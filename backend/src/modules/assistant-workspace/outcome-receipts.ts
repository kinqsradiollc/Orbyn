import {
  assistantOutcomeReceipt,
  goalExecutionAcceptance,
  type AssistantOutcomeReceipt,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";

/** A reviewed proposal resolves a waiting decision, without proving the goal complete. */
export function projectOutcomeReceipt(
  value: unknown,
  jobId: string,
  reviewStatus?: string | null,
  goalAcceptance?: unknown,
): AssistantOutcomeReceipt | undefined {
  const parsed = assistantOutcomeReceipt.safeParse(value);
  if (!parsed.success || parsed.data.job_id !== jobId) return undefined;
  const receipt = parsed.data;
  const accepted = goalExecutionAcceptance.safeParse(goalAcceptance);
  if (
    accepted.success &&
    accepted.data.job_id === jobId &&
    receipt.process === "finished" &&
    ["unverified", "completed"].includes(receipt.outcome) &&
    !receipt.open_questions.length &&
    receipt.checks.every((check) => check.status === "passed")
  ) {
    return assistantOutcomeReceipt.parse({
      ...receipt,
      outcome: "completed",
      reason: "accepted",
      acceptance: {
        kind: "person",
        reference: accepted.data.id,
        accepted_at: accepted.data.accepted_at,
      },
    });
  }
  if (
    receipt.outcome === "waiting" &&
    receipt.reason === "review_required" &&
    reviewStatus === "expired"
  )
    return { ...receipt, outcome: "unverified", reason: "waiting_expired" };
  return receipt.outcome === "waiting" &&
    receipt.reason === "review_required" &&
    ["applied", "declined", "cancelled"].includes(reviewStatus ?? "")
    ? { ...receipt, outcome: "unverified", reason: "response_ready" }
    : receipt;
}

/** Additive display evidence; never stored in legacy/client-authored turn payloads. */
export async function readOutcomeReceipts(
  db: Queryable,
  owner: string,
  chat: string,
  turns: string[],
) {
  const byTurn = new Map<string, AssistantOutcomeReceipt>();
  if (!turns.length) return byTurn;
  const receipts = await db.query<{
    id: string;
    turn_id: string;
    receipt: unknown;
    review_status: string | null;
    goal_acceptance: unknown;
  }>(
    `SELECT j.id,j.result->>'turn_id' AS turn_id,j.result->'assistant_run'->'execution_outcome' AS receipt,
     (SELECT accepted.acceptance FROM assistant_goal_executions accepted WHERE accepted.owner_id=$1 AND accepted.state='completed' AND accepted.acceptance->>'job_id'=j.id::text LIMIT 1) AS goal_acceptance,
     CASE WHEN p.status='pending' AND p.expires_at<=now() THEN 'expired' ELSE p.status END AS review_status
     FROM ai_jobs j LEFT JOIN proposals p ON p.user_id=$1 AND p.id=CASE WHEN j.result->'assistant_run'->>'proposal_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN (j.result->'assistant_run'->>'proposal_id')::uuid END WHERE j.user_id=$1 AND j.chat_id=$2 AND j.result->>'turn_id'=ANY($3::text[])
       AND j.result->'assistant_run'->'execution_outcome' IS NOT NULL
       AND ${assistantJobSourcesVisible("j", "$1", false)}
     ORDER BY j.created_at DESC,j.id DESC LIMIT 200`,
    [owner, chat, turns.slice(0, 200)],
  );
  for (const value of receipts.rows) {
    const receipt = projectOutcomeReceipt(
      value.receipt,
      value.id,
      value.review_status,
      value.goal_acceptance,
    );
    if (receipt && !byTurn.has(value.turn_id))
      byTurn.set(value.turn_id, receipt);
  }
  return byTurn;
}
