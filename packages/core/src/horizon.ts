import { isClosed } from "./schemas.js";
import { addDays, dayTime, localDateKey, zonedParts } from "./time.js";
import type { Item, Plan, PlannedBlock } from "./types.js";

/**
 * The planner preview as days ahead: one lane per day with the sessions the
 * plan puts there, and moving a session to another day. Moving is pinning —
 * the plan is tuned around it exactly as dragging on the calendar does — so
 * this is a way of looking at a plan, not a second planner.
 */
export type HorizonLane = {
  /** "YYYY-MM-DD" in the planner's time zone. */
  day: string;
  blocks: PlannedBlock[];
  minutes: number;
};

/** A plan's sessions grouped by day, every day of the plan included. */
export function horizonLanes(plan: Plan, timeZone: string): HorizonLane[] {
  const lanes: HorizonLane[] = Array.from({ length: plan.days }, (_, n) => ({
    day: addDays(plan.starts_on, n),
    blocks: [],
    minutes: 0,
  }));
  const byDay = new Map(lanes.map((l) => [l.day, l]));
  for (const b of [...plan.blocks].sort(
    (a, c) => Date.parse(a.start_at) - Date.parse(c.start_at),
  )) {
    const lane = byDay.get(localDateKey(new Date(b.start_at), timeZone));
    if (!lane) continue;
    lane.blocks.push(b);
    lane.minutes += Math.round(
      (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000,
    );
  }
  return lanes;
}

/** The same session at the same clock time on another day. */
export function onDay(
  block: Pick<PlannedBlock, "start_at" | "end_at">,
  day: string,
  timeZone: string,
) {
  const start = zonedParts(new Date(block.start_at), timeZone);
  const at = dayTime(day, start.hour * 60 + start.minute, timeZone);
  const length = Date.parse(block.end_at) - Date.parse(block.start_at);
  return { start: at, end: new Date(at.getTime() + length) };
}

/**
 * Why a session can't go at `start`–`end`, or null when it can. A task
 * can't start before what it waits on is done or finished in the plan, and
 * nothing waiting on it can start before it ends.
 */
export function dependencyConflict(
  itemId: string,
  start: Date,
  end: Date,
  plan: Pick<Plan, "blocks">,
  items: Pick<Item, "id" | "title" | "status" | "prerequisite_ids">[],
): string | null {
  const byId = new Map(items.map((i) => [i.id, i]));
  const item = byId.get(itemId);
  const lastEnd = (id: string) => {
    const blocks = plan.blocks.filter((b) => b.item_id === id);
    return blocks.length
      ? Math.max(...blocks.map((b) => Date.parse(b.end_at)))
      : null;
  };
  for (const pre of item?.prerequisite_ids ?? []) {
    const p = byId.get(pre);
    if (!p || isClosed(p.status)) continue;
    const finish = lastEnd(pre);
    if (finish === null)
      return `Waits on ${p.title}, which isn't in the plan yet.`;
    if (finish > start.getTime())
      return `Waits on ${p.title}, which is planned to finish later.`;
  }
  for (const other of items) {
    if (!other.prerequisite_ids?.includes(itemId) || isClosed(other.status))
      continue;
    const firstStart = plan.blocks
      .filter((b) => b.item_id === other.id)
      .map((b) => Date.parse(b.start_at));
    if (firstStart.length && Math.min(...firstStart) < end.getTime())
      return `${other.title} waits on this and is planned earlier.`;
  }
  return null;
}

/** Plain words for a day in the lanes: "Today", "Tomorrow", "Thu 24". */
export function laneLabel(day: string, today: string) {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
