import { z } from "zod";
import { assistantOutcomeReceipt } from "./assistant-outcomes.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().int().positive();
export const goalExecutionCriterion = z
  .object({
    id: z.uuid(),
    text: z.string().trim().min(1).max(500),
    kind: z.literal("person"),
  })
  .strict();
const criteria = z
  .array(goalExecutionCriterion)
  .min(1)
  .max(10)
  .refine(
    (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
    "Give each criterion a distinct identity.",
  );
export const goalExecutionLimits = z
  .object({
    max_attempts: z.number().int().min(1).max(20),
    token_limit: z.number().int().min(1).max(1_000_000),
    deadline: z.iso.datetime(),
  })
  .strict();
export const goalExecutionStart = z
  .object({
    request_id: z.uuid(),
    expected_goal_revision: positive,
    criteria,
    lane: z.enum(["background", "overnight"]),
    effect_ceiling: z.enum(["suggest", "existing_scopes"]),
    limits: goalExecutionLimits,
  })
  .strict();
export type GoalExecutionStartInput = z.input<typeof goalExecutionStart>;
export const goalExecutionControl = z
  .object({
    request_id: z.uuid(),
    expected_revision: positive,
    generation: positive,
  })
  .strict();
export type GoalExecutionControlInput = z.input<typeof goalExecutionControl>;
export const goalExecutionResume = goalExecutionControl
  .extend({ expected_config_hash: hash })
  .strict();
export type GoalExecutionResumeInput = z.input<typeof goalExecutionResume>;
export const goalExecutionAccept = goalExecutionControl
  .extend({
    expected_criteria_hash: hash,
    expected_evidence_hash: hash,
    accepted_criterion_ids: z
      .array(z.uuid())
      .min(1)
      .max(10)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Review each criterion once.",
      ),
  })
  .strict();
export type GoalExecutionAcceptInput = z.input<typeof goalExecutionAccept>;

export const goalExecutionOutput = z
  .object({
    kind: z.enum(["task", "doc", "project", "response"]),
    id: z.string().min(1).max(160),
    version: z.string().min(1).max(80),
    producer_job_id: z.uuid(),
    receipt_digest: hash,
  })
  .strict();
export const goalExecutionUnit = z
  .object({
    id: z.uuid(),
    criterion_id: z.uuid(),
    revision: positive,
    effects_applied: z.boolean().default(false),
    stage: z.enum([
      "work",
      "verify",
      "repair",
      "ready_for_acceptance",
      "satisfied",
      "blocked",
    ]),
    last_attempt_id: z.uuid().nullable(),
    outputs: z.array(goalExecutionOutput).max(100),
    pending_proposal_id: z.uuid().nullable(),
    blocker_code: z.string().max(120).nullable(),
  })
  .strict();
export type GoalExecutionUnit = z.output<typeof goalExecutionUnit>;
export type GoalExecutionOutput = z.output<typeof goalExecutionOutput>;
export const goalExecutionAcceptance = z
  .object({
    id: z.uuid(),
    kind: z.literal("person"),
    accepted_at: z.iso.datetime(),
    criteria_hash: hash,
    evidence_hash: hash,
    job_id: z.uuid(),
    criterion_ids: z.array(z.uuid()).min(1).max(10),
  })
  .strict();
const executionMetadata = {
  id: z.uuid(),
  goal_id: z.uuid(),
  state: z.enum([
    "ready",
    "active",
    "waiting",
    "awaiting_acceptance",
    "limited",
    "held",
    "failed",
    "stopped",
    "completed",
  ]),
  admissions_paused: z.boolean(),
  generation: positive,
  revision: positive,
  lane: z.enum(["background", "overnight"]),
  effect_ceiling: z.enum(["suggest", "existing_scopes"]),
  criteria_hash: hash,
  config_hash: hash,
  frontier_revision: positive,
  evidence_revision: z.number().int().nonnegative(),
  limits: goalExecutionLimits,
  consumed_tokens: z.number().int().nonnegative(),
  reserved_tokens: z.number().int().nonnegative(),
  attempt_count: z.number().int().nonnegative(),
  last_transition_reason: z.string().max(300),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
};
export const goalExecution = z.object(executionMetadata).strict();
export type GoalExecution = z.output<typeof goalExecution>;
export const goalExecutionResult = z
  .object({
    attempt_id: z.uuid(),
    job_id: z.uuid(),
    chat_id: z.uuid(),
    state: z.enum(["queued", "running", "waiting", "done", "failed"]),
    cancel_requested: z.boolean(),
    recovering: z.boolean(),
    summary: z.string().max(4000).nullable(),
    execution_outcome: assistantOutcomeReceipt.optional(),
  })
  .strict();
export const goalExecutionWaitingResult = goalExecutionResult
  .extend({
    unit_id: z.uuid(),
    criterion_id: z.uuid(),
    mode: z.enum(["work", "verify", "repair"]),
    waiting_kind: z.enum(["person", "approval", "review"]),
  })
  .strict();
export type GoalExecutionWaitingResult = z.output<
  typeof goalExecutionWaitingResult
>;

export const goalExecutionDetails = z
  .discriminatedUnion("visibility", [
    z
      .object({ ...executionMetadata, visibility: z.literal("restricted") })
      .strict(),
    z
      .object({
        ...executionMetadata,
        visibility: z.literal("available"),
        criteria,
        units: z.array(goalExecutionUnit).min(1).max(10),
        current_job_id: z.uuid().nullable(),
        result: goalExecutionResult.nullable(),
        waiting_results: z
          .array(goalExecutionWaitingResult)
          .max(10)
          .default([]),
        evidence_hash: hash.nullable(),
        can_accept: z.boolean(),
        permission_summary: z.string().max(1000),
        acceptance: goalExecutionAcceptance.nullable(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.visibility !== "available") return;
    const ids = new Set(value.criteria.map((criterion) => criterion.id));
    if (
      value.units.length !== ids.size ||
      new Set(value.units.map((unit) => unit.criterion_id)).size !== ids.size ||
      value.units.some((unit) => !ids.has(unit.criterion_id))
    )
      ctx.addIssue({
        code: "custom",
        message: "Execution units must match the reviewed criteria.",
      });
    if (
      value.result?.execution_outcome &&
      value.result.execution_outcome.job_id !== value.result.job_id
    )
      ctx.addIssue({
        code: "custom",
        message: "Result evidence must belong to its job.",
      });
    const parkedUnits = new Set<string>();
    for (const waiting of value.waiting_results) {
      if (
        parkedUnits.has(waiting.unit_id) ||
        !value.units.some(
          (unit) =>
            unit.id === waiting.unit_id &&
            unit.criterion_id === waiting.criterion_id,
        ) ||
        (waiting.execution_outcome &&
          waiting.execution_outcome.job_id !== waiting.job_id)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Waiting results must belong to distinct reviewed units and their exact jobs.",
        });
      parkedUnits.add(waiting.unit_id);
    }
    if (
      value.can_accept &&
      (value.state !== "awaiting_acceptance" ||
        value.waiting_results.length > 0 ||
        !value.evidence_hash ||
        value.units.some((unit) => unit.stage !== "ready_for_acceptance"))
    )
      ctx.addIssue({
        code: "custom",
        message: "Only fully reviewed, idle criteria may be accepted.",
      });
  });
export type GoalExecutionDetails = z.output<typeof goalExecutionDetails>;
export const goalExecutionHistoryCursor = z
  .string()
  .max(100)
  .refine((value) => {
    const parts = value.split("|");
    return (
      parts.length === 2 &&
      z.iso.datetime().safeParse(parts[0]).success &&
      z.uuid().safeParse(parts[1]).success
    );
  }, "Choose a valid execution history cursor.");
export const goalExecutionHistoryQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(20).default(10),
    cursor: goalExecutionHistoryCursor.optional(),
  })
  .strict();
export type GoalExecutionHistoryQuery = z.input<
  typeof goalExecutionHistoryQuery
>;
export const goalExecutionPage = z
  .object({
    goal_id: z.uuid(),
    executions: z.array(goalExecution).max(20),
    next_cursor: goalExecutionHistoryCursor.nullable(),
  })
  .strict();
export type GoalExecutionPage = z.output<typeof goalExecutionPage>;
const attemptMetadata = {
  id: z.uuid(),
  execution_id: z.uuid(),
  unit_id: z.uuid(),
  ordinal: positive,
  mode: z.enum(["work", "verify", "repair"]),
  relation: z.enum(["initial", "continue", "retry"]),
  generation: positive,
  state: z.enum([
    "queued",
    "running",
    "waiting",
    "done",
    "failed",
    "unavailable",
  ]),
  allocated_tokens: z.number().int().nonnegative(),
  settled_tokens: z.number().int().nonnegative().nullable(),
  created_at: z.iso.datetime(),
  settled_at: z.iso.datetime().nullable(),
};
export const goalExecutionAttempt = z.discriminatedUnion("visibility", [
  z
    .object({ ...attemptMetadata, visibility: z.literal("restricted") })
    .strict(),
  z
    .object({
      ...attemptMetadata,
      visibility: z.literal("available"),
      job_id: z.uuid(),
      chat_id: z.uuid(),
      summary: z.string().max(4000).nullable(),
      execution_outcome: assistantOutcomeReceipt.optional(),
    })
    .strict(),
]);
export type GoalExecutionAttempt = z.output<typeof goalExecutionAttempt>;
export const goalExecutionAttemptPage = z
  .object({
    execution_id: z.uuid(),
    attempts: z.array(goalExecutionAttempt).max(20),
    next_cursor: goalExecutionHistoryCursor.nullable(),
  })
  .strict();
export type GoalExecutionAttemptPage = z.output<
  typeof goalExecutionAttemptPage
>;
