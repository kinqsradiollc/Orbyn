import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TeamChange, TeamChangesPage } from "@orbyn/core";
import { reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";

const query = z.object({
  /** One team; every team you are in when left out. */
  team_id: z.uuid().optional(),
  /** Leave out what you did yourself. On unless turned off. */
  hide_mine: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v !== "false" && v !== "0"),
  /** Changes before this moment (the previous page's `next`). */
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

type Row = Omit<TeamChange, "at" | "first_at"> & {
  at: Date;
  first_at: Date;
};

/**
 * Recent changes (SHR-02): who created, edited, finished or deleted which of
 * a team's pages and tasks, newest first, for everyone in the team. The
 * triggers in migration 116 write them; this only reads.
 */
export async function teamChangeRoutes(app: FastifyInstance) {
  app.get("/changes", async (r): Promise<TeamChangesPage> => {
    const u = await authenticate(r);
    const q = query.parse(r.query ?? {});
    const db = reader(r.headers);
    // A team named must be one you are in; the same 404 as any team page.
    if (q.team_id) await requireTeam(q.team_id, u, "items:read");
    const rows = (
      await db.query<Row>(
        `SELECT c.id, c.team_id, t.name AS team_name, c.user_id,
                who.name AS user_name, c.kind, c.object_id, c.title, c.action,
                c.edits, c.first_at, c.at,
                CASE c.kind
                  WHEN 'page' THEN EXISTS (
                    SELECT 1 FROM docs d WHERE d.id = c.object_id
                       AND d.deleted_at IS NULL AND d.team_id = c.team_id)
                  ELSE EXISTS (
                    SELECT 1 FROM items i WHERE i.id = c.object_id
                       AND i.team_id = c.team_id)
                END AS open
           FROM team_changes c
           JOIN teams t ON t.id = c.team_id
           LEFT JOIN users who ON who.id = c.user_id
          WHERE c.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
            AND ($2::uuid IS NULL OR c.team_id = $2)
            AND (NOT $3::boolean OR c.user_id IS DISTINCT FROM $1)
            AND ($4::timestamptz IS NULL OR c.at < $4)
          ORDER BY c.at DESC, c.id
          LIMIT $5`,
        [u.id, q.team_id ?? null, q.hide_mine, q.before ?? null, q.limit + 1],
      )
    ).rows;
    const more = rows.length > q.limit;
    const shown = rows.slice(0, q.limit);
    return {
      changes: shown.map((c) => ({
        ...c,
        edits: Number(c.edits),
        at: c.at.toISOString(),
        first_at: c.first_at.toISOString(),
      })),
      next: more ? shown[shown.length - 1].at.toISOString() : null,
    };
  });
}
