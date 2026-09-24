import {
  addDays,
  clockMinutes,
  dayTime,
  localDateKey,
  weekdayOf,
  type BusyInterval,
  type PlannerPrefs,
} from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import { busyIntervals, loadPrefs, mergeIntervals } from "./calendar.js";

export type Span = { start: number; end: number };

/** Working hours between two instants, as spans. */
export function workingSpans(
  prefs: PlannerPrefs,
  from: Date,
  to: Date,
): Span[] {
  const spans: Span[] = [];
  const last = localDateKey(to, prefs.timezone);
  for (
    let day = localDateKey(from, prefs.timezone);
    day <= last;
    day = addDays(day, 1)
  ) {
    if (!prefs.work_days.includes(weekdayOf(day))) continue;
    const start = Math.max(
      dayTime(day, clockMinutes(prefs.work_start), prefs.timezone).getTime(),
      from.getTime(),
    );
    const end = Math.min(
      dayTime(day, clockMinutes(prefs.work_end), prefs.timezone).getTime(),
      to.getTime(),
    );
    if (end > start) spans.push({ start, end });
  }
  return spans;
}

/** Spans minus busy intervals. */
export function freeSpans(spans: Span[], busy: BusyInterval[]): Span[] {
  const merged = mergeIntervals(busy).map((b) => ({
    start: Date.parse(b.start_at),
    end: Date.parse(b.end_at),
  }));
  const out: Span[] = [];
  for (const span of spans) {
    let cursor = span.start;
    for (const b of merged) {
      if (b.end <= cursor || b.start >= span.end) continue;
      if (b.start > cursor) out.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < span.end) out.push({ start: cursor, end: span.end });
  }
  return out;
}

/** How far ahead free time before a deadline is counted, in days. */
export const FREE_LOOKAHEAD_DAYS = 14;

/**
 * Free working minutes between `now` and `deadline`: working hours less your
 * events (and the buffers and travel around them), looking at most two
 * weeks ahead. Sessions don't count as busy, as in the daily at-risk check:
 * this is the room there is to plan in. 0 once the deadline has passed.
 */
export async function freeMinutesBefore(
  db: Db,
  userId: string,
  deadline: Date,
  now = new Date(),
): Promise<number> {
  if (deadline.getTime() <= now.getTime()) return 0;
  const to = new Date(
    Math.min(
      deadline.getTime(),
      now.getTime() + FREE_LOOKAHEAD_DAYS * 86_400_000,
    ),
  );
  const [prefs, busy] = await Promise.all([
    loadPrefs(db, userId),
    busyIntervals(db, userId, now, to, { blocks: false, derived: true }),
  ]);
  return Math.round(
    freeSpans(workingSpans(prefs, now, to), busy).reduce(
      (sum, s) => sum + (s.end - s.start) / 60_000,
      0,
    ),
  );
}
