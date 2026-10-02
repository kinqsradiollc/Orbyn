import { z } from "zod";

export const ASSISTANT_RULE_ACTIONS = [
  "any_change",
  "create",
  "edit",
  "delete_move_restore",
  "email",
  "notify",
  "publish",
  "fetch",
  "handoff",
] as const;
export const assistantRuleScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z.object({ kind: z.literal("personal") }).strict(),
  z
    .object({
      kind: z.literal("team"),
      id: z.uuid().transform((id) => id.toLowerCase()),
    })
    .strict(),
]);
/** Reviewed restrictions on a named assistant runtime; never a grant of access. */
export const assistantActionRule = z
  .object({
    id: z.uuid().transform((id) => id.toLowerCase()),
    lane: z.enum(["interactive", "background", "overnight"]),
    action: z.enum(ASSISTANT_RULE_ACTIONS),
    scope: assistantRuleScope,
    decision: z.enum(["allow", "ask", "deny"]),
  })
  .strict();
export type AssistantActionRule = z.output<typeof assistantActionRule>;
export const assistantActionRules = z
  .array(assistantActionRule)
  .max(100)
  .superRefine((rules, ctx) => {
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length)
      ctx.addIssue({
        code: "custom",
        message: "Each rule needs a distinct identity.",
      });
  });
export const assistantRulesInput = z
  .object({
    expected_revision: z.number().int().min(1).max(2147483646),
    rules: assistantActionRules,
  })
  .strict();
export const assistantRulesSnapshot = z
  .object({
    revision: z.number().int().positive().max(2147483647),
    rules: assistantActionRules,
  })
  .strict();

/** Deny dominates ask, which dominates allow, regardless of specificity/order. */
export function assistantRuleDecision(
  rules: readonly AssistantActionRule[],
  lane: AssistantActionRule["lane"],
  teamId: string | null,
  actions: readonly AssistantActionRule["action"][],
): "deny" | "ask" | "allow" | null {
  let result: "deny" | "ask" | "allow" | null = null;
  for (const rule of rules) {
    if (rule.lane !== lane || !actions.includes(rule.action)) continue;
    if (rule.scope.kind === "personal" && teamId !== null) continue;
    if (rule.scope.kind === "team" && rule.scope.id !== teamId?.toLowerCase())
      continue;
    if (rule.decision === "deny") return "deny";
    if (rule.decision === "ask") result = "ask";
    else if (result === null) result = "allow";
  }
  return result;
}
