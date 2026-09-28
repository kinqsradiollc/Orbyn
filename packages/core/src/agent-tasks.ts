/**
 * Tasks handed to your own agent (W3), and the board's quick filters and
 * date range (W2). One set of rules for the web and phone apps.
 */
import { isClosed } from "./schemas.js";
import { dueDayAt, dueBeforeToday } from "./deadlines.js";
import type { Item } from "./types.js";

/** How a handed task stands: waiting its turn, being worked on, finished, or waiting on you. */
export const AGENT_TASK_STATES = [
  "queued",
  "working",
  "done",
  "needs_you",
] as const;
export type AgentTaskState = (typeof AGENT_TASK_STATES)[number];

/** The most tasks one person's agent holds at once. */
export const MAX_AGENT_TASKS = 5;

/** A handed task's state in words, with the agent's chosen name. */
export function agentStateText(
  state: AgentTaskState | null | undefined,
  agentName = "Orbyn",
): string {
  switch (state) {
    case "queued":
      return `Waiting for ${agentName}`;
    case "working":
      return `${agentName} is on it`;
    case "done":
      return `${agentName} finished`;
    case "needs_you":
      return "Needs you";
    default:
      return "";
  }
}

/** Whether your agent has the task now (queued, working or asking you). */
export const withAgent = (i: Pick<Item, "agent_grant_id">) =>
  !!i.agent_grant_id;

/** The board's quick filters, each with a live count. */
export const BOARD_FILTERS = [
  "all",
  "in_progress",
  "needs_review",
  "overdue",
  "done_week",
] as const;
export type BoardFilter = (typeof BOARD_FILTERS)[number];
export const BOARD_FILTER_LABELS: Record<BoardFilter, string> = {
  all: "All",
  in_progress: "In progress",
  needs_review: "Needs review",
  overdue: "Overdue",
  done_week: "Done this week",
};

/** The board's date range, by due or planned date. */
export const BOARD_RANGES = ["all", "day", "week", "month", "range"] as const;
export type BoardRangeKind = (typeof BOARD_RANGES)[number];
export const BOARD_RANGE_LABELS: Record<BoardRangeKind, string> = {
  all: "All",
  day: "Day",
  week: "Week",
  month: "Month",
  range: "Range",
};
/** A range; `from` and `to` are days (YYYY-MM-DD, both included) for "range". */
export type BoardRange = {
  kind: BoardRangeKind;
  from?: string | null;
  to?: string | null;
};

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fromDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

/** The Sunday this week started on (weeks start on Sunday, as the calendar's do). */
function boardWeekStart(now: Date): Date {
  const s = startOfDay(now);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

/**
 * Where a range starts and ends on the device's clock, the end not
 * included. Null for "all", or a "range" without both days.
 */
export function boardRangeBounds(
  range: BoardRange,
  now = new Date(),
): { from: Date; to: Date } | null {
  switch (range.kind) {
    case "day": {
      const from = startOfDay(now);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      return { from, to };
    }
    case "week": {
      const from = boardWeekStart(now);
      const to = new Date(from);
      to.setDate(to.getDate() + 7);
      return { from, to };
    }
    case "month":
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      };
    case "range": {
      if (!range.from || !range.to) return null;
      const [a, b] =
        range.from <= range.to
          ? [range.from, range.to]
          : [range.to, range.from];
      const to = fromDay(b);
      to.setDate(to.getDate() + 1);
      return { from: fromDay(a), to };
    }
    default:
      return null;
  }
}

/**
 * Whether a task falls in the range by its due day or one of its planned
 * sessions (`planned`: their start times). Everything is in "all".
 */
export function inBoardRange(
  i: Item,
  range: BoardRange,
  now = new Date(),
  planned: readonly string[] = [],
): boolean {
  const bounds = boardRangeBounds(range, now);
  if (!bounds) return true;
  const due = dueDayAt(i);
  const times = [
    ...(due ? [due.getTime()] : []),
    ...planned.map((at) => new Date(at).getTime()),
  ];
  return times.some(
    (t) => t >= bounds.from.getTime() && t < bounds.to.getTime(),
  );
}

/** Whether a task is in a quick filter. */
export function matchesBoardFilter(
  i: Item,
  filter: BoardFilter,
  now = new Date(),
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "in_progress":
      return (
        i.status === "in_progress" ||
        i.agent_state === "working" ||
        i.agent_state === "queued"
      );
    case "needs_review":
      return i.agent_state === "needs_you";
    case "overdue":
      return !isClosed(i.status) && dueBeforeToday(i, now);
    case "done_week":
      return (
        i.status === "done" &&
        !!i.updated_at &&
        new Date(i.updated_at).getTime() >= boardWeekStart(now).getTime()
      );
  }
}

/**
 * Each quick filter's count. "Needs review" also counts the proposals
 * waiting in Review (`reviewCount`), which show in their own lane.
 */
export function boardFilterCounts(
  items: Item[],
  now = new Date(),
  reviewCount = 0,
): Record<BoardFilter, number> {
  const counts = {} as Record<BoardFilter, number>;
  for (const f of BOARD_FILTERS)
    counts[f] = items.filter((i) => matchesBoardFilter(i, f, now)).length;
  counts.needs_review += reviewCount;
  return counts;
}
