import type { FastifyInstance } from "fastify";
import { deviceData, fail } from "@orbyn/core";
import { pool } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";

/** Expo push token registration. A token belongs to exactly one account. */
export async function deviceRoutes(app: FastifyInstance) {
  app.post("/devices", async (r, reply) => {
    const u = await authenticate(r);
    const d = deviceData.parse(r.body);
    const result = await pool.query(
      "INSERT INTO devices(token,user_id) VALUES($1,$2) ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id WHERE devices.user_id=EXCLUDED.user_id RETURNING token",
      [d.token, u.id],
    );
    if (!result.rowCount)
      fail(409, "Sign out of the previous account on this device first");
    return reply.code(204).send();
  });

  app.delete("/devices", async (r, reply) => {
    const u = await authenticate(r);
    const d = deviceData.parse(r.body);
    await pool.query("DELETE FROM devices WHERE token=$1 AND user_id=$2", [
      d.token,
      u.id,
    ]);
    return reply.code(204).send();
  });
}
