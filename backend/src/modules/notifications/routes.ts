import type { FastifyInstance } from "fastify";
import { fail } from "@orbyn/core";
import { pool, reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { visibleItems } from "../../lib/visibility.js";

/**
 * The in-app notification tray: reminders and conflicts (tied to an item the
 * person can still see) and booking notices (tied to a booking, in `ref`).
 */
export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", async (r) => {
    const u = await authenticate(r);
    return (
      await reader(r.headers).query(
        `SELECT n.id, n.title, n.body, n.read, n.created_at, n.kind, n.item_id, n.ref
         FROM notifications n LEFT JOIN items i ON i.id = n.item_id
         WHERE n.user_id = $1 AND n.channel = 'inapp'
           AND (n.item_id IS NULL OR ${visibleItems()})
         ORDER BY n.created_at DESC LIMIT 100`,
        [u.id],
      )
    ).rows;
  });

  app.post("/notifications/:id/read", async (r, reply) => {
    const u = await authenticate(r);
    const result = await pool.query(
      `UPDATE notifications n SET read = true
       WHERE n.id = $2 AND n.user_id = $1 AND n.channel = 'inapp'
         AND (n.item_id IS NULL
           OR EXISTS (SELECT 1 FROM items i WHERE i.id = n.item_id AND ${visibleItems()}))`,
      [u.id, idParam(r)],
    );
    if (!result.rowCount) fail(404, "Notification not found");
    return reply.code(204).send();
  });
}
