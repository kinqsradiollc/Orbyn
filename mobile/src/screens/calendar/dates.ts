/** First hour on the day timeline (6am) and the hour it ends (midnight). */
export const DAY_START = 6;
export const DAY_END = 24;
/** Points per hour row. */
export const HOUR_HEIGHT = 56;
/** Shortest block drawn, in minutes, so a deadline still has room for a title. */
const MIN_BLOCK = 30;
/** Default length of a timed task and of an event without an end. */
const TASK_MINUTES = 30;
const EVENT_MINUTES = 60;

export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Sunday of the week containing `d`, matching the Sunday-first month grid. */
export const startOfWeek = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());

export const weekDays = (start: Date) =>
  Array.from({ length: 7 }, (_, i) => addDays(start, i));

/** "6 AM", "12 PM", in the device locale. */
export const hourLabel = (hour: number) =>
  new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" });

export const timeLabel = (d: Date) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Minutes since local midnight of `day` (may be negative or past 1440). */
const minutesInto = (day: Date, at: Date) =>
  (at.getTime() -
    new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()) /
  60_000;

/** Y offset on the timeline for a moment on `day`. */
export const offsetFor = (day: Date, at: Date) =>
  ((minutesInto(day, at) - DAY_START * 60) / 60) * HOUR_HEIGHT;

/** Anything drawn on the day timeline: a calendar entry or a time block. */
export type Slot = {
  key: string;
  start: Date;
  /** Null for a task with only a due time, or an event without an end. */
  end: Date | null;
  kind: "task" | "event";
};

export type Placed<T extends Slot> = {
  slot: T;
  start: Date;
  end: Date;
  top: number;
  height: number;
  /** Column within its overlap cluster, and how many columns the cluster has. */
  column: number;
  columns: number;
};

/**
 * Split a day's slots into timeline blocks and the "All day / no time" row.
 * Slots starting exactly at midnight without an end, or entirely outside the
 * visible 6am-midnight window, go in the row. Overlapping blocks share the
 * width side by side, like a desktop calendar.
 */
export function layoutDay<T extends Slot>(slots: T[], day: Date) {
  const allDay: T[] = [];
  const blocks: Omit<Placed<T>, "column" | "columns">[] = [];
  for (const slot of slots) {
    const start = slot.start;
    const startMin = minutesInto(day, start);
    const end =
      slot.end ??
      new Date(
        start.getTime() +
          (slot.kind === "event" ? EVENT_MINUTES : TASK_MINUTES) * 60_000,
      );
    const endMin = Math.min(minutesInto(day, end), DAY_END * 60);
    const untimed = !slot.end && startMin === 0;
    if (untimed || endMin <= DAY_START * 60) {
      allDay.push(slot);
      continue;
    }
    const from = Math.max(startMin, DAY_START * 60);
    const to = Math.max(endMin, from + MIN_BLOCK);
    blocks.push({
      slot,
      start,
      end,
      top: ((from - DAY_START * 60) / 60) * HOUR_HEIGHT,
      height: ((to - from) / 60) * HOUR_HEIGHT,
    });
  }
  blocks.sort((a, b) => a.top - b.top || b.height - a.height);

  const placed: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const p of cluster) p.columns = columnEnds.length;
    cluster = [];
    columnEnds = [];
  };
  for (const b of blocks) {
    if (b.top >= clusterEnd) close();
    let column = columnEnds.findIndex((end) => end <= b.top);
    if (column === -1) column = columnEnds.push(0) - 1;
    columnEnds[column] = b.top + b.height;
    clusterEnd = Math.max(
      b.top >= clusterEnd ? -Infinity : clusterEnd,
      b.top + b.height,
    );
    const p: Placed<T> = { ...b, column, columns: 1 };
    cluster.push(p);
    placed.push(p);
  }
  close();
  return { placed, allDay };
}
