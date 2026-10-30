import { z } from "zod";

export const routineQuietSource = z
  .object({
    kind: z.enum(["task", "doc"]),
    id: z.uuid(),
  })
  .strict();
export type RoutineQuietSource = z.output<typeof routineQuietSource>;
export const routineQuietPolicy = z
  .object({
    enabled: z.boolean().default(false),
    sources: z.array(routineQuietSource).max(20).default([]),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (policy.enabled && !policy.sources.length)
      ctx.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Choose at least one task or page.",
      });
    if (
      new Set(policy.sources.map((source) => `${source.kind}:${source.id}`))
        .size !== policy.sources.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Choose each source only once.",
      });
  });
export type RoutineQuietPolicy = z.output<typeof routineQuietPolicy>;
const label = routineQuietSource
  .extend({ title: z.string().max(500) })
  .strict();
export const routineQuietPolicyPage = z.discriminatedUnion("visibility", [
  z
    .object({
      routine_id: z.uuid(),
      revision: z.number().int().positive(),
      visibility: z.literal("available"),
      policy: routineQuietPolicy,
      labels: z.array(label).max(20),
    })
    .strict(),
  z
    .object({
      routine_id: z.uuid(),
      revision: z.number().int().positive(),
      visibility: z.literal("restricted"),
      enabled: z.boolean(),
      source_count: z.number().int().min(0).max(20),
    })
    .strict(),
]);
export type RoutineQuietPolicyPage = z.output<typeof routineQuietPolicyPage>;
export const updateRoutineQuietPolicyInput = z
  .object({
    request_id: z.uuid(),
    expected_revision: z.number().int().positive(),
    policy: routineQuietPolicy,
  })
  .strict();
export type UpdateRoutineQuietPolicyInput = z.input<
  typeof updateRoutineQuietPolicyInput
>;
const checkMetadata = {
  id: z.uuid(),
  status: z.enum([
    "pending",
    "baseline",
    "verified_unchanged",
    "changed",
    "reported",
    "incomplete",
  ]),
  requested: z.boolean(),
  expected_count: z.number().int().min(0).max(20),
  checked_count: z.number().int().min(0).max(20),
  created_at: z.iso.datetime(),
  observed_at: z.iso.datetime().nullable(),
  reason: z.string().max(1000).nullable(),
  baseline_available: z.boolean(),
};
export const routineQuietCheck = z.discriminatedUnion("visibility", [
  z.object({ ...checkMetadata, visibility: z.literal("restricted") }).strict(),
  z
    .object({
      ...checkMetadata,
      visibility: z.literal("available"),
      job_id: z.uuid().nullable(),
      chat_id: z.uuid().nullable(),
      sources: z
        .array(
          label
            .extend({
              state: z.enum([
                "checked",
                "changed",
                "unchanged",
                "incomplete",
                "unavailable",
              ]),
              checked_at: z.iso.datetime().nullable(),
              reason: z.string().max(1000).nullable(),
            })
            .strict(),
        )
        .max(20),
    })
    .strict(),
]);
export type RoutineQuietCheck = z.output<typeof routineQuietCheck>;
export const routineQuietChecksPage = z
  .object({
    routine_id: z.uuid(),
    occurrence_id: z.uuid(),
    configured: z.boolean(),
    checks: z.array(routineQuietCheck).max(5),
  })
  .strict();
export type RoutineQuietChecksPage = z.output<typeof routineQuietChecksPage>;
