import type { Db } from "../../../db/pool.js";
import {
  ASSISTANT_RUNTIME_CAPACITY,
  type AssistantRuntimeLane,
} from "./runtime-lanes.js";

/** Serialize claims and count every leased provider job across both queues. */
export async function assistantRuntimeHasRoom(
  db: Db,
  lane: AssistantRuntimeLane,
  now = new Date(),
): Promise<boolean> {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('assistant-global-slots'))",
  );
  const occupied = (
    await db.query<{ count: number; lane_count: number }>(
      `SELECT count(*)::int AS count,
       count(*) FILTER (WHERE lane=$1)::int AS lane_count FROM (
         SELECT runtime_lane AS lane FROM ai_jobs
           WHERE state='running' AND run_state->>'version'='1' AND lease_until>$2
         UNION ALL
         SELECT lane FROM assistant_page_runs
           WHERE state='running' AND lease_expires_at>$2
         UNION ALL
         SELECT 'background' AS lane FROM agenda_summary_runs
           WHERE state='running' AND lease_expires_at>$2
       ) occupied`,
      [lane, now],
    )
  ).rows[0];
  return (
    occupied.count < 8 && occupied.lane_count < ASSISTANT_RUNTIME_CAPACITY[lane]
  );
}
