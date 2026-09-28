import { AsyncLocalStorage } from "node:async_hooks";
import { pool, type Queryable } from "../../../db/pool.js";

const lease = new AsyncLocalStorage<{ jobId: string; owner: string }>();

/** A stale worker must stop without changing the job held by another runner. */
export class AssistantLeaseLost extends Error {
  constructor() {
    super("The assistant job is now held by another runner.");
  }
}

/** Carry the claim through checkpoints, provider calls and apply transactions. */
export const withAssistantLease = <T>(
  jobId: string,
  owner: string,
  run: () => Promise<T>,
) => lease.run({ jobId, owner }, run);

/** Legacy direct calls have no lease context; queued runs always have one. */
export const assistantLeaseOwner = (jobId: string) => {
  const current = lease.getStore();
  return current?.jobId === jobId ? current.owner : null;
};

/** Lock the job while applying or completing, so a second runner cannot take it. */
export async function assertAssistantLease(
  jobId: string,
  db: Queryable = pool,
  lock = false,
) {
  const owner = assistantLeaseOwner(jobId);
  if (!owner) return;
  const result = await db.query(
    `SELECT id FROM ai_jobs WHERE id = $1 AND claimed_by = $2
     AND state = 'running' AND lease_until > now() ${lock ? "FOR UPDATE" : ""}`,
    [jobId, owner],
  );
  if (!result.rowCount) throw new AssistantLeaseLost();
}
