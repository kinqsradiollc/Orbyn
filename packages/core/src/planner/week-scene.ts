import type {
  CalendarEntry,
  CalendarView,
  PlannedBlock,
  PlannerPrefs,
  TimeBlock,
} from "../types.js";
import { capacityLevel, type CapacityLevel } from "./capacity.js";
import { isLateSession } from "./fit.js";
import {
  addDays,
  clockMinutes,
  dayTime,
  localDateKey,
  weekdayOf,
} from "./time.js";

/**
 * The week as a model both clients draw: days across, minutes along, and
 * height from priority. Pure and free of any renderer, so the web's CSS scene,
 * a native canvas and a flat calendar all show the same facts.
 */

export type WeekPartSource =
  "block" | "entry" | "external" | "frame" | "habit" | "proposal";

export type WeekPartHeight = "low" | "medium" | "high";

export type WeekPart = {
  /** Stable for one source record, including while a session is moved. */
  id: string;
  source: WeekPartSource;
  /** The block, item, subscription, frame or habit block behind it. */
  source_id: string;
  title: string;
  day: number;
  start_minutes: number;
  end_minutes: number;
  start_at: string;
  end_at: string;
  height: WeekPartHeight;
  /** Only your own sessions that sit on one day can be moved directly. */
  movable: boolean;
  /** Counts towards the day's booked time. */
  busy: boolean;
  done: boolean;
  late: boolean;
  /** How many overlapping parts sit underneath this one. */
  level: number;
  deadline_at: string | null;
};

export type WeekDay = {
  /** "YYYY-MM-DD" in the viewer's time zone. */
  date: string;
  off: boolean;
  working_minutes: number;
  booked_minutes: number;
  free_minutes: number;
  over_minutes: number;
  over: boolean;
  level: CapacityLevel;
  today: boolean;
  /** Whole-day events, which have no place on the time axis. */
  all_day: string[];
};

export type WeekDeadline = {
  id: string;
  title: string;
  day: number;
  minutes: number;
  at: string;
};

export type WeekIssue =
  | { kind: "over"; day: number; minutes: number }
  | { kind: "late"; part_id: string; title: string }
  | {
      kind: "clash";
      part_id: string;
      with_id: string;
      title: string;
      with_title: string;
    };

export type WeekScene = {
  timezone: string;
  from: string;
  to: string;
  /** The hours the floor needs: working hours, widened to fit what's there. */
  start_minutes: number;
  end_minutes: number;
  work_start_minutes: number;
  work_end_minutes: number;
  now_day: number | null;
  now_minutes: number;
  days: WeekDay[];
  parts: WeekPart[];
  deadlines: WeekDeadline[];
  issues: WeekIssue[];
};

export type WeekSceneInput = {
  week_start: string;
  view: Pick<
    CalendarView,
    "entries" | "blocks" | "frames" | "external" | "habit_blocks"
  >;
  prefs: Pick<
    PlannerPrefs,
    "timezone" | "work_days" | "work_start" | "work_end"
  >;
  now?: Date;
  /** A plan's proposed sessions, shown until it is applied or discarded. */
  proposals?: PlannedBlock[];
};

export const WEEK_DAYS = 7;

/** A day counts as over at 15 minutes, as team capacity does. */
const OVER_MINUTES = 15;
const DAY_MINUTES = 1440;

/** The instants a week's calendar request covers. */
export function weekRange(weekStart: string, timeZone: string) {
  return {
    from: dayTime(weekStart, 0, timeZone).toISOString(),
    to: dayTime(addDays(weekStart, WEEK_DAYS), 0, timeZone).toISOString(),
  };
}

const heightOf = (priority: string): WeekPartHeight =>
  priority === "high" ? "high" : priority === "low" ? "low" : "medium";

function merged(spans: [number, number][]) {
  const out: [number, number][] = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

const total = (spans: [number, number][]) =>
  merged(spans).reduce((sum, [start, end]) => sum + end - start, 0);

type Span = Omit<
  WeekPart,
  | "id"
  | "day"
  | "start_minutes"
  | "end_minutes"
  | "start_at"
  | "end_at"
  | "movable"
  | "level"
> & { start_at: string; end_at: string; movable: boolean };

/** Where a time span falls on each day of the week it touches. */
function placed(span: Span, dayStarts: number[], dayEnd: number): WeekPart[] {
  const start = Date.parse(span.start_at);
  const end = Date.parse(span.end_at);
  // A session keeps its id when it moves, so its element and focus survive.
  const identity =
    span.source === "block"
      ? span.source_id
      : `${span.source_id}:${span.start_at}`;
  const pieces: WeekPart[] = [];
  dayStarts.forEach((dayStart, day) => {
    const next = dayStarts[day + 1] ?? dayEnd;
    if (end <= dayStart || start >= next) return;
    const from = Math.max(start, dayStart);
    const to = Math.min(end, next);
    pieces.push({
      ...span,
      id: `${span.source}:${identity}:${pieces.length}`,
      day,
      start_minutes: Math.round((from - dayStart) / 60_000),
      end_minutes: Math.round((to - dayStart) / 60_000),
      level: 0,
    });
  });
  if (pieces.length > 1) for (const piece of pieces) piece.movable = false;
  return pieces;
}

function blockSpan(block: TimeBlock, now: Date): Span {
  const deadline = block.deadline_at ?? null;
  const done = block.status === "done" || block.outcome === "done";
  const after = !!deadline && Date.parse(block.end_at) > Date.parse(deadline);
  return {
    source: "block",
    source_id: block.id,
    title: block.title,
    start_at: block.start_at,
    end_at: block.end_at,
    height: heightOf(block.priority),
    movable: !done,
    busy: true,
    done,
    late:
      !done &&
      isLateSession({ after_deadline: after, deadline_at: deadline }, now),
    deadline_at: deadline,
  };
}

const entrySpan = (entry: CalendarEntry, end: string): Span => ({
  source: "entry",
  source_id: entry.item_id,
  title: entry.title,
  start_at: entry.start_at,
  end_at: end,
  height: heightOf(entry.priority),
  movable: false,
  busy: entry.busy !== false,
  done: entry.status === "done",
  late: false,
  deadline_at: null,
});

const fixedSpan = (
  source: WeekPartSource,
  source_id: string,
  title: string,
  start_at: string,
  end_at: string,
  busy: boolean,
): Span => ({
  source,
  source_id,
  title,
  start_at,
  end_at,
  height: "low",
  movable: false,
  busy,
  done: false,
  late: false,
  deadline_at: null,
});

/** Overlapping parts of one day rest on each other, earliest at the bottom. */
function stacked(parts: WeekPart[]) {
  const clashes: [WeekPart, WeekPart][] = [];
  const order = [...parts].sort(
    (a, b) => a.start_minutes - b.start_minutes || a.id.localeCompare(b.id),
  );
  order.forEach((part, index) => {
    for (const earlier of order.slice(0, index)) {
      if (earlier.day !== part.day || earlier.end_minutes <= part.start_minutes)
        continue;
      part.level = Math.max(part.level, earlier.level + 1);
      if (earlier.busy && part.busy && (earlier.movable || part.movable))
        clashes.push([earlier, part]);
    }
  });
  return clashes;
}

export function buildWeekScene(input: WeekSceneInput): WeekScene {
  const { prefs, view, week_start: weekStart } = input;
  const now = input.now ?? new Date();
  const timezone = prefs.timezone;
  const dates = Array.from({ length: WEEK_DAYS }, (_, i) =>
    addDays(weekStart, i),
  );
  const dayStarts = dates.map((d) => dayTime(d, 0, timezone).getTime());
  const dayEnd = dayTime(addDays(weekStart, WEEK_DAYS), 0, timezone).getTime();
  const todayKey = localDateKey(now, timezone);
  const allDay: string[][] = dates.map(() => []);

  const spans: Span[] = view.blocks.map((b) => blockSpan(b, now));
  const dues: WeekDeadline[] = [];
  for (const entry of view.entries) {
    if (entry.all_day) {
      const day = dates.indexOf(
        localDateKey(new Date(entry.start_at), timezone),
      );
      if (day >= 0) allDay[day].push(entry.title);
    } else if (entry.end_at) {
      spans.push(entrySpan(entry, entry.end_at));
    }
  }
  for (const f of view.frames ?? [])
    spans.push(
      fixedSpan("frame", f.frame_id, f.name, f.start_at, f.end_at, f.busy),
    );
  for (const e of view.external ?? []) {
    if (e.all_day) {
      const day = dates.indexOf(localDateKey(new Date(e.start_at), timezone));
      if (day >= 0) allDay[day].push(e.title);
    } else {
      spans.push(
        fixedSpan(
          "external",
          e.subscription_id,
          e.title,
          e.start_at,
          e.end_at,
          e.busy,
        ),
      );
    }
  }
  for (const h of view.habit_blocks ?? [])
    spans.push(fixedSpan("habit", h.id, h.name, h.start_at, h.end_at, true));

  const parts = spans.flatMap((span) => placed(span, dayStarts, dayEnd));
  const proposals = (input.proposals ?? []).flatMap((p, i) =>
    placed(
      {
        source: "proposal",
        source_id: `${p.item_id}:${i}`,
        title: p.title,
        start_at: p.start_at,
        end_at: p.end_at,
        height: "medium",
        movable: false,
        busy: false,
        done: false,
        late: false,
        deadline_at: null,
      },
      dayStarts,
      dayEnd,
    ),
  );

  const deadlineSeen = new Set<string>();
  for (const block of view.blocks) {
    const at = block.deadline_at;
    if (!at || deadlineSeen.has(`${block.item_id}:${at}`)) continue;
    const time = Date.parse(at);
    const day = dayStarts.findIndex(
      (start, i) => time >= start && time < (dayStarts[i + 1] ?? dayEnd),
    );
    if (day < 0) continue;
    deadlineSeen.add(`${block.item_id}:${at}`);
    dues.push({
      id: `${block.item_id}:${at}`,
      title: block.title,
      day,
      minutes: Math.round((time - dayStarts[day]) / 60_000),
      at,
    });
  }

  const start = clockMinutes(prefs.work_start);
  const end = clockMinutes(prefs.work_end);
  const days: WeekDay[] = dates.map((date, day) => {
    const working = prefs.work_days.includes(weekdayOf(date))
      ? Math.max(0, end - start)
      : 0;
    const busy = parts
      .filter((p) => p.day === day && p.busy)
      .map((p): [number, number] => [p.start_minutes, p.end_minutes]);
    const booked = total(busy);
    const bookedInHours = total(
      busy
        .map(([a, b]): [number, number] => [
          Math.max(a, start),
          Math.min(b, end),
        ])
        .filter(([a, b]) => b > a),
    );
    const free = Math.max(0, working - bookedInHours);
    const over = working ? Math.max(0, booked - working) : 0;
    return {
      date,
      off: working === 0,
      working_minutes: working,
      booked_minutes: booked,
      free_minutes: free,
      over_minutes: over,
      over: over >= OVER_MINUTES,
      level: working ? capacityLevel(free) : 0,
      today: date === todayKey,
      all_day: allDay[day],
    };
  });

  const clashes = stacked(parts);
  const issues: WeekIssue[] = [];
  days.forEach((d, day) => {
    if (d.over) issues.push({ kind: "over", day, minutes: d.over_minutes });
  });
  for (const part of parts)
    if (part.late)
      issues.push({ kind: "late", part_id: part.id, title: part.title });
  for (const [a, b] of clashes)
    issues.push({
      kind: "clash",
      part_id: b.id,
      with_id: a.id,
      title: b.title,
      with_title: a.title,
    });

  const everything = [...parts, ...proposals];
  const floorStart = Math.min(
    start,
    ...everything.map((p) => p.start_minutes),
    ...dues.map((d) => d.minutes),
  );
  const floorEnd = Math.max(
    end,
    ...everything.map((p) => p.end_minutes),
    ...dues.map((d) => d.minutes),
  );
  const nowDay = dates.indexOf(todayKey);
  return {
    timezone,
    from: new Date(dayStarts[0]).toISOString(),
    to: new Date(dayEnd).toISOString(),
    start_minutes: Math.max(0, Math.floor(floorStart / 60) * 60 - 60),
    end_minutes: Math.min(DAY_MINUTES, Math.ceil(floorEnd / 60) * 60 + 60),
    work_start_minutes: start,
    work_end_minutes: end,
    now_day: nowDay < 0 ? null : nowDay,
    now_minutes:
      nowDay < 0 ? 0 : Math.round((now.getTime() - dayStarts[nowDay]) / 60_000),
    days,
    parts: everything,
    deadlines: dues,
    issues,
  };
}

/** The times a session takes when dropped at `startMinutes` on a day. */
export function movedPartTimes(
  scene: Pick<WeekScene, "days" | "timezone">,
  part: Pick<WeekPart, "start_at" | "end_at">,
  day: number,
  startMinutes: number,
) {
  const length = Date.parse(part.end_at) - Date.parse(part.start_at);
  const start = dayTime(scene.days[day].date, startMinutes, scene.timezone);
  return {
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + length).toISOString(),
  };
}
