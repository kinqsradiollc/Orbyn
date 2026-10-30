import { readRoutineRunLimits } from "../modules/assistant-workspace/routine-run-limits.js";
import { prepareRoutineRecovery } from "../modules/assistant-workspace/routine-recovery.js";
import { nextOccurrence, type SystemRole } from "@orbyn/core";
import { pool, transaction } from "../db/pool.js";
import { startAssistantAutomation } from "../modules/ai/agent/run.js";
import { assistantProviderAdmissionSql } from "../modules/ai/providers/admission.js";
import type { ResolvedAi } from "../modules/ai/providers/adapters.js";
import { recordRoutineRun } from "../modules/assistant-workspace/routine-runs.js";
import {
  assistantActive,
  jobReleased,
  nightShiftOwns,
} from "./assistant-scan.js";

const CLAIM_RETRY_MINUTES = 30;
const ROUTINE_BATCH = 10;

type RoutineDue = {
  id: string;
  user_id: string;
  user_name: string;
  role: SystemRole;
  instruction: string;
  rrule: string;
  timezone: string;
  next_run_at: Date;
  scheduled_for: string;
  intent_version: number;
};
/** Claim and run due Orbyn Assistant routines without holding a DB lock in the model call. */
export async function scanAssistantRoutines(
  now = new Date(),
  options: {
    limit?: number;
    only?: string[];
    ai?: ResolvedAi | null;
    startAutomation?: typeof startAssistantAutomation;
  } = {},
) {
  if (options.ai === null) return 0;
  const limit = Math.max(1, Math.min(options.limit ?? ROUTINE_BATCH, 50));
  const routines = await transaction(async (db) => {
    const rows = (
      await db.query<RoutineDue>(
        `SELECT r.id, r.user_id, u.name AS user_name, u.role, r.instruction,
                r.rrule, r.timezone, r.next_run_at, r.next_run_at::text AS scheduled_for,r.recovery_intent_version AS intent_version
           FROM agent_routines r JOIN users u ON u.id = r.user_id AND NOT u.disabled
          WHERE r.paused = false AND r.next_run_at <= $1
            AND NOT EXISTS(SELECT 1 FROM assistant_routine_runs recovery WHERE recovery.routine_id=r.id AND recovery.recovery_version=1 AND recovery.recovery_state IN ('active','waiting','retry_scheduled','held'))
          AND ${assistantProviderAdmissionSql("r.user_id", options.ai)}
            -- A job that finished, failed, died or waits too long on the
            -- person no longer holds the routine (after a restart, say).
            AND ${jobReleased("r.current_job_id", "$1")}
            AND ${assistantActive("r.user_id")}
            AND NOT ${nightShiftOwns("r.user_id")}
            AND (r.claimed_at IS NULL OR r.claimed_at < $1 - make_interval(mins => $2))
            AND ($3::uuid[] IS NULL OR r.user_id = ANY($3::uuid[]))
          ORDER BY r.next_run_at, r.id LIMIT $4
          FOR UPDATE OF r SKIP LOCKED`,
        [now, CLAIM_RETRY_MINUTES, options.only ?? null, limit],
      )
    ).rows;
    const claimed = [] as (RoutineDue & {
      next_run_at_after_claim: Date | null;
    })[];
    for (const row of rows) {
      let next: Date | null;
      try {
        next = nextOccurrence(row.next_run_at, row.rrule, row.timezone, now);
      } catch {
        // One bad schedule pauses its own routine, never the whole batch.
        await db.query(
          `UPDATE agent_routines SET paused = true, claimed_at = NULL,
             last_result = $2::jsonb, updated_at = now()
           WHERE id = $1`,
          [
            row.id,
            JSON.stringify({
              error:
                "This routine's schedule could not be read, so it was paused. Edit its schedule to resume it.",
            }),
          ],
        );
        continue;
      }
      await db.query(
        `UPDATE agent_routines SET claimed_at = $2, updated_at = now()
         WHERE id = $1`,
        [row.id, now],
      );
      claimed.push({ ...row, next_run_at_after_claim: next });
    }
    return claimed;
  });

  let started = 0;
  for (const routine of routines) {
    const message = [
      `Run my scheduled Orbyn Assistant routine: ${routine.instruction}`,
      `This routine repeats using ${routine.rrule} in ${routine.timezone}. Use the current workspace, follow the built-in assistant's saved approval scopes, and report what you completed or what needs my attention.`,
    ].join("\n\n");
    try {
      const limits = await transaction((db) =>
        readRoutineRunLimits(db, routine.user_id, routine.id),
      );
      const prepared = await transaction((db) =>
        prepareRoutineRecovery(
          db,
          routine.user_id,
          routine.id,
          "background",
          routine.scheduled_for,
          {
            nextScheduledFor:
              routine.next_run_at_after_claim?.toISOString() ?? null,
            now,
            expectedIntentVersion: routine.intent_version,
            allocationCap: limits.token_limit,
          },
        ),
      );
      const jobId = await (options.startAutomation ?? startAssistantAutomation)(
        {
          userId: routine.user_id,
          message,
          timezone: routine.timezone,
          automation: {
            kind: "routine",
            id: routine.id,
            token_budget: Math.min(
              limits.token_limit,
              prepared?.allocation ?? Infinity,
            ),
            max_active_work_ms: limits.active_work_minutes * 60_000,
            ...(prepared
              ? {
                  routine_recovery: prepared.binding,
                  end_at: prepared.deadline,
                }
              : {}),
          },
          title: `Routine: ${routine.instruction}`,
          onQueued: async (db, id) => {
            const queued = await db.query(
              `UPDATE agent_routines SET current_job_id = $2,
               next_run_at = coalesce($3, next_run_at),
               paused = CASE WHEN $3::timestamptz IS NULL THEN true ELSE paused END,
               claimed_at = now(), updated_at = now()
              WHERE id = $1 AND claimed_at = $4 AND recovery_intent_version=$5 AND NOT paused AND NOT ${nightShiftOwns("agent_routines.user_id")}`,
              [
                routine.id,
                id,
                routine.next_run_at_after_claim,
                now,
                routine.intent_version,
              ],
            );
            if (!queued.rowCount)
              throw new Error("The routine claim expired before queueing.");
            await recordRoutineRun(
              db,
              routine.user_id,
              routine.id,
              routine.scheduled_for,
              id,
              prepared,
            );
          },
        },
      );
      if (jobId) started++;
      else
        await pool.query(
          `UPDATE agent_routines SET claimed_at = NULL,
             last_result = $3::jsonb, updated_at = now()
            WHERE id = $1 AND user_id = $2 AND claimed_at = $4`,
          [
            routine.id,
            routine.user_id,
            JSON.stringify({ error: "The scheduled run could not start." }),
            now,
          ],
        );
    } catch {
      await pool.query(
        `UPDATE agent_routines SET claimed_at = NULL,
           last_result = $3::jsonb, updated_at = now()
          WHERE id = $1 AND user_id = $2 AND claimed_at = $4`,
        [
          routine.id,
          routine.user_id,
          JSON.stringify({ error: "The scheduled run could not start." }),
          now,
        ],
      );
    }
  }
  return started;
}
