import { z } from "zod";

/** Execution evidence is independent of legacy proposal/apply outcome and job termination. */
export const assistantOutcomeReceipt = z
  .object({
    version: z.literal(1),
    job_id: z.uuid(),
    process: z.enum(["waiting", "finished", "failed", "cancelled"]),
    outcome: z.enum([
      "unverified",
      "completed",
      "partial",
      "waiting",
      "failed",
      "interrupted",
      "uncertain",
    ]),
    reason: z.enum([
      "response_ready",
      "review_required",
      "specialist_incomplete",
      "execution_limit",
      "stopped",
      "timed_out",
      "runtime_failure",
      "worker_interrupted",
      "waiting_expired",
      "dispatch_uncertain",
      "accepted",
    ]),
    observed_at: z.iso.datetime(),
    artifacts: z
      .array(
        z
          .object({
            kind: z.enum(["response", "change_set", "proposal"]),
            id: z.string().min(1).max(160),
          })
          .strict(),
      )
      .max(20),
    checks: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            title: z.string().min(1).max(160),
            status: z.enum(["passed", "failed", "not_run"]),
          })
          .strict(),
      )
      .max(20),
    open_questions: z.array(z.string().min(1).max(1000)).max(20),
    /** Only a trusted acceptance writer can populate this; a model claim is insufficient. */
    acceptance: z
      .object({
        kind: z.enum(["person", "verifier"]),
        reference: z.string().min(1).max(160),
        accepted_at: z.iso.datetime(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((receipt, ctx) => {
    if (
      receipt.outcome === "completed" &&
      (receipt.process !== "finished" ||
        receipt.reason !== "accepted" ||
        !receipt.acceptance ||
        receipt.open_questions.length ||
        receipt.checks.some((check) => check.status !== "passed"))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Completed goals require explicit acceptance, no open questions and passing recorded checks.",
      });
    if (receipt.acceptance && receipt.outcome !== "completed")
      ctx.addIssue({
        code: "custom",
        message: "Acceptance belongs only to a completed goal.",
      });
    if (receipt.process === "waiting" && receipt.outcome !== "waiting")
      ctx.addIssue({
        code: "custom",
        message: "A waiting process cannot have a terminal goal outcome.",
      });
    if (
      receipt.process === "failed" &&
      !["failed", "interrupted", "uncertain"].includes(receipt.outcome)
    )
      ctx.addIssue({
        code: "custom",
        message: "A failed process cannot claim a completed goal.",
      });
    if (
      receipt.outcome === "uncertain" &&
      receipt.reason !== "dispatch_uncertain"
    )
      ctx.addIssue({
        code: "custom",
        message: "Uncertain execution requires reconciliation.",
      });
  });
export type AssistantOutcomeReceipt = z.output<typeof assistantOutcomeReceipt>;

export const ASSISTANT_OUTCOME_LABELS: Record<
  AssistantOutcomeReceipt["outcome"],
  string
> = {
  unverified: "Outcome not verified",
  completed: "Goal completed",
  partial: "Partial result",
  waiting: "Waiting for you",
  failed: "Run failed",
  interrupted: "Run interrupted",
  uncertain: "Execution uncertain",
};

/** Optional wire evidence: older or malformed records stay explicitly unverified. */
export function readAssistantOutcome(
  value: unknown,
): AssistantOutcomeReceipt | undefined {
  const parsed = assistantOutcomeReceipt.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Plain-language evidence shared by both clients, separate from the response body. */
export function assistantOutcomeDetails(
  receipt: AssistantOutcomeReceipt,
): string[] {
  const reasons: Record<AssistantOutcomeReceipt["reason"], string> = {
    response_ready:
      "A response is available. The goal has not been independently verified.",
    review_required:
      "Your answer or review is required before work can continue.",
    specialist_incomplete: "Some assigned work or questions remain unresolved.",
    execution_limit:
      "The run reached its execution budget before all work was verified.",
    stopped:
      "The run stopped at your request. Check any changes already applied.",
    timed_out: "The run reached its time limit. Review the partial result.",
    runtime_failure: "The run failed. Review any saved result before retrying.",
    worker_interrupted:
      "The worker was interrupted. Completion has not been verified.",
    waiting_expired: "The pending answer or review expired.",
    dispatch_uncertain:
      "Execution admission is uncertain. Reconciliation is required before retrying.",
    accepted: "The recorded result was explicitly accepted.",
  };
  return [
    reasons[receipt.reason],
    ...receipt.checks.map(
      (check) =>
        `${check.title}: ${check.status === "not_run" ? "not checked" : check.status}`,
    ),
    ...(receipt.checks.length ? [] : ["No verification checks recorded."]),
    ...receipt.open_questions.map((question) => `Open question: ${question}`),
    ...(receipt.acceptance
      ? [
          `Accepted by ${receipt.acceptance.kind === "person" ? "a person" : "a verifier"} on ${receipt.acceptance.accepted_at}.`,
        ]
      : []),
  ];
}
