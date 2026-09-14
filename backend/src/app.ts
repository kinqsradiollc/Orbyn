import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { authRoutes } from "./modules/auth/routes.js";
import { userRoutes } from "./modules/users/routes.js";
import { itemRoutes } from "./modules/items/routes.js";
import { deviceRoutes } from "./modules/devices/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { aiRoutes } from "./modules/ai/routes.js";

/** Build the HTTP API. Each feature lives in `modules/<name>/routes.ts`. */
export async function buildApp() {
  const app = Fastify({
    logger: { redact: ["req.headers.authorization", "req.body.password"] },
    bodyLimit: 65536,
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
    return { status: "ok" };
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(itemRoutes);
  await app.register(deviceRoutes);
  await app.register(notificationRoutes);
  await app.register(aiRoutes);
  return app;
}
