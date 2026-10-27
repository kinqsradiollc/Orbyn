import { z } from "zod";

export const assistantBudgetLane = z.enum(["background", "overnight"]);
export const assistantBudgetLimits = z
  .object({
    daily_token_limit: z.number().int().min(1000).max(10_000_000),
    hourly_start_limit: z.number().int().min(1).max(100),
    per_run_token_limit: z.number().int().min(1000).max(200_000),
  })
  .strict();
export const assistantBudgetUpdate = assistantBudgetLimits.extend({
  expected_revision: z.number().int().positive().max(2147483646),
});
export const assistantBudgetView = assistantBudgetLimits.extend({
  lane: assistantBudgetLane,
  revision: z.number().int().positive(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  estimated_tokens: z.number().int().nonnegative(),
  active_reserved_tokens: z.number().int().nonnegative(),
  starts_last_hour: z.number().int().nonnegative(),
});
export const assistantBudgets = z
  .object({
    background: assistantBudgetView,
    overnight: assistantBudgetView,
  })
  .strict();
export type AssistantBudgetView = z.output<typeof assistantBudgetView>;
