import { transaction, type Queryable } from "../../../db/pool.js";
import { assertAssistantLease } from "./lease.js";
import {
  assertRoutineRecoveryCurrent,
  type RoutineRecoveryBinding,
} from "../../assistant-workspace/routine-recovery.js";
import type { AssistantAutomation } from "./run.js";

/** A fresh routine attempt never acquires authority from its predecessor's text. */
export async function checkRoutineRecoveryBoundary(
  owner: string,
  jobId: string,
  automation?: AssistantAutomation,
  db?: Queryable,
  write = false,
) {
  const binding = automation?.routine_recovery;
  if (!binding) return;
  const check = async (current: Queryable) => {
    await assertAssistantLease(jobId, current, true);
    await assertRoutineRecoveryCurrent(current, owner, binding, {
      jobId,
      write,
    });
  };
  if (db) await check(db);
  else await transaction(check);
}
export type { RoutineRecoveryBinding };
