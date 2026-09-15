import {
  startOfDay,
  type CalendarEntry,
  type CalendarSet,
  type Item,
} from "@orbyn/core";

/** Drag data type for a task dragged onto the calendar. */
export const TASK_MIME = "application/x-orbyn-task";

/** Unique per occurrence: repeating items share an item id. */
export const entryKey = (e: CalendarEntry) => `${e.item_id}@${e.start_at}`;

/** The item id inside an `entryKey`. */
export const itemIdOf = (key: string) => key.split("@")[0];

/** End of an entry; entries without one get a default length. */
export const entryEnd = (e: CalendarEntry) =>
  new Date(
    e.end_at
      ? Date.parse(e.end_at)
      : Date.parse(e.start_at) + (e.kind === "event" ? 60 : 30) * 60_000,
  );

const lastDayOf = (e: CalendarEntry) =>
  e.end_at && Date.parse(e.end_at) > Date.parse(e.start_at)
    ? startOfDay(new Date(Date.parse(e.end_at) - 1))
    : startOfDay(new Date(e.start_at));

/** Multi-day entries, and ones at midnight with no end, have no time of day. */
export const isAllDayEntry = (e: CalendarEntry) => {
  const start = new Date(e.start_at);
  if (lastDayOf(e).getTime() > startOfDay(start).getTime()) return true;
  return !e.end_at && start.getHours() === 0 && start.getMinutes() === 0;
};

export const entryOnDay = (e: CalendarEntry, day: Date) => {
  const d = startOfDay(day).getTime();
  return (
    startOfDay(new Date(e.start_at)).getTime() <= d &&
    d <= lastDayOf(e).getTime()
  );
};

/** Whether a calendar set shows something (no set shows everything). */
export function inSet(
  set: CalendarSet | null,
  x: { team_id: string | null; list_id: string | null },
) {
  if (!set) return true;
  const place = x.team_id ? set.team_ids.includes(x.team_id) : set.personal;
  const list =
    !set.list_ids.length || (!!x.list_id && set.list_ids.includes(x.list_id));
  return place && list;
}

/** An entry shaped like an item, for the month grid and day list. */
export function entryAsItem(e: CalendarEntry, items: Map<string, Item>): Item {
  const base = items.get(e.item_id);
  return {
    notes: "",
    reminder_minutes: 0,
    ...base,
    id: entryKey(e),
    version: e.version,
    title: e.title,
    kind: e.kind,
    status: e.status,
    priority: e.priority,
    due_at: e.start_at,
    end_at: e.end_at,
    team_id: e.team_id,
    team_name: e.team_name,
    list_id: e.list_id,
    rrule: e.rrule,
  } as Item;
}
