import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
} from "fastify";
import { recordRequests } from "../lib/request-log.js";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "@orbyn/core";
import { createHash, randomUUID } from "node:crypto";
import { closeDatabase, pool } from "../db/pool.js";
import { apiKeyId, authenticate, isApiKeyRequest } from "../lib/auth.js";
import { cachedSettings, settings } from "../lib/settings.js";
import { versionInfo } from "../lib/version.js";
import { idempotency } from "../lib/idempotency.js";

/** The field a validation issue is about, in words ("start time", "title"). */
const fieldOf = (path: PropertyKey[]) => {
  const last = [...path].reverse().find((p) => typeof p === "string");
  return typeof last === "string" ? last.replace(/_/g, " ") : "";
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A rejected request in a sentence or two people can act on ("Title is too
 * long: 200 characters at most."), from Zod's issues. Hand-written messages
 * (refinements) are used as they are.
 */
export function validationMessage(
  issues: {
    code: string;
    path: PropertyKey[];
    message: string;
    origin?: string;
    maximum?: number | bigint;
    minimum?: number | bigint;
    format?: string;
    input?: unknown;
  }[],
): string {
  const one = (i: (typeof issues)[number]) => {
    // A message written in the schema ("Colours look like #376c51") is for
    // people already, and says which field when it has one; Zod's own
    // ("Invalid input: …", "Too big: …") aren't.
    if (
      !/^(Invalid|Too (big|small)|Expected|Unrecognized|Required)\b/.test(
        i.message,
      )
    ) {
      const text = /[.!?]$/.test(i.message) ? i.message : `${i.message}.`;
      const name = fieldOf(i.path);
      return name ? `${capital(name)}: ${text}` : text;
    }
    const field = fieldOf(i.path);
    const Field = capital(field || "a value");
    switch (i.code) {
      case "too_big":
        return i.origin === "string"
          ? `${Field} is too long: ${i.maximum} characters at most.`
          : i.origin === "array" || i.origin === "set"
            ? `Too many ${field || "items"}: ${i.maximum} at most.`
            : `${Field} must be ${i.maximum} or less.`;
      case "too_small":
        return i.origin === "string"
          ? Number(i.minimum) <= 1
            ? `${Field} can't be empty.`
            : `${Field} is too short: at least ${i.minimum} characters.`
          : i.origin === "array" || i.origin === "set"
            ? `Add at least ${i.minimum} ${field || "items"}.`
            : `${Field} must be at least ${i.minimum}.`;
      case "invalid_type":
        return i.input === undefined
          ? `${Field} is missing.`
          : `${Field} isn't the right kind of value.`;
      case "invalid_format":
        return i.format === "email"
          ? `${Field} isn't a valid email address.`
          : i.format === "url"
            ? `${Field} isn't a valid link.`
            : i.format === "datetime" || i.format === "date"
              ? `${Field} isn't a valid date.`
              : `${Field} isn't in the right format.`;
      case "invalid_value":
        return `${Field} isn't one of the choices.`;
      case "unrecognized_keys":
        return "Some of what was sent isn't recognised. Refresh and try again.";
      case "custom":
        return i.message;
      default:
        return `${Field} isn't valid.`;
    }
  };
  const messages = [...new Set(issues.map(one))];
  return messages.slice(0, 2).join(" ") || "Something in that isn't valid.";
}

/** Each deployable HTTP service, plus "all" for single-process mode. */
export type ServiceName =
  "api" | "ai" | "status" | "realtime" | "files" | "all";

const startedAt = Date.now();
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const OPEN_DURING_MAINTENANCE = ["/auth/", "/admin/", "/devices", "/ai/chat"];
/**
 * Paths that answer maintenance mode themselves: MCP lets reads through and
 * turns writes into a JSON-RPC error its clients understand.
 */
const OWN_MAINTENANCE = new Set(["/mcp"]);
/** Paths anyone with a link can open: booking pages, invites, profiles, RSVPs. */
const PUBLIC_PAGES = /^\/(book|invite|u|rsvp)(\/|$)/;

/**
 * Fastify with the plugins, error handling, and `/health` endpoint every
 * service shares. `modules` are the route plugins this service exposes.
 */
export async function createService(
  name: ServiceName,
  modules: FastifyPluginAsync[],
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      base: { service: name },
      redact: [
        "req.headers.authorization",
        "req.body.password",
        "req.body.api_key",
      ],
    },
    bodyLimit: 65536,
    // Route parameters may be long: a signed upload link for importing into
    // Docs (/files/u/<link>) is about 250 characters, past the default 100.
    routerOptions: { maxParamLength: 1024 },
    // The gateway's request id when it sent a sane one, so a request can be
    // followed from nginx through the service that answered it.
    requestIdHeader: false,
    genReqId: (req) => {
      const given = req.headers["x-request-id"];
      return typeof given === "string" && /^[\w-]{8,64}$/.test(given)
        ? given
        : randomUUID();
    },
    // While a copy shuts down during a deploy, keep answering requests that
    // arrive on connections the gateway already holds, instead of replying
    // 503; the gateway moves to the new copies as those connections close.
    return503OnClosing: false,
    // Behind the gateway, the client address arrives in X-Forwarded-For.
    // Only enable where services are not reachable directly.
    trustProxy: env.TRUST_PROXY === "true",
  });
  // WebDAV methods CalDAV clients use, with an XML body parser for them.
  for (const method of ["PROPFIND", "REPORT", "PROPPATCH", "MKCALENDAR"])
    app.addHttpMethod(method, { hasBody: true });
  app.addContentTypeParser(
    ["application/xml", "text/xml"],
    { parseAs: "string" },
    (_req, body, done) => done(null, body),
  );
  // CalDAV clients PUT events as iCalendar text.
  app.addContentTypeParser(
    "text/calendar",
    { parseAs: "string" },
    (_req, body, done) => done(null, body),
  );

  // Allowed origins and the rate limit come from live settings (Admin ->
  // System, falling back to .env), so changing them needs no restart.
  await settings();
  await app.register(cors, {
    origin: (origin, cb) =>
      cb(null, !origin || cachedSettings().cors_origins.includes(origin)),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    exposedHeaders: [
      "ETag",
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
      "Retry-After",
    ],
  });
  // Sign-in and AI routes set their own stricter limits, which always apply.
  // The general per-client limit can be left to the gateway (0). Requests
  // signed with a personal API key count against that key, wherever they
  // come from; everything else counts per address. Every response says
  // where the client stands (RateLimit-Limit, -Remaining, -Reset), and a
  // 429 says when to try again (Retry-After, in seconds).
  await app.register(rateLimit, {
    global: true,
    max: () => {
      const limit = cachedSettings().rate_limit_per_minute;
      return limit > 0 ? limit : 1_000_000;
    },
    timeWindow: "1 minute",
    enableDraftSpec: true,
    keyGenerator: async (request) => {
      const key = await apiKeyId(request).catch(() => null);
      return key ? `key:${key}` : request.ip;
    },
  });

  // Every request is traced for the admin console (batched, off the request path).
  recordRequests(app, name);

  // Public booking, invite, profile and RSVP responses aren't for search engines.
  app.addHook("onRequest", async (request, reply) => {
    if (PUBLIC_PAGES.test(request.url.split("?")[0]))
      reply.header("X-Robots-Tag", "noindex, nofollow");
  });

  // Maintenance mode: members can read but not change anything. Admins,
  // sign-in, device registration and the assistant's chat stay open.
  if (name !== "status")
    app.addHook("onRequest", async (request, reply) => {
      if (!WRITES.has(request.method)) return;
      const { maintenance } = await settings();
      if (!maintenance.enabled) return;
      const path = request.url.split("?")[0];
      if (OPEN_DURING_MAINTENANCE.some((p) => path.startsWith(p))) return;
      if (OWN_MAINTENANCE.has(path)) return;
      const user = await authenticate(request).catch(() => null);
      // An admin's own session may keep working; an admin's API key may not.
      if (user?.role === "admin" && !isApiKeyRequest(request)) return;
      return reply.code(503).send({
        message: maintenance.message
          ? `Orbyn is under maintenance: ${maintenance.message}`
          : "Orbyn is under maintenance. Changes are paused for a moment.",
        maintenance: true,
      });
    });

  // Every error reply carries a plain message people can act on and the
  // request id (to find it in the logs). The technical detail goes in
  // `detail` only with DEBUG_ERRORS on; it's always in the logs.
  const debugErrors = env.DEBUG_ERRORS === "true";
  app.setErrorHandler((err, request, reply) => {
    const body = (message: string, detail?: string) => ({
      message,
      request_id: request.id,
      ...(debugErrors && detail ? { detail } : {}),
    });
    if (err instanceof ZodError) {
      const detail = err.issues
        .map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message)
        .join("; ");
      request.log.debug({ issues: detail }, "Invalid request");
      return reply.code(422).send(body(validationMessage(err.issues), detail));
    }
    const e = err as Error & {
      statusCode?: number;
      code?: string;
      validation?: unknown;
    };
    if (e.code === "23505")
      return reply.code(409).send(body("This already exists.", e.message));
    const code = e.statusCode || 500;
    // Messages the code wrote itself (fail()) are meant for people, even a
    // 503 such as "No mail server is set up yet".
    if (err instanceof HttpError) {
      if (code >= 500) request.log.error({ err: e }, "Request failed");
      return reply.code(code).send(body(e.message));
    }
    if (code >= 500) {
      request.log.error({ err: e }, "Request failed");
      return reply
        .code(code)
        .send(
          body(
            "Something went wrong on our side. Try again in a moment.",
            e.message,
          ),
        );
    }
    // Fastify's own errors (bad JSON, an unknown route, too large, too many
    // requests) are written for developers; say what they mean instead.
    if (e.code?.startsWith("FST_") || e.validation) {
      const plain =
        code === 404
          ? "That isn't here any more."
          : code === 413
            ? "That's too large to send."
            : code === 429
              ? "That's a lot at once. Wait a moment and try again."
              : code === 415
                ? "That kind of content can't be sent here."
                : "That request couldn't be read. Refresh and try again.";
      return reply.code(code).send(body(plain, e.message));
    }
    reply.code(code).send(body(e.message));
  });

  // An address nothing answers: the same shape as every other error.
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      message: "That isn't here any more.",
      request_id: request.id,
      ...(debugErrors
        ? {
            detail: `No route for ${request.method} ${request.url.split("?")[0]}`,
          }
        : {}),
    }),
  );

  // Changes sent with an Idempotency-Key happen once (offline replays).
  if (name !== "status") idempotency(app);

  // Conditional GETs: unchanged responses cost a 304 with no body, which
  // keeps the apps' polling cheap in bandwidth and client work.
  app.addHook("onSend", async (request, reply, payload) => {
    if (
      request.method !== "GET" ||
      reply.statusCode !== 200 ||
      typeof payload !== "string"
    )
      return payload;
    const etag = `W/"${createHash("sha1").update(payload).digest("base64url")}"`;
    reply.header("ETag", etag);
    if (!reply.getHeader("Cache-Control"))
      reply.header("Cache-Control", "private, no-cache");
    if (request.headers["if-none-match"] === etag) {
      reply.code(304);
      return "";
    }
    return payload;
  });

  /** The build this instance runs. */
  app.get("/version", async () => versionInfo(name));

  /** Liveness: the process is up. No database, so a database blip never restarts every instance. */
  app.get("/live", async () => ({ status: "ok", service: name }));

  /** Readiness: this instance can serve traffic, including the database. */
  app.get("/health", async (_r, reply) => {
    try {
      await pool.query("SELECT 1");
    } catch {
      // Not ready (503), so load balancers route around this instance.
      return reply.code(503).send({
        status: "unavailable",
        service: name,
        message: "The database isn't reachable.",
      });
    }
    return {
      status: "ok",
      service: name,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
    };
  });

  for (const module of modules) await app.register(module);
  return app;
}

/** Listen on `port` and shut down cleanly on SIGINT/SIGTERM. */
export async function startService(
  app: FastifyInstance,
  port: number,
  onStop: () => void | Promise<void> = () => {},
) {
  await app.listen({ host: "0.0.0.0", port });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await onStop();
      await app.close();
      await closeDatabase();
      process.exit(0);
    });
}
