import type { Item, ItemSort, Priority } from "@orbyn/core";
import { byScore } from "../shared-task";

const RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
/** Smallest first, missing values last. */
const ascending = (a?: number | null, b?: number | null) =>
  a == null || Number.isNaN(a)
    ? b == null || Number.isNaN(b)
      ? 0
      : 1
    : b == null || Number.isNaN(b)
      ? -1
      : a - b;
const time = (iso?: string | null) => (iso ? Date.parse(iso) : null);
const negate = (n: number | null | undefined) => (n == null ? null : -n);

/** The server's sort orders, applied to the loaded items. */
export function sortBy(
  sort: ItemSort,
  now: Date,
  among: Item[],
): (a: Item, b: Item) => number {
  const pressing = byScore(now, among);
  switch (sort) {
    case "newest":
      return (a, b) =>
        ascending(negate(time(a.created_at)), negate(time(b.created_at))) ||
        pressing(a, b);
    case "created":
      return (a, b) =>
        ascending(time(a.created_at), time(b.created_at)) ||
        a.title.localeCompare(b.title);
    case "due":
      return (a, b) =>
        ascending(time(a.due_at), time(b.due_at)) || pressing(a, b);
    case "priority":
      return (a, b) => RANK[b.priority] - RANK[a.priority] || pressing(a, b);
    case "estimate":
      return (a, b) =>
        ascending(a.estimate_minutes, b.estimate_minutes) || pressing(a, b);
    case "position":
      return (a, b) =>
        ascending(a.position, b.position) || a.title.localeCompare(b.title);
    case "title":
      return (a, b) => a.title.localeCompare(b.title);
    default:
      return (a, b) =>
        ascending(negate(a.score), negate(b.score)) || pressing(a, b);
  }
}
