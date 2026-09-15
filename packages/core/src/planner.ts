import { sameDay } from "./dates.js";
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
  reminder_minutes: 30,
  team_id: null,
  progress: 0,
});

/** The exact body `PUT /items/:id` expects: every field plus the current version. */
export const itemBody = (i: Item): ItemInput & { version: number } => ({
  title: i.title,
  notes: i.notes,
  kind: i.kind,
  status: i.status,
  priority: i.priority,
  due_at: i.due_at,
  end_at: i.end_at,
  reminder_minutes: i.reminder_minutes,
  team_id: i.team_id ?? null,
  progress: i.progress,
  version: i.version,
});

export type PlannerGroups = {
  pending: Item[];
  today: Item[];
  overdue: Item[];
  upcoming: Item[];
  done: Item[];
};

/** Buckets used by the Overview / Today screens on every client. */
export function groupItems(items: Item[], now = new Date()): PlannerGroups {
  const pending = items.filter((i) => i.status !== "done");
  const done = items.filter((i) => i.status === "done");
  const today = pending
    .filter((i) => i.due_at && sameDay(new Date(i.due_at), now))
    .sort(byDueDate);
  const overdue = pending.filter(
    (i) =>
      i.due_at && new Date(i.due_at) < now && !sameDay(new Date(i.due_at), now),
  );
  const upcoming = pending
    .filter((i) => i.due_at && new Date(i.due_at) >= now)
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
