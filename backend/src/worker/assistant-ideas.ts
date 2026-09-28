import { localDateKey } from "@orbyn/core";
import { pool } from "../db/pool.js";
import { startAssistantAutomation } from "../modules/ai/agent/run.js";

const CLAIM_RETRY_MINUTES = 30;
const IDEA_BATCH = 50;

/** Create up to three ready-to-review ideas for each assistant user per local day. */
export async function scanAssistantIdeas(
  now = new Date(),
  options: { limit?: number; only?: string[] } = {},
) {
  const limit = Math.max(1, Math.min(options.limit ?? IDEA_BATCH, 100));
  const users = (
    await pool.query<{ user_id: string; timezone: string }>(
      `SELECT g.user_id, coalesce(p.timezone, 'UTC') AS timezone
         FROM agent_grants g
         JOIN users u ON u.id = g.user_id AND NOT u.disabled
         LEFT JOIN planner_prefs p ON p.user_id = u.id
        WHERE g.kind = 'assistant' AND g.revoked_at IS NULL
          AND g.suspended_at IS NULL
          AND ($1::uuid[] IS NULL OR g.user_id = ANY($1::uuid[]))
        ORDER BY g.user_id LIMIT $2`,
      [options.only ?? null, limit],
    )
  ).rows;
  let started = 0;
  for (const user of users) {
    const day = localDateKey(now, user.timezone);
    for (let slot = 1; slot <= 3; slot++) {
      const claimed = await pool.query(
        `INSERT INTO assistant_idea_days (user_id, local_day, slot, claimed_at)
         VALUES ($1, $2::date, $3, $4)
         ON CONFLICT (user_id, local_day, slot) DO UPDATE SET claimed_at = EXCLUDED.claimed_at
         WHERE assistant_idea_days.finished_at IS NULL
           AND assistant_idea_days.claimed_at < $4 - make_interval(mins => $5)
         RETURNING user_id`,
        [user.user_id, day, slot, now, CLAIM_RETRY_MINUTES],
      );
      if (!claimed.rowCount) continue;
      try {
        const jobId = await startAssistantAutomation({
          userId: user.user_id,
          timezone: user.timezone,
          automation: { kind: "idea", local_day: day, slot },
          message: [
            `Look across my current tasks, calendar, study load, deadlines and private Memory for one useful idea (slot ${slot} of up to 3 today).`,
            "Delegate to the relevant Planner, Study or Projects specialist when needed. Suggest one small, concrete change that is ready to apply, and include the reason in plain words. Do not invent facts, use kept-out projects, or apply anything directly. If nothing clearly helps, finish without changes.",
          ].join("\n\n"),
        });
        if (jobId) started++;
      } catch {
        // A failed attempt remains eligible after the claim timeout.
      }
    }
  }
  return started;
}
