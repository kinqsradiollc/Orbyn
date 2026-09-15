import type { FastifyInstance } from "fastify";
import { preferences } from "@orbyn/core";
import { pool } from "../../db/pool.js";
import { authenticate, publicUser } from "../../lib/auth.js";

export async function userRoutes(app: FastifyInstance) {
  app.get("/me", async (r) => publicUser(await authenticate(r)));

  app.put("/me", async (r) => {
    const u = await authenticate(r);
    const d = preferences.parse(r.body);
    return publicUser(
      (
        await pool.query(
          "UPDATE users SET email_reminders=$1 WHERE id=$2 RETURNING *",
          [d.email_reminders, u.id],
        )
      ).rows[0],
    );
  });
}
