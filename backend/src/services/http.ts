import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
} from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { createHash } from "node:crypto";
import { closeDatabase, pool } from "../db/pool.js";
import { authenticate } from "../lib/auth.js";
import { cachedSettings, settings } from "../lib/settings.js";
import { versionInfo } from "../lib/version.js";

/** Each deployable HTTP service, plus "all" for single-process mode. */
export type ServiceName = "api" | "ai" | "status" | "all";

const startedAt = Date.now();
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const OPEN_DURING_MAINTENANCE = ["/auth/", "/admin/", "/devices", "/ai/chat"];

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
    // While a copy shuts down during a deploy, keep answering requests that
    // arrive on connections the gateway already holds, instead of replying
    // 503; the gateway moves to the new copies as those connections close.
    return503OnClosing: false,
    // Behind the gateway, the client address arrives in X-Forwarded-For.
    // Only enable where services are not reachable directly.
    trustProxy: env.TRUST_PROXY === "true",
  });
  // Allowed origins and the rate limit come from live settings (Admin ->
  // System, falling back to .env), so changing them needs no restart.
  await settings();
  await app.register(cors, {
    origin: (origin, cb) =>
      cb(null, !origin || cachedSettings().cors_origins.includes(origin)),
    methods: ["GET", "POST", "PUT", "DELETE"],
    exposedHeaders: ["ETag"],
  });
  // Sign-in and AI routes set their own stricter limits, which always apply.
  // The general per-client limit can be left to the gateway (0).
  await app.register(rateLimit, {
    global: true,
    max: () => {
      const limit = cachedSettings().rate_limit_per_minute;
      return limit > 0 ? limit : 1_000_000;
    },
    timeWindow: "1 minute",
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
      return reply
        .code(422)
        .send({ message: err.issues.map((i) => i.message).join("; ") });
    const e = err as Error & { statusCode?: number; code?: string };
    if (e.code === "23505")
      return reply.code(409).send({ message: "This record already exists." });
    const code = e.statusCode || 500;
    if (code >= 500) request.log.error({ err: e }, "Request failed");
    reply
      .code(code)
      .send({ message: code === 500 ? "Unexpected server error" : e.message });
  });

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
  app.get("/health", async () => {
    await pool.query("SELECT 1");
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
