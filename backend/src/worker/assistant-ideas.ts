import { pool } from "../db/pool.js";
import { startAssistantAutomation } from "../modules/ai/agent/run.js";
import { assistantProviderAdmissionSql } from "../modules/ai/providers/admission.js";
import type { ResolvedAi } from "../modules/ai/providers/adapters.js";
import {
  FAILED_RETRY_HOURS,
  MAX_AUTOMATION_ATTEMPTS,
  jobDead,
  recentlyActive,
} from "./assistant-scan.js";

/** Each daily slot looks first at a different part of the person's work. */
const SLOT_FOCUS = [
  "tasks and deadlines that are slipping or not planned",
  "the calendar: free time, clashes and sessions to book",
  "study: due cards, exams and revision",
];

const IDEA_BATCH = 50;
const SLOTS = 3;

/**
 * SQL true when the idea slot on `d` may be claimed again: not finished,
 * under its daily tries, and its last try failed, died, or never queued a
 * job (after a few hours' wait).
 */
const slotClaimable = (d: string, now: string) => `(
  ${d}.finished_at IS NULL AND ${d}.attempts < ${MAX_AUTOMATION_ATTEMPTS} AND (
    (${d}.job_id IS NULL
      AND ${d}.claimed_at < ${now}::timestamptz - make_interval(hours => ${FAILED_RETRY_HOURS}))
    OR (${jobDead(`${d}.job_id`, now)}
      AND ${d}.claimed_at < ${now}::timestamptz - make_interval(hours => ${FAILED_RETRY_HOURS}))))`;

/** Create up to three ready-to-review ideas for each assistant user per local day. */
export async function scanAssistantIdeas(
  now = new Date(),
  options: {
    limit?: number;
    only?: string[];
    ai?: ResolvedAi | null;
    startAutomation?: typeof startAssistantAutomation;
  } = {},
) {
  if (options.ai === null) return 0;
  const limit = Math.max(1, Math.min(options.limit ?? IDEA_BATCH, 100));
  // Only people with an open slot today, least recently served first, so
  // everyone is reached however many use the assistant.
  const users = (
    await pool.query<{ user_id: string; timezone: string; day: string }>(
      `SELECT g.user_id, coalesce(p.timezone, 'UTC') AS timezone,
              local.day::text AS day
         FROM agent_grants g
         JOIN users u ON u.id = g.user_id AND NOT u.disabled
         LEFT JOIN planner_prefs p ON p.user_id = u.id
         CROSS JOIN LATERAL (
           SELECT ($3::timestamptz AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS day
         ) local
        WHERE g.kind = 'assistant' AND g.revoked_at IS NULL
          AND ${assistantProviderAdmissionSql("g.user_id", options.ai)}
          AND g.suspended_at IS NULL
          AND ${recentlyActive("g.user_id", "$3")}
          AND EXISTS (
            SELECT 1 FROM generate_series(1, ${SLOTS}) AS slot(n)
             WHERE NOT EXISTS (
               SELECT 1 FROM assistant_idea_days d
                WHERE d.user_id = g.user_id AND d.local_day = local.day
                  AND d.slot = slot.n AND NOT ${slotClaimable("d", "$3")}))
          AND ($1::uuid[] IS NULL OR g.user_id = ANY($1::uuid[]))
        ORDER BY (SELECT max(d.claimed_at) FROM assistant_idea_days d
                   WHERE d.user_id = g.user_id) NULLS FIRST, g.user_id
        LIMIT $2`,
      [options.only ?? null, limit, now],
    )
  ).rows;
  let started = 0;
  for (const user of users) {
    const day = user.day;
    for (let slot = 1; slot <= SLOTS; slot++) {
      const claimed = await pool.query(
        `INSERT INTO assistant_idea_days (user_id, local_day, slot, claimed_at, attempts)
         VALUES ($1, $2::date, $3, $4, 1)
         ON CONFLICT (user_id, local_day, slot) DO UPDATE
           SET claimed_at = EXCLUDED.claimed_at, job_id = NULL,
               attempts = assistant_idea_days.attempts + 1
         WHERE ${slotClaimable("assistant_idea_days", "$4")}
         RETURNING user_id`,
        [user.user_id, day, slot, now],
      );
      if (!claimed.rowCount) continue;
      // Ideas from the last week, so a slot doesn't suggest one again.
      const recent = (
        await pool.query<{ title: string }>(
          `SELECT title FROM assistant_ideas
            WHERE user_id = $1 AND created_at > $2::timestamptz - interval '7 days'
            ORDER BY created_at DESC LIMIT 10`,
          [user.user_id, now],
        )
      ).rows.map((r) => r.title.slice(0, 120));
      try {
        const jobId = await (
          options.startAutomation ?? startAssistantAutomation
        )({
          userId: user.user_id,
          timezone: user.timezone,
          automation: { kind: "idea", local_day: day, slot },
          message: [
            `Look across my current tasks, calendar, study load, deadlines and private Memory for one useful idea (slot ${slot} of up to 3 today). For this one, look first at ${SLOT_FOCUS[(slot - 1) % SLOT_FOCUS.length]}.`,
            ...(recent.length
              ? [
                  `Don't repeat an idea I already have: ${recent.map((t) => `"${t}"`).join("; ")}.`,
                ]
              : []),
            "Delegate to the relevant Planner, Study or Projects specialist when needed. Suggest one small, concrete change that is ready to apply, and include the reason in plain words. Do not invent facts, use kept-out projects, or apply anything directly. If nothing clearly helps, finish without changes.",
          ].join("\n\n"),
          onQueued: async (db, id) => {
            await db.query(
              `UPDATE assistant_idea_days SET job_id = $4
                WHERE user_id = $1 AND local_day = $2::date AND slot = $3`,
              [user.user_id, day, slot, id],
            );
          },
        });
        if (jobId) started++;
      } catch {
        // The slot keeps no job, so it is tried again after the backoff.
      }
    }
  }
  return started;
}
