import { z } from "zod";
import { assistantOutcomeReceipt } from "./assistant-outcomes.js";

export const routineRetryPolicy = z
  .object({
    enabled: z.boolean().default(false),
    max_attempts: z.number().int().min(1).max(5).default(3),
    token_limit: z.number().int().min(1).max(1_000_000).default(200_000),
    max_elapsed_minutes: z.number().int().min(1).max(1440).default(180),
    backoff_seconds: z.number().int().min(5).max(3600).default(60),
  })
  .strict();
export type RoutineRetryPolicy = z.output<typeof routineRetryPolicy>;
export const routineRetryPolicyPage = z
  .object({
    routine_id: z.uuid(),
    revision: z.number().int().positive(),
    policy: routineRetryPolicy,
  })
  .strict();
export type RoutineRetryPolicyPage = z.output<typeof routineRetryPolicyPage>;
export const routineRetryPolicyUpdate = z
  .object({
    request_id: z.uuid(),
    expected_revision: z.number().int().positive(),
    policy: routineRetryPolicy,
  })
  .strict();
export type RoutineRetryPolicyUpdateInput = z.input<
  typeof routineRetryPolicyUpdate
>;
const attemptMetadata = {
  id: z.uuid(),
  ordinal: z.number().int().min(1).max(5),
  state: z.enum([
    "queued",
    "running",
    "waiting",
    "done",
    "failed",
    "unavailable",
  ]),
  created_at: z.iso.datetime(),
  settled_at: z.iso.datetime().nullable(),
  allocated_tokens: z.number().int().nonnegative(),
  settled_tokens: z.number().int().nonnegative().nullable(),
  resume_count: z.number().int().nonnegative(),
  retry: z.enum(["eligible", "never", "reconcile", "unavailable"]),
};
export const routineRecoveryAttempt = z
  .discriminatedUnion("visibility", [
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
  ])
  .superRefine((value, ctx) => {
    if (
      value.visibility === "available" &&
      value.execution_outcome &&
      value.execution_outcome.job_id !== value.job_id
    )
      ctx.addIssue({
        code: "custom",
        message: "Attempt evidence must belong to its job.",
      });
  });
export type RoutineRecoveryAttempt = z.output<typeof routineRecoveryAttempt>;
const identity = {
  routine_id: z.uuid(),
  occurrence_id: z.uuid(),
  scheduled_for: z.iso.datetime(),
};
const recoveryMetadata = {
  ...identity,
  recovery: z.literal("enabled"),
  state: z.enum([
    "active",
    "waiting",
    "retry_scheduled",
    "held",
    "limited",
    "completed",
    "stopped",
  ]),
  generation: z.number().int().positive(),
  revision: z.number().int().positive(),
  lane: z.enum(["background", "overnight"]),
  policy: routineRetryPolicy,
  deadline: z.iso.datetime(),
  consumed_tokens: z.number().int().nonnegative(),
  reserved_tokens: z.number().int().nonnegative(),
  attempt_count: z.number().int().min(1).max(5),
  next_retry_at: z.iso.datetime().nullable(),
  reason: z.string().max(1000),
};
export const routineRecovery = z.union([
  z.object({ ...identity, recovery: z.literal("legacy") }).strict(),
  z.discriminatedUnion("visibility", [
    z
      .object({ ...recoveryMetadata, visibility: z.literal("restricted") })
      .strict(),
    z
      .object({
        ...recoveryMetadata,
        visibility: z.literal("available"),
        attempts: z.array(routineRecoveryAttempt).max(5),
      })
      .strict(),
  ]),
]);
export type RoutineRecovery = z.output<typeof routineRecovery>;
export const routineRecoveryStop = z
  .object({
    request_id: z.uuid(),
    expected_revision: z.number().int().positive(),
    generation: z.number().int().positive(),
  })
  .strict();
export type RoutineRecoveryStopInput = z.input<typeof routineRecoveryStop>;
