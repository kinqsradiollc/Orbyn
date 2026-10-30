import {
  fail,
  routineRecovery,
  readAssistantOutcome,
  type RoutineRecovery,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { Params, scopeFor } from "../../lib/visibility.js";
import { policy } from "../../capabilities/policy.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { projectOutcomeReceipt } from "../ai/outcome-receipts.js";
import { readTerminalEvidence } from "../ai/agent/terminal-evidence.js";
import { assistantExecutionContext } from "./execution-authority.js";
import {
  readRoutineRecovery,
  routineRecoveryAttempts,
  routineRecoverySourcesCurrent,
} from "./routine-recovery.js";

export async function readRoutineRecoveryDetails(
  db: Queryable,
  owner: string,
  routine: string,
  id: string,
): Promise<RoutineRecovery> {
  const row = await readRoutineRecovery(db, owner, id);
  if (!row || row.routine_id !== routine)
    fail(404, "Routine occurrence not found.");
  const identity = {
    routine_id: routine,
    occurrence_id: id,
    scheduled_for: row.scheduled_for.toISOString(),
  };
  if (row.recovery_version !== 1)
    return routineRecovery.parse({ ...identity, recovery: "legacy" });
  const metadata = {
    ...identity,
    recovery: "enabled" as const,
    state: row.recovery_state,
    generation: row.generation,
    revision: row.revision,
    lane: row.lane,
    policy: row.policy_snapshot,
    deadline: row.deadline.toISOString(),
    consumed_tokens: row.consumed_tokens,
    reserved_tokens: row.reserved_tokens,
    attempt_count: row.attempt_count,
    next_retry_at: row.next_eligible_at?.toISOString() ?? null,
    reason: row.last_transition_reason,
  };
  if (!(await routineRecoverySourcesCurrent(db, row)))
    return routineRecovery.parse({ ...metadata, visibility: "restricted" });
  const all = await routineRecoveryAttempts(db, row),
    principal = await assistantExecutionContext(db, owner, row.lane);
  if (!principal)
    return routineRecovery.parse({ ...metadata, visibility: "restricted" });
  const params = new Params(all.map((a) => a.job_id)),
    scope = scopeFor(policy.spaces(principal), params);
  const proposalId =
    "regexp_replace(coalesce(j.result->'assistant_run'->>'proposal_id',j.apply_result->'structured'->'pending'->>'proposal_id'),'^proposal:','')";
  const jobs = (
    await db.query<{
      id: string;
      chat_id: string;
      state: "queued" | "running" | "waiting" | "done" | "failed";
      resume_count: number;
      result: any;
      terminal_evidence: unknown;
      review_status: string | null;
    }>(
      `SELECT j.id,j.chat_id,j.state,j.resume_count,j.result,j.terminal_evidence,CASE WHEN p.status='pending' AND p.expires_at<=now() THEN 'expired' ELSE p.status END AS review_status
      FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id LEFT JOIN proposals p ON p.user_id=${scope.user} AND p.id=CASE WHEN ${proposalId} ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN (${proposalId})::uuid END
      WHERE j.id=ANY($1::uuid[]) AND ${assistantJobSourcesVisible("j", scope.user, false, scope)} AND ${assistantChatVisible("c", scope.user, scope)}`,
      params.values,
    )
  ).rows;
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return routineRecovery.parse({
    ...metadata,
    visibility: "available",
    attempts: all.map((a) => {
      const job = a.job_id ? byId.get(a.job_id) : null;
      const terminal = job
        ? readTerminalEvidence(job.terminal_evidence, job.id)
        : null;
      const base = {
        id: a.id,
        ordinal: a.ordinal,
        state: job?.state ?? a.state,
        created_at: a.created_at.toISOString(),
        settled_at: a.settled_at?.toISOString() ?? null,
        allocated_tokens: a.allocated_tokens,
        settled_tokens: a.settled_tokens,
        resume_count: job?.resume_count ?? 0,
        retry: terminal?.retry ?? "unavailable",
      };
      if (!job) return { ...base, visibility: "restricted" };
      const outcome = readAssistantOutcome(
        job.result?.assistant_run?.execution_outcome,
      );
      return {
        ...base,
        visibility: "available",
        job_id: job.id,
        chat_id: job.chat_id,
        summary:
          typeof job.result?.answer === "string"
            ? job.result.answer.slice(0, 4000)
            : null,
        ...(outcome
          ? {
              execution_outcome: projectOutcomeReceipt(
                outcome,
                job.id,
                job.review_status,
              ),
            }
          : {}),
      };
    }),
  });
}
