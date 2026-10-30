import {
  assistantExecutionDigest as goalExecutionDigest,
  assistantExecutionContext as scopeContext,
  assistantExecutionFingerprints as goalExecutionFingerprints,
} from "./execution-authority.js";
export { goalExecutionDigest, scopeContext, goalExecutionFingerprints };
import { evidence } from "./goal-execution-evidence.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  fail,
  goalExecution,
  goalExecutionAccept,
  goalExecutionAcceptance,
  goalExecutionControl,
  goalExecutionResume,
  goalExecutionStart,
  type GoalExecution,
  type GoalExecutionUnit,
} from "@orbyn/core";

import type { Queryable } from "../../db/pool.js";

import { Params, scopeFor } from "../../lib/visibility.js";
import { assistantSourceVisible } from "../../lib/assistant-source-visibility.js";

import { policy } from "../../capabilities/policy.js";

import { scheduledConversationRoute } from "./conversation-schedules.js";
import { assistantAdmissionOpen } from "./work-controls.js";

type Criteria = z.output<typeof goalExecutionStart>["criteria"];
export type GoalExecutionRow = Omit<
  GoalExecution,
  "created_at" | "updated_at"
> & {
  owner_id: string;
  start_request_id: string;
  start_digest: string;
  criteria: Criteria;
  units: GoalExecutionUnit[];
  provider_hash: string;
  scope_hash: string;
  destination_id: string | null;
  personal_only: boolean;
  current_job_id: string | null;
  acceptance: z.output<typeof goalExecutionAcceptance> | null;
  last_control: { id: string; action: string; digest: string } | null;
  created_at: Date;
  updated_at: Date;
};
type GoalFacts = {
  id: string;
  title: string;
  target: string;
  target_date: string | null;
  project_id: string | null;
  plan_doc_id: string | null;
  status: string;
  revision: number;
};
export function goalExecutionCriteriaHash(goal: GoalFacts, criteria: Criteria) {
  return goalExecutionDigest({
    criteria,
    title: goal.title,
    target: goal.target,
    target_date: goal.target_date,
    project_id: goal.project_id,
    plan_doc_id: goal.plan_doc_id,
  });
}
// Strict wire schemas deliberately receive only public metadata, never private row fields.
export function publicMetadata(row: GoalExecutionRow): GoalExecution {
  const {
    id,
    goal_id,
    state,
    admissions_paused,
    generation,
    revision,
    lane,
    effect_ceiling,
    criteria_hash,
    config_hash,
    frontier_revision,
    evidence_revision,
    limits,
    consumed_tokens,
    reserved_tokens,
    attempt_count,
    last_transition_reason,
    created_at,
    updated_at,
  } = row;
  return goalExecution.parse({
    id,
    goal_id,
    state,
    admissions_paused,
    generation,
    revision,
    lane,
    effect_ceiling,
    criteria_hash,
    config_hash,
    frontier_revision,
    evidence_revision,
    limits,
    consumed_tokens,
    reserved_tokens,
    attempt_count,
    last_transition_reason,
    created_at: created_at.toISOString(),
    updated_at: updated_at.toISOString(),
  });
}
export async function readGoalExecution(
  db: Queryable,
  owner: string,
  id: string,
): Promise<GoalExecutionRow | null> {
  return (
    (
      await db.query<GoalExecutionRow>(
        "SELECT * FROM assistant_goal_executions WHERE id=$2 AND owner_id=$1",
        [owner, id],
      )
    ).rows[0] ?? null
  );
}
/** Existing jobs must be locked BEFORE this execution lock. */
export async function lockGoalExecution(
  db: Queryable,
  owner: string,
  id: string,
): Promise<GoalExecutionRow> {
  const row = (
    await db.query<GoalExecutionRow>(
      "SELECT * FROM assistant_goal_executions WHERE id=$2 AND owner_id=$1 FOR UPDATE",
      [owner, id],
    )
  ).rows[0];
  if (!row) fail(404, "Goal execution not found.");
  return row;
}
export async function goalFacts(
  db: Queryable,
  owner: string,
  goalId: string,
  lane: GoalExecution["lane"],
): Promise<GoalFacts | null> {
  const principal = await scopeContext(db, owner, lane);
  if (!principal) return null;
  const params = new Params(goalId);
  const scope = scopeFor(policy.spaces(principal), params);
  return (
    (
      await db.query<GoalFacts>(
        `SELECT g.id,g.title,g.target,g.target_date::text,g.project_id,g.plan_doc_id,g.status,g.revision FROM goals g WHERE g.user_id=${scope.user} AND g.id=$1 AND ${assistantSourceVisible("'goal'", "g.id", scope.user, false, scope)} FOR SHARE OF g`,
        params.values,
      )
    ).rows[0] ?? null
  );
}
export async function assertGoalExecutionCurrent(
  db: Queryable,
  owner: string,
  row: GoalExecutionRow,
  options: {
    generation?: number;
    jobId?: string;
    admit?: boolean;
    unitId?: string;
    mode?: "work" | "verify" | "repair";
    write?: boolean;
  } = {},
) {
  if (
    row.owner_id !== owner ||
    (options.generation !== undefined && row.generation !== options.generation)
  )
    fail(409, "Goal execution changed. Refresh before continuing.");
  if (
    ["stopped", "completed", "held", "failed"].includes(row.state) ||
    (row.state === "limited" && !options.jobId)
  )
    fail(409, "This goal execution cannot continue.");
  if (
    options.jobId &&
    !(
      await db.query(
        `SELECT id FROM assistant_goal_attempts WHERE execution_id=$1 AND owner_id=$2 AND job_id=$3 AND generation=$4 AND processed_at IS NULL`,
        [row.id, owner, options.jobId, row.generation],
      )
    ).rowCount
  )
    fail(409, "This job no longer owns goal work.");
  const goal = await goalFacts(db, owner, row.goal_id, row.lane);
  if (
    !goal ||
    goal.status !== "active" ||
    goalExecutionCriteriaHash(goal, row.criteria) !== row.criteria_hash
  )
    fail(409, "The goal or its reviewed criteria changed.");
  const hashes = await goalExecutionFingerprints(db, owner, row.lane);
  if (
    hashes.provider_hash !== row.provider_hash ||
    hashes.scope_hash !== row.scope_hash
  )
    fail(
      409,
      "Provider or assistant permission changed. Review this execution.",
    );
  if (
    goalExecutionDigest({
      criteria_hash: row.criteria_hash,
      lane: row.lane,
      effect_ceiling: row.effect_ceiling,
      limits: row.limits,
      ...hashes,
      destination_id: row.destination_id,
      personal_only: row.personal_only,
    }) !== row.config_hash
  )
    fail(409, "The captured execution configuration changed.");
  if (
    (options.write || options.admit) &&
    Date.parse(row.limits.deadline) <= Date.now()
  )
    fail(409, "This execution reached its deadline.");
  if (
    options.admit &&
    (!["ready", "active", "waiting"].includes(row.state) ||
      row.admissions_paused ||
      !(await assistantAdmissionOpen(db, owner, row.lane)) ||
      row.attempt_count >= row.limits.max_attempts ||
      row.consumed_tokens + row.reserved_tokens >= row.limits.token_limit)
  )
    fail(409, "This execution is paused or has reached its allowance.");
  if (options.unitId) {
    const unit = row.units.find((u) => u.id === options.unitId);
    if (
      !unit ||
      ["satisfied", "ready_for_acceptance", "blocked"].includes(unit.stage)
    )
      fail(409, "This work unit cannot run.");
    if (
      options.admit &&
      (
        await db.query(
          "SELECT id FROM assistant_goal_attempts WHERE execution_id=$1 AND unit_id=$2 AND processed_at IS NULL",
          [row.id, unit.id],
        )
      ).rowCount
    )
      fail(409, "This work unit already has saved work in progress.");
    if (options.mode && unit.stage !== options.mode)
      fail(409, "The work unit changed stage.");
    if (options.write && options.mode === "verify")
      fail(409, "Verification cannot make changes.");
    if (
      options.jobId &&
      !(
        await db.query(
          `SELECT id FROM assistant_goal_attempts WHERE execution_id=$1 AND owner_id=$2 AND job_id=$3 AND unit_id=$4 AND generation=$5 AND mode=$6 AND processed_at IS NULL`,
          [
            row.id,
            owner,
            options.jobId,
            options.unitId,
            row.generation,
            options.mode ?? unit.stage,
          ],
        )
      ).rowCount
    )
      fail(409, "This job no longer owns the goal work unit.");
  }
}
export async function startGoalExecution(
  db: Queryable,
  owner: string,
  goalId: string,
  raw: unknown,
) {
  const input = goalExecutionStart.parse(raw),
    digest = goalExecutionDigest({ goalId, input });
  await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [owner]);
  const prior = (
    await db.query<GoalExecutionRow>(
      "SELECT * FROM assistant_goal_executions WHERE owner_id=$1 AND start_request_id=$2",
      [owner, input.request_id],
    )
  ).rows[0];
  if (prior) {
    if (prior.start_digest !== digest)
      fail(409, "This start request was already used for different work.");
    return prior.id;
  }
  await db.query("SELECT id FROM goals WHERE id=$2 AND user_id=$1 FOR UPDATE", [
    owner,
    goalId,
  ]);
  const goal = await goalFacts(db, owner, goalId, input.lane);
  if (!goal) fail(404, "Goal not found or unavailable to your assistant.");
  if (goal.revision !== input.expected_goal_revision)
    fail(409, "This goal changed. Review it before starting.");
  if (
    goal.status !== "active" ||
    Date.parse(input.limits.deadline) <= Date.now()
  )
    fail(409, "Choose an active goal and a future execution deadline.");
  if (
    (
      await db.query(
        "SELECT id FROM assistant_goal_executions WHERE goal_id=$1 AND state NOT IN ('stopped','completed')",
        [goalId],
      )
    ).rowCount
  )
    fail(409, "This goal already has an open execution.");
  if (
    (
      await db.query(
        "SELECT id FROM ai_jobs WHERE user_id=$1 AND work_source_kind='goal' AND work_source_id=$2 AND state IN ('queued','running','waiting')",
        [owner, goalId],
      )
    ).rowCount
  )
    fail(409, "This goal already has admitted assistant work.");
  const hashes = await goalExecutionFingerprints(db, owner, input.lane);
  const route = await scheduledConversationRoute(db, owner, "goal", goalId);
  const criteriaHash = goalExecutionCriteriaHash(goal, input.criteria);
  const configHash = goalExecutionDigest({
    criteria_hash: criteriaHash,
    lane: input.lane,
    effect_ceiling: input.effect_ceiling,
    limits: input.limits,
    ...hashes,
    destination_id: route.destinationId,
    personal_only: route.personalOnly,
  });
  const units: GoalExecutionUnit[] = input.criteria.map((c) => ({
    id: randomUUID(),
    criterion_id: c.id,
    revision: 1,
    effects_applied: false,
    stage: "work",
    last_attempt_id: null,
    outputs: [],
    pending_proposal_id: null,
    blocker_code: null,
  }));
  return (
    await db.query<{ id: string }>(
      `INSERT INTO assistant_goal_executions(owner_id,goal_id,start_request_id,start_digest,criteria,units,lane,effect_ceiling,criteria_hash,config_hash,provider_hash,scope_hash,destination_id,personal_only,limits) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [
        owner,
        goalId,
        input.request_id,
        digest,
        JSON.stringify(input.criteria),
        JSON.stringify(units),
        input.lane,
        input.effect_ceiling,
        criteriaHash,
        configHash,
        hashes.provider_hash,
        hashes.scope_hash,
        route.destinationId,
        route.personalOnly,
        JSON.stringify(input.limits),
      ],
    )
  ).rows[0].id;
}
/** Lock every retained job before the execution; never invert runtime job -> execution order. */
async function lockControl(db: Queryable, owner: string, id: string) {
  const seen = await readGoalExecution(db, owner, id);
  if (!seen) fail(404, "Goal execution not found.");
  const identities = async () =>
    (
      await db.query<{ id: string; job_id: string | null }>(
        "SELECT id,job_id FROM assistant_goal_attempts WHERE execution_id=$1 AND owner_id=$2 ORDER BY id",
        [id, owner],
      )
    ).rows;
  const before = await identities();
  const jobIds = before.flatMap((a) => (a.job_id ? [a.job_id] : [])).sort();
  await db.query(
    "SELECT id FROM ai_jobs WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
    [owner, jobIds],
  );
  const row = await lockGoalExecution(db, owner, id);
  if (
    row.revision !== seen.revision ||
    goalExecutionDigest(before) !== goalExecutionDigest(await identities())
  )
    fail(409, "Work changed while this control was opening. Try again.");
  return { row, jobIds };
}
export async function controlGoalExecution(
  db: Queryable,
  owner: string,
  id: string,
  action: "pause" | "resume" | "stop" | "accept",
  raw: unknown,
) {
  const input =
    action === "accept"
      ? goalExecutionAccept.parse(raw)
      : action === "resume"
        ? goalExecutionResume.parse(raw)
        : goalExecutionControl.parse(raw);
  const digest = goalExecutionDigest({ action, input });
  const { row, jobIds } = await lockControl(db, owner, id);
  if (row.last_control?.id === input.request_id) {
    if (row.last_control.digest !== digest)
      fail(409, "This request already controls different work.");
    return { jobs: action === "stop" ? jobIds : [] };
  }
  if (
    row.revision !== input.expected_revision ||
    row.generation !== input.generation
  )
    fail(409, "This execution changed. Refresh before continuing.");
  if (["stopped", "completed"].includes(row.state))
    fail(409, "This execution is already closed.");
  let state = row.state,
    paused = row.admissions_paused,
    generation = row.generation,
    acceptance = row.acceptance,
    units = row.units,
    currentJob = row.current_job_id;
  if (action === "pause") paused = true;
  if (action === "resume") {
    if (
      !("expected_config_hash" in input) ||
      input.expected_config_hash !== row.config_hash
    )
      fail(409, "Reviewed execution configuration changed.");
    await assertGoalExecutionCurrent(db, owner, row);
    paused = false;
  }
  if (action === "stop") {
    generation++;
    state = "stopped";
    paused = true;
    await db.query(
      "UPDATE ai_jobs SET cancel_requested=true WHERE id=ANY($2::uuid[]) AND user_id=$1 AND state IN ('queued','running','waiting')",
      [owner, jobIds],
    );
    currentJob = null;
  }
  if (action === "accept") {
    const accepted = goalExecutionAccept.parse(input);
    const facts = await evidence(db, row);
    if (
      !facts.ready ||
      accepted.expected_criteria_hash !== row.criteria_hash ||
      accepted.expected_evidence_hash !== facts.hash
    )
      fail(
        409,
        "The criteria or result evidence changed, or work still needs attention.",
      );
    if (
      [...accepted.accepted_criterion_ids].sort().join() !==
      row.criteria
        .map((c) => c.id)
        .sort()
        .join()
    )
      fail(422, "Review every criterion before accepting.");
    const last = facts.all.at(-1);
    if (!last?.job_id) fail(409, "The result is unavailable.");
    acceptance = {
      id: randomUUID(),
      kind: "person",
      accepted_at: new Date().toISOString(),
      criteria_hash: row.criteria_hash,
      evidence_hash: facts.hash!,
      job_id: last.job_id,
      criterion_ids: accepted.accepted_criterion_ids,
    };
    units = row.units.map((u) => ({
      ...u,
      stage: "satisfied" as const,
      revision: u.revision + 1,
    }));
    state = "completed";
    paused = true;
  }
  await db.query(
    `UPDATE assistant_goal_executions SET state=$3,admissions_paused=$4,generation=$5,revision=revision+1,units=$6,acceptance=$7,current_job_id=$8,last_control=$9,last_transition_reason=$10,updated_at=clock_timestamp() WHERE id=$2 AND owner_id=$1`,
    [
      owner,
      id,
      state,
      paused,
      generation,
      JSON.stringify(units),
      acceptance ? JSON.stringify(acceptance) : null,
      currentJob,
      JSON.stringify({ id: input.request_id, action, digest }),
      {
        pause: "New admissions paused",
        resume: "Admissions resumed",
        stop: "Stopped by you",
        accept: "Criteria accepted by you",
      }[action],
    ],
  );
  return { jobs: action === "stop" ? jobIds : [] };
}

export { goalExecutionDetailsFor } from "./goal-execution-evidence.js";
export { goalExecutionRoutes } from "./goal-execution-routes.js";
