import { offsetAt } from "./prompt.js";

/** The fields the assistant needs; ids and versions let it propose edits. */
const FIELDS = [
  "id",
  "version",
  "title",
  "notes",
  "kind",
  "status",
  "priority",
  "due_at",
  "end_at",
  "reminder_minutes",
  "team_id",
  "team_name",
  "progress",
  "steps_done",
  "steps_total",
  "updates_count",
] as const;

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

/**
 * The planner as the model sees it: only the useful fields, with times in the
 * user's local time so replies never say "12:45pm (UTC)" for a local event.
 */
export function modelSnapshot(
  items: Record<string, unknown>[],
  timezone: string,
): Record<string, unknown>[] {
  return items.map((item) => {
    const out: Record<string, unknown> = {};
    for (const key of FIELDS) if (key in item) out[key] = item[key];
    out.due_at = localIso(item.due_at, timezone);
    out.end_at = localIso(item.end_at, timezone);
    return out;
  });
}
