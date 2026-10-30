import { fail } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { pool, transaction } from "../../db/pool.js";
import {
  assistantExecutionContext,
  assistantExecutionDigest,
} from "./execution-authority.js";
import { readCurrentQuietProjection } from "./quiet-projection.js";
import {
  assertQuietCheckConfiguration,
  readQuietCheck,
  quietReadReceipts,
  quietSourceCoverage,
  quietJobVisible,
  type QuietCheckRow,
  type QuietSnapshot,
} from "./routine-quiet-checks.js";
export type QuietCheckFinalization = {
  requested: boolean;
  terminal: "succeeded" | "failed" | "cancelled" | "waiting";
  effects: "none" | "applied" | "pending" | "uncertain";
  hasUsefulOutput: boolean;
  hasDecision: boolean;
};
export type QuietCheckFinalized = {
  status: QuietCheckRow["status"];
  summary: string;
  quiet: boolean;
};
async function baseline(db: Queryable, row: QuietCheckRow) {
  if (!row.baseline_check_id) return null;
  const prior = await readQuietCheck(db, row.owner_id, row.baseline_check_id);
  if (
    !prior ||
    prior.config_hash !== row.config_hash ||
    prior.provider_hash !== row.provider_hash ||
    prior.scope_hash !== row.scope_hash ||
    prior.projection_version !== row.projection_version ||
    !["baseline", "verified_unchanged", "changed", "reported"].includes(
      prior.status,
    ) ||
    !prior.snapshot_aggregate ||
    prior.checked_count !== prior.expected_count ||
    !(await quietJobVisible(db, prior))
  )
    return null;
  return prior;
}
export async function currentQuietSnapshots(
  db: Queryable,
  row: QuietCheckRow,
  lock = false,
) {
  const principal = await assistantExecutionContext(db, row.owner_id, row.lane);
  if (!principal) fail(409, "Assistant permission is unavailable.");
  const snapshots: QuietSnapshot[] = [];
  for (const source of [...row.policy_snapshot.sources].sort((a, b) =>
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
  )) {
    const p = await readCurrentQuietProjection(db, principal, source, { lock });
    if (!p.supported) fail(409, "A selected source is no longer supported.");
    snapshots.push({
      kind: source.kind,
      id: source.id,
      revision: p.revision,
      digest: p.digest,
    });
  }
  return snapshots;
}
function positiveNone(job: {
  apply_tracking_version: number | null;
  apply_started_at: Date | null;
  apply_rolled_back_at: Date | null;
  apply_result: unknown;
}) {
  return (
    job.apply_tracking_version === 1 &&
    job.apply_result == null &&
    (!job.apply_started_at ||
      (!!job.apply_rolled_back_at &&
        job.apply_rolled_back_at >= job.apply_started_at))
  );
}
/** The runtime supplies terminal facts; SQL still requires a positive tracked no-effect origin. */
export async function finalizeRoutineQuietCheck(
  db: Queryable,
  owner: string,
  jobId: string,
  input: QuietCheckFinalization,
): Promise<QuietCheckFinalized | null> {
  const job = (
    await db.query<{
      id: string;
      cancel_requested: boolean;
      apply_tracking_version: number | null;
      apply_started_at: Date | null;
      apply_rolled_back_at: Date | null;
      apply_result: unknown;
      run_state: any;
    }>(
      "SELECT id,cancel_requested,apply_tracking_version,apply_started_at,apply_rolled_back_at,apply_result,run_state FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [jobId, owner],
    )
  ).rows[0];
  if (!job) return null;
  const found = (
    await db.query<{ id: string }>(
      "SELECT id FROM assistant_quiet_checks WHERE job_id=$1 AND owner_id=$2",
      [jobId, owner],
    )
  ).rows[0];
  if (!found) return null;
  const row = (await readQuietCheck(db, owner, found.id, true))!;
  if (row.status !== "pending")
    return {
      status: row.status,
      summary: row.reason,
      quiet:
        row.status === "verified_unchanged" &&
        (await routineQuietDeliveryProof(db, owner, jobId)),
    };
  const requested = row.requested || input.requested;
  if (input.terminal === "waiting") {
    await db.query(
      "UPDATE assistant_quiet_checks SET requested=$2,decision_seen=true,reason='This check needs a decision before it can finish.' WHERE id=$1",
      [row.id, requested],
    );
    return {
      status: "pending",
      summary: "This check needs a decision before it can finish.",
      quiet: false,
    };
  }
  let status: QuietCheckRow["status"] = "incomplete",
    summary =
      "The selected sources could not all be verified. Review this run.",
    aggregate: QuietSnapshot[] | null = null,
    checked = 0;
  const eligible =
    input.terminal === "succeeded" &&
    input.effects === "none" &&
    !input.hasDecision &&
    !row.decision_seen &&
    !job.cancel_requested &&
    !job.run_state?.state?.waiting &&
    positiveNone(job);
  if (eligible) {
    try {
      await assertQuietCheckConfiguration(db, row);
      if (!(await quietJobVisible(db, row)))
        fail(409, "Source context is unavailable.");
      const receipts = await quietReadReceipts(db, row.id),
        covered = row.policy_snapshot.sources.map((s) =>
          quietSourceCoverage(s, receipts),
        );
      checked = covered.filter(Boolean).length;
      if (covered.every((s): s is QuietSnapshot => s !== null)) {
        const current = await currentQuietSnapshots(db, row, true);
        const observed = [...covered].sort((a, b) =>
          `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
        );
        if (
          assistantExecutionDigest(observed) ===
          assistantExecutionDigest(current)
        ) {
          aggregate = current;
          const previous = await baseline(db, row);
          const unchanged =
            !!previous &&
            assistantExecutionDigest(previous.snapshot_aggregate) ===
              assistantExecutionDigest(current);
          status = !previous
            ? "baseline"
            : input.hasUsefulOutput || !requested
              ? "reported"
              : unchanged
                ? "verified_unchanged"
                : "changed";
          summary =
            status === "verified_unchanged"
              ? "All selected sources were freshly checked and unchanged."
              : status === "baseline"
                ? "All selected sources were checked. This establishes the first comparable check."
                : status === "changed"
                  ? "The selected sources changed since their previous complete check."
                  : "All selected sources were checked. This run has a report to review.";
        } else
          summary =
            "A selected source changed during the check. The result stays visible.";
      }
    } catch {
      summary =
        "The selected sources or check configuration are no longer available. The result stays visible.";
    }
  }
  await db.query(
    "UPDATE assistant_quiet_checks SET requested=$2,status=$3,reason=$4,checked_count=$5,observed_at=clock_timestamp(),snapshot_aggregate=$6::jsonb,decision_seen=decision_seen OR $7 WHERE id=$1",
    [
      row.id,
      requested,
      status,
      summary,
      checked,
      aggregate ? JSON.stringify(aggregate) : null,
      input.hasDecision,
    ],
  );
  return { status, summary, quiet: status === "verified_unchanged" };
}
/** Cross-job quiet suppression requires retained, current, source-authorized check evidence. */
export async function routineQuietDeliveryProof(
  db: Queryable,
  owner: string,
  jobId: string,
): Promise<boolean> {
  const job = (
    await db.query<{
      id: string;
      cancel_requested: boolean;
      apply_tracking_version: number | null;
      apply_started_at: Date | null;
      apply_rolled_back_at: Date | null;
      apply_result: unknown;
      state: string;
    }>(
      "SELECT id,state,cancel_requested,apply_tracking_version,apply_started_at,apply_rolled_back_at,apply_result FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [jobId, owner],
    )
  ).rows[0];
  if (
    !job ||
    job.state !== "done" ||
    job.cancel_requested ||
    !positiveNone(job)
  )
    return false;
  const found = (
    await db.query<{ id: string }>(
      "SELECT id FROM assistant_quiet_checks WHERE owner_id=$1 AND job_id=$2",
      [owner, jobId],
    )
  ).rows[0];
  if (!found) return false;
  const row = (await readQuietCheck(db, owner, found.id, true))!;
  if (
    row.status !== "verified_unchanged" ||
    !row.requested ||
    row.checked_count !== row.expected_count ||
    !row.snapshot_aggregate
  )
    return false;
  try {
    await assertQuietCheckConfiguration(db, row);
    if (!(await quietJobVisible(db, row)) || !(await baseline(db, row)))
      return false;
    return (
      assistantExecutionDigest(await currentQuietSnapshots(db, row, true)) ===
      assistantExecutionDigest(row.snapshot_aggregate)
    );
  } catch {
    return false;
  }
}
/** Jobs which fail before normal finish still leave an explicit visible incomplete check. */
export async function settleFailedRoutineQuietChecks(
  lane: "background" | "overnight",
  now = new Date(),
) {
  const rows = (
    await pool.query<{ id: string; owner_id: string; job_id: string | null }>(
      `SELECT c.id,c.owner_id,c.job_id FROM assistant_quiet_checks c LEFT JOIN ai_jobs j ON j.id=c.job_id WHERE c.lane=$1 AND c.status='pending' AND (j.id IS NULL OR j.state IN ('done','failed')) ORDER BY c.created_at,c.id LIMIT 30`,
      [lane],
    )
  ).rows;
  for (const candidate of rows)
    await transaction(async (db) => {
      if (candidate.job_id) {
        await finalizeRoutineQuietCheck(
          db,
          candidate.owner_id,
          candidate.job_id,
          {
            requested: false,
            terminal: "failed",
            effects: "uncertain",
            hasUsefulOutput: true,
            hasDecision: false,
          },
        );
        return;
      }
      const row = await readQuietCheck(
        db,
        candidate.owner_id,
        candidate.id,
        true,
      );
      if (row?.status === "pending" && !row.job_id)
        await db.query(
          "UPDATE assistant_quiet_checks SET status='incomplete',reason='The execution evidence is no longer available.',observed_at=$2 WHERE id=$1",
          [row.id, now],
        );
    });
  return rows.length;
}
