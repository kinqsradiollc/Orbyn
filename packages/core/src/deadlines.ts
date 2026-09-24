import {
  addDays,
  dayTime,
  localDateKey,
  localDaysBetween,
  occurrences,
  parseRrule,
} from "./time.js";

/**
 * One rule for "when is this due?". "Due" is the deadline: planned time
 * (sessions) is kept separate, and only time that ends by the deadline counts
 * as planned for it. Every "is this after the deadline?" check in the apps
 * and on the server goes through `deadlineOf` and `endsAfterDeadline`.
 */

/** What a deadline is worked out from: a task's (or one occurrence's) times. */
export type DeadlineSource = {
  due_at: string | Date | null | undefined;
  end_at?: string | Date | null;
  all_day?: boolean | null;
  /** The zone an all-day date is kept in; UTC when missing. */
  timezone?: string | null;
};

const iso = (v: string | Date) => new Date(v).toISOString();

/**
 * The moment a task is due, or null when it has no date:
 * - a task with an end time (drawn as a span) is due when the span ends;
 * - an all-day task is due at the end of its day, not at the midnight it
 *   starts (an all-day `due_at` is stored as local midnight), so sessions on
 *   the day itself aren't late;
 * - otherwise its due time.
 */
export function deadlineOf(item: DeadlineSource): string | null {
  if (!item.due_at) return null;
  if (item.end_at) return iso(item.end_at);
  if (item.all_day) {
    const zone = item.timezone || "UTC";
    const day = localDateKey(new Date(item.due_at), zone);
    return dayTime(addDays(day, 1), 0, zone).toISOString();
  }
  return iso(item.due_at);
}

/** Whether something ending at `end` ends after `deadline`. No deadline: never. */
export function endsAfterDeadline(
  end: string | Date,
  deadline: string | Date | null | undefined,
): boolean {
  return !!deadline && new Date(end).getTime() > new Date(deadline).getTime();
}

/** A task as a series: what's needed to tell which occurrence a session is for. */
export type SeriesSource = DeadlineSource & {
  rrule?: string | null;
  /** The first occurrence; `due_at` is the current one. */
  series_start?: string | Date | null;
  /** Occurrences removed from the series. */
  exdates?: (string | Date)[] | null;
};

/** The due date a session works towards: its task's, or one occurrence's. */
export type SessionDue = {
  /** When it's due, as the task shows it. */
  due_at: string;
  /** The moment it's due by (see `deadlineOf`). */
  deadline_at: string;
};

/** Occurrences looked at before giving up on a very long series. */
const MAX_OCCURRENCES = 5000;

/**
 * Which due date each session of a task is for, by when the session ends.
 * A one-off task has one deadline. For a repeating task, a session is for
 * the first occurrence whose deadline it ends by: time set aside after this
 * occurrence's deadline counts towards the next one, and sessions of
 * occurrences already finished stay with them. A session after the last
 * occurrence of a series that has ended is for that last one (so it's late).
 * Null when the task has no date.
 */
export function sessionDueFor(
  task: SeriesSource,
): (sessionEnd: string | Date) => SessionDue | null {
  const deadline = deadlineOf(task);
  if (!task.due_at || !deadline) return () => null;
  const single: SessionDue = {
    due_at: iso(task.due_at),
    deadline_at: deadline,
  };
  const rule = task.rrule ? parseRrule(task.rrule) : null;
  if (!rule) return () => single;
  const zone = task.timezone || "UTC";
  const due = new Date(task.due_at);
  const end = task.end_at ? new Date(task.end_at) : null;
  const days =
    end && task.all_day ? Math.max(1, localDaysBetween(due, end, zone)) : 0;
  const length = end && !task.all_day ? end.getTime() - due.getTime() : 0;
  const deadlineAt = (at: Date) => {
    if (task.all_day)
      return dayTime(addDays(localDateKey(at, zone), days || 1), 0, zone);
    return new Date(at.getTime() + length);
  };
  const skip = new Set((task.exdates ?? []).map((d) => new Date(d).getTime()));
  const series = occurrences(
    new Date(task.series_start ?? task.due_at),
    rule,
    zone,
  );
  // Occurrences are listed once, lazily, as later sessions need them.
  const known: SessionDue[] = [];
  let done = false;
  const extend = () => {
    while (!done) {
      const next = series.next();
      if (next.done || known.length >= MAX_OCCURRENCES) {
        done = true;
        return false;
      }
      if (skip.has(next.value.getTime())) continue;
      known.push({
        due_at: next.value.toISOString(),
        deadline_at: deadlineAt(next.value).toISOString(),
      });
      return true;
    }
    return false;
  };
  return (sessionEnd) => {
    const endsAt = new Date(sessionEnd).getTime();
    let i = 0;
    for (;;) {
      if (i >= known.length && !extend()) break;
      if (Date.parse(known[i].deadline_at) >= endsAt) return known[i];
      i++;
    }
    return known.at(-1) ?? single;
  };
}

/** A session's place among a task's sessions: "Session 2 of 3". */
export type SessionNumber = { part: number; parts: number };

/**
 * Number sessions in time order within each group (a task, or one
 * occurrence of a repeating task). The plan preview and the saved calendar
 * number the same way, so a session keeps its number once it's saved.
 */
export function numberSessions<T extends { start_at: string; id?: string }>(
  sessions: T[],
  groupOf: (session: T) => string,
): Map<T, SessionNumber> {
  const groups = new Map<string, T[]>();
  for (const s of sessions) {
    const key = groupOf(s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out = new Map<T, SessionNumber>();
  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) =>
        Date.parse(a.start_at) - Date.parse(b.start_at) ||
        (a.id ?? "").localeCompare(b.id ?? ""),
    );
    sorted.forEach((s, i) => out.set(s, { part: i + 1, parts: sorted.length }));
  }
  return out;
}

// ---- words -------------------------------------------------------------------

/** A deadline this close makes a session say when its task is due. */
export const SESSION_DUE_SOON_DAYS = 7;

/** What the words about a session are made from (see `TimeBlock`). */
export type SessionWords = {
  start_at: string;
  end_at: string;
  part?: number;
  parts?: number;
  due_at?: string | null;
  due_all_day?: boolean;
  deadline_at?: string | null;
  after_deadline?: boolean;
};

const DAY_MS = 86_400_000;

const localDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * "5 pm" or "5:30 pm" where the device's clock has am and pm, "17:00" where
 * it doesn't (a bare "17" reads oddly).
 */
function clock(at: Date) {
  const twelve = new Intl.DateTimeFormat([], {
    hour: "numeric",
  }).resolvedOptions().hour12;
  return at.toLocaleTimeString([], {
    hour: "numeric",
    ...(at.getMinutes() || !twelve ? { minute: "2-digit" } : {}),
  });
}

/**
 * The instant to name for a deadline: the deadline itself, or for an
 * all-day date the last minute of its day (its deadline is the midnight
 * after), so it reads as that day.
 */
const namedAt = (deadline: string, allDay: boolean) =>
  new Date(Date.parse(deadline) - (allDay ? 60_000 : 0));

/**
 * When something is due, briefly and in the device's zone: "today 5 pm",
 * "tomorrow", "Fri 5 pm" within a week, else "Fri 16 Oct". All-day dates
 * leave the time out.
 */
export function dueWhen(
  deadline: string,
  allDay = false,
  now = new Date(),
): string {
  const at = namedAt(deadline, allDay);
  const days = Math.round((localDay(at) - localDay(now)) / DAY_MS);
  const time = allDay ? "" : ` ${clock(at)}`;
  if (days === 0) return `today${time}`;
  if (days === 1) return `tomorrow${time}`;
  if (days > 1 && days < SESSION_DUE_SOON_DAYS)
    return `${at.toLocaleDateString([], { weekday: "short" })}${time}`;
  return at.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "Fri 2 Oct, 5 pm", or "Fri 2 Oct" for an all-day date. */
export function dueDate(deadline: string, allDay = false): string {
  const at = namedAt(deadline, allDay);
  const day = at.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return allDay ? day : `${day}, ${clock(at)}`;
}

/**
 * The second line on a session's calendar tile: "Session 2 · due Fri 5 pm",
 * "Session 3 · after the deadline", "Due tomorrow 5 pm" or "Session 2 of 3".
 * It shows when the task has more than one session, is due within a week,
 * or the session ends after the deadline; otherwise null.
 */
export function sessionLine(s: SessionWords, now = new Date()): string | null {
  const numbered = (s.parts ?? 1) > 1 ? `Session ${s.part}` : "";
  const join = (text: string) =>
    numbered ? `${numbered} · ${text}` : text[0].toUpperCase() + text.slice(1);
  if (s.after_deadline) return join("after the deadline");
  const deadline = s.deadline_at ? Date.parse(s.deadline_at) : null;
  const soon =
    deadline !== null &&
    deadline >= now.getTime() &&
    deadline - now.getTime() <= SESSION_DUE_SOON_DAYS * DAY_MS;
  if (s.deadline_at && (soon || numbered))
    return join(`due ${dueWhen(s.deadline_at, !!s.due_all_day, now)}`);
  return numbered ? `${numbered} of ${s.parts}` : null;
}

/** "Session 2 of 3 planned", or null when the numbers aren't known. */
export function sessionCount(s: SessionWords): string | null {
  return s.part && s.parts ? `Session ${s.part} of ${s.parts} planned` : null;
}

/** "Deadline Fri 2 Oct, 5 pm", "Deadline end of Fri 2 Oct", or null. */
export function deadlineLine(s: SessionWords): string | null {
  if (!s.deadline_at) return null;
  return s.due_all_day
    ? `Deadline end of ${dueDate(s.deadline_at, true)}`
    : `Deadline ${dueDate(s.deadline_at)}`;
}

/** The most days a plan looks ahead. */
export const PLAN_MAX_DAYS = 14;

/**
 * How many days a plan should cover to reach a deadline, counting today:
 * 1 when it's due today, 3 when it's due the day after tomorrow, counted in
 * `timeZone` (the planner's; the device's when not given). At most two
 * weeks; undefined without a deadline or once it has passed.
 */
export function planDaysBefore(
  deadline: string | null | undefined,
  now = new Date(),
  timeZone?: string,
): number | undefined {
  if (!deadline) return undefined;
  // A deadline at midnight belongs to the day before it.
  const at = new Date(Date.parse(deadline) - 60_000);
  if (at.getTime() < now.getTime()) return undefined;
  const dayOf = (d: Date) =>
    timeZone
      ? Date.parse(`${localDateKey(d, timeZone)}T00:00:00Z`)
      : localDay(d);
  const days = Math.round((dayOf(at) - dayOf(now)) / DAY_MS) + 1;
  return Math.max(1, Math.min(PLAN_MAX_DAYS, days));
}
