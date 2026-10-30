import { z } from "zod";
import { assistantOutcomeReceipt } from "./assistant-outcomes.js";

/** Exact database timestamps retain microseconds so tied pages cannot skip a run. */
export const assistantRoutineRunCursor = z
  .string()
  .max(100)
  .refine((value) => {
    const parts = value.split("|");
    return (
      parts.length === 2 &&
      z.iso.datetime().safeParse(parts[0]).success &&
      z.uuid().safeParse(parts[1]).success
    );
  }, "Choose a valid routine history cursor.");

export const assistantRoutineRunsQuery = z
  .object({
    cursor: assistantRoutineRunCursor.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();
export type AssistantRoutineRunsQuery = z.input<
  typeof assistantRoutineRunsQuery
>;

const metadata = {
  id: z.uuid(),
  scheduled_for: z.iso.datetime(),
  state: z.enum(["queued", "running", "waiting", "done", "failed"]),
  last_observed_at: z.iso.datetime(),
  resume_count: z.number().int().nonnegative(),
};

/** Restricted/retained occurrences contain neither source IDs nor model output. */
export const assistantRoutineRun = z.discriminatedUnion("visibility", [
  z.object({ ...metadata, visibility: z.literal("restricted") }).strict(),
  z
    .object({
      ...metadata,
      visibility: z.literal("available"),
      job_id: z.uuid(),
      chat_id: z.uuid(),
      summary: z.string().max(2000).nullable(),
      execution_outcome: assistantOutcomeReceipt.optional(),
    })
    .strict(),
]);
export type AssistantRoutineRun = z.output<typeof assistantRoutineRun>;

export const assistantRoutineRunsPage = z
  .object({
    routine_id: z.uuid(),
    runs: z.array(assistantRoutineRun).max(50),
    next_cursor: assistantRoutineRunCursor.nullable(),
  })
  .strict()
  .superRefine((page, ctx) => {
    const last = page.runs.at(-1);
    if (
      page.next_cursor &&
      (!last || page.next_cursor !== `${last.scheduled_for}|${last.id}`)
    )
      ctx.addIssue({
        code: "custom",
        path: ["next_cursor"],
        message: "A continuing history page must advance past its last run.",
      });
    for (const [index, run] of page.runs.entries())
      if (
        run.visibility === "available" &&
        run.execution_outcome &&
        run.execution_outcome.job_id !== run.job_id
      )
        ctx.addIssue({
          code: "custom",
          path: ["runs", index, "execution_outcome"],
          message: "Execution evidence must belong to this run's job.",
        });
  });
export type AssistantRoutineRunsPage = z.output<
  typeof assistantRoutineRunsPage
>;
