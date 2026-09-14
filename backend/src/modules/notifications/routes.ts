import type { FastifyInstance } from "fastify";
import { fail } from "@orbyn/core";
import { pool } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";

/** The in-app notification tray. Rows are produced by the reminder worker. */
export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", async (r) => {
    const u = await authenticate(r);
    return (
      await pool.query(
        "SELECT id,title,body,read,created_at FROM notifications WHERE user_id=$1 AND channel='inapp' ORDER BY created_at DESC LIMIT 100",
        [u.id],
      )
    ).rows;
  });

  app.post("/notifications/:id/read", async (r, reply) => {
    const u = await authenticate(r);
    const result = await pool.query(
      "UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2",
      [idParam(r), u.id],
    );
    if (!result.rowCount) fail(404, "Notification not found");
    return reply.code(204).send();
  });
}
