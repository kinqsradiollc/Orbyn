import { localDateKey, type ActivitySummary } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { visibleItems } from "../../lib/visibility.js";
import { loadPrefs } from "../planner/calendar.js";

/** Only this account's recorded work, with current item visibility rechecked. */
export async function activitySummary(
  db: Queryable,
  userId: string,
  days: number,
): Promise<ActivitySummary> {
  const { timezone } = await loadPrefs(db, userId);
  const result = await db.query<{
    day: string;
    completions: number;
    focus_minutes: number;
    started_at: Date;
  }>(
    `WITH bounds AS (
       SELECT (now() AT TIME ZONE $2)::date AS today,
         ((now() AT TIME ZONE $2)::date - ($3::int - 1)) AS first
     ), completions AS (
       SELECT (c.created_at AT TIME ZONE $2)::date AS day, count(*)::int AS total
       FROM item_completions c JOIN items i ON i.id=c.item_id CROSS JOIN bounds b
       WHERE c.user_id=$1 AND ${visibleItems("i")}
         AND c.created_at >= (b.first::timestamp AT TIME ZONE $2)
         AND c.created_at < ((b.today + 1)::timestamp AT TIME ZONE $2)
       GROUP BY 1
     ), focus AS (
       SELECT (s.started_at AT TIME ZONE $2)::date AS day, coalesce(sum(s.minutes),0)::int AS total
       FROM focus_sessions s LEFT JOIN items i ON i.id=s.item_id CROSS JOIN bounds b
       WHERE s.user_id=$1 AND s.kind='work'
         AND (s.item_id IS NULL OR ${visibleItems("i")})
         AND s.started_at >= (b.first::timestamp AT TIME ZONE $2)
         AND s.started_at < ((b.today + 1)::timestamp AT TIME ZONE $2)
       GROUP BY 1
     )
     SELECT d.day::date::text AS day, coalesce(c.total,0)::int AS completions,
       coalesce(f.total,0)::int AS focus_minutes, h.started_at
     FROM bounds b CROSS JOIN LATERAL generate_series(b.first::timestamp,b.today::timestamp,interval '1 day') d(day)
     CROSS JOIN activity_history_start h
     LEFT JOIN completions c ON c.day=d.day::date LEFT JOIN focus f ON f.day=d.day::date
     ORDER BY d.day`,
    [userId, timezone, days],
  );
  if (!result.rows[0]) throw new Error("Activity history is not initialized");
  const firstRecordedDay = localDateKey(result.rows[0].started_at, timezone);
  const rows = result.rows.map(({ day, completions, focus_minutes }) => ({
    day,
    completions: day < firstRecordedDay ? null : completions,
    focus_minutes,
  }));
  return {
    timezone,
    completion_history_since: result.rows[0].started_at.toISOString(),
    days: rows,
    totals: rows.reduce(
      (total, day) => ({
        completions: total.completions + (day.completions ?? 0),
        focus_minutes: total.focus_minutes + day.focus_minutes,
        active_days:
          total.active_days +
          ((day.completions ?? 0) > 0 || day.focus_minutes > 0 ? 1 : 0),
      }),
      { completions: 0, focus_minutes: 0, active_days: 0 },
    ),
  };
}
