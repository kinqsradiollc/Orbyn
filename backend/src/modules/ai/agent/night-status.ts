import type { Queryable } from "../../../db/pool.js";

/** Save a night run's review card and recompute its persisted token accounting. */
export async function recordNightRun(
  db: Queryable,
  jobId: string,
  summary: string,
  status: "kept" | "pending",
) {
  const row = (
    await db.query<{ night_id: string }>(
      `UPDATE assistant_night_runs SET summary = $2, status = $3
     WHERE job_id = $1 RETURNING night_id`,
      [jobId, summary.slice(0, 2000), status],
    )
  ).rows[0];
  if (!row) return;
  await db.query(
    `UPDATE assistant_nights SET budget_used = (
       SELECT coalesce(sum(coalesce(
         (j.result->'assistant_run'->>'token_estimate')::integer,
         (j.run_state->'state'->>'token_estimate')::integer, 0)), 0)
       FROM assistant_night_runs nr JOIN ai_jobs j ON j.id = nr.job_id
       WHERE nr.night_id = $1), updated_at = now() WHERE id = $1`,
    [row.night_id],
  );
}
