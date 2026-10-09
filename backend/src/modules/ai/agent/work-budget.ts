import type { Db } from "../../../db/pool.js";
import { LEAD_TOKEN_BUDGET } from "./lead.js";

type Lane = "background" | "overnight";
type WorkKind = "job" | "page" | "agenda";
type Checkpoint = {
  request?: { automation?: { token_budget?: number } };
  state?: { token_estimate?: number };
};

/** One serialized worker segment; this is an estimate ceiling, not billing. */
export async function reserveAssistantWork(
  db: Db,
  work: {
    kind: WorkKind;
    id: string;
    userId: string;
    lane: Lane;
    startingEstimate: number;
    originalLimit: number;
    minimumReservation?: number;
  },
  now = new Date(),
): Promise<number | null> {
  const { userId, lane, startingEstimate, originalLimit } = work;
  if (
    !Number.isSafeInteger(startingEstimate) ||
    startingEstimate < 0 ||
    !Number.isSafeInteger(originalLimit) ||
    originalLimit < 0
  )
    throw new Error("Invalid assistant work budget estimate.");
  await db.query(
    `INSERT INTO assistant_lane_budget_settings(user_id,lane) VALUES($1,$2)
     ON CONFLICT DO NOTHING`,
    [userId, lane],
  );
  const settings = (
    await db.query<{
      daily_token_limit: number;
      hourly_start_limit: number;
      per_run_token_limit: number;
    }>(
      `SELECT daily_token_limit,hourly_start_limit,per_run_token_limit
       FROM assistant_lane_budget_settings WHERE user_id=$1 AND lane=$2 FOR UPDATE`,
      [userId, lane],
    )
  ).rows[0];
  const budget = (
    await db.query<{ day: string; spent: string; started: string }>(
      `SELECT assistant_lane_budget_day($1,$3) AS day,
         (SELECT coalesce(sum(coalesce(reported_tokens,reserved_tokens)),0)::bigint
          FROM assistant_work_reservations WHERE user_id=$1 AND lane=$2
          AND budget_day=assistant_lane_budget_day($1,$3))::text AS spent,
         (SELECT count(*) FROM assistant_work_reservations WHERE user_id=$1 AND lane=$2
          AND started_at>$3::timestamptz-interval '1 hour')::text AS started`,
      [userId, lane, now],
    )
  ).rows[0];
  if (
    Number(budget.started) >= settings.hourly_start_limit ||
    Number(budget.spent) >= settings.daily_token_limit
  )
    return null;
  const reserved = Math.min(
    Math.max(0, originalLimit - startingEstimate),
    settings.per_run_token_limit,
    settings.daily_token_limit - Number(budget.spent),
  );
  if (reserved < (work.minimumReservation ?? 0)) return null;
  const reference = {
    job: "job_id",
    page: "page_run_id",
    agenda: "agenda_run_id",
  }[work.kind];
  await db.query(
    `INSERT INTO assistant_work_reservations
      (user_id,lane,${reference},budget_day,reserved_tokens,starting_estimate,started_at)
     VALUES($1,$2,$3,$4::date,$5,$6,$7)`,
    [userId, lane, work.id, budget.day, reserved, startingEstimate, now],
  );
  return startingEstimate + reserved;
}

/** A lead checkpoint's hard cap is recalculated from its original request. */
export async function reserveAssistantJobWork(
  db: Db,
  job: { id: string; user_id: string; run_state: unknown },
  lane: Lane,
  now = new Date(),
) {
  const checkpoint = job.run_state as Checkpoint | null;
  const used = checkpoint?.state?.token_estimate;
  const startingEstimate =
    typeof used === "number" && Number.isSafeInteger(used) && used >= 0
      ? used
      : 0;
  const requested = checkpoint?.request?.automation?.token_budget;
  const requestedLimit =
    typeof requested === "number" &&
    Number.isSafeInteger(requested) &&
    requested > 0
      ? requested
      : LEAD_TOKEN_BUDGET;
  return reserveAssistantWork(
    db,
    {
      kind: "job",
      id: job.id,
      userId: job.user_id,
      lane,
      startingEstimate,
      originalLimit: Math.min(requestedLimit, LEAD_TOKEN_BUDGET),
    },
    now,
  );
}

/** A stale page lease may restart without changing state; close its old segment. */
export async function settleStalePageWork(
  db: Db,
  pageRunId: string,
  currentEstimate: number,
) {
  await db.query(
    `UPDATE assistant_work_reservations SET state='settled',
       reported_tokens=greatest(0,$2::integer-starting_estimate),settled_at=clock_timestamp()
     WHERE page_run_id=$1 AND state='active'`,
    [pageRunId, currentEstimate],
  );
}
