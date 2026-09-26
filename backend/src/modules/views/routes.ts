import type { FastifyInstance } from "fastify";
import {
  fail,
  savedViewInput,
  savedViewUpdate,
  type SavedView,
} from "@orbyn/core";
import { z } from "zod";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { withReadContext } from "../../capabilities/execute.js";
import { sessionPrincipal } from "../../capabilities/policy.js";
import { groupsOf, runView } from "../../capabilities/query.js";
import { CapabilityError } from "../../capabilities/registry.js";
import {
  createView,
  deleteView,
  findView,
  listViews,
  updateView,
} from "./service.js";

/**
 * Saved views (DATA-01): a named filter, sort, grouping and layout, kept on
 * the account or shared with a team. The rows are worked out by the same
 * code the agents' query tool runs, so a view reads the same everywhere.
 */
export async function viewRoutes(app: FastifyInstance) {
  const every = (userId: string) => ({
    userId,
    teamIds: null,
    personal: true,
  });

  app.get("/views", async (r): Promise<SavedView[]> => {
    const u = await authenticate(r);
    return listViews(reader(r.headers), every(u.id));
  });

  app.post("/views", async (r, reply) => {
    const u = await authenticate(r);
    const d = savedViewInput.parse(r.body);
    const view = await transaction((db) => createView(db, u, d));
    reply.code(201);
    return view;
  });

  app.put("/views/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = savedViewUpdate.parse(r.body);
    return transaction((db) => updateView(db, u, id, d));
  });

  app.delete("/views/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction((db) => deleteView(db, u, id));
    return reply.code(204).send();
  });

  /** A view's rows, a page at a time (offset paging, 100 at most). */
  app.get("/views/:id/rows", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).max(10_000).default(0),
      })
      .parse(r.query ?? {});
    const principal = await sessionPrincipal(pool, u);
    return withReadContext(principal, "views.rows", { id }, async (ctx) => {
      const view = await findView(ctx.db, ctx.spaces, id);
      if (!view) fail(404, "View not found");
      const { rows, more } = await runView(
        ctx,
        view.definition,
        q.limit,
        q.offset,
      ).catch((e) =>
        e instanceof CapabilityError ? fail(422, e.message) : Promise.reject(e),
      );
      return {
        view,
        rows,
        groups: groupsOf(rows),
        next_offset: more ? q.offset + q.limit : null,
      };
    });
  });
}
