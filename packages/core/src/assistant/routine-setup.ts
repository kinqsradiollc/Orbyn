import { z } from "zod";
import {
  agentRoutineInput,
  approvalScopesInput,
  ASSISTANT_CHANGE_KINDS,
} from "./assistant-workspace.js";

const snapshot = z.string().regex(/^[a-f0-9]{64}$/);

/** Current permissions, without creating or expanding assistant authority. */
export const routineSetupContext = z
  .object({
    approval_scopes: approvalScopesInput,
    snapshot,
    max_run_tokens: z.number().int().positive(),
    can_preauthorize: z.boolean(),
  })
  .strict();
export type RoutineSetupContext = z.output<typeof routineSetupContext>;

export const routineSetupInput = z
  .object({
    request_id: z.uuid(),
    routine: agentRoutineInput,
    allow_changes: z
      .array(z.enum(ASSISTANT_CHANGE_KINDS))
      .max(ASSISTANT_CHANGE_KINDS.length)
      .default([])
      .refine((kinds) => new Set(kinds).size === kinds.length, {
        message: "Choose each kind of change only once.",
      }),
    expected_snapshot: snapshot,
  })
  .strict();
export type RoutineSetupInput = z.input<typeof routineSetupInput>;
