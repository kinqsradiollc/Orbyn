import {
  clockLabel,
  deadlineOf,
  dueDayAt,
  dueWhen,
  sessionLine,
  type DeadlineSource,
} from "./deadlines.js";
import {
  fitChipShown,
  fitTone,
  spokenMinutes,
  type DeadlineFit,
} from "./fit.js";
import { isClosed } from "./schemas.js";
import { addDays, dayTime, localDateKey } from "./time.js";
import type { Kind, Status } from "./types.js";

/**
 * Today, planned and due in one list, and the planned feed that puts
 * "Planned 9:15" on task rows. Planned time (sessions) and the deadline stay
 * separate: a task that is both planned and due today is one row with two
 * chips. The web Overview's Today card, the phone's Today screen and task
 * rows all read this module; `GET /today` and `GET /planned` fill it in.
 */

// ---- the planned feed (GET /planned) ------------------------------------------

/** One of your sessions for a task, in the window asked for. */
export type PlannedSession = {
  id: string;
  start_at: string;
  end_at: string;
  /** It ends after the deadline it's for (see `endsAfterDeadline`). */
  after_deadline: boolean;
};

/**
 * What you've planned for one task: your sessions in the window asked for,
 * your next one, and its "does it fit?" status. Kept apart from the task
 * itself, because sessions change without the task changing (and devices
 * sync tasks by when they last changed).
 */
export type PlannedTask = {
  item_id: string;
  /** Your sessions for it in the window asked for, soonest first. */
  sessions: PlannedSession[];
  /** Your next session still to come (or under way), if any. */
  next: { start_at: string; end_at: string } | null;
  /** Minutes still to come in sessions that count (see `splitSessions`). */
  planned_minutes: number;
  /** Minutes still to come in sessions after a deadline still ahead. */
  late_minutes: number;
  /**
   * Its one status (see `deadlineFit`). Null for a finished task, or one
   * that isn't yours to plan and has none of your sessions.
   */
  fit: DeadlineFit | null;
};

/** `GET /planned`: your planned time, task by task. */
export type PlannedFeed = {
  /** The window whose sessions are listed; null when none was asked for. */
  from: string | null;
  to: string | null;
  tasks: PlannedTask[];
};

/** Where a day starts and ends: in `timeZone`, or on the device's clock. */
export function dayBounds(now = new Date(), timeZone?: string) {
  if (timeZone) {
    const day = localDateKey(now, timeZone);
    return {
      day,
      from: dayTime(day, 0, timeZone),
      to: dayTime(addDays(day, 1), 0, timeZone),
    };
  }
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    day: `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
    from,
    to,
  };
}

/** Your sessions for a task on `now`'s day (the device's, or `timeZone`'s). */
export function sessionsOnDay(
  planned: Pick<PlannedTask, "sessions"> | null | undefined,
  now = new Date(),
  timeZone?: string,
): PlannedSession[] {
  if (!planned) return [];
  const { from, to } = dayBounds(now, timeZone);
  return planned.sessions
    .filter(
      (s) =>
        Date.parse(s.start_at) < to.getTime() &&
        Date.parse(s.end_at) > from.getTime(),
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
}

/** The tasks with a session of yours on `now`'s day: My tasks' "Today" filter. */
export function plannedTodayIds(
  feed: Pick<PlannedFeed, "tasks"> | null | undefined,
  now = new Date(),
  timeZone?: string,
): Set<string> {
  const ids = new Set<string>();
  for (const t of feed?.tasks ?? [])
    if (sessionsOnDay(t, now, timeZone).length) ids.add(t.item_id);
  return ids;
}

/** "9:15", or "9:15 AM" where the clock has am and pm. */
export const timeLabel = (at: string | Date, timeZone?: string) =>
  new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });

/** "9:15–10:00". */
export const timeRange = (start: string, end: string, timeZone?: string) =>
  `${timeLabel(start, timeZone)}–${timeLabel(end, timeZone)}`;

/**
 * "Planned 9:15" on a task row, when the task has a session today: the next
 * one that hasn't ended, or the day's first once they all have. Null
 * without one.
 */
export function plannedLabel(
  planned: Pick<PlannedTask, "sessions"> | null | undefined,
  now = new Date(),
  timeZone?: string,
): string | null {
  const today = sessionsOnDay(planned, now, timeZone);
  if (!today.length) return null;
  const next =
    today.find((s) => Date.parse(s.end_at) > now.getTime()) ?? today[0];
  return `Planned ${timeLabel(next.start_at, timeZone)}`;
}

/** A small label on a row, and how it's drawn. */
export type RowChip = {
  text: string;
  tone: "ok" | "warn" | "muted" | "accent";
};

/**
 * The status chip a task row shows: only when it isn't on track and it's
 * due within a week, or a session falls after its deadline ("Short 2h",
 * "Session after the deadline", "Nothing planned", "At risk"). A deadline
 * already passed says so elsewhere on the row, so it gets none here.
 */
export function rowFitChip(
  fit: DeadlineFit | null | undefined,
  now = new Date(),
): RowChip | null {
  if (!fit || fit.status === "overdue") return null;
  if (!fitChipShown(fit, now)) return null;
  return { text: fit.label, tone: fitTone(fit.status) };
}

/**
 * Minutes still to plan for a task ("Tasks to place"): what it still needs
 * less the time planned that counts. 0 when it's already on track; null
 * when that isn't known (a teammate's task, or no feed yet).
 */
export function stillToPlan(
  planned: Pick<PlannedTask, "fit"> | null | undefined,
): number | null {
  const fit = planned?.fit;
  return fit ? fit.short_minutes : null;
}

/** "2 h still to plan". */
export const stillToPlanLabel = (minutes: number) =>
  `${spokenMinutes(minutes)} still to plan`;

// ---- the Today list (GET /today) ---------------------------------------------

/** An event on the day: yours, or from a calendar you subscribe to. */
export type TodayEventInput = {
  /** Null for a subscribed calendar's event (it can't be opened). */
  item_id: string | null;
  title: string;
  start_at: string;
  end_at: string | null;
  all_day?: boolean;
  /** Which occurrence of a repeating event. */
  occurrence?: string | null;
  status?: Status;
  /** The subscribed calendar's name. */
  calendar?: string | null;
};

/** One of your sessions, with what it's for (see `TimeBlock`). */
export type TodaySessionInput = {
  id: string;
  item_id: string;
  title: string;
  start_at: string;
  end_at: string;
  /** The task's status. */
  status: Status;
  kind?: Kind;
  part?: number;
  parts?: number;
  due_at?: string | null;
  due_all_day?: boolean;
  deadline_at?: string | null;
  after_deadline?: boolean;
};

/** A task that may be due today or late, with its status. */
export type TodayTaskInput = DeadlineSource & {
  id: string;
  title: string;
  kind: Kind;
  status: Status;
};

/** A past session whose task is still open and has no time planned since. */
export type TodayUnfinishedInput = {
  id: string;
  item_id: string;
  title: string;
  start_at: string;
  end_at: string;
};

export type TodayInput = {
  now: Date;
  /** The zone whose day it is. */
  timezone: string;
  events: TodayEventInput[];
  sessions: TodaySessionInput[];
  /** Tasks that may be due today or late; the rest are left out. */
  tasks: TodayTaskInput[];
  /** Each task's status, by id (see `deadlineFit`). */
  fits?: Record<string, DeadlineFit | null | undefined>;
  /** Unfinished sessions from before today (see `unfinishedBlocks`). */
  unfinished?: TodayUnfinishedInput[];
  /** Late tasks listed, at most; the rest are counted. */
  late_limit?: number;
};

/** A chip on a Today row. */
export type TodayChip =
  /** "Planned 11:00": the task's sessions today. */
  | { kind: "planned"; starts: string[] }
  /** "Due 5 pm": its deadline today. */
  | { kind: "due"; deadline_at: string; all_day: boolean }
  /** Its "does it fit?" status, when it isn't on track. */
  | { kind: "fit"; status: DeadlineFit["status"]; label: string };

/** One row of the Today list. */
export type TodayRow = {
  key: string;
  /** An event, one of your sessions, or a task due today or late. */
  kind: "event" | "session" | "task";
  /** Where it sits in the day: a start, or a task's deadline. Null when late. */
  at: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  item_id: string | null;
  /** The session's id (session rows). */
  block_id: string | null;
  /** Which occurrence of a repeating event. */
  occurrence: string | null;
  /** The subscribed calendar an event comes from. */
  calendar: string | null;
  title: string;
  /** For a task row: due today, or due on an earlier day. */
  due: "today" | "late" | null;
  /** The deadline the row names (see `deadlineOf`). */
  deadline_at: string | null;
  due_all_day: boolean;
  /** "Session 2 of 3" (session rows). */
  part: number | null;
  parts: number | null;
  /** The session ends after its deadline (session rows). */
  after_deadline: boolean;
  /** A task row's sessions today, soonest first. */
  sessions: { id: string; start_at: string; end_at: string }[];
  /** A task row's status. */
  fit: DeadlineFit | null;
  chips: TodayChip[];
  /**
   * What the row offers: "focus" for time planned now or later today,
   * "plan" for a task due today or late with time still missing.
   */
  action: "focus" | "plan" | null;
  /** It's over (a past event or session, or a finished event). */
  past: boolean;
};

/** A session from an earlier day that wasn't finished: "Plan again" or "Dismiss". */
export type TodayUnfinished = {
  block_id: string;
  item_id: string;
  title: string;
  start_at: string;
  end_at: string;
  /** It was yesterday's. */
  yesterday: boolean;
};

/** `GET /today`: the day's events, your sessions, what's due and what's late. */
export type TodayList = {
  /** The local day, YYYY-MM-DD. */
  day: string;
  timezone: string;
  now: string;
  /** The day's first and last moments (local midnights). */
  from: string;
  to: string;
  /** Events, sessions and tasks due today in time order, then late tasks. */
  rows: TodayRow[];
  /** How many tasks are late in all (some may not be listed). */
  late_total: number;
  /** Sessions from earlier days whose work isn't finished, latest first. */
  unfinished: TodayUnfinished[];
};

/** Late tasks the Today list names, at most. */
export const TODAY_LATE_SHOWN = 20;

/**
 * Whether a task is due today, due on an earlier day ("late"), or neither,
 * by the day it's due by (`dueDayAt`) in `timeZone`. Only open tasks.
 */
export function todayDue(
  task: DeadlineSource & { kind?: Kind | null; status?: Status | null },
  now: Date,
  timeZone: string,
): "today" | "late" | null {
  if (task.kind === "event" || (task.status && isClosed(task.status)))
    return null;
  const at = dueDayAt(task);
  if (!at) return null;
  const key = localDateKey(at, timeZone);
  const today = localDateKey(now, timeZone);
  if (key === today) return "today";
  return key < today ? "late" : null;
}

const RANK = { event: 0, session: 1, task: 2 } as const;

/**
 * The Today list: the day's events and your sessions in time order, tasks
 * due today (at their session when they have one today, else at their
 * deadline), then late tasks (latest deadline first). A task that is both
 * planned and due today (or late) is one row with two chips. Sessions and
 * tasks already finished are left out; unfinished sessions from earlier days
 * come separately, for "Plan again". Pure: `GET /today` gathers the input.
 */
export function todayList(input: TodayInput): TodayList {
  const { now, timezone } = input;
  const { day, from, to } = dayBounds(now, timezone);
  const start = from.getTime();
  const end = to.getTime();
  const at = now.getTime();
  const fits = input.fits ?? {};
  const rows: TodayRow[] = [];
  const blank = {
    start_at: null,
    end_at: null,
    all_day: false,
    item_id: null,
    block_id: null,
    occurrence: null,
    calendar: null,
    due: null,
    deadline_at: null,
    due_all_day: false,
    part: null,
    parts: null,
    after_deadline: false,
    sessions: [],
    fit: null,
    chips: [],
    action: null,
    past: false,
  } satisfies Omit<TodayRow, "key" | "kind" | "at" | "title">;

  // Events on the day, all-day ones first.
  input.events.forEach((e, n) => {
    if (e.status === "cancelled") return;
    const s = Date.parse(e.start_at);
    const f = e.end_at ? Date.parse(e.end_at) : s;
    if (!(s < end && (e.end_at ? f > start : s >= start))) return;
    rows.push({
      ...blank,
      key: `event:${e.item_id ?? `calendar${n}`}:${e.occurrence ?? e.start_at}`,
      kind: "event",
      at: e.all_day ? from.toISOString() : e.start_at,
      start_at: e.start_at,
      end_at: e.end_at,
      all_day: !!e.all_day,
      item_id: e.item_id,
      occurrence: e.occurrence ?? null,
      calendar: e.calendar ?? null,
      title: e.title,
      past: e.status === "done" || f <= at,
    });
  });

  // Your sessions on the day, by task.
  const sessions = input.sessions
    .filter(
      (s) =>
        !isClosed(s.status) &&
        Date.parse(s.start_at) < end &&
        Date.parse(s.end_at) > start,
    )
    .sort(
      (a, b) =>
        a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id),
    );
  const byTask = new Map<string, TodaySessionInput[]>();
  for (const s of sessions)
    byTask.set(s.item_id, [...(byTask.get(s.item_id) ?? []), s]);

  // Tasks due today or late: one row each, with their sessions today.
  const merged = new Set<string>();
  const late: TodayRow[] = [];
  let lateTotal = 0;
  for (const t of input.tasks) {
    const due = todayDue(t, now, timezone);
    if (!due) continue;
    if (due === "late") lateTotal++;
    const deadline = deadlineOf(t);
    if (!deadline) continue;
    const mine = byTask.get(t.id) ?? [];
    const fit = fits[t.id] ?? null;
    const allDay = !!t.all_day;
    const chips: TodayChip[] = [];
    if (mine.length)
      chips.push({ kind: "planned", starts: mine.map((s) => s.start_at) });
    if (due === "today" && mine.length)
      chips.push({ kind: "due", deadline_at: deadline, all_day: allDay });
    if (
      due === "today" &&
      fit &&
      fit.status !== "on_track" &&
      fit.status !== "no_deadline"
    )
      chips.push({ kind: "fit", status: fit.status, label: fit.label });
    const ahead = mine.some((s) => Date.parse(s.end_at) > at);
    const missing = fit ? fit.short_minutes > 0 : true;
    const row: TodayRow = {
      ...blank,
      key: `task:${t.id}`,
      kind: "task",
      at: mine.length
        ? mine[0].start_at
        : due === "today"
          ? dueDayAt(t)!.toISOString()
          : null,
      item_id: t.id,
      title: t.title,
      due,
      deadline_at: deadline,
      due_all_day: allDay,
      sessions: mine.map((s) => ({
        id: s.id,
        start_at: s.start_at,
        end_at: s.end_at,
      })),
      fit,
      chips,
      action: ahead ? "focus" : missing ? "plan" : null,
    };
    if (mine.length) merged.add(t.id);
    if (row.at) rows.push(row);
    else late.push(row);
  }

  // Sessions for everything else, one row each.
  for (const s of sessions) {
    if (merged.has(s.item_id)) continue;
    const over = Date.parse(s.end_at) <= at;
    rows.push({
      ...blank,
      key: `session:${s.id}`,
      kind: "session",
      at: s.start_at,
      start_at: s.start_at,
      end_at: s.end_at,
      item_id: s.item_id,
      block_id: s.id,
      title: s.title,
      deadline_at: s.deadline_at ?? null,
      due_all_day: !!s.due_all_day,
      part: s.part ?? null,
      parts: s.parts ?? null,
      after_deadline: !!s.after_deadline,
      action: over ? null : "focus",
      past: over,
    });
  }

  rows.sort((a, b) => {
    const allDay = Number(b.all_day) - Number(a.all_day);
    if (allDay) return allDay;
    return (
      Date.parse(a.at!) - Date.parse(b.at!) ||
      RANK[a.kind] - RANK[b.kind] ||
      a.title.localeCompare(b.title) ||
      a.key.localeCompare(b.key)
    );
  });
  late.sort(
    (a, b) =>
      Date.parse(b.deadline_at!) - Date.parse(a.deadline_at!) ||
      a.title.localeCompare(b.title),
  );

  const yesterday = addDays(day, -1);
  const unfinished = (input.unfinished ?? [])
    .map((b) => ({
      block_id: b.id,
      item_id: b.item_id,
      title: b.title,
      start_at: b.start_at,
      end_at: b.end_at,
      yesterday: localDateKey(new Date(b.end_at), timezone) === yesterday,
    }))
    .sort((a, b) => b.end_at.localeCompare(a.end_at));

  return {
    day,
    timezone,
    now: now.toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    rows: [...rows, ...late.slice(0, input.late_limit ?? TODAY_LATE_SHOWN)],
    late_total: lateTotal,
    unfinished,
  };
}

/**
 * A saved Today list is shown only on the day it's for (a phone opened
 * offline the next morning shows nothing rather than yesterday's day).
 */
export const todayIsCurrent = (
  list: Pick<TodayList, "day" | "timezone"> | null | undefined,
  now = new Date(),
): boolean => !!list && list.day === localDateKey(now, list.timezone);

// ---- words -------------------------------------------------------------------

/**
 * A chip's words: "Planned 11:00" (or "Planned 11:00, 15:00", "Planned
 * 11:00 +2"), "Due 5 pm" ("Due today" for a whole day), or the status
 * ("Nothing planned", "Short 1h"). Times on the device's clock, or in
 * `timeZone`.
 */
export function todayChipText(chip: TodayChip, timeZone?: string): string {
  if (chip.kind === "planned") {
    const times = chip.starts.map((s) => timeLabel(s, timeZone));
    if (times.length <= 2) return `Planned ${times.join(", ")}`;
    return `Planned ${times[0]} +${times.length - 1}`;
  }
  if (chip.kind === "due")
    return chip.all_day
      ? "Due today"
      : `Due ${clockLabel(new Date(chip.deadline_at), timeZone)}`;
  return chip.label;
}

/** How a chip is drawn. */
export function todayChipTone(chip: TodayChip): RowChip["tone"] {
  if (chip.kind === "planned") return "accent";
  if (chip.kind === "due") return "muted";
  return fitTone(chip.status);
}

/** What a Today row says, beside its title. */
export type TodayWords = {
  /** "9:15–10:00", "All day", "Due today 5 pm" or "Late". */
  lead: string | null;
  /** "Session 1 · due Tue 6 Oct", "due Tue 22 Sep", or a calendar's name. */
  meta: string | null;
  chips: RowChip[];
};

/**
 * A Today row in words, as both apps draw it:
 * - an event: "9:00–9:30 Standup";
 * - a session: "9:15–10:00 Write homepage copy · Session 1 · due Tue 6 Oct";
 * - planned and due today: "Send invoice", chips "Planned 11:00", "Due 5 pm";
 * - due today with nothing planned: "Due today 5 pm · Pay supplier", chip
 *   "Nothing planned";
 * - late: "Late · Book venue · due Tue 22 Sep".
 * Days and times on the device's clock, or in `timeZone`.
 */
export function todayRowWords(
  row: TodayRow,
  now = new Date(),
  timeZone?: string,
): TodayWords {
  const chips = row.chips.map((c) => ({
    text: todayChipText(c, timeZone),
    tone: todayChipTone(c),
  }));
  if (row.kind === "event")
    return {
      lead: row.all_day
        ? "All day"
        : row.end_at
          ? timeRange(row.start_at!, row.end_at, timeZone)
          : timeLabel(row.start_at!, timeZone),
      meta: row.calendar,
      chips,
    };
  if (row.kind === "session")
    return {
      lead: timeRange(row.start_at!, row.end_at!, timeZone),
      meta: sessionLine(
        {
          start_at: row.start_at!,
          end_at: row.end_at!,
          part: row.part ?? undefined,
          parts: row.parts ?? undefined,
          deadline_at: row.deadline_at,
          due_all_day: row.due_all_day,
          after_deadline: row.after_deadline,
        },
        now,
        timeZone,
      ),
      chips,
    };
  const planned = row.sessions.length > 0;
  if (row.due === "late")
    return {
      lead: "Late",
      meta: row.deadline_at
        ? `due ${dueWhen(row.deadline_at, row.due_all_day, now, timeZone)}`
        : null,
      chips,
    };
  if (planned || !row.deadline_at) return { lead: null, meta: null, chips };
  return {
    lead: row.due_all_day
      ? "Due today"
      : `Due today ${clockLabel(new Date(row.deadline_at), timeZone)}`,
    meta: null,
    chips,
  };
}

/** "Not finished yesterday", or "Not finished" when some are older. */
export const unfinishedHeading = (list: Pick<TodayList, "unfinished">) =>
  list.unfinished.every((u) => u.yesterday)
    ? "Not finished yesterday"
    : "Not finished";

/** "14:00–15:00" for yesterday's, "Mon 21 Sep 14:00–15:00" for older ones. */
export function unfinishedWhen(u: TodayUnfinished, timeZone?: string) {
  const range = timeRange(u.start_at, u.end_at, timeZone);
  if (u.yesterday) return range;
  const day = new Date(u.start_at).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(timeZone ? { timeZone } : {}),
  });
  return `${day} ${range}`;
}
