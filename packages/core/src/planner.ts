import { addDays, dayTime } from "./time.js";
import { sameDay } from "./dates.js";
import { dueDayAt } from "./deadlines.js";
import { isClosed } from "./schemas.js";
import type { Item, ItemInput } from "./types.js";

/** Default values for a new, unsaved item. */
export const freshItem = (): ItemInput => ({
  title: "",
  notes: "",
  kind: "task",
  status: "todo",
  priority: "medium",
  due_at: null,
  end_at: null,
  team_id: null,
  progress: 0,
});

/** Planning fields that `PUT /items/:id` keeps when they are omitted. */
const PLANNING_FIELDS = [
  "estimate_minutes",
  "list_id",
  "tag_ids",
  "prerequisite_ids",
  "assignee_id",
  "location",
  "meeting_url",
  "rrule",
  "timezone",
  "all_day",
  "busy",
  "color",
  "alerts",
  "parent_id",
  "target_value",
  "current_value",
  "value_unit",
] as const;

/**
 * The exact body `PUT /items/:id` expects: every field plus the current
 * version. Planning fields are sent only when the item carries them, so an
 * item loaded before they existed never clears them.
 */
export const itemBody = (i: Item): ItemInput & { version: number } => {
  const body: ItemInput & { version: number } = {
    title: i.title,
    notes: i.notes,
    kind: i.kind,
    status: i.status,
    priority: i.priority,
    due_at: i.due_at,
    end_at: i.end_at,
    team_id: i.team_id ?? null,
    progress: i.progress,
    version: i.version,
  };
  // Modern alerts can exceed the legacy one-week limit. Never echo the
  // response's derived reminder_minutes alongside the authoritative alerts.
  if (i.alerts === undefined && i.reminder_minutes != null)
    body.reminder_minutes = i.reminder_minutes;
  // Detail responses add ids and RSVP metadata that strict write schemas reject.
  if (i.attendees !== undefined)
    body.attendees =
      i.kind === "event"
        ? i.attendees.map(({ email, name }) => ({
            email,
            ...(name ? { name } : {}),
          }))
        : [];
  if (i.links !== undefined)
    body.links = i.links.map(({ url, title }) => ({ url, title: title ?? "" }));
  for (const key of PLANNING_FIELDS)
    if (i[key] !== undefined) (body as Record<string, unknown>)[key] = i[key];
  return body;
};

export type PlannerGroups = {
  pending: Item[];
  today: Item[];
  overdue: Item[];
  upcoming: Item[];
  done: Item[];
};

/**
 * Buckets used by the Overview / Today screens on every client. A task goes
 * by its deadline's day (`dueDayAt`): an all-day task is due today until the
 * day is over, one running over several days is due on its last, and one
 * with an end time on the day it ends. Events go by when they start.
 */
export function groupItems(items: Item[], now = new Date()): PlannerGroups {
  // Cancelled items are closed: neither pending nor done.
  const pending = items.filter((i) => !isClosed(i.status));
  const done = items.filter((i) => i.status === "done");
  const dueDay = new Map(pending.map((i) => [i, dueDayAt(i)]));
  const today = pending
    .filter((i) => {
      const at = dueDay.get(i);
      return !!at && sameDay(at, now);
    })
    .sort(byDueDate);
  const overdue = pending.filter((i) => {
    const at = dueDay.get(i);
    return !!at && at < now && !sameDay(at, now);
  });
  const upcoming = pending
    .filter((i) => {
      const at = dueDay.get(i);
      return !!at && at >= now;
    })
    .sort(byDueDate);
  return { pending, today, overdue, upcoming, done };
}

/** Case-insensitive title/notes search. Empty query returns everything. */
export function searchItems(items: Item[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) =>
      i.title.toLowerCase().includes(q) || i.notes.toLowerCase().includes(q),
  );
}

export const itemsOnDay = (items: Item[], day: Date) =>
  items.filter((i) => i.due_at && sameDay(new Date(i.due_at), day));

/** Sort by due date ascending with undated items last. */
export const byDueDate = (a: Item, b: Item) =>
  (a.due_at ? Date.parse(a.due_at) : Infinity) -
    (b.due_at ? Date.parse(b.due_at) : Infinity) ||
  a.title.localeCompare(b.title) ||
  a.id.localeCompare(b.id);

/** Shared overview: each open item appears in its highest-priority section only.
 * Counts include all matching items, even when attention takes precedence.
 * Completion recency uses the latest available activity, not a completion timestamp.
 */
export function overviewItems(items: Item[], now = new Date()) {
  const groups = groupItems(items, now);
  const overdue = new Set(groups.overdue.map((i) => i.id));
  const shown = new Set<string>();
  const take = (list: Item[]) =>
    list.filter((i) => !shown.has(i.id) && shown.add(i.id));
  const attention = take(
    groups.pending
      .filter((i) => i.status === "blocked" || overdue.has(i.id))
      .sort(
        (a, b) =>
          Number(b.status === "blocked") - Number(a.status === "blocked") ||
          byDueDate(a, b),
      ),
  );
  const inProgress = take(
    groups.pending.filter((i) => i.status === "in_progress").sort(byDueDate),
  );
  const today = take(groups.today);
  const upcoming = take(groups.upcoming);
  const weekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - now.getDay(),
  ).getTime();
  const doneThisWeek = groups.done.filter((i) => {
    const touched = Math.max(
      Date.parse(i.updated_at ?? "") || 0,
      Date.parse(i.last_update_at ?? "") || 0,
    );
    return touched >= weekStart && touched <= now.getTime();
  }).length;
  return {
    ...groups,
    attention,
    inProgress,
    today,
    upcoming,
    doneThisWeek,
    inProgressCount: groups.pending.filter((i) => i.status === "in_progress")
      .length,
    blockedCount: groups.pending.filter((i) => i.status === "blocked").length,
  };
}

/** All-day form dates are inclusive; the API end is the next local midnight. */
export function allDayRange(first: string, last: string, timezone: string) {
  return {
    due_at: dayTime(first, 0, timezone).toISOString(),
    end_at: dayTime(
      addDays(last < first ? first : last, 1),
      0,
      timezone,
    ).toISOString(),
  };
}
