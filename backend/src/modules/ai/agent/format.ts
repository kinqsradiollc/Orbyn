import { z } from "zod";
import { offsetAt } from "../prompt.js";

/** Small formatting helpers shared by the assistant's tools. */

/** Text from the database, without control characters and cut to size. */
export const clean = (text: unknown, max: number) =>
  Array.from(String(text ?? ""))
    .map((c) => (c < " " && c !== "\n" && c !== "\t" ? " " : c))
    .join("")
    .slice(0, max);

/**
 * "Wed 16 Sept, 07:00–08:00" in the user's timezone. Models misname weekdays
 * when they work them out from a date, so every item carries its own.
 */
export function whenLabel(
  start: Date | null,
  end: Date | null,
  timezone: string,
): string | null {
  if (!start) return null;
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  return `${day}, ${time(start)}${end ? `–${time(end)}` : ""}`;
}

export const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** "YYYY-MM-DD" in the user's timezone. */
export function localDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** A date or date-time from the model as an instant; bare values are local time. */
export function toInstant(
  value: string,
  timezone: string,
  endOfDay = false,
): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v))
    return `${v}T${endOfDay ? "23:59:59" : "00:00:00"}${offsetAt(timezone, new Date(`${v}T12:00:00Z`))}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) {
    const full = v.length === 16 ? `${v}:00` : v;
    return full + offsetAt(timezone, new Date(`${full}Z`));
  }
  return v;
}
