import {
  deadlineOf,
  fitDeadline,
  planningDeadline,
  remainingOf,
  type ProjectPlanning,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import {
  FIT_COLUMNS,
  fitsFor,
  sessionsFor,
  type FitRow,
} from "../planner/planned.js";
import { dependentTargets } from "../planner/targets.js";
import { visibleItems } from "../../lib/visibility.js";

/** Only the signed-in person's work and sessions; a teammate's calendar stays private. */
export async function projectPlanning(
  db: Queryable,
  userId: string,
  project: { id: string; deadline: Date | null; team_id: string | null },
  showTeamTotal: boolean,
  now = new Date(),
): Promise<ProjectPlanning> {
  const rows = (
    await db.query<FitRow>(
      `SELECT ${FIT_COLUMNS} FROM items i
        WHERE i.project_id = $2 AND i.kind = 'task'
          AND i.status NOT IN ('done', 'cancelled') AND ${visibleItems()}
          AND (CASE WHEN i.team_id IS NULL THEN i.user_id = $1
                    ELSE i.assignee_id = $1 END)
        ORDER BY i.created_at, i.id LIMIT 500`,
      [userId, project.id],
    )
  ).rows;
  const sessions = await sessionsFor(
    db,
    userId,
    rows.map((row) => row.id),
    now,
  );
  const fits = await fitsFor(db, userId, rows, sessions, now);
  // Sum the leaves rather than a parent's rollup and its children twice.
  // An unknown estimate stays named below instead of becoming a guessed 30m.
  const counted = rows.filter((row) => row.open_children === 0);
  const unestimated = counted
    .filter((row) => row.estimate_minutes == null)
    .map((row) => ({ id: row.id, title: row.title }));
  const estimatedIds = new Set(
    counted.filter((row) => row.estimate_minutes != null).map((row) => row.id),
  );
  let neededMinutes = 0;
  let plannedMinutes = 0;
  let lateSessionCount = 0;
  let lastPlannedAt: string | null = null;
  for (const row of counted) {
    if (row.estimate_minutes == null) continue;
    const needed = fits.get(row.id)?.fit?.needed_minutes ?? remainingOf(row);
    const planned = fits.get(row.id)?.planned_minutes ?? 0;
    neededMinutes += needed;
    plannedMinutes += Math.min(needed, planned);
  }
  for (const row of rows) {
    const deadline = fits.get(row.id)?.fit?.deadline_at;
    for (const session of sessions.get(row.id) ?? []) {
      const end = Date.parse(session.end_at);
      if (end <= now.getTime()) continue;
      if (
        deadline &&
        Date.parse(deadline) > now.getTime() &&
        end > Date.parse(deadline)
      ) {
        lateSessionCount++;
      } else if (
        estimatedIds.has(row.id) &&
        (!lastPlannedAt || end > Date.parse(lastPlannedAt))
      ) {
        lastPlannedAt = session.end_at;
      }
    }
  }
  const unplannedMinutes = Math.max(0, neededMinutes - plannedMinutes);
  const result: ProjectPlanning = {
    project_id: project.id,
    deadline: project.deadline?.toISOString() ?? null,
    task_count: counted.length,
    needed_minutes: neededMinutes,
    planned_minutes: plannedMinutes,
    unplanned_minutes: unplannedMinutes,
    late_session_count: lateSessionCount,
    planned_finish_at:
      unplannedMinutes === 0 && unestimated.length === 0 ? lastPlannedAt : null,
    unestimated_tasks: unestimated,
  };
  if (showTeamTotal && project.team_id) {
    const teamRows = (
      await db.query<{
        item_id: string;
        start_at: Date;
        end_at: Date;
        due_at: Date | null;
        due_end_at: Date | null;
        all_day: boolean;
        timezone: string;
      }>(
        `SELECT b.item_id, b.start_at, b.end_at, i.due_at,
                i.end_at AS due_end_at, i.all_day, i.timezone
           FROM time_blocks b JOIN items i ON i.id = b.item_id
           JOIN team_members m ON m.team_id = i.team_id AND m.user_id = b.user_id
          WHERE i.project_id = $1 AND i.team_id = $2 AND i.kind = 'task'
            AND i.status NOT IN ('done', 'cancelled') AND b.end_at > $3`,
        [project.id, project.team_id, now],
      )
    ).rows;
    const dependent = await dependentTargets(db, userId, [
      ...new Set(teamRows.map((row) => row.item_id)),
    ]);
    result.team_planned_minutes = Math.round(
      teamRows.reduce((minutes, row) => {
        const target = fitDeadline(
          deadlineOf({
            due_at: row.due_at,
            end_at: row.due_end_at,
            all_day: row.all_day,
            timezone: row.timezone,
          }),
          planningDeadline(project.deadline, dependent.get(row.item_id)),
          now,
        );
        if (target && row.end_at.getTime() > Date.parse(target)) return minutes;
        return (
          minutes +
          Math.max(
            0,
            (row.end_at.getTime() -
              Math.max(row.start_at.getTime(), now.getTime())) /
              60_000,
          )
        );
      }, 0),
    );
  }
  return result;
}
