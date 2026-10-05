import { HttpError } from "@orbyn/core";
import { pool, transaction } from "../db/pool.js";
import type { UserRow } from "../lib/auth.js";
import { visibleDocs } from "../lib/visibility.js";
import { assistantPrincipal } from "../modules/agents/assistant.js";
import { queueMaintainedPageRun } from "../modules/docs/maintenance-runs.js";
import { nightShiftOwns } from "./assistant-scan.js";

let afterBinding: string | null = null;

/** Bounded round-robin due scan; authority locks precede document/binding locks. */
export async function scanMaintainedPages(
  now = new Date(),
  options: { limit?: number; only?: string[] } = {},
): Promise<number> {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
  // Do not lock a binding here: the context guard owns the canonical lock order.
  const due = (
    await pool.query<{ id: string; user_id: string }>(
      `SELECT b.id,b.user_id FROM assistant_page_bindings b
       JOIN users u ON u.id=b.user_id AND NOT u.disabled
       JOIN agent_grants g ON g.id=b.agent_grant_id AND g.user_id=u.id
       JOIN docs d ON d.id=b.doc_id
       WHERE NOT b.paused AND NOT b.schedule_exhausted AND b.next_run_at<=$1
         AND g.revoked_at IS NULL AND g.suspended_at IS NULL
         AND (g.expires_at IS NULL OR g.expires_at>$1)
         AND ${visibleDocs("d", { user: "b.user_id", ai: true })}
         AND NOT ${nightShiftOwns("b.user_id")}
         AND NOT EXISTS(SELECT 1 FROM assistant_page_runs r WHERE r.binding_id=b.id
           AND r.state IN ('queued','running','waiting'))
         AND ($2::uuid[] IS NULL OR b.user_id=ANY($2::uuid[]))
       ORDER BY (b.id>$3::uuid) DESC NULLS LAST,b.id LIMIT $4`,
      [now, options.only ?? null, afterBinding, limit],
    )
  ).rows;
  let queued = 0;
  for (const binding of due) {
    afterBinding = binding.id;
    try {
      const run = await transaction(async (db) => {
        const user = (
          await db.query<UserRow>(
            "SELECT * FROM users WHERE id=$1 AND NOT disabled",
            [binding.user_id],
          )
        ).rows[0];
        if (!user) return null;
        const principal = await assistantPrincipal(user, { db, touch: false });
        return queueMaintainedPageRun(db, user, principal, binding.id, now, {
          kind: "background",
        });
      });
      if (run) queued++;
    } catch (error) {
      // Changed ownership/source/schedule is a hold, not a reason to advance it.
      if (!(error instanceof HttpError)) throw error;
    }
  }
  return queued;
}
