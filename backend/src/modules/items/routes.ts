import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { itemData, pagination } from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { mutate } from "./service.js";

export async function itemRoutes(app: FastifyInstance) {
  app.get("/items", async (r) => {
    const u = await authenticate(r);
    const q = pagination.parse(r.query);
    return (
      await pool.query(
        "SELECT * FROM items WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3",
        [u.id, q.limit, q.offset],
      )
    ).rows;
  });

  app.post("/items", async (r, reply) => {
    const u = await authenticate(r);
    const data = itemData.parse(r.body);
    const item = await transaction((db) =>
      mutate(db, u.id, { operation: "create", data }),
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
      mutate(db, u.id, {
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
      mutate(db, u.id, {
        operation: "delete",
        item_id: idParam(r),
        version: q.version,
      }),
    );
    return reply.code(204).send();
  });
}
