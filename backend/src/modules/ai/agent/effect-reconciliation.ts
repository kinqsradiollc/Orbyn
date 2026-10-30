import type { z } from "zod";
import {
  pool,
  transaction,
  type Db,
  type Queryable,
} from "../../../db/pool.js";
import { assistantJobSourcesVisible } from "../../../lib/assistant-job-sources.js";
import { assistantChatVisible } from "../../../lib/assistant-visibility.js";
import { AssistantLeaseLost, assertAssistantLease } from "./lease.js";
import {
  readStoredAssistantApplyEffect,
  storedAssistantApplyResult,
} from "./terminal-evidence.js";

export { storedAssistantApplyResult } from "./terminal-evidence.js";
export type StoredAssistantApplyResult = z.output<
  typeof storedAssistantApplyResult
>;

export type AssistantApplyReconciliation =
  | {
      kind: "receipt";
      effect: "applied" | "pending_review";
      receipt: StoredAssistantApplyResult;
    }
  | { kind: "none" }
  | {
      kind: "unknown";
      reason:
        | "missing_job"
        | "restricted"
        | "missing_receipt"
        | "invalid_receipt"
        | "unavailable";
    };

/** Commit this marker separately BEFORE the plan's effect transaction starts. */
export async function markAssistantApplyStarted(
  db: Queryable,
  jobId: string,
  ownerId: string,
): Promise<string> {
  await assertAssistantLease(jobId, db, true);
  const marked = await db.query<{ marker: string }>(
    `UPDATE ai_jobs SET apply_started_at=CASE WHEN apply_rolled_back_at IS NOT NULL
       THEN greatest(clock_timestamp(),apply_started_at+interval '1 microsecond')
       ELSE coalesce(apply_started_at,clock_timestamp()) END,apply_rolled_back_at=NULL
     WHERE id=$1 AND user_id=$2 AND state='running'
     RETURNING to_char(apply_started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS marker`,
    [jobId, ownerId],
  );
  if (!marked.rowCount) throw new AssistantLeaseLost();
  return marked.rows[0].marker;
}

/** An approval-shaped error must not escape as proof of a failed rollback. */
export class AssistantApplyRollbackUncertain extends Error {
  constructor() {
    super("The apply rollback could not be confirmed.");
  }
}

/**
 * The marker commits independently. Only an acknowledged pre-COMMIT rollback
 * may qualify that exact marker as not applied; a lost COMMIT is reconciled.
 */
export async function withAssistantApplyTransaction<T>(
  jobId: string,
  ownerId: string,
  work: (db: Db) => Promise<T>,
): Promise<T> {
  const marker = await transaction((db) =>
    markAssistantApplyStarted(db, jobId, ownerId),
  );
  const db = await pool.connect();
  let commitAttempted = false;
  let rollbackAcknowledged = false;
  let failure: unknown;
  let discard: Error | undefined;
  try {
    await db.query("BEGIN");
    await assertAssistantLease(jobId, db, true);
    const result = await work(db);
    commitAttempted = true;
    await db.query("COMMIT");
    return result;
  } catch (error) {
    failure = error;
    try {
      await db.query("ROLLBACK");
      rollbackAcknowledged = true;
    } catch (rollbackError) {
      discard =
        rollbackError instanceof Error
          ? rollbackError
          : new Error("The apply connection could not roll back.");
    }
  } finally {
    // Do not reuse a connection that could still own an open transaction.
    db.release(discard);
  }
  if (failure instanceof AssistantLeaseLost) throw failure;
  if (!commitAttempted) {
    if (!rollbackAcknowledged) throw new AssistantApplyRollbackUncertain();
    try {
      await transaction(async (proof) => {
        await assertAssistantLease(jobId, proof, true);
        const recorded = await proof.query(
          `UPDATE ai_jobs SET apply_rolled_back_at=greatest(clock_timestamp(),apply_started_at)
           WHERE id=$1 AND user_id=$2 AND state='running'
             AND apply_started_at=$3::timestamptz AND apply_result IS NULL RETURNING id`,
          [jobId, ownerId, marker],
        );
        if (!recorded.rowCount) throw new AssistantApplyRollbackUncertain();
      });
    } catch (proofError) {
      if (proofError instanceof AssistantLeaseLost) throw proofError;
      throw new AssistantApplyRollbackUncertain();
    }
  }
  // AskFirst identity survives only after its rollback proof was committed.
  throw failure;
}

/**
 * The primary job lock waits for an in-flight effect transaction to commit or
 * roll back. Only that same job's currently authorized receipt can be returned.
 * Query/commit failure and absent legacy evidence never establish a rollback.
 */
export async function reconcileAssistantApply(
  jobId: string,
  ownerId: string,
  options: { knownNotStarted?: boolean } = {},
): Promise<AssistantApplyReconciliation> {
  try {
    return await transaction(
      async (db): Promise<AssistantApplyReconciliation> => {
        const row = (
          await db.query<{
            apply_result: unknown;
            apply_started_at: Date | null;
            apply_tracking_version: number | null;
            confirmed_rollback: boolean;
            state: string;
          }>(
            `SELECT apply_result,apply_started_at,apply_tracking_version,state,
              (apply_started_at IS NOT NULL AND apply_rolled_back_at>=apply_started_at) AS confirmed_rollback FROM ai_jobs
           WHERE id=$1 AND user_id=$2 FOR UPDATE`,
            [jobId, ownerId],
          )
        ).rows[0];
        if (!row) return { kind: "unknown", reason: "missing_job" };
        if (row.state !== "running") throw new AssistantLeaseLost();
        await assertAssistantLease(jobId, db, true);
        const authorized = await db.query(
          `SELECT j.id FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id
         WHERE j.id=$2 AND ${assistantJobSourcesVisible("j", "$1", false)}
           AND ${assistantChatVisible("c", "$1")}`,
          [ownerId, jobId],
        );
        if (!authorized.rowCount)
          return { kind: "unknown", reason: "restricted" };
        if (row.apply_result === null) {
          return row.apply_tracking_version === 1 &&
            (row.confirmed_rollback ||
              (options.knownNotStarted === true && !row.apply_started_at))
            ? { kind: "none" }
            : { kind: "unknown", reason: "missing_receipt" };
        }
        const parsed = storedAssistantApplyResult.safeParse(row.apply_result);
        const effect = readStoredAssistantApplyEffect(row.apply_result);
        if (!parsed.success || effect === "uncertain")
          return { kind: "unknown", reason: "invalid_receipt" };
        return {
          kind: "receipt",
          effect: effect === "pending" ? "pending_review" : "applied",
          receipt: parsed.data,
        };
      },
    );
  } catch (error) {
    if (error instanceof AssistantLeaseLost) throw error;
    return { kind: "unknown", reason: "unavailable" };
  }
}
