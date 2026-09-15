import {
  addDays,
  clockMinutes,
  dayTime,
  localDateKey,
  occurrencesBetween,
  weekdayOf,
  type Frame,
} from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";

/**
 * Frames: recurring windows for a kind of work. They repeat on weekdays or
 * by a rule, skip chosen dates, keep their own time zone if they have one,
 * and can count as busy for booking pages and team time (never for the
 * planner, which plans inside them).
 */
export const FRAME_COLUMNS = `id, name, days, to_char(start_time, 'HH24:MI') AS start_time,
  to_char(end_time, 'HH24:MI') AS end_time, filters, color, position, rrule,
  to_char(series_start, 'YYYY-MM-DD') AS series_start, busy, timezone,
  array(SELECT to_char(x, 'YYYY-MM-DD') FROM unnest(exdates) x ORDER BY x) AS exdates`;

export async function loadFrames(
  db: Db,
  userId: string,
  onlyBusy = false,
): Promise<Frame[]> {
  return (
    await db.query<Frame>(
      `SELECT ${FRAME_COLUMNS} FROM frames WHERE user_id = $1 AND ($2::boolean IS FALSE OR busy)
       ORDER BY position, start_time`,
      [userId, onlyBusy],
    )
  ).rows.map((f) => ({ ...f, days: f.days.map(Number) }));
}

export type FrameSpan = { start: number; end: number; date: string };

/**
 * Every occurrence of a frame overlapping [from, to), clipped to it. A rule
 * wins over weekdays; skipped dates are left out. Times are in the frame's
 * own zone, or `defaultTz` (the owner's).
 */
export function frameSpans(
  frame: Frame,
  from: number,
  to: number,
  defaultTz: string,
): FrameSpan[] {
  const tz = frame.timezone || defaultTz;
  const startMinutes = clockMinutes(frame.start_time);
  const endMinutes = clockMinutes(frame.end_time);
  const skip = new Set(frame.exdates ?? []);
  // A day either side, for a frame in another zone than the range's.
  const first = addDays(localDateKey(new Date(from), tz), -1);
  const last = localDateKey(new Date(to), tz);
  let dates: string[] = [];
  if (frame.rrule) {
    const anchor = dayTime(frame.series_start ?? first, startMinutes, tz);
    dates = occurrencesBetween(
      anchor,
      frame.rrule,
      tz,
      dayTime(first, 0, tz),
      dayTime(addDays(last, 1), 0, tz),
    ).map((at) => localDateKey(at, tz));
  } else
    for (let d = first; d <= last; d = addDays(d, 1))
      if (frame.days.includes(weekdayOf(d))) dates.push(d);
  const out: FrameSpan[] = [];
  for (const date of dates) {
    if (skip.has(date)) continue;
    const start = Math.max(dayTime(date, startMinutes, tz).getTime(), from);
    const end = Math.min(dayTime(date, endMinutes, tz).getTime(), to);
    if (end > start) out.push({ start, end, date });
  }
  return out;
}

/** Weekdays a rule repeats on, stored in `days` for older apps; every day otherwise. */
export function daysForRule(rrule: string): number[] {
  const m = rrule.match(/BYDAY=([A-Z,]+)/i);
  const codes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  if (!m || !/FREQ=WEEKLY/i.test(rrule)) return [0, 1, 2, 3, 4, 5, 6];
  return m[1]
    .toUpperCase()
    .split(",")
    .map((c) => codes.indexOf(c))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
}
