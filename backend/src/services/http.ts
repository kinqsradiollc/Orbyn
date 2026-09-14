import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
} from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";

/** Each deployable HTTP service, plus "all" for single-process mode. */
export type ServiceName = "api" | "ai" | "status" | "all";

const startedAt = Date.now();

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
    // Behind the gateway, the client address arrives in X-Forwarded-For.
    // Only enable where services are not reachable directly.
    trustProxy: env.TRUST_PROXY === "true",
  });
  await app.register(cors, {
    origin: env.CORS_ORIGINS.split(","),
    methods: ["GET", "POST", "PUT", "DELETE"],
  });
  await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });

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
      await pool.end();
      process.exit(0);
    });
}
