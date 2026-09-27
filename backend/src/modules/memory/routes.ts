import type { FastifyInstance } from "fastify";
import { fail } from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import { authenticate, isApiKeyRequest } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { announceDocChange } from "../docs/live.js";
import { forgetMemory } from "./service.js";

/** Private Memory actions available to the signed-in person in Orbyn. */
export async function memoryRoutes(app: FastifyInstance) {
  app.delete("/me/memory/:id", async (request) => {
    const user = await authenticate(request);
    if (isApiKeyRequest(request))
      fail(403, "Only you, signed in to Orbyn, can forget private Memory.");
    const id = idParam(request);
    const removed = await transaction(async (db) => {
      const removed = await forgetMemory(db, user.id, "", {
        onlyDocId: id,
        includeKeptOut: true,
      });
      if (!removed.docs.length) fail(404, "Memory note not found");
      return removed.docs;
    });
    for (const doc of removed)
      await announceDocChange(pool, doc.id, doc.version + 1, user.id, {
        forgotten: true,
      });
    return { forgotten: true };
  });
}
