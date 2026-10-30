import { randomUUID } from "node:crypto";
import {
  goalExecutionUnit,
  nightShiftInput,
  assistantOutcomeReceipt,
  type GoalExecutionOutput,
  type SystemRole,
} from "@orbyn/core";
import { pool, transaction, type Queryable } from "../db/pool.js";
import { startAssistantAutomation } from "../modules/ai/agent/run.js";
import { LEAD_TOKEN_BUDGET, goalUnitResult } from "../modules/ai/agent/lead.js";
import {
  goalEvidenceDigest,
  captureGoalOutputs,
} from "../modules/ai/agent/goal-execution.js";
import {
  readTerminalEvidence,
  readStoredAssistantApplyEffect,
} from "../modules/ai/agent/terminal-evidence.js";
import {
  assertGoalExecutionCurrent,
  lockGoalExecution,
  type GoalExecutionRow,
} from "../modules/assistant-workspace/goal-executions.js";
import { assistantJobSourcesVisible } from "../lib/assistant-job-sources.js";
import { assistantChatVisible } from "../lib/assistant-visibility.js";
import { assistantNightWindow } from "./night-window.js";
import { bindConversationWork } from "../modules/assistant-workspace/conversation-delivery.js";
import { assistantAdmissionOpen } from "../modules/assistant-workspace/work-controls.js";
import type { ResolvedAi } from "../modules/ai/providers/adapters.js";
import { assistantProviderAdmissionSql } from "../modules/ai/providers/admission.js";

type Attempt = {
  id: string;
  unit_id: string;
  mode: "work" | "verify" | "repair";
  ordinal: number;
  generation: number;
  allocated_tokens: number;
  settled_at: Date | null;
  job_id: string | null;
};
async function transition(
  db: Queryable,
  row: GoalExecutionRow,
  state: string,
  reason: string,
  units = row.units,
  currentJob: string | null = null,
) {
  await db.query(
    `UPDATE assistant_goal_executions SET state=$2,last_transition_reason=$3,units=$4::jsonb,current_job_id=$5,
    revision=revision+1,frontier_revision=frontier_revision+1,evidence_revision=evidence_revision+1,updated_at=now() WHERE id=$1`,
    [row.id, state, reason, JSON.stringify(units), currentJob],
  );
}

/** Observe existing jobs; never turn a process result into accepted goal completion. */
export async function settleGoalExecutions(
  lane: "background" | "overnight",
  now = new Date(),
  only?: string[],
) {
  const candidates = (
    await pool.query<{
      id: string;
      owner_id: string;
      current_job_id: string | null;
    }>(
      `SELECT e.id,e.owner_id,coalesce(e.current_job_id,(SELECT a.job_id FROM assistant_goal_attempts a WHERE a.execution_id=e.id AND a.settled_at IS NULL ORDER BY a.ordinal DESC LIMIT 1)) AS current_job_id FROM assistant_goal_executions e
    WHERE lane=$1 AND (e.current_job_id IS NOT NULL OR state IN ('active','waiting') OR EXISTS(SELECT 1 FROM assistant_goal_attempts a WHERE a.execution_id=e.id AND a.settled_at IS NULL))
    AND ($2::uuid[] IS NULL OR owner_id=ANY($2::uuid[])) ORDER BY updated_at,id LIMIT 20`,
      [lane, only ?? null],
    )
  ).rows;
  let settled = 0;
  for (const candidate of candidates)
    await transaction(async (db) => {
      // Stop, effects and settlement all lock job before execution.
      const job = candidate.current_job_id
        ? (
            await db.query<{
              id: string;
              chat_id: string;
              turn_id: string;
              state: string;
              result: any;
              apply_result: any;
              terminal_evidence: unknown;
              cancel_requested: boolean;
            }>(
              `SELECT id,chat_id,turn_id,state,result,apply_result,terminal_evidence,cancel_requested FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE`,
              [candidate.current_job_id, candidate.owner_id],
            )
          ).rows[0]
        : null;
      const row = await lockGoalExecution(db, candidate.owner_id, candidate.id);
      if (
        row.current_job_id !== candidate.current_job_id &&
        !(
          row.current_job_id === null &&
          ["stopped", "completed"].includes(row.state)
        )
      )
        return;
      const attempt = (
        await db.query<Attempt>(
          `SELECT * FROM assistant_goal_attempts WHERE execution_id=$1 ORDER BY ordinal DESC LIMIT 1 FOR UPDATE`,
          [row.id],
        )
      ).rows[0];
      if (!attempt) return;
      if (!job) {
        if (!attempt.settled_at) {
          await db.query(
            `UPDATE assistant_goal_attempts SET settled_at=$2,settled_tokens=allocated_tokens,state='unavailable' WHERE id=$1 AND settled_at IS NULL`,
            [attempt.id, now],
          );
          await db.query(
            `UPDATE assistant_goal_executions SET consumed_tokens=consumed_tokens+$2,reserved_tokens=greatest(0,reserved_tokens-$2),revision=revision+1,evidence_revision=evidence_revision+1,updated_at=now() WHERE id=$1`,
            [row.id, attempt.allocated_tokens],
          );
        }
        await transition(
          db,
          row,
          ["stopped", "completed"].includes(row.state) ? row.state : "held",
          "Execution evidence is no longer available.",
        );
        return;
      }
      if (["queued", "running", "waiting"].includes(job.state)) {
        const next = job.state === "waiting" ? "waiting" : "active";
        if (!["stopped", "completed"].includes(row.state) && row.state !== next)
          await db.query(
            `UPDATE assistant_goal_executions SET state=$2,last_transition_reason=$3,revision=revision+1,updated_at=now() WHERE id=$1`,
            [
              row.id,
              next,
              job.state === "waiting"
                ? "This run needs your decision."
                : "A bounded work unit is in progress.",
            ],
          );
        return;
      }
      const terminal = readTerminalEvidence(job.terminal_evidence, job.id);
      if (!attempt.settled_at) {
        const usage = (
          await db.query<{ used: string }>(
            `SELECT coalesce(sum(coalesce(reported_tokens,reserved_tokens)),0)::text AS used FROM assistant_work_reservations WHERE job_id=$1`,
            [job.id],
          )
        ).rows[0];
        const estimate = job.result?.assistant_run?.token_estimate;
        const charged = Math.max(
          Number(usage.used),
          Number.isSafeInteger(estimate) && estimate >= 0
            ? estimate
            : attempt.allocated_tokens,
        );
        await db.query(
          `UPDATE assistant_goal_attempts SET settled_at=$2,settled_tokens=$3,terminal_evidence=$4::jsonb,result_digest=$5 WHERE id=$1 AND settled_at IS NULL`,
          [
            attempt.id,
            now,
            charged,
            terminal ? JSON.stringify(terminal) : null,
            job.result ? goalEvidenceDigest(job.result) : null,
          ],
        );
        await db.query(
          `UPDATE assistant_goal_executions SET consumed_tokens=consumed_tokens+$2,reserved_tokens=greatest(0,reserved_tokens-$3),revision=revision+1,evidence_revision=evidence_revision+1,updated_at=now() WHERE id=$1`,
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
        row.state === "stopped" ||
        row.state === "completed" ||
        row.generation !== attempt.generation
      ) {
        await db.query(
          `UPDATE assistant_goal_executions SET current_job_id=NULL,revision=revision+1,updated_at=now() WHERE id=$1 AND current_job_id=$2`,
          [row.id, job.id],
        );
        return;
      }
      try {
        await assertGoalExecutionCurrent(db, row.owner_id, row, {
          generation: attempt.generation,
          jobId: job.id,
        });
      } catch {
        await transition(
          db,
          row,
          "held",
          "The goal, sources or execution scope changed. Review before continuing.",
        );
        return;
      }
      const visible = await db.query(
        `SELECT j.id FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id WHERE j.id=$2 AND ${assistantJobSourcesVisible("j", "$1", false)} AND ${assistantChatVisible("c", "$1")}`,
        [row.owner_id, job.id],
      );
      if (!visible.rowCount) {
        await transition(
          db,
          row,
          "held",
          "The result sources are no longer available.",
        );
        return;
      }
      const unit = row.units.find((unit) => unit.id === attempt.unit_id);
      if (!unit) {
        await transition(db, row, "held", "The work unit identity changed.");
        return;
      }
      const applied = readStoredAssistantApplyEffect(job.apply_result);
      const rawProposal = job.apply_result?.structured?.pending?.proposal_id;
      const proposal =
        typeof rawProposal === "string"
          ? rawProposal.replace(/^proposal:/, "")
          : null;
      if (
        applied === "pending" &&
        (!proposal ||
          !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(proposal))
      ) {
        await transition(
          db,
          row,
          "held",
          "The saved Review identity could not be verified.",
        );
        return;
      }
      if (applied === "pending" && proposal) {
        const decision = (
          await db.query<{ status: string }>(
            `SELECT CASE WHEN status='pending' AND expires_at<=now() THEN 'expired' ELSE status END AS status FROM proposals WHERE id=$1 AND user_id=$2`,
            [proposal, row.owner_id],
          )
        ).rows[0];
        unit.pending_proposal_id = proposal;
        if (decision?.status === "pending") {
          if (row.state !== "waiting")
            await transition(
              db,
              row,
              "waiting",
              "The prepared changes are waiting in Review.",
              row.units,
              job.id,
            );
          return;
        }
        if (decision?.status !== "applied") {
          unit.stage = "blocked";
          unit.blocker_code = "review_not_applied";
          await transition(
            db,
            row,
            "held",
            "Review was declined, cancelled or expired. The changes were not repeated.",
          );
          return;
        }
        // The person approved the same saved plan. Rebind actual activity targets,
        // never create a replacement proposal or rerun its steps.
        const refs = (
          await db.query<{ target_ids: string[] }>(
            `SELECT target_ids FROM agent_activity WHERE user_id=$1 AND request_id=$2 AND outcome='ok'`,
            [row.owner_id, job.apply_result.structured.job],
          )
        ).rows.flatMap((r) => r.target_ids ?? []);
        unit.outputs = await captureGoalOutputs(
          db,
          row.owner_id,
          job.id,
          refs,
          job.apply_result.structured,
        );
        unit.effects_applied = true;
        unit.pending_proposal_id = null;
      } else if (applied === "applied") {
        unit.effects_applied = true;
        const outputs = job.apply_result.goal_outputs;
        if (!Array.isArray(outputs)) {
          await transition(
            db,
            row,
            "held",
            "The committed change has no stable output identities. It will not be recreated.",
          );
          return;
        }
        unit.outputs = outputs;
      } else if (
        !terminal ||
        terminal.effects === "uncertain" ||
        terminal.retry === "reconcile"
      ) {
        await transition(
          db,
          row,
          "held",
          "Execution is uncertain. Reconcile the saved run before continuing.",
        );
        return;
      }
      if (job.cancel_requested || terminal?.cause === "stopped") {
        await transition(db, row, "stopped", "This execution was stopped.");
        return;
      }
      if (job.state === "failed") {
        if (
          terminal?.retry === "eligible" &&
          terminal.effects === "none" &&
          row.attempt_count < row.limits.max_attempts &&
          row.consumed_tokens < row.limits.token_limit
        ) {
          await transition(
            db,
            row,
            "ready",
            "A transient failure had no effects; retrying the same bounded unit.",
          );
          return;
        }
        await transition(
          db,
          row,
          "held",
          "The run failed and was not safe to retry automatically.",
        );
        return;
      }
      const report = goalUnitResult.safeParse(
        job.result?.assistant_run?.goal_result,
      );
      if (
        report.success &&
        report.data.criterion_id === unit.criterion_id &&
        report.data.decision === "blocked"
      ) {
        unit.last_attempt_id = attempt.id;
        unit.revision++;
        unit.stage = "blocked";
        unit.blocker_code = "required_input";
        await transition(
          db,
          row,
          row.units.some(
            (other) =>
              other.id !== unit.id &&
              ["work", "verify", "repair"].includes(other.stage),
          )
            ? "ready"
            : "held",
          "This criterion needs a decision; other authorized units may continue.",
        );
        return;
      }
      const parsedOutcome = assistantOutcomeReceipt.safeParse(
        job.result?.assistant_run?.execution_outcome,
      );
      const outcome =
        parsedOutcome.success && parsedOutcome.data.job_id === job.id
          ? parsedOutcome.data
          : null;
      if (
        !outcome ||
        ["partial", "failed", "interrupted", "uncertain"].includes(
          outcome.outcome,
        ) ||
        outcome.open_questions?.length ||
        outcome.checks?.some(
          (check: { status: string }) => check.status !== "passed",
        )
      ) {
        await transition(
          db,
          row,
          outcome?.reason === "specialist_incomplete" ? "held" : "limited",
          "The unit is incomplete. Review its result and recorded checks.",
        );
        return;
      }
      if (!report.success || report.data.criterion_id !== unit.criterion_id) {
        await transition(
          db,
          row,
          "held",
          "The run did not record a structured result for this criterion.",
        );
        return;
      }
      if (!unit.outputs.length) {
        const digest = goalEvidenceDigest(job.result);
        unit.outputs = [
          {
            kind: "response",
            id: `${job.chat_id}:${job.turn_id}`,
            version: digest,
            producer_job_id: job.id,
            receipt_digest: digest,
          },
        ];
      }
      unit.last_attempt_id = attempt.id;
      unit.revision++;

      unit.stage =
        attempt.mode === "verify"
          ? report.data.decision === "ready"
            ? "ready_for_acceptance"
            : "repair"
          : "verify";
      unit.blocker_code = null;
      const ready = row.units.every(
        (unit) => unit.stage === "ready_for_acceptance",
      );
      if (
        !ready &&
        (row.attempt_count >= row.limits.max_attempts ||
          row.consumed_tokens >= row.limits.token_limit ||
          now >= new Date(row.limits.deadline))
      ) {
        await transition(
          db,
          row,
          "limited",
          "The cumulative execution bound was reached.",
        );
        return;
      }
      await transition(
        db,
        row,
        ready ? "awaiting_acceptance" : "ready",
        ready
          ? "All criteria are ready for your review."
          : "Continuing the next distinct bounded work unit.",
      );
    });
  return settled;
}

export async function scanGoalExecutions(
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
  const rows = (
    await pool.query<{ id: string; owner_id: string }>(
      `SELECT e.id,e.owner_id FROM assistant_goal_executions e
    WHERE e.lane=$1 AND e.state='ready' AND NOT e.admissions_paused AND e.current_job_id IS NULL
    AND ($2::uuid[] IS NULL OR e.owner_id=ANY($2::uuid[])) AND ${assistantProviderAdmissionSql("e.owner_id", options.ai)}
    ORDER BY e.updated_at,e.id LIMIT $3`,
      [lane, options.only ?? null, Math.min(options.limit ?? 10, 20)],
    )
  ).rows;
  let started = 0;
  for (const candidate of rows)
    await transaction(async (db) => {
      const row = await lockGoalExecution(db, candidate.owner_id, candidate.id);
      if (row.state !== "ready" || row.admissions_paused || row.current_job_id)
        return;
      if (!(await assistantAdmissionOpen(db, row.owner_id, lane))) return;
      if (
        row.attempt_count >= row.limits.max_attempts ||
        row.consumed_tokens + row.reserved_tokens >= row.limits.token_limit ||
        now >= new Date(row.limits.deadline)
      ) {
        await transition(
          db,
          row,
          "limited",
          "The cumulative execution bound was reached.",
        );
        return;
      }
      try {
        await assertGoalExecutionCurrent(db, row.owner_id, row, {
          admit: true,
        });
      } catch {
        await transition(
          db,
          row,
          "held",
          "The execution scope or available bounds changed. Review before continuing.",
        );
        return;
      }
      const unit = row.units.find((unit) =>
        ["work", "verify", "repair"].includes(unit.stage),
      );
      if (!unit) {
        await transition(
          db,
          row,
          "held",
          "No remaining bounded work unit is available.",
        );
        return;
      }
      const parent = (
        await db.query<Attempt>(
          `SELECT * FROM assistant_goal_attempts WHERE execution_id=$1 ORDER BY ordinal DESC LIMIT 1`,
          [row.id],
        )
      ).rows[0];
      const user = (
        await db.query<{ role: SystemRole; timezone: string }>(
          `SELECT u.role,coalesce(p.timezone,'UTC') AS timezone FROM users u LEFT JOIN planner_prefs p ON p.user_id=u.id WHERE u.id=$1 AND NOT u.disabled`,
          [row.owner_id],
        )
      ).rows[0];
      if (!user) return;
      let allocation = Math.min(
        LEAD_TOKEN_BUDGET,
        row.limits.token_limit - row.consumed_tokens - row.reserved_tokens,
      );
      let night: { id: string; end: Date; wait: boolean } | undefined;
      if (lane === "overnight") {
        const locked = (
          await db.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_xact_lock(hashtext('assistant-night:' || $1)) AS locked",
            [row.owner_id],
          )
        ).rows[0];
        if (!locked.locked) return;
        if (
          (
            await db.query(
              "SELECT id FROM ai_jobs WHERE user_id=$1 AND runtime_lane='overnight' AND state IN ('queued','running') LIMIT 1",
              [row.owner_id],
            )
          ).rowCount
        )
          return;
        const parsed = nightShiftInput.safeParse(
          (
            await db.query(
              `SELECT night_shift FROM agent_settings WHERE user_id=$1`,
              [row.owner_id],
            )
          ).rows[0]?.night_shift,
        );
        if (
          !parsed.success ||
          !parsed.data.enabled ||
          !parsed.data.kinds.follow_through
        )
          return;
        const window = assistantNightWindow(now, parsed.data);
        if (!window) return;
        const created = await db.query(
          `INSERT INTO assistant_nights(user_id,local_day) VALUES($1,$2::date) ON CONFLICT DO NOTHING RETURNING id`,
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
            `SELECT n.*,s.night_token_budget AS budget FROM assistant_nights n CROSS JOIN ai_settings s WHERE n.user_id=$1 AND n.local_day=$2::date AND s.id FOR UPDATE OF n`,
            [row.owner_id, window.localDay],
          )
        ).rows[0];
        if (n.status !== "running" || n.runs >= 10) return;
        allocation = Math.min(allocation, n.budget - n.budget_used);
        if (created.rowCount)
          await bindConversationWork(db, {
            ownerId: row.owner_id,
            work: { kind: "night", id: n.id },
            lane: "overnight",
            timezone: user.timezone,
            sourcesChecked: true,
            notBefore: window.end,
          });
        night = { id: n.id, end: window.end, wait: parsed.data.wait_for_ok };
      }
      if (allocation <= 0) {
        await transition(
          db,
          row,
          "limited",
          "The cumulative token allowance was reached.",
        );
        return;
      }
      const criterion = row.criteria.find((c) => c.id === unit.criterion_id)!;
      const previousJob = parent?.job_id;
      const jobs = [
        ...new Set([
          ...unit.outputs.map((o) => o.producer_job_id),
          ...(previousJob ? [previousJob] : []),
        ]),
      ];
      if (jobs.length) {
        const visible = await db.query(
          `SELECT j.id FROM ai_jobs j WHERE j.id=ANY($2::uuid[]) AND ${assistantJobSourcesVisible("j", "$1", false)}`,
          [row.owner_id, jobs],
        );
        if (visible.rowCount !== jobs.length) {
          await transition(
            db,
            row,
            "held",
            "Earlier work evidence is no longer available.",
          );
          return;
        }
      }
      const mode = unit.stage as "work" | "verify" | "repair";
      const message = [
        `Work on criterion ${criterion.id}: ${criterion.text}`,
        `This is one ${mode} unit of an explicitly scoped goal. Other criteria are separate units.`,
        mode === "verify"
          ? "Read the saved outputs and relevant current sources. Do not stage changes. Report ready only for person review, or repair/blocked with a concise reason."
          : unit.effects_applied
            ? "Repair only the bound existing outputs at their current checked versions. Never recreate them."
            : "Investigate and produce the result for this criterion within the existing assistant permissions.",
        `Bound outputs: ${JSON.stringify(unit.outputs)}`,
        `Earlier result references: ${jobs.map((id) => `job:${id}`).join(", ")}`,
        `Use finish.goal_result with criterion_id=${criterion.id}, decision ready|repair|blocked and a concise note. Only the person can accept the goal.`,
      ].join("\n\n");
      const attemptId = randomUUID();
      const ordinal = row.attempt_count + 1;
      const id = await (options.startAutomation ?? startAssistantAutomation)({
        userId: row.owner_id,
        message,
        timezone: user.timezone,
        title: `Goal work: ${criterion.text.slice(0, 95)}`,
        automation: {
          kind: "goal",
          id: row.goal_id,
          recipient_lane: lane,
          goal_execution: {
            id: row.id,
            unit_id: unit.id,
            criterion_id: criterion.id,
            generation: row.generation,
            mode,
            effect_ceiling: row.effect_ceiling,
            job_ids: jobs,
            outputs: unit.outputs,
          },
          token_budget: allocation,
          end_at: night
            ? new Date(
                Math.min(
                  night.end.getTime(),
                  new Date(row.limits.deadline).getTime(),
                ),
              ).toISOString()
            : row.limits.deadline,
          ...(night
            ? {
                night_id: night.id,
                night_kind: "goal",
                source_kind: "goal" as const,
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
            `INSERT INTO assistant_goal_attempts(id,execution_id,owner_id,unit_id,ordinal,mode,relation,parent_attempt_id,job_id,generation,input_frontier_revision,allocated_tokens)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              attemptId,
              row.id,
              row.owner_id,
              unit.id,
              ordinal,
              mode,
              parent
                ? parent.unit_id === unit.id && parent.mode === mode
                  ? "retry"
                  : "continue"
                : "initial",
              parent?.id ?? null,
              jobId,
              row.generation,
              row.frontier_revision,
              allocation,
            ],
          );
          unit.last_attempt_id = attemptId;
          await inside.query(
            `UPDATE assistant_goal_executions SET state='active',current_job_id=$2,units=$3::jsonb,attempt_count=$4,reserved_tokens=reserved_tokens+$5,revision=revision+1,last_transition_reason='A bounded work unit was queued.',updated_at=now() WHERE id=$1`,
            [row.id, jobId, JSON.stringify(row.units), ordinal, allocation],
          );
          if (night) {
            await inside.query(
              `INSERT INTO assistant_night_runs(night_id,job_id,kind) VALUES($1,$2,'goal')`,
              [night.id, jobId],
            );
            await inside.query(
              `UPDATE assistant_nights SET runs=runs+1,updated_at=now() WHERE id=$1`,
              [night.id],
            );
          }
        },
      });
      if (id) started++;
    });
  return started;
}
