import type { FastifyInstance } from "fastify";
import { fail } from "@orbyn/core";
import { pool, reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";

/** The in-app notification tray. Rows are produced by the reminder worker. */
export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", async (r) => {
    const u = await authenticate(r);
    return (
      await reader(r.headers).query(
        `SELECT n.id,n.title,n.body,n.read,n.created_at
         FROM notifications n JOIN items i ON i.id=n.item_id
         WHERE n.user_id=$1 AND n.channel='inapp' AND ${VISIBLE_ITEMS}
         ORDER BY n.created_at DESC LIMIT 100`,
        [u.id],
      )
    ).rows;
  });

  app.post("/notifications/:id/read", async (r, reply) => {
    const u = await authenticate(r);
    const result = await pool.query(
      `UPDATE notifications n SET read=true FROM items i
       WHERE n.item_id=i.id AND n.id=$2 AND n.user_id=$1
         AND n.channel='inapp' AND ${VISIBLE_ITEMS}`,
      [u.id, idParam(r)],
    );
    if (!result.rowCount) fail(404, "Notification not found");
    return reply.code(204).send();
  });
}
