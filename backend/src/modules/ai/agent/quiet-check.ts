import { transaction, type Queryable } from "../../../db/pool.js";
import { assertAssistantLease } from "./lease.js";
import {
  assertQuietCheckCurrent,
  recordQuietReadEvidence,
  type QuietCheckBinding,
} from "../../assistant-workspace/routine-quiet-checks.js";
import type { QuietReadEvidence } from "../../assistant-workspace/quiet-projection.js";
import type { AssistantAutomation } from "./run.js";

export async function checkQuietBoundary(
  owner: string,
  jobId: string,
  automation?: AssistantAutomation,
  db?: Queryable,
) {
  const binding = automation?.routine_quiet;
  if (!binding) return;
  const check = async (current: Queryable) => {
    await assertAssistantLease(jobId, current, true);
    await assertQuietCheckCurrent(current, owner, jobId, binding);
  };
  if (db) await check(db);
  else await transaction(check);
}
export async function recordQuietReads(
  owner: string,
  jobId: string,
  binding: QuietCheckBinding,
  evidence: QuietReadEvidence[],
) {
  await transaction(async (db) => {
    await assertAssistantLease(jobId, db, true);
    await recordQuietReadEvidence(db, owner, jobId, binding, evidence);
  });
}
export type { QuietCheckBinding };
