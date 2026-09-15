import { STATUSES, isClosed, type Item, type Status } from "@orbyn/core";

/** 0-100 progress for display. Done items always read as complete. */
export const progressOf = (i: Pick<Item, "status" | "progress">) =>
  i.status === "done" ? 100 : Math.max(0, Math.min(100, i.progress ?? 0));

/** "3 of 5 steps", or null when the task has no checklist. */
export const stepsLabel = (i: Item) =>
  i.steps_total ? `${i.steps_done ?? 0} of ${i.steps_total} steps` : null;

/** "Updated 2h ago · 4 updates", or null when nobody has posted yet. */
export const updatesLabel = (i: Item) => {
  if (!i.updates_count) return null;
  const count = `${i.updates_count} ${i.updates_count === 1 ? "update" : "updates"}`;
  return i.last_update_at
    ? `Updated ${timeAgo(i.last_update_at)} · ${count}`
    : count;
};

/** "just now", "5m ago", "2h ago", "3d ago", then a short date. */
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/** Open items whose due date has passed (before today). */
export const isOverdue = (i: Item, now = new Date()) =>
  !isClosed(i.status) &&
  !!i.due_at &&
  new Date(i.due_at) <
    new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** Count of items per status, plus "all". */
export function statusCounts(items: Item[]) {
  const counts = { all: items.length } as Record<Status | "all", number>;
  for (const s of STATUSES) counts[s] = 0;
  for (const i of items) counts[i.status] += 1;
  return counts;
}
