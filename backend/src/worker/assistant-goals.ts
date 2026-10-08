import { assistantSourceVisible } from "../lib/assistant-source-visibility.js";
import type { SystemRole } from "@orbyn/core";
import { pool } from "../db/pool.js";
import { startAssistantAutomation } from "../modules/ai/agent/run.js";
import { assistantProviderAdmissionSql } from "../modules/ai/providers/admission.js";
import type { ResolvedAi } from "../modules/ai/providers/adapters.js";
import {
  FAILED_RETRY_HOURS,
  MAX_AUTOMATION_ATTEMPTS,
  assistantActive,
  nightShiftOwns,
  jobDead,
} from "./assistant-scan.js";

/** A claim that never queued a job (the worker stopped) is retried after this. */
const CLAIM_RETRY_MINUTES = 30;
const GOAL_BATCH = 10;

type GoalDue = {
  id: string;
  user_id: string;
  user_name: string;
  role: SystemRole;
  timezone: string;
  title: string;
  target: string;
  target_date: string | null;
  project_id: string | null;
  plan_doc_id: string | null;
  week_of: string;
};

/**
 * SQL true when the check-in on `c` may be claimed again. A finished check-in
 * never is. A failed one waits a few hours; a running one only when its job
 * failed or died, or it never queued one. Each week allows a few tries.
 */
export const checkinClaimable = (c: string, now: string) => `(
  ${c}.status <> 'done' AND ${c}.attempts < ${MAX_AUTOMATION_ATTEMPTS} AND (
    (${c}.status = 'failed'
      AND ${c}.claimed_at < ${now}::timestamptz - make_interval(hours => ${FAILED_RETRY_HOURS}))
    OR (${c}.status IN ('running', 'scheduled') AND (
      ${c}.claimed_at IS NULL
      OR (${c}.job_id IS NULL
        AND ${c}.claimed_at < ${now}::timestamptz - make_interval(mins => ${CLAIM_RETRY_MINUTES}))
      OR ${jobDead(`${c}.job_id`, now)}))))`;

/** Start a bounded weekly run for each active goal, once in the local week. */
export async function scanAssistantGoals(
  now = new Date(),
  options: {
    limit?: number;
    only?: string[];
    ai?: ResolvedAi | null;
    startAutomation?: typeof startAssistantAutomation;
  } = {},
) {
  if (options.ai === null) return 0;
  const limit = Math.max(1, Math.min(options.limit ?? GOAL_BATCH, 50));
  const goals = (
    await pool.query<GoalDue>(
      `SELECT g.id, g.user_id, u.name AS user_name, u.role,
              coalesce(p.timezone, 'UTC') AS timezone, g.title, g.target,
              g.target_date::text AS target_date, g.project_id, g.plan_doc_id,
              wk.week_of::text AS week_of
         FROM goals g JOIN users u ON u.id = g.user_id AND NOT u.disabled
         LEFT JOIN planner_prefs p ON p.user_id = u.id
         CROSS JOIN LATERAL (
           SELECT date_trunc('week',
             $3::timestamptz AT TIME ZONE coalesce(p.timezone, 'UTC'))::date AS week_of
         ) wk
         LEFT JOIN goals_checkins c ON c.goal_id = g.id AND c.week_of = wk.week_of
        WHERE g.status = 'active' AND ${assistantSourceVisible("'goal'", "g.id", "g.user_id")}
          AND ${assistantActive("g.user_id")}
          AND ${assistantProviderAdmissionSql("g.user_id", options.ai)}
          AND NOT ${nightShiftOwns("g.user_id")}
          AND NOT EXISTS (
            SELECT 1 FROM projects hidden
             WHERE hidden.assistant_off AND (
               hidden.id = g.project_id OR EXISTS (
                 SELECT 1 FROM docs plan
                  WHERE plan.id = g.plan_doc_id AND plan.project_id = hidden.id
               )
             )
          )
          AND (c.id IS NULL OR ${checkinClaimable("c", "$3")})
          AND ($1::uuid[] IS NULL OR g.user_id = ANY($1::uuid[]))
        ORDER BY c.claimed_at NULLS FIRST, g.updated_at, g.id LIMIT $2`,
      [options.only ?? null, limit, now],
    )
  ).rows;
  let started = 0;
  for (const goal of goals) {
    const week = goal.week_of;
    const claimed = await pool.query(
      `INSERT INTO goals_checkins
         (goal_id, user_id, week_of, summary, progress, status, claimed_at, attempts)
       SELECT $1, $2, $3::date, 'Weekly review in progress', '{}'::jsonb, 'running', $4, 1 FROM goals g WHERE g.id=$1 AND g.user_id=$2 AND ${assistantSourceVisible("'goal'", "g.id", "$2")} AND NOT ${nightShiftOwns("g.user_id")}
       ON CONFLICT (goal_id, week_of) DO UPDATE
         SET summary = 'Weekly review in progress', status = 'running',
             job_id = NULL, claimed_at = EXCLUDED.claimed_at,
             attempts = goals_checkins.attempts + 1
       WHERE ${checkinClaimable("goals_checkins", "$4")}
       RETURNING goal_id`,
      [goal.id, goal.user_id, week, now],
    );
    if (!claimed.rowCount) continue;
    const message = [
      `Do the weekly check-in for my goal “${goal.title}”.`,
      goal.target ? `Target: ${goal.target}` : "",
      goal.target_date ? `Target date: ${goal.target_date}` : "",
      `Week beginning: ${week}. Review progress against current tasks, sessions, deadlines, study and the goal's Agent plan note. Point out slipping work and re-plan it through the relevant specialist when useful. Keep changes within this goal and ask before anything outside the assistant's saved approval scope.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      const jobId = await (options.startAutomation ?? startAssistantAutomation)(
        {
          userId: goal.user_id,
          message,
          timezone: goal.timezone,
          automation: { kind: "goal", id: goal.id, week_of: week },
          title: `Weekly check-in: ${goal.title}`,
          onQueued: async (db, id) => {
            await db.query(
              `UPDATE goals_checkins SET job_id = $3, claimed_at = now(), status = 'running'
                WHERE goal_id = $1 AND week_of = $2::date AND status = 'running'`,
              [goal.id, week, id],
            );
          },
        },
      );
      if (jobId) started++;
      else
        await pool.query(
          `UPDATE goals_checkins SET status = 'failed', claimed_at = now()
            WHERE goal_id = $1 AND week_of = $2::date AND job_id IS NULL`,
          [goal.id, week],
        );
    } catch {
      await pool.query(
        `UPDATE goals_checkins SET status = 'failed', claimed_at = now()
          WHERE goal_id = $1 AND week_of = $2::date AND job_id IS NULL`,
        [goal.id, week],
      );
    }
  }
  return started;
}
