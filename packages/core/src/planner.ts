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
  const today = pending.filter(
    (i) => i.due_at && sameDay(new Date(i.due_at), now),
  );
  const overdue = pending.filter(
    (i) =>
      i.due_at && new Date(i.due_at) < now && !sameDay(new Date(i.due_at), now),
  );
  const upcoming = pending
    .filter((i) => i.due_at && new Date(i.due_at) >= now)
    .sort((a, b) => a.due_at!.localeCompare(b.due_at!));
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
  (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999");
