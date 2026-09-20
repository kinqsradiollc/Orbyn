import type { FastifyInstance } from "fastify";
import { fail, preferences, type Session } from "@orbyn/core";
import { pool } from "../../db/pool.js";
import {
  authenticate,
  bearerToken,
  digest,
  publicUser,
} from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";

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

  // Where you're signed in. The current session is flagged so the app can
  // label it and keep you from signing yourself out by surprise.
  app.get("/me/sessions", async (r): Promise<Session[]> => {
    const u = await authenticate(r);
    const here = digest(bearerToken(r));
    const rows = (
      await pool.query<{
        id: string;
        created_at: Date;
        last_seen_at: Date;
        user_agent: string;
        current: boolean;
      }>(
        `SELECT id, created_at, last_seen_at, user_agent, token_hash = $2 AS current
           FROM sessions WHERE user_id = $1 AND expires_at > now()
           ORDER BY last_seen_at DESC`,
        [u.id, here],
      )
    ).rows;
    return rows.map((s) => ({
      id: s.id,
      created_at: s.created_at.toISOString(),
      last_seen_at: s.last_seen_at.toISOString(),
      user_agent: s.user_agent,
      current: s.current,
    }));
  });

  // Sign out one other device. Signing out the current one is /auth/logout.
  app.delete("/me/sessions/:id", async (r, reply) => {
    const u = await authenticate(r);
    const here = digest(bearerToken(r));
    const gone = await pool.query(
      "DELETE FROM sessions WHERE id = $1 AND user_id = $2 AND token_hash <> $3",
      [idParam(r), u.id, here],
    );
    if (!gone.rowCount)
      fail(404, "That session isn't signed in, or it's this one.");
    return reply.code(204).send();
  });

  // Sign out everywhere except right here.
  app.post("/me/sessions/revoke-others", async (r) => {
    const u = await authenticate(r);
    const here = digest(bearerToken(r));
    const gone = await pool.query(
      "DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2",
      [u.id, here],
    );
    return { signed_out: gone.rowCount ?? 0 };
  });
}
