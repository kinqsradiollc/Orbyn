import { deadlineOf } from "./deadlines.js";

/**
 * Task priority, shared by the server and the apps: how pressing an open
 * task is. Pure: no clock, no network.
 */

const PRIORITY_WEIGHT = { low: 1, medium: 2, high: 3 } as const;

/** `size_fit` values: the estimate fits today's largest free slot, doesn't, or is unknown. */
export const SIZE_FIT = { fits: 1, too_big: 0.5, unknown: 0.75 } as const;

/**
 * How well a task's remaining estimate fits the largest free slot today: 1
 * when it fits in one go, 0.5 when it doesn't, and a neutral 0.75 for a task
 * without an estimate.
 */
export function sizeFit(
  item: { estimate_minutes?: number | null; spent_minutes?: number | null },
  largestFreeMinutes: number,
) {
  if (item.estimate_minutes == null) return SIZE_FIT.unknown;
  const remaining = Math.max(
    0,
    item.estimate_minutes - (item.spent_minutes ?? 0),
  );
  return remaining <= largestFreeMinutes ? SIZE_FIT.fits : SIZE_FIT.too_big;
}

/** What a priority score is worked out from: a task, or a row of one. */
export type PriorityInput = {
  priority: "low" | "medium" | "high";
  status: string;
  due_at: string | null;
  /** When it's due by, when the caller already knows (see `deadlineOf`). */
  deadline_at?: string | null;
  /** With `all_day` and `timezone`, what the deadline is worked out from. */
  end_at?: string | null;
  all_day?: boolean | null;
  timezone?: string | null;
  estimate_minutes?: number | null;
  spent_minutes?: number | null;
};

/**
 * How pressing an open task is, used to sort lists and by the planner:
 *
 *   3 x priority (1-3) + 4 x urgency + 2 if overdue + 1 x size_fit
 *
 * Urgency rises from 0 a week before the deadline to 1 at it, and a task is
 * overdue once its deadline has passed. The deadline is `deadlineOf`'s: an
 * all-day task is due by the end of its day and a task with an end time when
 * it ends. `size_fit` (see `sizeFit`) is 1 when the remaining estimate fits
 * the largest free slot today, 0.5 when it doesn't and 0.75 without an
 * estimate, so quick wins that fit edge ahead of equal work that can't be
 * done in one sitting. It only counts when the caller knows the largest free
 * slot (`largestFreeMinutes`); the planner and task lists always pass it.
 * Blocked tasks sink; tasks already under way rise a little.
 */
export function priorityScore(
  item: PriorityInput,
  now = new Date(),
  largestFreeMinutes?: number | null,
) {
  const deadline =
    item.deadline_at !== undefined ? item.deadline_at : deadlineOf(item);
  const due = deadline ? Date.parse(deadline) : NaN;
  const hours = Number.isNaN(due)
    ? Infinity
    : (due - now.getTime()) / 3_600_000;
  const urgency = Number.isFinite(hours)
    ? Math.min(1, Math.max(0, 1 - hours / (7 * 24)))
    : 0;
  let score = 3 * PRIORITY_WEIGHT[item.priority] + 4 * urgency;
  if (hours < 0) score += 2;
  if (largestFreeMinutes != null) score += sizeFit(item, largestFreeMinutes);
  if (item.status === "in_progress") score += 0.5;
  if (item.status === "blocked") score -= 3;
  return Math.round(score * 100) / 100;
}
