import { randomUUID } from "node:crypto";
import {
  nightShiftInput,
  readAssistantOutcome,
  type SystemRole,
} from "@orbyn/core";
import { pool, transaction, type Queryable } from "../db/pool.js";
import type { UserRow } from "../lib/auth.js";
import {
  startAssistantAutomation,
  stopAssistantJob,
} from "../modules/ai/agent/run.js";
import { readTerminalEvidence } from "../modules/ai/agent/terminal-evidence.js";
import { LEAD_TOKEN_BUDGET } from "../modules/ai/agent/lead.js";
import { assistantProviderAdmissionSql } from "../modules/ai/providers/admission.js";
import type { ResolvedAi } from "../modules/ai/providers/adapters.js";
import { assistantExecutionDigest } from "../modules/assistant-workspace/execution-authority.js";
import {
  assertRoutineRecoveryCurrent,
  lockRoutineRecovery,
  type RoutineRecoveryRow,
  type RoutineAttemptRow,
} from "../modules/assistant-workspace/routine-recovery.js";
import { assistantAdmissionOpen } from "../modules/assistant-workspace/work-controls.js";
import { bindConversationWork } from "../modules/assistant-workspace/conversation-delivery.js";
import { assistantNightWindow } from "./night-window.js";

async function transition(
  db: Queryable,
  row: RoutineRecoveryRow,
  state: RoutineRecoveryRow["recovery_state"],
  reason: string,
  next: Date | null = null,
) {
  if (
    row.recovery_state === state &&
    row.last_transition_reason === reason &&
    row.next_eligible_at?.getTime() === next?.getTime()
  )
    return;
  await db.query(
    `UPDATE assistant_routine_runs SET recovery_state=$2,last_transition_reason=$3,next_eligible_at=$4,
 revision=revision+1,recovery_updated_at=clock_timestamp() WHERE id=$1`,
    [row.id, state, reason, next],
  );
}
function proposalId(job: { result: any; apply_result: any }) {
  const raw =
    job.apply_result?.structured?.pending?.proposal_id ??
    job.result?.assistant_run?.proposal_id;
  const id = typeof raw === "string" ? raw.replace(/^proposal:/, "") : null;
  return id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

/** Settle existing attempts once; classified transient no-effect failures alone may retry. */
export async function settleRoutineRecoveries(
  lane: "background" | "overnight",
  now = new Date(),
  only?: string[],
) {
  const candidates = (
    await pool.query<{
      id: string;
      owner_id: string;
      attempt_id: string;
      job_id: string | null;
    }>(
      `SELECT r.id,r.owner_id,a.id AS attempt_id,a.job_id FROM assistant_routine_runs r
   JOIN assistant_routine_attempts a ON a.occurrence_id=r.id AND a.ordinal=r.attempt_count
   LEFT JOIN ai_jobs j ON j.id=a.job_id
   LEFT JOIN proposals p ON p.user_id=r.owner_id AND p.id::text=regexp_replace(coalesce(j.apply_result->'structured'->'pending'->>'proposal_id',j.result->'assistant_run'->>'proposal_id'),'^proposal:','')
   WHERE r.recovery_version=1 AND r.lane=$1 AND ($2::uuid[] IS NULL OR r.owner_id=ANY($2::uuid[])) AND (
    (a.settled_at IS NULL AND (j.id IS NULL OR j.state IN ('done','failed') OR r.deadline<=$3
      OR (r.recovery_state IN ('stopped','limited') AND j.cancel_requested)
      OR (j.state IN ('queued','running') AND r.recovery_state<>'active') OR (j.state='waiting' AND r.recovery_state<>'waiting')))
    OR (a.settled_at IS NOT NULL AND r.recovery_state='waiting' AND (j.id IS NULL OR j.state IN ('done','failed'))
      AND (j.id IS NULL OR r.deadline<=$3 OR p.status IS DISTINCT FROM 'pending' OR p.expires_at<=now()))
   )
   ORDER BY CASE WHEN r.deadline<=$3 OR j.id IS NULL OR j.state IN ('done','failed') THEN 0 ELSE 1 END,r.recovery_updated_at,r.id LIMIT 30`,
      [lane, only ?? null, now],
    )
  ).rows;
  let settled = 0;
  const cancellations: { owner: string; job: string; deadline: boolean }[] = [];
  for (const candidate of candidates)
    await transaction(async (db) => {
      const job = candidate.job_id
        ? (
            await db.query<{
              id: string;
              state: string;
              result: any;
              apply_result: any;
              terminal_evidence: unknown;
              cancel_requested: boolean;
            }>(
              "SELECT id,state,result,apply_result,terminal_evidence,cancel_requested FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE",
              [candidate.job_id, candidate.owner_id],
            )
          ).rows[0]
        : null;
      const row = await lockRoutineRecovery(
        db,
        candidate.owner_id,
        candidate.id,
      );
      const attempt = (
        await db.query<RoutineAttemptRow>(
          "SELECT * FROM assistant_routine_attempts WHERE id=$1 AND occurrence_id=$2 FOR UPDATE",
          [candidate.attempt_id, row.id],
        )
      ).rows[0];
      if (!attempt || attempt.ordinal !== row.attempt_count) return;
      if (job && ["queued", "running", "waiting"].includes(job.state)) {
        if (
          row.recovery_state === "stopped" ||
          row.recovery_state === "limited" ||
          now >= row.deadline
        ) {
          const deadline = row.recovery_state !== "stopped";
          if (deadline)
            await transition(
              db,
              row,
              "limited",
              "The occurrence time or allowance limit was reached.",
            );
          await db.query(
            "UPDATE ai_jobs SET cancel_requested=true,cancel_reason=$3 WHERE id=$1 AND user_id=$2",
            [job.id, row.owner_id, deadline ? "deadline" : "stopped"],
          );
          if (job.state !== "running")
            cancellations.push({ owner: row.owner_id, job: job.id, deadline });
        } else
          await transition(
            db,
            row,
            job.state === "waiting" ? "waiting" : "active",
            job.state === "waiting"
              ? "This occurrence needs your decision."
              : "An attempt is in progress.",
          );
        return;
      }
      // Capture qualification before settling, while this exact attempt still owns its binding.
      let authority = true;
      if (
        !attempt.settled_at &&
        !["stopped", "completed", "limited"].includes(row.recovery_state)
      ) {
        try {
          await assertRoutineRecoveryCurrent(
            db,
            row.owner_id,
            {
              occurrence_id: row.id,
              attempt_id: attempt.id,
              generation: attempt.generation,
              ordinal: attempt.ordinal,
            },
            { jobId: job?.id },
          );
        } catch {
          authority = false;
        }
      }
      const terminal = job
        ? readTerminalEvidence(job.terminal_evidence, job.id)
        : null;
      if (!attempt.settled_at) {
        const usage = job
          ? (
              await db.query<{ used: string }>(
                "SELECT coalesce(sum(coalesce(reported_tokens,reserved_tokens)),0)::text AS used FROM assistant_work_reservations WHERE job_id=$1",
                [job.id],
              )
            ).rows[0]
          : null;
        const estimate = job?.result?.assistant_run?.token_estimate;
        const charged = Math.max(
          Number(usage?.used ?? 0),
          Number.isSafeInteger(estimate) && estimate >= 0
            ? estimate
            : attempt.allocated_tokens,
        );
        await db.query(
          `UPDATE assistant_routine_attempts SET settled_at=$2,settled_tokens=$3,state=$4,terminal_evidence=$5::jsonb,result_digest=$6 WHERE id=$1 AND settled_at IS NULL`,
          [
            attempt.id,
            now,
            charged,
            job?.state ?? "unavailable",
            terminal ? JSON.stringify(terminal) : null,
            job?.result ? assistantExecutionDigest(job.result) : null,
          ],
        );
        await db.query(
          `UPDATE assistant_routine_runs SET consumed_tokens=consumed_tokens+$2,reserved_tokens=greatest(0,reserved_tokens-$3),revision=revision+1,recovery_updated_at=clock_timestamp() WHERE id=$1`,
          [row.id, charged, attempt.allocated_tokens],
        );
        row.consumed_tokens += charged;
        row.reserved_tokens = Math.max(
          0,
          row.reserved_tokens - attempt.allocated_tokens,
        );
        settled++;
      }
      if (
        ["stopped", "completed", "limited"].includes(row.recovery_state) ||
        row.generation !== attempt.generation
      )
        return;
      if (!job || !authority) {
        await transition(
          db,
          row,
          "held",
          "The routine configuration, authority or retained execution evidence changed. Review before continuing.",
        );
        return;
      }
      if (
        (job.cancel_requested && terminal?.cause !== "deadline") ||
        terminal?.cause === "stopped"
      ) {
        await db.query(
          "UPDATE assistant_routine_runs SET recovery_state='stopped',generation=generation+1,revision=revision+1,next_eligible_at=NULL,last_transition_reason='This occurrence was stopped.',recovery_updated_at=clock_timestamp() WHERE id=$1",
          [row.id],
        );
        return;
      }
      if (
        terminal?.cause === "deadline" ||
        (now >= row.deadline && job.state === "failed")
      ) {
        await transition(
          db,
          row,
          "limited",
          "The occurrence time limit was reached. Review any saved result.",
        );
        return;
      }
      if (
        !terminal ||
        terminal.effects === "uncertain" ||
        terminal.retry === "reconcile"
      ) {
        await transition(
          db,
          row,
          "held",
          "The effect outcome could not be confirmed. This occurrence will not be repeated automatically.",
        );
        return;
      }
      const proposal = proposalId(job);
      if ((terminal.effects === "pending" || proposal) && now >= row.deadline) {
        await transition(
          db,
          row,
          "limited",
          "The occurrence time limit was reached. Any saved Review remains available for your decision.",
        );
        return;
      }
      if (terminal.effects === "pending" || proposal) {
        const p = proposal
          ? (
              await db.query<{ status: string }>(
                "SELECT CASE WHEN status='pending' AND expires_at<=now() THEN 'expired' ELSE status END AS status FROM proposals WHERE id=$1 AND user_id=$2",
                [proposal, row.owner_id],
              )
            ).rows[0]
          : null;
        await transition(
          db,
          row,
          p?.status === "pending"
            ? "waiting"
            : p?.status === "applied"
              ? "completed"
              : "held",
          p?.status === "pending"
            ? "The saved changes are waiting in Review."
            : p?.status === "applied"
              ? "The saved Review was applied. This occurrence finished."
              : "Review was not applied. No replacement plan was created.",
        );
        return;
      }
      if (job.state === "done") {
        const outcome = readAssistantOutcome(
          job.result?.assistant_run?.execution_outcome,
        );
        const useful =
          outcome &&
          outcome.job_id === job.id &&
          ![
            "partial",
            "failed",
            "interrupted",
            "uncertain",
            "waiting",
          ].includes(outcome.outcome) &&
          !outcome.open_questions.length &&
          outcome.checks.every((c) => c.status === "passed");
        await transition(
          db,
          row,
          useful ? "completed" : "held",
          useful
            ? "This occurrence finished."
            : "The occurrence is incomplete. Review its saved result; it will not be replayed.",
        );
        return;
      }
      if (terminal.retry !== "eligible" || terminal.effects !== "none") {
        await transition(
          db,
          row,
          "held",
          "This failure does not qualify for an automatic retry.",
        );
        return;
      }
      const delay = Math.min(
        3600,
        row.policy_snapshot.backoff_seconds * 2 ** (attempt.ordinal - 1),
      );
      const eligible = new Date(now.getTime() + delay * 1000);
      if (
        row.attempt_count >= row.policy_snapshot.max_attempts ||
        row.consumed_tokens >= row.policy_snapshot.token_limit ||
        eligible >= row.deadline
      ) {
        await transition(
          db,
          row,
          "limited",
          "The cumulative occurrence attempt, token or time limit was reached.",
        );
        return;
      }
      await transition(
        db,
        row,
        "retry_scheduled",
        "A transient failure had confirmed no effects. Another bounded attempt is scheduled.",
        eligible,
      );
    });
  for (const cancellation of cancellations) {
    const user = (
      await pool.query<UserRow>("SELECT * FROM users WHERE id=$1", [
        cancellation.owner,
      ])
    ).rows[0];
    if (user)
      await stopAssistantJob(cancellation.job, user, undefined, {
        deadline: cancellation.deadline,
      });
  }
  return settled;
}

/** One new job under the same occurrence, admitted atomically with its predecessor. */
export async function scanRoutineRetries(
  lane: "background" | "overnight",
  now = new Date(),
  options: {
    only?: string[];
    limit?: number;
    ai?: ResolvedAi | null;
    startAutomation?: typeof startAssistantAutomation;
  } = {},
) {
  if (options.ai === null) return 0;
  const candidates = (
    await pool.query<{ id: string; owner_id: string; job_id: string | null }>(
      `SELECT r.id,r.owner_id,a.job_id FROM assistant_routine_runs r JOIN assistant_routine_attempts a ON a.occurrence_id=r.id AND a.ordinal=r.attempt_count
   WHERE r.recovery_version=1 AND r.lane=$1 AND r.recovery_state='retry_scheduled' AND r.next_eligible_at<=$2
   AND ($3::uuid[] IS NULL OR r.owner_id=ANY($3::uuid[])) AND ${assistantProviderAdmissionSql("r.owner_id", options.ai)} ORDER BY r.next_eligible_at,r.id LIMIT $4`,
      [
        lane,
        now,
        options.only ?? null,
        Math.max(1, Math.min(options.limit ?? 10, 30)),
      ],
    )
  ).rows;
  let started = 0;
  for (const candidate of candidates)
    await transaction(async (db) => {
      if (candidate.job_id)
        await db.query(
          "SELECT id FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [candidate.job_id, candidate.owner_id],
        );
      const row = await lockRoutineRecovery(
        db,
        candidate.owner_id,
        candidate.id,
      );
      if (
        row.recovery_state !== "retry_scheduled" ||
        !row.next_eligible_at ||
        row.next_eligible_at > now
      )
        return;
      if (
        now >= row.deadline ||
        row.attempt_count >= row.policy_snapshot.max_attempts ||
        row.consumed_tokens + row.reserved_tokens >=
          row.policy_snapshot.token_limit
      ) {
        await transition(
          db,
          row,
          "limited",
          "The cumulative occurrence attempt, token or time limit was reached.",
        );
        return;
      }
      if (!(await assistantAdmissionOpen(db, row.owner_id, lane))) return;
      const previous = (
        await db.query<RoutineAttemptRow>(
          "SELECT * FROM assistant_routine_attempts WHERE occurrence_id=$1 ORDER BY ordinal DESC LIMIT 1 FOR UPDATE",
          [row.id],
        )
      ).rows[0];
      if (!previous?.job_id || !previous.settled_at) {
        await transition(
          db,
          row,
          "held",
          "The previous attempt evidence is unavailable. This occurrence will not be repeated.",
        );
        return;
      }
      const terminal = readTerminalEvidence(
        previous.terminal_evidence,
        previous.job_id,
      );
      if (
        !terminal ||
        terminal.retry !== "eligible" ||
        terminal.effects !== "none"
      ) {
        await transition(
          db,
          row,
          "held",
          "The previous attempt has no current safe retry qualification.",
        );
        return;
      }
      try {
        await assertRoutineRecoveryCurrent(
          db,
          row.owner_id,
          {
            occurrence_id: row.id,
            attempt_id: previous.id,
            generation: row.generation,
            ordinal: previous.ordinal,
          },
          { admit: true, now },
        );
      } catch {
        await transition(
          db,
          row,
          "held",
          "The routine configuration, provider or source authority changed. Review before continuing.",
        );
        return;
      }
      if (
        (
          await db.query(
            "SELECT id FROM assistant_routine_runs WHERE routine_id=$1 AND scheduled_for>$2 LIMIT 1",
            [row.routine_id, row.scheduled_for],
          )
        ).rowCount
      ) {
        await transition(
          db,
          row,
          "held",
          "A newer scheduled occurrence already exists. The older occurrence will not be repeated.",
        );
        return;
      }
      const user = (
        await db.query<{ role: SystemRole; timezone: string }>(
          "SELECT u.role,coalesce(p.timezone,'UTC') AS timezone FROM users u LEFT JOIN planner_prefs p ON p.user_id=u.id WHERE u.id=$1 AND NOT u.disabled",
          [row.owner_id],
        )
      ).rows[0];
      if (!user) return;
      let allocation = Math.min(
        LEAD_TOKEN_BUDGET,
        row.policy_snapshot.token_limit -
          row.consumed_tokens -
          row.reserved_tokens,
      );
      let night: { id: string; end: Date; wait: boolean } | undefined;
      if (lane === "overnight") {
        const locked = (
          await db.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_xact_lock(hashtext('assistant-night:'||$1)) AS locked",
            [row.owner_id],
          )
        ).rows[0];
        if (!locked.locked) return;
        if (
          (
            await db.query(
              "SELECT id FROM ai_jobs WHERE user_id=$1 AND runtime_lane='overnight' AND state IN ('queued','running') UNION ALL SELECT id FROM assistant_page_runs WHERE user_id=$1 AND lane='overnight' AND state IN ('queued','running') LIMIT 1",
              [row.owner_id],
            )
          ).rowCount
        )
          return;
        const prefs = nightShiftInput.safeParse(
          (
            await db.query(
              "SELECT night_shift FROM agent_settings WHERE user_id=$1",
              [row.owner_id],
            )
          ).rows[0]?.night_shift,
        );
        if (
          !prefs.success ||
          !prefs.data.enabled ||
          !prefs.data.kinds.follow_through
        )
          return;
        const window = assistantNightWindow(now, prefs.data);
        if (!window) return;
        const created = await db.query(
          "INSERT INTO assistant_nights(user_id,local_day) VALUES($1,$2::date) ON CONFLICT DO NOTHING RETURNING id",
          [row.owner_id, window.localDay],
        );
        const n = (
          await db.query<{
            id: string;
            status: string;
            runs: number;
            budget_used: number;
            budget: number;
          }>(
            "SELECT n.*,s.night_token_budget AS budget FROM assistant_nights n CROSS JOIN ai_settings s WHERE n.user_id=$1 AND n.local_day=$2::date AND s.id FOR UPDATE OF n",
            [row.owner_id, window.localDay],
          )
        ).rows[0];
        if (n.status !== "running" || n.runs >= 10) return;
        allocation = Math.min(allocation, n.budget - n.budget_used);
        if (allocation <= 0) return;
        if (created.rowCount)
          await bindConversationWork(db, {
            ownerId: row.owner_id,
            work: { kind: "night", id: n.id },
            lane: "overnight",
            timezone: user.timezone,
            sourcesChecked: true,
            notBefore: window.end,
          });
        night = { id: n.id, end: window.end, wait: prefs.data.wait_for_ok };
      }
      const attemptId = randomUUID(),
        ordinal = row.attempt_count + 1;
      const id = await (options.startAutomation ?? startAssistantAutomation)({
        userId: row.owner_id,
        timezone: user.timezone,
        title: `Routine retry ${ordinal}: ${row.instruction_snapshot.slice(0, 75)}`,
        message: `Run this same scheduled Orbyn Assistant occurrence: ${row.instruction_snapshot}\n\nIts previous attempt had confirmed no effects and a qualified transient failure. Use current authorized sources and existing saved approval scopes. Do not replay any saved plan or broaden permission. Scheduled occurrence: ${row.scheduled_for.toISOString()}.`,
        automation: {
          kind: "routine",
          id: row.routine_id,
          recipient_lane: lane,
          routine_recovery: {
            occurrence_id: row.id,
            attempt_id: attemptId,
            generation: row.generation,
            ordinal,
          },
          token_budget: allocation,
          end_at: new Date(
            Math.min(row.deadline.getTime(), night?.end.getTime() ?? Infinity),
          ).toISOString(),
          ...(night
            ? {
                night_id: night.id,
                night_kind: "routine",
                source_kind: "routine" as const,
                wait_for_ok: night.wait,
              }
            : {}),
        },
        db,
        ...(row.destination_id
          ? {
              deliveryDestinationId: row.destination_id,
              deliveryPersonalOnly: row.personal_only,
            }
          : {}),
        onQueued: async (inside, jobId) => {
          await inside.query(
            `INSERT INTO assistant_routine_attempts(id,occurrence_id,owner_id,ordinal,parent_attempt_id,job_id,generation,allocated_tokens) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              attemptId,
              row.id,
              row.owner_id,
              ordinal,
              previous.id,
              jobId,
              row.generation,
              allocation,
            ],
          );
          await inside.query(
            `UPDATE assistant_routine_runs SET recovery_state='active',attempt_count=$2,reserved_tokens=reserved_tokens+$3,next_eligible_at=NULL,revision=revision+1,last_transition_reason='A bounded retry was queued.',recovery_updated_at=clock_timestamp() WHERE id=$1`,
            [row.id, ordinal, allocation],
          );
          await inside.query(
            "UPDATE agent_routines SET current_job_id=$2,claimed_at=now(),updated_at=now() WHERE id=$1 AND user_id=$3",
            [row.routine_id, jobId, row.owner_id],
          );
          if (night) {
            await inside.query(
              "INSERT INTO assistant_night_runs(night_id,job_id,kind) VALUES($1,$2,'routine')",
              [night.id, jobId],
            );
            await inside.query(
              "UPDATE assistant_nights SET runs=runs+1,updated_at=now() WHERE id=$1",
              [night.id],
            );
          }
        },
      });
      if (id) started++;
    });
  return started;
}
