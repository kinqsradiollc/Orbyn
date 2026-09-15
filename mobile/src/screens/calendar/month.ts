import { daysBetween, startOfDay } from "./dates";

/** How something looks in the month grid. */
export type MonthLook = "entry" | "done" | "block" | "external" | "ghost";

/** Anything shown in the month grid: an entry, block, subscribed event or planned block. */
export type MonthThing = {
  key: string;
  title: string;
  start: Date;
  /** Exclusive end; null for a task with only a due time. */
  end: Date | null;
  color: string;
  look: MonthLook;
};

/** A bar in one week row of the month grid, placed on a lane across columns. */
export type WeekBar = {
  thing: MonthThing;
  /** 0-6 column where the bar starts and ends within this week. */
  startCol: number;
  endCol: number;
  lane: number;
  /** It continues from the previous week / into the next one. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

const firstDay = (t: MonthThing) => startOfDay(t.start);
const lastDay = (t: MonthThing) =>
  t.end && t.end.getTime() > t.start.getTime()
    ? startOfDay(new Date(t.end.getTime() - 1))
    : startOfDay(t.start);

/**
 * Lay out one week of the month grid (ported from the web). Things spanning
 * several days become continuous bars across them; single-day ones fill the
 * remaining lanes of their day. Whatever doesn't fit in `maxLanes` is
 * counted per day for "+N more".
 */
export function layoutWeek(
  things: MonthThing[],
  week: Date[],
  maxLanes: number,
) {
  const weekStart = week[0];
  const weekEnd = week[6];
  const rows = things
    .filter(
      (t) =>
        firstDay(t).getTime() <= weekEnd.getTime() &&
        lastDay(t).getTime() >= weekStart.getTime(),
    )
    .map((thing) => {
      const from = daysBetween(weekStart, firstDay(thing));
      const to = daysBetween(weekStart, lastDay(thing));
      return {
        thing,
        startCol: Math.max(0, from),
        endCol: Math.min(6, to),
        continuesBefore: from < 0,
        continuesAfter: to > 6,
        multi: to > from,
      };
    })
    .sort(
      (a, b) =>
        Number(b.multi) - Number(a.multi) ||
        a.startCol - b.startCol ||
        b.endCol - b.startCol - (a.endCol - a.startCol) ||
        a.thing.start.getTime() - b.thing.start.getTime() ||
        a.thing.title.localeCompare(b.thing.title),
    );

  const lanes: boolean[][] = Array.from({ length: maxLanes }, () =>
    Array<boolean>(7).fill(false),
  );
  const bars: WeekBar[] = [];
  const hidden = Array<number>(7).fill(0);
  const total = Array<number>(7).fill(0);
  for (const { multi: _multi, ...row } of rows) {
    for (let c = row.startCol; c <= row.endCol; c++) total[c] += 1;
    const lane = lanes.findIndex((cols) =>
      cols.slice(row.startCol, row.endCol + 1).every((taken) => !taken),
    );
    if (lane === -1) {
      for (let c = row.startCol; c <= row.endCol; c++) hidden[c] += 1;
      continue;
    }
    for (let c = row.startCol; c <= row.endCol; c++) lanes[lane][c] = true;
    bars.push({ ...row, lane });
  }
  return { bars, hidden, total };
}
