import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { itemData, itemsQuery } from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam, VISIBLE_ITEMS } from "../../lib/teams.js";
import { mutate } from "./service.js";

export async function itemRoutes(app: FastifyInstance) {
  app.get("/items", async (r) => {
    const u = await authenticate(r);
    const q = itemsQuery.parse(r.query);
    if (q.team_id) await requireTeam(q.team_id, u, "items:read");
    return (
      await pool.query(
        `SELECT i.*, t.name AS team_name FROM items i LEFT JOIN teams t ON t.id=i.team_id
         WHERE ${VISIBLE_ITEMS} AND ($4::uuid IS NULL OR i.team_id=$4)
         ORDER BY i.created_at DESC, i.id LIMIT $2 OFFSET $3`,
        [u.id, q.limit, q.offset, q.team_id ?? null],
      )
    ).rows;
  });

  app.post("/items", async (r, reply) => {
    const u = await authenticate(r);
    const data = itemData.parse(r.body);
    const item = await transaction((db) =>
      mutate(db, u, { operation: "create", data }),
    );
    reply.code(201);
    return item;
  });

  app.put("/items/:id", async (r) => {
    const u = await authenticate(r);
    const { version, ...raw } = z
      .object({ version: z.number().int().positive() })
      .passthrough()
      .parse(r.body);
    const data = itemData.parse(raw);
    return transaction((db) =>
      mutate(db, u, {
        operation: "update",
        data,
        item_id: idParam(r),
        version,
      }),
    );
  });

  app.delete("/items/:id", async (r, reply) => {
    const u = await authenticate(r);
    const q = z
      .object({ version: z.coerce.number().int().positive() })
      .parse(r.query);
    await transaction((db) =>
      mutate(db, u, {
        operation: "delete",
        item_id: idParam(r),
        version: q.version,
      }),
    );
    return reply.code(204).send();
  });
}
