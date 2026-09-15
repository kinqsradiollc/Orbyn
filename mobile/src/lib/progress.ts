import { isClosed, type Item, type Status } from "@orbyn/core";

/** Status the quick-complete checkbox moves an item to. */
export const toggledStatus = (item: Item): Status =>
  item.status !== "done"
    ? "done"
    : (item.progress ?? 0) > 0
      ? "in_progress"
      : "todo";

/** "just now", "5m ago", "2h ago", "3d ago", then a short date. */
export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "";
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/** "3 of 5 steps", or "" when the task has no checklist. */
export const stepsLabel = (done = 0, total = 0) =>
  total > 0 ? `${done} of ${total} step${total === 1 ? "" : "s"}` : "";

/** "Updated 2h ago · 4 updates", or "" before the first update. */
export function updatesLabel(item: Item, now = Date.now()) {
  const count = item.updates_count ?? 0;
  if (!count) return "";
  const when = item.last_update_at
    ? `Updated ${timeAgo(item.last_update_at, now)} · `
    : "";
  return `${when}${count} update${count === 1 ? "" : "s"}`;
}

/** Progress as a whole percentage between 0 and 100. */
export const percentOf = (item: Pick<Item, "progress" | "status">) =>
  item.status === "done"
    ? 100
    : Math.max(0, Math.min(100, Math.round(item.progress ?? 0)));

/** Still open and due before today (the web's rule); due earlier today is today. */
export const isOverdue = (item: Item, now = new Date()) =>
  !isClosed(item.status) &&
  !!item.due_at &&
  new Date(item.due_at) <
    new Date(now.getFullYear(), now.getMonth(), now.getDate());
