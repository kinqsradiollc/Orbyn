import type { FastifyInstance } from "fastify";
import { fail } from "@orbyn/core";
import { pool, reader } from "../../db/pool.js";
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
    return listNotifications(reader(r.headers), u.id);
  });

  app.post("/notifications/:id/read", async (r, reply) => {
    const u = await authenticate(r);
    const read = await markNotificationsRead(pool, u.id, [idParam(r)]);
    if (!read) fail(404, "Notification not found");
    return reply.code(204).send();
  });
}
