import type { FastifyInstance } from "fastify";
import { pool } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { keptOutFor } from "../../lib/assistant-off.js";

function mentionsKeptOut(value: unknown, hidden: Set<string>): boolean {
  if (typeof value === "string") {
    for (const match of value.matchAll(/[0-9a-f-]{36}/gi))
      if (hidden.has(match[0].toLowerCase())) return true;
    return false;
  }
  if (Array.isArray(value))
    return value.some((entry) => mentionsKeptOut(entry, hidden));
  if (value && typeof value === "object")
    return Object.values(value).some((entry) => mentionsKeptOut(entry, hidden));
  return false;
}

/** The signed-in person's recent Assistant ideas, excluding kept-out work. */
export async function assistantIdeasRoutes(app: FastifyInstance) {
  app.get("/me/assistant/ideas", async (r) => {
    const user = await authenticate(r);
    const keptOut = await keptOutFor(pool, user.id);
    const hidden = new Set([...keptOut.ids, ...keptOut.projects]);
    const rows = (
      await pool.query<{
        id: string;
        title: string;
        summary: string;
        proposal_id: string | null;
        proposal_status: string | null;
        changes: unknown;
        created_at: Date;
      }>(
        `SELECT i.id, i.title, i.summary, i.proposal_id,
                p.status AS proposal_status, p.changes, i.created_at
           FROM assistant_ideas i LEFT JOIN proposals p ON p.id = i.proposal_id
          WHERE i.user_id = $1 AND i.local_day >= current_date - 6
          ORDER BY i.local_day DESC, i.created_at DESC LIMIT 21`,
        [user.id],
      )
    ).rows;
    return rows
      .filter(
        (row) =>
          !mentionsKeptOut([row.changes, row.title, row.summary], hidden),
      )
      .map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        proposal_id: row.proposal_id,
        status: row.proposal_status ?? "expired",
        created_at: row.created_at.toISOString(),
      }));
  });
}
