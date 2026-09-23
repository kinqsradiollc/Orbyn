import type { FastifyInstance } from "fastify";
import { askRoutes } from "./asks.js";
import { attentionRoutes } from "./attention.js";
import { memoryRoutes } from "./memory.js";
import { proofRoutes } from "./proof.js";
import { realityRoutes } from "./reality.js";
import { reentryRoutes } from "./reentry.js";

/**
 * Follow-through: plan reality and what-if, the re-entry brief, pages that
 * have gone quiet, negotiated asks, the team attention budget, and proof of
 * progress. All short requests on the API service.
 */
export async function followThroughRoutes(app: FastifyInstance) {
  await app.register(realityRoutes);
  await app.register(reentryRoutes);
  await app.register(memoryRoutes);
  await app.register(askRoutes);
  await app.register(attentionRoutes);
  await app.register(proofRoutes);
}
