import {
  deadlineOf,
  planningDeadline,
  dueDate,
  dueWhen,
  SESSION_DUE_SOON_DAYS,
  sessionDueFor,
  type SeriesSource,
} from "./deadlines.js";

/**
 * "Does it fit?": one rule for whether a task's planned time covers what it
 * still needs before its deadline. Only time that ends by the deadline counts
 * as planned; a session after it is flagged, never counted, so it can't
 * silence the at-risk, due-soon or roll-forward warnings. Once the deadline
 * has passed, sessions still to come count as catch-up time. The daily
 * notices, the planner (its preview, its moves and its result) and a task's
 * Sessions card all read this module.
 */

/** A task without an estimate is planned as this long. */
export const DEFAULT_ESTIMATE_MINUTES = 30;

/**
 * Minutes a task still needs for itself: its estimate minus the time logged.
 * A past session is not assumed to be done. A task's estimate covers its
 * subtasks: while it has open subtasks, they are planned on their own, and
 * the parent keeps only what its estimate has beyond theirs (nothing when it
 * has no estimate). So the work counted is the sum of the subtasks'
 * remaining estimates or the parent's own, whichever is more, and never
 * twice.
 */
export function remainingOf(t: {
  estimate_minutes: number | null;
  spent_minutes: number;
  open_children?: number;
  children_remaining?: number;
}) {
  if (t.open_children)
    return t.estimate_minutes == null
      ? 0
      : Math.max(
          0,
          t.estimate_minutes - t.spent_minutes - (t.children_remaining ?? 0),
        );
  return Math.max(
    0,
    (t.estimate_minutes ?? DEFAULT_ESTIMATE_MINUTES) - t.spent_minutes,
  );
}

// ---- words -------------------------------------------------------------------

/** "2h", "45m", "1h 30m": the short form the planner's messages use. */
export function shortMinutes(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/** "2 h", "45 min", "1 h 30 min": the long form notices use. */
export function spokenMinutes(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h ? (rest ? `${h} h ${rest} min` : `${h} h`) : `${rest} min`;
}

/**
 * Why a task is at risk, as the daily notice, the review and the planner all
 * say it: "Needs 2 h more, with 45 min free before it's due." When there is
 * enough free time in all, but not in pieces its sessions fit (with the
 * planner's padding, breaks and frames), it says that instead.
 */
export function atRiskReason(neededMinutes: number, freeMinutes: number) {
  return neededMinutes > freeMinutes
    ? `Needs ${spokenMinutes(neededMinutes)} more, with ${spokenMinutes(freeMinutes)} free before it's due.`
    : "Its sessions don't all fit in the free time before it's due.";
}

// ---- which sessions count ----------------------------------------------------

/**
 * How one session counts for its task:
 * - "planned": it ends by the deadline of the occurrence being worked on (or
 *   the task has no deadline, or its deadline has passed and this is
 *   catch-up time);
 * - "late": it ends after that deadline;
 * - "other": it belongs to another occurrence of a repeating task (time set
 *   aside after this occurrence's deadline counts towards the next one).
 */
export type SessionKind = "planned" | "late" | "other";

/** A minute either side, so an occurrence's deadline matches the task's. */
const SAME = 60_000;

/** Tells how each of a task's sessions counts (see `SessionKind`). */
export function sessionKindFor(
  task: SeriesSource,
  now = new Date(),
): (session: { end_at: string | Date }) => SessionKind {
  const deadline = deadlineOf(task);
  if (!deadline) return () => "planned";
  const current = Date.parse(deadline);
  // Past the deadline, whatever comes next is catching up.
  if (current <= now.getTime()) return () => "planned";
  if (!task.rrule)
    return (s) => (new Date(s.end_at).getTime() > current ? "late" : "planned");
  const dueFor = sessionDueFor(task);
  return (s) => {
    const end = new Date(s.end_at).getTime();
    const due = dueFor(s.end_at);
    const at = due ? Date.parse(due.deadline_at) : current;
    // An occurrence already finished keeps its own sessions.
    if (at < current - SAME) return "other";
    if (at <= current + SAME) return end > current ? "late" : "planned";
    // Past the last occurrence of a series that has ended: late.
    return end > at ? "late" : "other";
  };
}

/** A session's times, and whatever else the caller carries along. */
type Span = { start_at: string | Date; end_at: string | Date };

/** How much of a task's time still to come counts, and what's late. */
export type SessionSplit<T extends Span> = {
  /**
   * Minutes still to come in sessions that count: ending by the deadline,
   * or any once it has passed (catch-up) or when there is none.
   */
  planned_minutes: number;
  /** Minutes still to come in sessions that end after a deadline still ahead. */
  late_minutes: number;
  /** Those late sessions, soonest first. */
  late: T[];
  /** The deadline has passed: sessions still to come are catch-up time. */
  catch_up: boolean;
};

/**
 * Split a task's sessions into time that counts as planned and time after
 * the deadline, counting only what is still to come (from `now`).
 */
export function splitSessions<T extends Span>(
  task: SeriesSource,
  sessions: T[],
  now = new Date(),
  projectDeadline?: string | Date | null,
): SessionSplit<T> {
  const kind = sessionKindFor(task, now);
  const deadline = planningDeadline(deadlineOf(task), projectDeadline);
  const cap = deadline ? Date.parse(deadline) : null;
  let planned = 0;
  let lateMinutes = 0;
  const late: T[] = [];
  for (const s of sessions) {
    const start = new Date(s.start_at).getTime();
    const end = new Date(s.end_at).getTime();
    const ahead = Math.max(0, end - Math.max(start, now.getTime())) / 60_000;
    if (!ahead) continue;
    const original = kind(s);
    const k =
      original === "planned" && cap && cap > now.getTime() && end > cap
        ? "late"
        : original;
    if (k === "planned") planned += ahead;
    else if (k === "late") {
      lateMinutes += ahead;
      late.push(s);
    }
  }
  late.sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
  return {
    planned_minutes: Math.round(planned),
    late_minutes: Math.round(lateMinutes),
    late,
    catch_up: !!deadline && Date.parse(deadline) <= now.getTime(),
  };
}

// ---- the status --------------------------------------------------------------

/**
 * A task's one "does it fit?" status:
 * - on_track: what it still needs is planned before the deadline;
 * - short: some of it is planned, not all ("Short 2h");
 * - late_session: a session falls after the deadline, and that time is missing;
 * - unplanned: nothing is planned for it;
 * - at_risk: there isn't enough free time before the deadline for what's missing;
 * - overdue: the deadline has passed;
 * - no_deadline: nothing to measure against.
 */
export type FitStatus =
  | "on_track"
  | "short"
  | "late_session"
  | "unplanned"
  | "at_risk"
  | "overdue"
  | "no_deadline";

export type DeadlineFit = {
  status: FitStatus;
  /** "On track", "Short 2h", "Session after the deadline", "Nothing planned", "At risk", "Deadline passed" or "No deadline". */
  label: string;
  /** Still needed: the estimate minus the time logged (subtasks added up). */
  needed_minutes: number;
  /** Time still to come that counts (see `splitSessions`). */
  planned_minutes: number;
  /** Time still to come after a deadline still ahead. */
  late_minutes: number;
  /** Needed minus planned, never below 0. */
  short_minutes: number;
  /** Free working time before the deadline, when it was worked out. */
  free_minutes: number | null;
  /** The moment it's due by (`deadlineOf`), or null. */
  deadline_at: string | null;
};

const DAY_MS = 86_400_000;

export type FitInput = {
  deadline_at: string | null | undefined;
  needed_minutes: number;
  planned_minutes: number;
  late_minutes?: number;
  /** Free working time before the deadline; without it "At risk" isn't told. */
  free_minutes?: number | null;
  /**
   * The task has its own estimate. Without one it counts as 30 minutes, a
   * guess, so "Short" is said only within a week of the deadline.
   */
  estimated?: boolean;
  now?: Date;
};

export const FIT_LABELS: Record<FitStatus, string> = {
  on_track: "On track",
  short: "Short",
  late_session: "Session after the deadline",
  unplanned: "Nothing planned",
  at_risk: "At risk",
  overdue: "Deadline passed",
  no_deadline: "No deadline",
};

/** A task's one status against its deadline (see `FitStatus`). */
export function deadlineFit(input: FitInput): DeadlineFit {
  const now = input.now ?? new Date();
  const needed = Math.max(0, Math.round(input.needed_minutes));
  const planned = Math.max(0, Math.round(input.planned_minutes));
  const late = Math.max(0, Math.round(input.late_minutes ?? 0));
  const free = input.free_minutes ?? null;
  const short = Math.max(0, needed - planned);
  const deadline = input.deadline_at ?? null;
  const out = (status: FitStatus): DeadlineFit => ({
    status,
    label:
      status === "short" ? `Short ${shortMinutes(short)}` : FIT_LABELS[status],
    needed_minutes: needed,
    planned_minutes: planned,
    late_minutes: late,
    short_minutes: short,
    free_minutes: free === null ? null : Math.round(free),
    deadline_at: deadline,
  });
  if (!deadline) return out("no_deadline");
  const at = Date.parse(deadline);
  if (at <= now.getTime()) return out("overdue");
  if (!short) return out("on_track");
  if (free !== null && short > free) return out("at_risk");
  if (late) return out("late_session");
  const soon = at - now.getTime() <= SESSION_DUE_SOON_DAYS * DAY_MS;
  // The default estimate is a guess: far off, some time planned will do.
  if (!input.estimated && !soon) return out(planned ? "on_track" : "unplanned");
  return out(planned ? "short" : "unplanned");
}

/**
 * Whether a task row shows its status chip: within a week of the deadline,
 * or when a session falls after it. The Sessions card always shows it.
 */
export function fitChipShown(fit: DeadlineFit, now = new Date()) {
  if (fit.status === "no_deadline" || fit.status === "on_track") return false;
  if (fit.late_minutes > 0) return true;
  if (!fit.deadline_at) return false;
  return (
    Date.parse(fit.deadline_at) - now.getTime() <=
    SESSION_DUE_SOON_DAYS * DAY_MS
  );
}

/** How a status is drawn: fine, a warning, or quiet. */
export function fitTone(status: FitStatus): "ok" | "warn" | "muted" {
  if (status === "on_track") return "ok";
  if (status === "no_deadline") return "muted";
  return "warn";
}

// ---- moving a session by hand ------------------------------------------------

/**
 * A session that ends after its task's deadline while that deadline is still
 * ahead: the one the apps call late and offer to move before it. Once the
 * deadline has passed, a session still to come is catch-up time, not late.
 */
export function isLateSession(
  s: { after_deadline?: boolean; deadline_at?: string | null },
  now = new Date(),
): boolean {
  return (
    !!s.after_deadline &&
    !!s.deadline_at &&
    Date.parse(s.deadline_at) > now.getTime()
  );
}

/**
 * The warning after a session is dragged, copied or moved past its deadline:
 * "This session ends after the deadline (Fri 5 pm)". Null when it doesn't,
 * or when the deadline has already passed (then it's catch-up time).
 * Nothing is refused: the apps offer "Keep it" and "Find time before".
 */
export function lateSessionWarning(
  s: {
    end_at: string;
    after_deadline?: boolean;
    deadline_at?: string | null;
    due_all_day?: boolean;
  },
  now = new Date(),
): string | null {
  if (!isLateSession(s, now) || !s.deadline_at) return null;
  return `This session ends after the deadline (${dueWhen(s.deadline_at, !!s.due_all_day, now)})`;
}

// ---- a plan's result ---------------------------------------------------------

/** A session a plan offers to move to before its task's deadline. */
export type MoveWords = {
  title: string;
  from_start_at: string;
  start_at: string;
  source: "manual" | "planner";
};

/** "Sat 3 Oct 10:00": a session's start, briefly, on the device's clock. */
const startLabel = (iso: string) => {
  const at = new Date(iso);
  return `${at.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  })} ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

/** "Sat 3 Oct 10:00 → Wed 30 Sep 16:00": where a session is, and where it would go. */
export const moveTimes = (m: Pick<MoveWords, "from_start_at" | "start_at">) =>
  `${startLabel(m.from_start_at)} → ${startLabel(m.start_at)}`;

/**
 * One offered move, as the plan preview lists it:
 * "Quarterly report: Sat 3 Oct 10:00 → Wed 30 Sep 16:00 (made by the
 * planner)", or for a session placed by hand "Slides: your Sun 4 Oct 11:00
 * session → Fri 2 Oct 9:00?".
 */
export function moveLine(m: MoveWords) {
  return m.source === "planner"
    ? `${m.title}: ${startLabel(m.from_start_at)} → ${startLabel(m.start_at)} (made by the planner)`
    : `${m.title}: your ${startLabel(m.from_start_at)} session → ${startLabel(m.start_at)}?`;
}

/**
 * An at-risk row in a plan: "needs 2h, 45m free before Fri 2 Oct, 5 pm".
 * Null without the minutes (a plan made before they were kept).
 */
export function atRiskLine(t: {
  remaining_minutes?: number | null;
  free_minutes?: number | null;
  deadline_at?: string | null;
  due_all_day?: boolean;
}) {
  if (t.remaining_minutes == null || t.free_minutes == null) return null;
  const by = t.deadline_at
    ? ` before ${dueDate(t.deadline_at, !!t.due_all_day)}`
    : "";
  return `needs ${shortMinutes(t.remaining_minutes)}, ${shortMinutes(t.free_minutes)} free${by}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const localDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "today", "tomorrow", "on Thu" within a week, else "on Fri 16 Oct". */
function dayWords(at: Date, now: Date) {
  const days = Math.round((localDay(at) - localDay(now)) / DAY_MS);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < SESSION_DUE_SOON_DAYS)
    return `on ${at.toLocaleDateString([], { weekday: "short" })}`;
  return `on ${at.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}`;
}

/**
 * What applying a plan did, in one message: "Planned 5 tasks: 3 today, 2
 * tomorrow · Moved 1 session before its deadline · 1 session wasn't moved
 * because it changed or that time is taken now · Couldn't fit before the
 * deadline: Budget review (needs 2h, 45m free)." Tasks are counted on the day
 * of their first new session.
 */
export function planOutcome(
  r: {
    /** The sessions added. */
    blocks: { item_id: string; start_at: string }[];
    /** The sessions moved before their deadline. */
    moved?: unknown[];
    /** Sessions left out because the time was taken by then. */
    skipped: number;
    /** Ticked moves left out: the session changed or went, or the time is taken. */
    moves_skipped?: number;
  },
  atRisk: {
    title: string;
    remaining_minutes?: number | null;
    free_minutes?: number | null;
  }[] = [],
  now = new Date(),
): string {
  const parts: string[] = [];
  const first = new Map<string, number>();
  for (const b of r.blocks) {
    const at = Date.parse(b.start_at);
    first.set(b.item_id, Math.min(first.get(b.item_id) ?? Infinity, at));
  }
  if (first.size) {
    const days = new Map<string, { at: number; n: number }>();
    for (const at of first.values()) {
      const words = dayWords(new Date(at), now);
      const d = days.get(words) ?? { at, n: 0 };
      days.set(words, { at: Math.min(d.at, at), n: d.n + 1 });
    }
    const groups = [...days.entries()].sort((a, b) => a[1].at - b[1].at);
    parts.push(
      groups.length === 1
        ? `Planned ${plural(first.size, "task")} ${groups[0][0]}`
        : `Planned ${plural(first.size, "task")}: ${groups
            .map(([words, d]) => `${d.n} ${words}`)
            .join(", ")}`,
    );
  }
  const moved = r.moved?.length ?? 0;
  if (moved)
    parts.push(
      moved === 1
        ? "Moved 1 session before its deadline"
        : `Moved ${moved} sessions before their deadlines`,
    );
  if (r.skipped)
    parts.push(
      `${plural(r.skipped, "session")} left out because something else is there now`,
    );
  const notMoved = r.moves_skipped ?? 0;
  if (notMoved)
    parts.push(
      notMoved === 1
        ? "1 session wasn't moved because it changed or that time is taken now"
        : `${notMoved} sessions weren't moved because they changed or that time is taken now`,
    );
  if (atRisk.length) {
    const named = atRisk
      .slice(0, 3)
      .map((t) =>
        t.remaining_minutes != null && t.free_minutes != null
          ? `${t.title} (needs ${shortMinutes(t.remaining_minutes)}, ${shortMinutes(t.free_minutes)} free)`
          : t.title,
      );
    const more = atRisk.length - named.length;
    parts.push(
      `Couldn't fit before the deadline: ${named.join(", ")}${more ? ` and ${more} more` : ""}`,
    );
  }
  if (!parts.length) return "Nothing changed on your calendar.";
  return `${parts.join(" · ")}.`;
}
