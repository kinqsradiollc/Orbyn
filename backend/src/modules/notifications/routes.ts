import type { FastifyInstance } from "fastify";
import { fail } from "@orbyn/core";
import { pool, reader, readTransaction } from "../../db/pool.js";
import { listNotifications, markNotificationsRead } from "./service.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";

/**
 * The in-app notification tray: reminders and conflicts (tied to an item the
 * person can still see) and booking notices (tied to a booking, in `ref`).
 */
export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", async (r) => {
    const u = await authenticate(r);
    return readTransaction((db) => listNotifications(db, u.id), {
      primary: reader(r.headers) === pool,
      jit: false,
    });
  });

  app.post("/notifications/:id/read", async (r, reply) => {
    const u = await authenticate(r);
    const read = await markNotificationsRead(pool, u.id, [idParam(r)]);
    if (!read) fail(404, "Notification not found");
    return reply.code(204).send();
  });
}
