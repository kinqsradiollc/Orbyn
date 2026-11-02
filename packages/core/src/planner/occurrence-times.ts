import type { OccurrenceChanges } from "../types.js";
import { addDays, dayTime, localDateKey, localDaysBetween } from "./time.js";

/** Canonical series span; the selected recurrence key is supplied separately. */
export type OccurrenceTimeSource = {
  due_at: string | Date;
  end_at: string | Date | null;
  all_day: boolean;
  timezone: string;
};

const instant = (value: string | Date) => {
  const date = new Date(value instanceof Date ? value.getTime() : value);
  if (!Number.isFinite(date.getTime()))
    throw new RangeError("Invalid occurrence time.");
  return date;
};

/** Local days, rather than elapsed hours, preserve all-day spans across DST. */
export const occurrenceDayLength = (series: OccurrenceTimeSource) =>
  series.end_at
    ? Math.max(
        1,
        localDaysBetween(
          instant(series.due_at),
          instant(series.end_at),
          series.timezone,
        ),
      )
    : 0;

/** The normal series end at an original recurrence key, without an override. */
export function occurrenceEndAt(
  series: OccurrenceTimeSource,
  at: string | Date,
): Date | null {
  const start = instant(at);
  if (!series.end_at) return null;
  if (series.all_day)
    return dayTime(
      addDays(
        localDateKey(start, series.timezone),
        occurrenceDayLength(series),
      ),
      0,
      series.timezone,
    );
  return new Date(
    start.getTime() +
      instant(series.end_at).getTime() -
      instant(series.due_at).getTime(),
  );
}

/** Resolve one stored override without changing its original recurrence key. */
export function resolveOccurrenceTimes(
  series: OccurrenceTimeSource,
  original: string | Date,
  change?: Pick<OccurrenceChanges, "due_at" | "end_at">,
): { occurrence: Date; start: Date; end: Date | null } {
  const occurrence = instant(original);
  return {
    occurrence,
    start: change?.due_at
      ? instant(change.due_at)
      : new Date(occurrence.getTime()),
    // A moved start owns its entire span; a missing/null end is deliberately null.
    end: change?.due_at
      ? change.end_at
        ? instant(change.end_at)
        : null
      : occurrenceEndAt(series, occurrence),
  };
}
