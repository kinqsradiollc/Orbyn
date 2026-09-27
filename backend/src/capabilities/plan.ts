import { z } from "zod";
import { defineCapability } from "./registry.js";
import { EDITS, clientRefInput, pendingOutput } from "./write.js";
import {
  MAX_PLAN_STEPS,
  newJob,
  planStep,
  runPlan,
  stepOutput,
} from "./plan-run.js";

/**
 * apply_plan (H5): a whole job in one call. The agent reads and thinks;
 * Orbyn checks the steps, makes them all in one transaction (or none),
 * asks once when anything needs the person, and records them as one job
 * that undo takes back. See plan-run.ts.
 */
export const applyPlan = defineCapability({
  name: "apply_plan",
  title: "Apply a whole plan",
  description:
    'Up to 50 write-tool steps as one job: all checked first, then made in one transaction, all or nothing, asking once if any step would ask. args may use earlier steps: "$notes.id", ".uri", ".ids", ".lines.<anchor>", "$proj.stages[0].id", or "{$notes.uri}" in words. undo({job}) takes it all back.',
  input: z
    .object({
      steps: z.array(planStep).min(1).max(MAX_PLAN_STEPS),
      summary: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe("What the plan does, for the person."),
      client_ref: clientRefInput,
    })
    .strict(),
  output: z.object({
    status: z.enum(["done", "pending_review"]),
    job: z.string().nullable(),
    steps: z.array(stepOutput),
    pending: pendingOutput.nullable(),
  }),
  annotations: EDITS,
  access: "suggest",
  toolset: "core",
  mode: "write",
  tier: "W2",
  limitGroup: "heavy",
  async run(ctx, a) {
    return runPlan(ctx, a, newJob());
  },
});
