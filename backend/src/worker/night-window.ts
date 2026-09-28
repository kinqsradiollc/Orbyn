import {
  addDays,
  localDateKey,
  zonedInstant,
  zonedParts,
  type NightShiftSettings,
} from "@orbyn/core";

/** The night's start day is stable through midnight and DST clock changes. */
export function assistantNightWindow(
  now: Date,
  settings: NightShiftSettings,
): { localDay: string; start: Date; end: Date } | null {
  const parts = zonedParts(now, settings.timezone);
  const clock = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  const crossesMidnight = settings.start > settings.end;
  const today = localDateKey(now, settings.timezone);
  const localDay =
    crossesMidnight && clock < settings.end ? addDays(today, -1) : today;
  const at = (day: string, time: string) => {
    const [year, month, date] = day.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    return zonedInstant(year, month, date, hour, minute, settings.timezone);
  };
  const start = at(localDay, settings.start);
  const end = at(
    crossesMidnight ? addDays(localDay, 1) : localDay,
    settings.end,
  );
  return now >= start && now < end ? { localDay, start, end } : null;
}
