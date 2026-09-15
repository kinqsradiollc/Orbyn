import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  fail,
  profileInput,
  type Profile,
  type PublicProfile,
} from "@orbyn/core";
import { pool, reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { appLink } from "./service.js";

/**
 * Your public profile: /u/<handle> shows your name, a short bio and the
 * active booking pages you own or host. Nothing else about you is shown.
 */
const profileOf = (row: { handle: string | null; bio: string }): Profile => ({
  handle: row.handle,
  bio: row.bio,
  url: row.handle ? appLink(`/u/${row.handle}`) : null,
});

export async function profileRoutes(app: FastifyInstance) {
  app.get("/me/profile", async (r): Promise<Profile> => {
    const u = await authenticate(r);
    return profileOf(u as unknown as { handle: string | null; bio: string });
  });

  app.put("/me/profile", async (r): Promise<Profile> => {
    const u = await authenticate(r);
    const d = profileInput.parse(r.body);
    const row = (
      await pool
        .query<{ handle: string | null; bio: string }>(
          `UPDATE users SET
             handle = CASE WHEN $2 THEN $3 ELSE handle END,
             bio = coalesce($4, bio)
           WHERE id = $1 RETURNING handle, bio`,
          [u.id, d.handle !== undefined, d.handle ?? null, d.bio ?? null],
        )
        .catch((error: { code?: string }) =>
          error.code === "23505"
            ? fail(409, "That name is taken. Try another.")
            : Promise.reject(error),
        )
    ).rows[0];
    return profileOf(row);
  });

  app.get("/u/:handle", async (r): Promise<PublicProfile> => {
    const { handle } = z
      .object({ handle: z.string().trim().toLowerCase().max(40) })
      .parse(r.params);
    const db = reader(r.headers);
    const user = (
      await db.query<{ id: string; name: string; handle: string; bio: string }>(
        "SELECT id, name, handle, bio FROM users WHERE handle = $1 AND NOT disabled",
        [handle],
      )
    ).rows[0];
    if (!user) fail(404, "There's no profile at this address.");
    const pages = (
      await db.query<PublicProfile["pages"][number]>(
        `SELECT p.title, p.slug, p.description, p.durations, p.color FROM booking_pages p
         WHERE p.active AND (p.owner_id = $1
           OR p.id IN (SELECT page_id FROM booking_hosts WHERE user_id = $1))
         ORDER BY p.created_at`,
        [user.id],
      )
    ).rows;
    return { name: user.name, handle: user.handle, bio: user.bio, pages };
  });
}
