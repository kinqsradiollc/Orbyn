import { z } from "zod";
import { isValidRrule } from "./time.js";

export const AGENT_ROUTINE_SCOPES = ["goal", "routine"] as const;
export const APPROVAL_SCOPES = ["goal", "routine", "always"] as const;
export const ASSISTANT_CHANGE_KINDS = [
  "tasks",
  "sessions",
  "pages",
  "projects",
  "memory",
  "study",
  "other",
] as const;
export type AssistantChangeKind = (typeof ASSISTANT_CHANGE_KINDS)[number];

export const approvalScopeRule = z.union([
  z.literal("always"),
  z.object({ scope: z.enum(["goal", "routine"]), id: z.uuid() }).strict(),
]);
export type ApprovalScopeRule = z.output<typeof approvalScopeRule>;

export const approvalScopesInput = z
  .partialRecord(z.enum(ASSISTANT_CHANGE_KINDS), approvalScopeRule)
  .default({});
export type ApprovalScopes = z.output<typeof approvalScopesInput>;

export const agentRoutineInput = z
  .object({
    instruction: z.string().trim().min(1).max(4000),
    rrule: z.string().trim().min(1).max(200).refine(isValidRrule),
    timezone: z.string().trim().min(1).max(64).default("UTC"),
    next_run_at: z.iso.datetime(),
    paused: z.boolean().default(false),
  })
  .strict();

export const agentRoutineUpdate = agentRoutineInput.partial().strict();
export type AgentRoutineInput = z.input<typeof agentRoutineInput>;
export type AgentRoutineUpdate = z.input<typeof agentRoutineUpdate>;

export type AgentRoutine = {
  id: string;
  user_id: string;
  instruction: string;
  rrule: string;
  timezone: string;
  next_run_at: string;
  last_result: Record<string, unknown> | null;
  paused: boolean;
  created_at: string;
  updated_at: string;
};
