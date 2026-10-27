/** The day timeline covers the whole day: midnight to midnight. */
export const DAY_START = 0;
export const DAY_END = 24;
/** Points per hour row. */
export const HOUR_HEIGHT = 56;
/** Shortest block drawn, in minutes, so a deadline still has room for a title. */
const MIN_BLOCK = 30;
/** Default length of a timed task and of an event without an end. */
const TASK_MINUTES = 30;
const EVENT_MINUTES = 60;
const DAY_MS = 86_400_000;

export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Local midnight of `d`'s day. */
export const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The same wall-clock time `n` days later (DST-safe). */
export const shiftDays = (d: Date, n: number) =>
  new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + n,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  );

/** Sunday of the week containing `d`, matching the Sunday-first month grid. */
export const startOfWeek = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());

export const weekDays = (start: Date) =>
  Array.from({ length: 7 }, (_, i) => addDays(start, i));

/** Whole calendar days from `a` to `b` (DST-safe). */
export const daysBetween = (a: Date, b: Date) =>
  Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      DAY_MS,
  );

/** "6 AM", "12 PM", in the device locale. */
export const hourLabel = (hour: number) =>
  new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" });

export const timeLabel = (d: Date) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * The range shown, like the web: "Tuesday, September 15, 2026" for one day,
 * "Sep 13 – 19, 2026" or "Sep 27 – Oct 3, 2026" for several.
 */
export function rangeTitle(days: Date[]) {
  const first = days[0];
  const last = days[days.length - 1];
  if (days.length === 1)
    return first.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const sameMonth = first.getMonth() === last.getMonth();
  const start = first.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
  const end = last.toLocaleDateString(
    [],
    sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" },
  );
  return `${start} – ${end}, ${last.getFullYear()}`;
}

/** Anything on the calendar with a start and maybe an end. */
type Timed = { start_at: string; end_at: string | null; all_day?: boolean };

/**
 * Whether something is on `day`: all-day ones on each day up to their
 * (exclusive) end, timed ones on every day they run into, and ones with only
 * a start on the day they start.
 */
export function covers(x: Timed, day: Date) {
  const from = startOfDay(day).getTime();
  const to = addDays(day, 1).getTime();
  const start = Date.parse(x.start_at);
  const end = x.end_at ? Date.parse(x.end_at) : NaN;
  if (x.all_day) {
    const until = end > start ? end : start + DAY_MS;
    return start < to && until > from;
  }
  return start < to && (end > start ? end : start + 1) > from;
}

/** Minutes since local midnight of `day` (may be negative or past 1440). */
const minutesInto = (day: Date, at: Date) =>
  (at.getTime() - startOfDay(day).getTime()) / 60_000;

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
  /** A whole-day item (the `all_day` flag): shown in the all-day row. */
  allDay?: boolean;
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
 * All-day slots (by their flag, never guessed from a midnight start) go in
 * the row; timed ones that run over midnight are clipped to this day.
 * Overlapping blocks share the width side by side, like a desktop calendar.
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
    if (slot.allDay || endMin <= DAY_START * 60) {
      allDay.push(slot);
      continue;
    }
    const from = Math.min(
      Math.max(startMin, DAY_START * 60),
      DAY_END * 60 - MIN_BLOCK,
    );
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
