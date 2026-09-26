import type { FastifyInstance } from "fastify";
import { searchQuery, type SearchHit } from "@orbyn/core";
import { reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { searchEverything } from "./service.js";

/** GET /search: the search service (service.ts), on the read replica. */
export async function searchRoutes(app: FastifyInstance) {
  app.get("/search", async (r): Promise<SearchHit[]> => {
    const u = await authenticate(r);
    const q = searchQuery.parse(r.query ?? {});
    return searchEverything(reader(r.headers), u.id, q, { semantic: true });
  });
}
