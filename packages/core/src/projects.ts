import { clockMinutes, dayTime, zonedParts } from "./time.js";

/**
 * Projects: a named piece of work with ordered stages and the tasks that make
 * it up. Tasks stay ordinary planner items — a project only groups them — so
 * scheduling, the calendar and reminders keep working unchanged.
 */

export const PROJECT_STATUSES = ["active", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type ProjectStage = {
  id: string;
  project_id: string;
  name: string;
  position: number;
};

export type Project = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name?: string | null;
  name: string;
  summary: string;
  status: ProjectStatus;
  deadline: string | null;
  doc_id: string | null;
  created_at: string;
  updated_at: string;
  stages: ProjectStage[];
  /** Tasks in the project, and how many are finished. */
  task_count: number;
  done_count: number;
};

/** A compact record of a meaningful change to a project's work. */
export type ProjectActivity = {
  id: string;
  /** PostgreSQL bigint, sent as decimal text to preserve precision. */
  event_order: string;
  project_id: string;
  actor_id: string | null;
  actor_name: string | null;
  kind:
    | "project_created"
    | "project_changed"
    | "task_added"
    | "task_changed"
    | "task_removed"
    | "note_added"
    | "note_changed"
    | "note_removed"
    | "stage_added"
    | "stage_changed"
    | "stage_removed"
    | "record_added"
    | "record_changed";
  entity_type: "project" | "task" | "note" | "stage" | "record";
  entity_id: string | null;
  summary: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
};

/** Progress as a whole percentage; an empty project reads as 0. */
export const projectProgress = (p: {
  task_count: number;
  done_count: number;
}) =>
  p.task_count === 0 ? 0 : Math.round((p.done_count / p.task_count) * 100);

/**
 * Whether a project needs attention: past its deadline with work left, or
 * due within `soonDays` and less than half finished.
 */
export function projectAtRisk(
  p: { deadline: string | null; task_count: number; done_count: number },
  now = new Date(),
  soonDays = 7,
): boolean {
  if (!p.deadline || p.task_count === 0) return false;
  if (p.done_count >= p.task_count) return false;
  const due = new Date(p.deadline).getTime();
  if (due < now.getTime()) return true;
  const days = (due - now.getTime()) / 86_400_000;
  return days <= soonDays && projectProgress(p) < 50;
}

// ---------------------------------------------------------- deadline ---

/**
 * A project's deadline is a moment: the day picked, at 5 pm in the zone of
 * whoever picked it, unless they picked a time too. Creating and editing
 * use this one rule, and the day and time are always shown in the viewer's
 * own zone, so nobody sees the day before or after the one that was meant.
 */
export const DEADLINE_CLOCK = "17:00";

/** The instant for a deadline on `day` ("YYYY-MM-DD") at `clock` ("HH:mm"). */
export function projectDeadlineAt(
  day: string,
  clock: string | null | undefined,
  timeZone: string,
): string {
  return dayTime(
    day,
    clockMinutes(clock || DEADLINE_CLOCK),
    timeZone,
  ).toISOString();
}

/** A saved deadline as the day and time ("HH:mm") it falls on in `timeZone`. */
export function projectDeadlineParts(
  deadline: string,
  timeZone: string,
): { day: string; clock: string } {
  const p = zonedParts(new Date(deadline), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    day: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    clock: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/**
 * The deadline after one part of it changes: a new day keeps the time that
 * was saved (5 pm for a first deadline), and a new time keeps the day. No
 * day means no deadline.
 */
export function changeProjectDeadline(
  saved: string | null,
  change: { day?: string | null; clock?: string | null },
  timeZone: string,
): string | null {
  const was = saved ? projectDeadlineParts(saved, timeZone) : null;
  const day = change.day === undefined ? (was?.day ?? null) : change.day;
  if (!day) return null;
  const clock =
    change.clock === undefined ? (was?.clock ?? DEADLINE_CLOCK) : change.clock;
  return projectDeadlineAt(day, clock, timeZone);
}

/** The stages a new project starts with, so a board is never empty. */
export const DEFAULT_STAGES = ["Planning", "In progress", "Review", "Done"];

// ---------------------------------------------------------- timeline ---

export type TimelineBar = {
  id: string;
  title: string;
  stage: string;
  /** Where the bar starts and how wide it is, as percentages of the range. */
  left: number;
  width: number;
  done: boolean;
  /** Due before now and not finished. */
  late: boolean;
};

export type Timeline = {
  /** The range the chart covers, as ISO instants. */
  start: string;
  end: string;
  days: number;
  bars: TimelineBar[];
  /** Where today and the deadline sit in the range, or null when outside it. */
  todayAt: number | null;
  deadlineAt: number | null;
};

/** A task shows for at least this long, so a bar is never a hairline. */
const MIN_BAR_MINUTES = 60;

const clampPercent = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Lay a project's dated tasks on one time axis: each bar runs from when the
 * work would have to start (its due time less its estimate) to when it is due.
 * Undated tasks are left out — a timeline can only show what has a date.
 */
export function projectTimeline(
  project: {
    deadline: string | null;
    stages: { id: string; name: string }[];
  },
  tasks: {
    id: string;
    title: string;
    due_at?: string | null;
    estimate_minutes?: number | null;
    status: string;
    stage_id?: string | null;
  }[],
  now = new Date(),
): Timeline | null {
  const stageName = new Map(project.stages.map((s) => [s.id, s.name]));
  const dated = tasks.filter((t) => t.due_at);
  if (!dated.length) return null;

  const spans = dated.map((t) => {
    const due = new Date(t.due_at!).getTime();
    const minutes = Math.max(t.estimate_minutes ?? 0, MIN_BAR_MINUTES);
    return { task: t, from: due - minutes * 60_000, to: due };
  });

  let start = Math.min(...spans.map((s) => s.from));
  let end = Math.max(...spans.map((s) => s.to));
  if (project.deadline)
    end = Math.max(end, new Date(project.deadline).getTime());
  // A range needs width, even when everything falls on one moment.
  if (end - start < 86_400_000) end = start + 86_400_000;
  const span = end - start;
  const at = (ms: number) => clampPercent(((ms - start) / span) * 100);

  const nowMs = now.getTime();
  const deadlineMs = project.deadline
    ? new Date(project.deadline).getTime()
    : null;

  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    days: Math.max(1, Math.round(span / 86_400_000)),
    todayAt: nowMs >= start && nowMs <= end ? at(nowMs) : null,
    deadlineAt:
      deadlineMs !== null && deadlineMs >= start && deadlineMs <= end
        ? at(deadlineMs)
        : null,
    bars: spans
      .sort((a, b) => a.from - b.from)
      .map(({ task, from, to }) => {
        const left = at(from);
        return {
          id: task.id,
          title: task.title,
          stage: task.stage_id ? (stageName.get(task.stage_id) ?? "") : "",
          left,
          // Keep a sliver visible for very short work.
          width: Math.max(1.5, at(to) - left),
          done: task.status === "done",
          late: task.status !== "done" && to < nowMs,
        };
      }),
  };
}
