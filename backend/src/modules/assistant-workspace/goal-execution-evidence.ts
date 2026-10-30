import { z } from "zod";
import {
  fail,
  goalExecutionDetails,
  readAssistantOutcome,
  type GoalExecutionDetails,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { Params, scopeFor } from "../../lib/visibility.js";
import { policy } from "../../capabilities/policy.js";
import { assistantSourceVisible } from "../../lib/assistant-source-visibility.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { projectOutcomeReceipt } from "../ai/outcome-receipts.js";
import { readTerminalEvidence } from "../ai/agent/terminal-evidence.js";
import {
  readGoalExecution,
  publicMetadata,
  scopeContext,
  goalFacts,
  goalExecutionCriteriaHash,
  goalExecutionDigest,
  type GoalExecutionRow,
} from "./goal-executions.js";
export type AttemptRow = {
  id: string;
  execution_id: string;
  owner_id: string;
  unit_id: string;
  ordinal: number;
  mode: "work" | "verify" | "repair";
  relation: "initial" | "continue" | "retry";
  generation: number;
  job_id: string | null;
  state: "queued" | "running" | "waiting" | "done" | "failed" | "unavailable";
  allocated_tokens: number;
  settled_tokens: number | null;
  settled_at: Date | null;
  created_at: Date;
  terminal_evidence: unknown;
  result_digest: string | null;
};
type JobEvidence = {
  id: string;
  chat_id: string;
  state: "queued" | "running" | "waiting" | "done" | "failed";
  cancel_requested: boolean;
  recovering: boolean;
  result: any;
  apply_result: any;
  terminal_evidence: any;
  review_status: string | null;
};
export async function attempts(db: Queryable, row: GoalExecutionRow) {
  return (
    await db.query<AttemptRow>(
      "SELECT * FROM assistant_goal_attempts WHERE execution_id=$1 AND owner_id=$2 ORDER BY ordinal LIMIT 20",
      [row.id, row.owner_id],
    )
  ).rows;
}
export async function authorizedJobs(
  db: Queryable,
  row: GoalExecutionRow,
  all: AttemptRow[],
) {
  const principal = await scopeContext(db, row.owner_id, row.lane);
  if (!principal) return new Map<string, JobEvidence>();
  const params = new Params(all.flatMap((a) => (a.job_id ? [a.job_id] : [])));
  const scope = scopeFor(policy.spaces(principal), params);
  const proposalId =
    "regexp_replace(coalesce(j.result->'assistant_run'->>'proposal_id',j.apply_result->'structured'->'pending'->>'proposal_id'),'^proposal:','')";
  const jobs = await db.query<JobEvidence>(
    `SELECT j.id,j.chat_id,j.state,j.cancel_requested,(j.state='running' AND (j.lease_until IS NULL OR j.lease_until<=now())) AS recovering,j.result,j.apply_result,j.terminal_evidence,CASE WHEN p.status='pending' AND p.expires_at<=now() THEN 'expired' ELSE p.status END AS review_status
     FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id LEFT JOIN proposals p ON p.user_id=${scope.user} AND p.id=CASE WHEN ${proposalId} ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN (${proposalId})::uuid END
     WHERE j.id=ANY($1::uuid[]) AND ${assistantJobSourcesVisible("j", scope.user, false, scope)} AND ${assistantChatVisible("c", scope.user, scope)}`,
    params.values,
  );
  return new Map(jobs.rows.map((j) => [j.id, j]));
}
export async function evidence(db: Queryable, row: GoalExecutionRow) {
  const all = await attempts(db, row),
    jobs = await authorizedJobs(db, row, all);
  let visible = !!(await goalFacts(db, row.owner_id, row.goal_id, row.lane));
  const outputPrincipal = await scopeContext(db, row.owner_id, row.lane);
  const versions: unknown[] = [];
  for (const unit of row.units)
    for (const output of unit.outputs) {
      const producer = jobs.get(output.producer_job_id);
      if (!producer) visible = false;
      const resultDigest = producer
        ? goalExecutionDigest(producer.result)
        : null;
      const receiptDigest = producer?.apply_result?.structured
        ? goalExecutionDigest(producer.apply_result.structured)
        : resultDigest;
      if (
        output.receipt_digest !== receiptDigest &&
        output.receipt_digest !== resultDigest
      )
        visible = false;
      if (output.kind === "response") {
        if (
          !producer ||
          output.id !== `${producer.chat_id}:${producer.result?.turn_id}` ||
          output.version !== resultDigest
        )
          visible = false;
        continue;
      }
      const id = output.id.match(
        /[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i,
      )?.[0];
      const table = { task: "items", doc: "docs", project: "projects" }[
        output.kind
      ];
      if (!id || !table) {
        visible = false;
        continue;
      }
      if (!outputPrincipal) {
        visible = false;
        continue;
      }
      const outputParams = new Params(id, output.kind);
      const outputScope = scopeFor(
        policy.spaces(outputPrincipal),
        outputParams,
      );
      const current = (
        await db.query<{ version: string | null }>(
          `SELECT ${output.kind === "project" ? "to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')" : "to_jsonb(s)->>'version'"} AS version FROM ${table} s WHERE s.id=$1 AND ${assistantSourceVisible("$2", "s.id", outputScope.user, false, outputScope)} FOR SHARE OF s`,
          outputParams.values,
        )
      ).rows[0];
      if (!current) visible = false;
      versions.push([
        output.kind,
        output.id,
        current?.version ?? null,
        output.version,
      ]);
    }
  if (all.some((a) => !a.job_id || !jobs.has(a.job_id))) visible = false;
  let ready =
    row.state === "awaiting_acceptance" &&
    !row.current_job_id &&
    all.length > 0 &&
    all.every((a) => a.settled_at !== null) &&
    row.units.every(
      (u) =>
        u.stage === "ready_for_acceptance" &&
        !u.pending_proposal_id &&
        !u.blocker_code,
    );
  const goal = await goalFacts(db, row.owner_id, row.goal_id, row.lane);
  if (
    !goal ||
    goalExecutionCriteriaHash(goal, row.criteria) !== row.criteria_hash
  )
    ready = false;
  const proposals: unknown[] = [];
  for (const a of all) {
    const job = a.job_id ? jobs.get(a.job_id) : null;
    if (!job) {
      ready = false;
      continue;
    }
    if (a.result_digest && a.result_digest !== goalExecutionDigest(job.result))
      ready = false;
    const terminal = readTerminalEvidence(job.terminal_evidence, job.id);
    if (!terminal) ready = false;
    if (
      ["queued", "running", "waiting"].includes(job.state) ||
      terminal?.effects === "uncertain"
    )
      ready = false;
    const proposal =
      job.result?.assistant_run?.proposal_id ??
      job.apply_result?.structured?.pending?.proposal_id;
    if (typeof proposal === "string") {
      const id = proposal.replace(/^proposal:/, "");
      if (z.uuid().safeParse(id).success) {
        const p = (
          await db.query(
            "SELECT status,expires_at FROM proposals WHERE id=$2 AND user_id=$1",
            [row.owner_id, id],
          )
        ).rows[0];
        proposals.push([id, p?.status, p?.expires_at]);
        if (!p || p.status === "pending") ready = false;
      } else ready = false;
    }
    if (row.units.some((u) => u.last_attempt_id === a.id)) {
      const receipt = readAssistantOutcome(
        job.result?.assistant_run?.execution_outcome,
      );
      if (
        !receipt ||
        receipt.job_id !== job.id ||
        !["unverified", "completed"].includes(receipt.outcome) ||
        receipt.open_questions.length ||
        receipt.checks.some((c) => c.status !== "passed")
      )
        ready = false;
    }
  }
  if (
    row.units.some(
      (u) => !u.last_attempt_id || !all.some((a) => a.id === u.last_attempt_id),
    )
  )
    ready = false;
  if (
    versions.some((v) => {
      const values = v as unknown[];
      return values[2] !== values[3];
    })
  )
    ready = false;
  const hash = visible
    ? goalExecutionDigest({
        criteria: row.criteria_hash,
        generation: row.generation,
        evidence_revision: row.evidence_revision,
        units: row.units,
        attempts: all.map((a) => [
          a.id,
          a.job_id,
          a.result_digest,
          a.settled_tokens,
        ]),
        jobs: [...jobs.values()].map((j) => [
          j.id,
          j.result,
          j.apply_result,
          j.terminal_evidence,
        ]),
        versions,
        proposals,
      })
    : null;
  return { all, jobs, visible, ready: visible && ready, hash };
}
export async function goalExecutionDetailsFor(
  db: Queryable,
  owner: string,
  id: string,
): Promise<GoalExecutionDetails> {
  const row = await readGoalExecution(db, owner, id);
  if (!row) fail(404, "Goal execution not found.");
  const facts = await evidence(db, row);
  const base = publicMetadata(row);
  if (!facts.visible)
    return goalExecutionDetails.parse({ ...base, visibility: "restricted" });
  const latest = facts.all.at(-1),
    job = latest?.job_id ? facts.jobs.get(latest.job_id) : null;
  return goalExecutionDetails.parse({
    ...base,
    visibility: "available",
    criteria: row.criteria,
    units: row.units,
    current_job_id: row.current_job_id,
    result:
      job && latest
        ? {
            attempt_id: latest.id,
            job_id: job.id,
            chat_id: job.chat_id,
            state: job.state,
            cancel_requested: job.cancel_requested,
            recovering: job.recovering,
            summary:
              typeof job.result?.answer === "string"
                ? job.result.answer.slice(0, 4000)
                : null,
            ...(readAssistantOutcome(
              job.result?.assistant_run?.execution_outcome,
            )
              ? {
                  execution_outcome: projectOutcomeReceipt(
                    job.result.assistant_run.execution_outcome,
                    job.id,
                    job.review_status,
                    row.acceptance,
                  ),
                }
              : {}),
          }
        : null,
    evidence_hash: facts.hash,
    can_accept: facts.ready,
    permission_summary:
      row.effect_ceiling === "suggest"
        ? "Changes stay in Review. Existing source access still applies."
        : "Existing assistant permissions and Review rules apply.",
    acceptance: row.acceptance,
  });
}
