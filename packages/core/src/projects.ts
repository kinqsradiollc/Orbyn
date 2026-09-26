import { deadlineOf } from "./deadlines.js";
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

/** A web resource pinned to a project Home. */
export type ProjectLink = {
  id: string;
  project_id: string;
  url: string;
  title: string;
  created_at: string;
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
  /** Kept out of the assistant: no AI reads the project or anything in it. */
  assistant_off?: boolean;
  created_at: string;
  updated_at: string;
  stages: ProjectStage[];
  /** Tasks in the project, and how many are finished. */
  task_count: number;
  done_count: number;
  /** Other names the project goes by, such as a course code (LNK-03). */
  aliases?: string[];
};

/** Your open work in a project, measured against each task's planning target. */
export type ProjectPlanning = {
  project_id: string;
  deadline: string | null;
  task_count: number;
  needed_minutes: number;
  planned_minutes: number;
  unplanned_minutes: number;
  late_session_count: number;
  /** Last counted session when every estimated minute has been covered. */
  planned_finish_at: string | null;
  unestimated_tasks: { id: string; title: string }[];
  /** Shown only to a team owner or admin, without names or session times. */
  team_planned_minutes?: number;
};

/** One of the viewer's actual scheduled sessions in a project. */
export type ProjectSession = {
  id: string;
  item_id: string;
  start_at: string;
  end_at: string;
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
    | "record_changed"
    | "session_planned"
    | "session_moved"
    | "session_started"
    | "session_removed"
    | "milestone_added"
    | "milestone_changed"
    | "milestone_removed";
  /**
   * A session row is the viewer's own planned time for the task in
   * `entity_id` (teammates never see each other's).
   */
  entity_type:
    "project" | "task" | "note" | "stage" | "record" | "session" | "milestone";
  entity_id: string | null;
  summary: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  /** How the change was made, when known. */
  origin?: ActivityOrigin | null;
  /** The connected agent that made it, by its app's name. */
  via_agent?: string | null;
  created_at: string;
};

export type ActivityOrigin =
  "app" | "planner" | "assistant" | "agent" | "reminder";

/**
 * Where a History entry came from, in a few words ("by the planner", "via
 * Claude"), or null when it was made in the app by hand.
 */
export function activityOriginLabel(
  a: Pick<ProjectActivity, "origin" | "via_agent">,
): string | null {
  if (a.via_agent) return `via ${a.via_agent}`;
  switch (a.origin) {
    case "planner":
      return "by the planner";
    case "assistant":
      return "via the assistant";
    case "agent":
      return "via an agent";
    case "reminder":
      return "from a reminder";
    default:
      return null;
  }
}

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

/**
 * The project page's planned-vs-deadline chip, by the same rule as task rows:
 * "On track" when all of your part is planned before the deadline, "Not fully
 * planned" when some of it isn't (time not planned, a task with no estimate,
 * or a session after its task's deadline). Null without a deadline or open
 * work. Finished tasks never count. The one "at risk" rule for projects: the
 * list, the assistant and the page all use it.
 */
export function projectPlanStatus(p: {
  deadline: string | null;
  task_count: number;
  unplanned_minutes: number;
  late_session_count: number;
  unestimated_tasks: { id: string }[];
}): { status: "on_track" | "not_fully_planned"; label: string } | null {
  if (!p.deadline || p.task_count === 0) return null;
  return p.unplanned_minutes > 0 ||
    p.late_session_count > 0 ||
    p.unestimated_tasks.length > 0
    ? { status: "not_fully_planned", label: "Not fully planned" }
    : { status: "on_track", label: "On track" };
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
  /** Its deadline (`deadlineOf`) has passed and it isn't finished. */
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
 * Lay a project's dated tasks on one time axis: each bar ends at the task's
 * deadline (`deadlineOf`: the end of its day for an all-day task, its end
 * time when it has one) and starts when the work would have to start (the
 * deadline less its estimate), or earlier when the task's own dates start
 * earlier (an all-day task covers its day). Undated tasks are left out — a
 * timeline can only show what has a date.
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
    end_at?: string | null;
    all_day?: boolean | null;
    timezone?: string | null;
    estimate_minutes?: number | null;
    status: string;
    stage_id?: string | null;
  }[],
  now = new Date(),
  sessions: ProjectSession[] = [],
): Timeline | null {
  const stageName = new Map(project.stages.map((s) => [s.id, s.name]));
  const dated = tasks.filter((t) => t.due_at);
  if (!dated.length && !sessions.length) return null;

  const spans = dated.map((t) => {
    const to = Date.parse(deadlineOf({ ...t, due_at: t.due_at })!);
    const minutes = Math.max(t.estimate_minutes ?? 0, MIN_BAR_MINUTES);
    const from = Math.min(to - minutes * 60_000, Date.parse(t.due_at!));
    return { task: t, from, to };
  });

  let start = Math.min(
    ...spans.map((s) => s.from),
    ...sessions.map((s) => Date.parse(s.start_at)),
  );
  let end = Math.max(
    ...spans.map((s) => s.to),
    ...sessions.map((s) => Date.parse(s.end_at)),
  );
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
          // Late once its deadline has passed: not during an all-day
          // task's own day, nor before a task with an end time ends.
          late: task.status !== "done" && to < nowMs,
        };
      }),
  };
}

/** Exact positions of saved sessions on a project's time axis. */
export function projectSessionTicks(
  line: Timeline,
  sessions: ProjectSession[],
) {
  const start = Date.parse(line.start);
  const span = Date.parse(line.end) - start;
  return sessions
    .filter(
      (session) =>
        Date.parse(session.end_at) > start &&
        Date.parse(session.start_at) < start + span,
    )
    .map((session) => {
      const left = clampPercent(
        ((Date.parse(session.start_at) - start) / span) * 100,
      );
      return {
        ...session,
        left,
        width: Math.max(
          1.5,
          clampPercent(((Date.parse(session.end_at) - start) / span) * 100) -
            left,
        ),
      };
    });
}
