import {
  assistantOutcomeReceipt,
  type AssistantOutcomeReceipt,
} from "@orbyn/core";
import type { LeadState } from "./lead.js";

/** Deterministic receipt from runtime/checker facts. Specialist completion never proves goal acceptance. */
export function runtimeOutcome(input: {
  jobId: string;
  chatId: string;
  turnId: string;
  state?: Pick<
    LeadState,
    "reports" | "token_estimate" | "token_budget" | "completion_limited"
  >;
  proposalOutcome?: "info" | "applied" | "pending" | "discarded";
  stopped?: boolean;
  timedOut?: boolean;
  failed?: boolean;
  interrupted?: boolean;
  waiting?: boolean;
  expiredWaiting?: boolean;
  /** A started effect or private inference dispatch has no reconciled result. */
  uncertain?: boolean;
  planJob?: string;
  proposalId?: string;
  now?: string;
}): AssistantOutcomeReceipt {
  const state = input.state;
  const incomplete =
    state?.reports.some(
      (report) => report.status !== "done" || report.open_questions.length > 0,
    ) ?? false;
  const limited =
    state?.completion_limited ||
    (state && state.token_estimate >= state.token_budget);
  const terminalFailure = input.failed || input.expiredWaiting;
  const interrupted = input.interrupted || input.stopped;
  const needsReview = input.waiting || input.proposalOutcome === "pending";
  const outcome: AssistantOutcomeReceipt["outcome"] = input.uncertain
    ? "uncertain"
    : terminalFailure
      ? "failed"
      : interrupted
        ? "interrupted"
        : needsReview
          ? "waiting"
          : input.timedOut || incomplete || limited
            ? "partial"
            : "unverified";
  const reason: AssistantOutcomeReceipt["reason"] = input.uncertain
    ? "dispatch_uncertain"
    : input.expiredWaiting
      ? "waiting_expired"
      : input.failed
        ? "runtime_failure"
        : input.interrupted
          ? "worker_interrupted"
          : input.stopped
            ? "stopped"
            : needsReview
              ? "review_required"
              : input.timedOut
                ? "timed_out"
                : limited
                  ? "execution_limit"
                  : incomplete
                    ? "specialist_incomplete"
                    : "response_ready";
  const artifacts: AssistantOutcomeReceipt["artifacts"] = [
    { kind: "response", id: `${input.chatId}:${input.turnId}` },
  ];
  if (input.planJob) artifacts.push({ kind: "change_set", id: input.planJob });
  if (input.proposalId)
    artifacts.push({ kind: "proposal", id: input.proposalId });
  return assistantOutcomeReceipt.parse({
    version: 1,
    job_id: input.jobId,
    process:
      terminalFailure || input.interrupted
        ? "failed"
        : input.stopped
          ? "cancelled"
          : input.waiting
            ? "waiting"
            : "finished",
    outcome,
    reason,
    observed_at: input.now ?? new Date().toISOString(),
    artifacts,
    checks:
      input.planJob && input.proposalOutcome === "applied"
        ? [
            {
              id: "plan_authorization",
              title: "Plan validation and authorization",
              status: "passed",
            },
          ]
        : [],
    open_questions: [
      ...new Set(
        state?.reports.flatMap((report) => report.open_questions) ?? [],
      ),
    ]
      .slice(0, 20)
      .map((question) => question.slice(0, 1000)),
  });
}
