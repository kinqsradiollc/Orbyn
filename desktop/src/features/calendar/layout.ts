import type { Item } from "@orbyn/core";
import {
  addDays,
  daysBetween,
  firstDay,
  isAllDay,
  isMultiDay,
  isOnDay,
  itemSpan,
  lastDay,
} from "./dates";

/** A bar in a month week row, placed on a lane across columns. */
export type WeekBar = {
  item: Item;
  /** 0-6 column where the bar starts and ends within this week. */
  startCol: number;
  endCol: number;
  lane: number;
  /** The item continues from the previous week / into the next one. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/**
 * Lay out one week of the month grid. Multi-day items become continuous bars
 * across their days; single-day items fill the remaining lanes of their day.
 * Items that don't fit in `maxLanes` are counted per day for "+N more".
 */
export function layoutWeek(items: Item[], week: Date[], maxLanes: number) {
  const weekStart = week[0];
  const weekEnd = week[6];
  const entries = items
    .filter(
      (i) =>
        i.due_at &&
        firstDay(i).getTime() <= weekEnd.getTime() &&
        lastDay(i).getTime() >= weekStart.getTime(),
    )
    .map((item) => {
      const from = daysBetween(weekStart, firstDay(item));
      const to = daysBetween(weekStart, lastDay(item));
      return {
        item,
        startCol: Math.max(0, from),
        endCol: Math.min(6, to),
        continuesBefore: from < 0,
        continuesAfter: to > 6,
        multi: isMultiDay(item),
      };
    })
    .sort(
      (a, b) =>
        Number(b.multi) - Number(a.multi) ||
        a.startCol - b.startCol ||
        b.endCol - b.startCol - (a.endCol - a.startCol) ||
        Date.parse(a.item.due_at!) - Date.parse(b.item.due_at!) ||
        a.item.title.localeCompare(b.item.title),
    );

  const lanes: boolean[][] = Array.from({ length: maxLanes }, () =>
    Array<boolean>(7).fill(false),
  );
  const bars: WeekBar[] = [];
  const hidden = Array<number>(7).fill(0);
  for (const { multi, ...e } of entries) {
    void multi;
    const lane = lanes.findIndex((cols) =>
      cols.slice(e.startCol, e.endCol + 1).every((taken) => !taken),
    );
    if (lane === -1) {
      for (let c = e.startCol; c <= e.endCol; c++) hidden[c] += 1;
      continue;
    }
    for (let c = e.startCol; c <= e.endCol; c++) lanes[lane][c] = true;
    bars.push({ ...e, lane });
  }
  return { bars, hidden };
}

/** A timed item placed in a day column of the week/day time grid. */
export type PlacedEvent = {
  item: Item;
  /** Minutes from the top of the grid. */
  top: number;
  /** Length in minutes (at least `minMinutes`). */
  height: number;
  /** Side-by-side column within its overlap cluster, and how many columns it has. */
  col: number;
  cols: number;
};

/**
 * Timed items on `day`, positioned by start and sized by duration between
 * `startHour` and `endHour`. Overlapping items sit side by side.
 */
export function layoutDay(
  items: Item[],
  day: Date,
  startHour: number,
  endHour: number,
  minMinutes = 24,
): PlacedEvent[] {
  const gridStart = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    startHour,
  ).getTime();
  const gridEnd = addDays(day, 0).setHours(endHour, 0, 0, 0);
  const total = (gridEnd - gridStart) / 60000;

  const placed = items
    .filter((i) => isOnDay(i, day) && !isAllDay(i))
    .map((item) => {
      const span = itemSpan(item)!;
      let top = (span.start.getTime() - gridStart) / 60000;
      let bottom = (span.end.getTime() - gridStart) / 60000;
      // Keep early and late items visible at the edges of the grid.
      top = Math.min(Math.max(top, 0), total - minMinutes);
      bottom = Math.min(Math.max(bottom, top + minMinutes), total);
      return { item, top, height: bottom - top, col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);

  // Sweep clusters of overlapping items; give each a free column.
  let cluster: PlacedEvent[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const p of cluster) p.cols = columnEnds.length;
    cluster = [];
    columnEnds = [];
  };
  for (const p of placed) {
    // Nothing in the current cluster overlaps this item: start a new one.
    if (p.top >= clusterEnd) close();
    let col = columnEnds.findIndex((end) => end <= p.top);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(0);
    }
    columnEnds[col] = p.top + p.height;
    p.col = col;
    cluster.push(p);
    clusterEnd = Math.max(...columnEnds);
  }
  close();
  return placed;
}
