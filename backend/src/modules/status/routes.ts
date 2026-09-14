import type { FastifyInstance } from "fastify";
import { statusReport } from "./report.js";

/** The public status report. No sign-in: anyone can check uptime. */
export async function statusRoutes(app: FastifyInstance) {
  app.get("/status", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=15");
    return statusReport();
  });
}
