import { offsetAt } from "./prompt.js";

const minutes = (offset: string) => {
  const [, sign, h, m] = offset.match(/([+-])(\d{2}):(\d{2})/) ?? [];
  return sign ? (sign === "-" ? -1 : 1) * (Number(h) * 60 + Number(m)) : 0;
};

/** An instant as the user's wall-clock time with their offset, e.g. 2026-09-27T12:45:00+10:00. */
export function localIso(value: unknown, timezone: string): string | null {
  if (value == null) return null;
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return null;
  const offset = offsetAt(timezone, date);
  const shifted = new Date(date.getTime() + minutes(offset) * 60_000);
  return shifted.toISOString().slice(0, 19) + offset;
}
