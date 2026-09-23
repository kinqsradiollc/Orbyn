import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
} from "fastify";
import { recordRequests } from "../lib/request-log.js";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { createHash, randomUUID } from "node:crypto";
import { closeDatabase, pool } from "../db/pool.js";
import { apiKeyId, authenticate } from "../lib/auth.js";
import { cachedSettings, settings } from "../lib/settings.js";
import { versionInfo } from "../lib/version.js";
import { idempotency } from "../lib/idempotency.js";

/** Each deployable HTTP service, plus "all" for single-process mode. */
export type ServiceName = "api" | "ai" | "status" | "realtime" | "all";

const startedAt = Date.now();
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const OPEN_DURING_MAINTENANCE = ["/auth/", "/admin/", "/devices", "/ai/chat"];
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
      const user = await authenticate(request).catch(() => null);
      if (user?.role === "admin") return;
      return reply.code(503).send({
        message: maintenance.message
          ? `Orbyn is under maintenance: ${maintenance.message}`
          : "Orbyn is under maintenance. Changes are paused for a moment.",
        maintenance: true,
      });
    });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ZodError)
      return reply.code(422).send({
        // Name the field, so a rejected value says which one to fix.
        message: err.issues
          .map(
            (i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message,
          )
          .join("; "),
      });
    const e = err as Error & { statusCode?: number; code?: string };
    if (e.code === "23505")
      return reply.code(409).send({ message: "This record already exists." });
    const code = e.statusCode || 500;
    if (code >= 500) request.log.error({ err: e }, "Request failed");
    reply
      .code(code)
      .send({ message: code === 500 ? "Unexpected server error" : e.message });
  });

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
