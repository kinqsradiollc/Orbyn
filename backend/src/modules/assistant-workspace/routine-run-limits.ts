import { routineRunLimits, type RoutineRunLimits } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
/** New admissions read this owner; existing jobs retain their captured limits. */
export async function readRoutineRunLimits(
  db: Queryable,
  owner: string,
  routine: string,
): Promise<RoutineRunLimits> {
  const row = (
    await db.query<{ run_limits: unknown }>(
      "SELECT run_limits FROM agent_routines WHERE id=$2 AND user_id=$1",
      [owner, routine],
    )
  ).rows[0];
  if (!row) throw new Error("Routine is no longer available.");
  return routineRunLimits.parse(row.run_limits ?? {});
}
