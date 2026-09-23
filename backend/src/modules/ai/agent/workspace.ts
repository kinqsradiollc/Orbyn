import {
  isClosed,
  priorityScore,
  projectAtRisk,
  projectProgress,
} from "@orbyn/core";
import { pool } from "../../../db/pool.js";
import { VISIBLE_ITEMS } from "../../../lib/teams.js";
import {
  agendaEntries,
  busyIntervals,
  loadPrefs,
} from "../../planner/calendar.js";
import {
  freeSpans,
  largestFreeMinutes,
  workingSpans,
} from "../../planner/plans.js";
import { planReality } from "../../followthrough/reality.js";
import { clean, isUuid, localDate, toInstant, whenLabel } from "./format.js";
import type { AgentContext } from "./tools.js";

/**
 * Read-only views of the workspace for the assistant: what to do first, the
 * projects, free time, and what is waiting on people. Every query is scoped
 * to the signed-in user and their teams exactly as the apps are; nothing
 * here writes. Changes still go through the propose_* tools and the user's
 * approval.
 */

type TaskRow = {
  id: string;
  title: string;
  kind: string;
  status: string;
  priority: "low" | "medium" | "high";
  due_at: Date | null;
  end_at: Date | null;
  estimate_minutes: number | null;
  spent_minutes: number;
  team_name: string | null;
  project_name: string | null;
  list_name: string | null;
};

/** Why a task ranks where it does, in words a person would use. */
function reasons(row: TaskRow, now: Date, timezone: string) {
  const out: string[] = [];
  const due = row.due_at?.getTime();
  if (due !== undefined && due < now.getTime()) out.push("overdue");
  else if (due !== undefined) {
    const days = (due - now.getTime()) / 86_400_000;
    if (localDate(row.due_at!, timezone) === localDate(now, timezone))
      out.push("due today");
    else if (days <= 2) out.push("due in the next two days");
    else if (days <= 7) out.push("due this week");
  } else out.push("no due date");
  if (row.priority === "high") out.push("high priority");
  if (row.status === "in_progress") out.push("already started");
  if (row.status === "blocked") out.push("blocked");
  if (row.estimate_minutes == null) out.push("no estimate");
  return out;
}

const RANK_SELECT = `SELECT i.id, i.title, i.kind, i.status, i.priority, i.due_at, i.end_at,
    i.estimate_minutes, i.spent_minutes, t.name AS team_name,
    p.name AS project_name, l.name AS list_name
  FROM items i
  LEFT JOIN teams t ON t.id = i.team_id
  LEFT JOIN projects p ON p.id = i.project_id
  LEFT JOIN lists l ON l.id = i.list_id`;

/**
 * Open tasks in the order the app itself would put them: the same priority
 * score the task lists sort by (priority, how close the due date is, overdue,
 * whether the remaining estimate fits today's largest free stretch), with
 * the reasons spelled out. Undated tasks are included, so "what should I do
 * first?" and "which undated tasks matter?" have a real answer.
 */
export async function rankTasks(
  ctx: AgentContext,
  a: { limit?: number; team_id?: string; only_undated?: boolean },
) {
  const values: unknown[] = [ctx.user.id];
  const where = [VISIBLE_ITEMS, "i.kind = 'task'"];
  if (a.team_id === "personal") where.push("i.team_id IS NULL");
  else if (a.team_id) {
    if (!isUuid(a.team_id))
      throw new Error('team_id must be an id from list_teams, or "personal".');
    values.push(a.team_id);
    where.push(`i.team_id = $${values.length}`);
  }
  if (a.only_undated) where.push("i.due_at IS NULL");
  const rows = (
    await pool.query<TaskRow>(
      `${RANK_SELECT} WHERE ${where.join(" AND ")}
         AND i.status NOT IN ('done', 'cancelled')
       LIMIT 500`,
      values,
    )
  ).rows;
  const now = new Date();
  const free = await largestFreeMinutes(pool, ctx.user.id, now);
  const ranked = rows
    .map((r) => ({
      row: r,
      score: priorityScore(
        {
          priority: r.priority,
          status: r.status,
          due_at: r.due_at?.toISOString() ?? null,
          estimate_minutes: r.estimate_minutes,
          spent_minutes: r.spent_minutes,
        },
        now,
        free,
      ),
    }))
    .sort((x, y) => y.score - x.score);
  const limit = a.limit ?? 10;
  return {
    total_open: ranked.length,
    largest_free_minutes_today: free,
    how_ranked:
      "The app's own priority score: 3 x priority + 4 x urgency (rises over the week before the due time) + 2 if overdue + how well the remaining estimate fits today's largest free stretch; started work rises, blocked work sinks.",
    tasks: ranked.slice(0, limit).map(({ row, score }, n) => ({
      rank: n + 1,
      id: row.id,
      title: clean(row.title, 200),
      when: whenLabel(row.due_at, row.end_at, ctx.timezone),
      priority: row.priority,
      status: row.status,
      estimate_minutes: row.estimate_minutes,
      project: row.project_name ? clean(row.project_name, 80) : null,
      list: row.list_name ? clean(row.list_name, 80) : null,
      team: row.team_name ? clean(row.team_name, 80) : null,
      score,
      why: reasons(row, now, ctx.timezone),
    })),
    more: ranked.length > limit,
  };
}

type ProjectRow = {
  id: string;
  name: string;
  summary: string;
  status: string;
  deadline: Date | null;
  team_name: string | null;
  task_count: number;
  done_count: number;
  updated_at: Date;
};

const PROJECT_SELECT = `SELECT p.id, p.name, p.summary, p.status, p.deadline, p.updated_at,
    t.name AS team_name,
    (SELECT count(*)::int FROM items i WHERE i.project_id = p.id) AS task_count,
    (SELECT count(*)::int FROM items i WHERE i.project_id = p.id AND i.status = 'done') AS done_count
  FROM projects p LEFT JOIN teams t ON t.id = p.team_id`;
const VISIBLE_PROJECTS = `((p.team_id IS NULL AND p.user_id = $1)
  OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

const projectView = (p: ProjectRow, timezone: string) => {
  const counts = { task_count: p.task_count, done_count: p.done_count };
  return {
    id: p.id,
    name: clean(p.name, 120),
    status: p.status,
    team: p.team_name ? clean(p.team_name, 80) : null,
    deadline: p.deadline ? localDate(p.deadline, timezone) : null,
    tasks: `${p.done_count} of ${p.task_count} done`,
    progress_percent: projectProgress(counts),
    at_risk: projectAtRisk({
      ...counts,
      deadline: p.deadline?.toISOString() ?? null,
    }),
  };
};

/** Every project this person can see, with progress and whether it is at risk. */
export async function listProjects(
  ctx: AgentContext,
  a: { include_archived?: boolean },
) {
  const rows = (
    await pool.query<ProjectRow>(
      `${PROJECT_SELECT} WHERE ${VISIBLE_PROJECTS}
         ${a.include_archived ? "" : "AND p.status <> 'archived'"}
       ORDER BY p.status = 'archived', p.deadline NULLS LAST, p.updated_at DESC
       LIMIT 50`,
      [ctx.user.id],
    )
  ).rows;
  return { projects: rows.map((p) => projectView(p, ctx.timezone)) };
}

/**
 * One project in full: its stages and the open tasks in each, its notes by
 * title, and the decisions and promises kept beside it — flagging decisions
 * that no task delivers yet.
 */
export async function getProject(ctx: AgentContext, a: { project_id: string }) {
  if (!isUuid(a.project_id))
    throw new Error("Use a project id from list_projects.");
  const project = (
    await pool.query<ProjectRow>(
      `${PROJECT_SELECT} WHERE p.id = $2 AND ${VISIBLE_PROJECTS}`,
      [ctx.user.id, a.project_id],
    )
  ).rows[0];
  if (!project) throw new Error("No project with that id in this workspace.");
  const [stages, tasks, notes, records] = await Promise.all([
    pool.query<{ id: string; name: string }>(
      "SELECT id, name FROM project_stages WHERE project_id = $1 ORDER BY position",
      [a.project_id],
    ),
    pool.query<{
      id: string;
      title: string;
      status: string;
      priority: string;
      due_at: Date | null;
      end_at: Date | null;
      stage_id: string | null;
    }>(
      `SELECT i.id, i.title, i.status, i.priority, i.due_at, i.end_at, i.stage_id
         FROM items i WHERE i.project_id = $2 AND ${VISIBLE_ITEMS}
        ORDER BY (i.status IN ('done', 'cancelled')), i.due_at NULLS LAST
        LIMIT 200`,
      [ctx.user.id, a.project_id],
    ),
    pool.query<{ id: string; title: string; updated_at: Date }>(
      `SELECT id, title, updated_at FROM docs WHERE project_id = $1
        ORDER BY updated_at DESC LIMIT 20`,
      [a.project_id],
    ),
    pool.query<{
      kind: string;
      title: string;
      status: string;
      due_at: Date | null;
      linked_item_id: string | null;
    }>(
      `SELECT kind, title, status, due_at, linked_item_id FROM work_records
        WHERE project_id = $1 AND status IN ('proposed', 'open')
        ORDER BY created_at DESC LIMIT 30`,
      [a.project_id],
    ),
  ]);
  const task = (t: (typeof tasks.rows)[number]) => ({
    id: t.id,
    title: clean(t.title, 200),
    status: t.status,
    priority: t.priority,
    when: whenLabel(t.due_at, t.end_at, ctx.timezone),
  });
  const inStage = (id: string | null) =>
    tasks.rows.filter((t) => t.stage_id === id && !isClosed(t.status));
  return {
    ...projectView(project, ctx.timezone),
    summary: clean(project.summary, 600),
    stages: [
      ...stages.rows.map((s) => ({
        name: clean(s.name, 80),
        open_tasks: inStage(s.id).map(task),
      })),
      { name: "No stage", open_tasks: inStage(null).map(task) },
    ].filter((s) => s.open_tasks.length),
    finished_tasks: tasks.rows.filter((t) => isClosed(t.status)).length,
    notes: notes.rows.map((d) => ({ id: d.id, title: clean(d.title, 120) })),
    open_records: records.rows.map((r) => ({
      kind: r.kind,
      title: clean(r.title, 200),
      status: r.status,
      due: r.due_at ? localDate(r.due_at, ctx.timezone) : null,
      ...(r.kind === "decision" && !r.linked_item_id
        ? { gap: "No task delivers this decision yet." }
        : {}),
    })),
  };
}

/**
 * Free stretches of working time over the coming days, around events,
 * booked time and focus blocks, within the person's working hours.
 */
export async function findFreeTime(
  ctx: AgentContext,
  a: { start_date?: string; days?: number; min_minutes?: number },
) {
  const prefs = await loadPrefs(pool, ctx.user.id);
  const now = new Date();
  const start = a.start_date
    ? Date.parse(toInstant(a.start_date, ctx.timezone))
    : now.getTime();
  if (Number.isNaN(start)) throw new Error("start_date must be YYYY-MM-DD.");
  const from = new Date(Math.max(now.getTime(), start));
  const to = new Date(from.getTime() + (a.days ?? 3) * 86_400_000);
  const busy = await busyIntervals(pool, ctx.user.id, from, to, {
    blocks: true,
    derived: true,
  });
  const min = (a.min_minutes ?? 30) * 60_000;
  const slots = freeSpans(workingSpans(prefs, from, to), busy).filter(
    (s) => s.end - s.start >= min,
  );
  return {
    working_hours: `${prefs.work_start}–${prefs.work_end}`,
    free: slots.slice(0, 30).map((s) => ({
      when: whenLabel(new Date(s.start), new Date(s.end), ctx.timezone),
      minutes: Math.round((s.end - s.start) / 60_000),
    })),
    total_free_minutes: Math.round(
      slots.reduce((n, s) => n + (s.end - s.start), 0) / 60_000,
    ),
  };
}

/**
 * What's on the calendar: the user's own events and their subscribed
 * calendars' (a class timetable, exams, shifts, meetings, holidays), with
 * titles, so the assistant can answer "what's on Thursday?" or plan around a
 * lecture. Read only; subscribed events can't be changed from Orbyn.
 */
export async function getCalendar(
  ctx: AgentContext,
  a: { start_date?: string; days?: number },
) {
  const now = new Date();
  const start = a.start_date
    ? Date.parse(toInstant(a.start_date, ctx.timezone))
    : Date.parse(toInstant(localDate(now, ctx.timezone), ctx.timezone));
  if (Number.isNaN(start)) throw new Error("start_date must be YYYY-MM-DD.");
  const from = new Date(start);
  const to = new Date(start + (a.days ?? 1) * 86_400_000);
  const entries = await agendaEntries(pool, ctx.user.id, from, to);
  return {
    from: localDate(from, ctx.timezone),
    days: a.days ?? 1,
    events: entries.slice(0, 80).map((e) => ({
      title: clean(e.title, 120),
      when: e.all_day
        ? `${localDate(new Date(e.start_at), ctx.timezone)} (all day)`
        : whenLabel(new Date(e.start_at), new Date(e.end_at), ctx.timezone),
      ...(e.location ? { location: clean(e.location, 80) } : {}),
      busy: e.busy,
      from:
        e.source === "subscription"
          ? `subscribed calendar "${e.calendar}"${e.calendar_kind ? ` (${e.calendar_kind})` : ""}, read only`
          : "your calendar",
      ...(e.item_id ? { item_id: e.item_id } : {}),
    })),
    ...(entries.length > 80 ? { more: entries.length - 80 } : {}),
  };
}

/**
 * What is waiting on people: tasks asked of this person or by them, open
 * promises, decisions with nothing delivering them, and how well plans have
 * held lately — the things a to-do list alone doesn't show.
 */
export async function followThrough(ctx: AgentContext) {
  const [asks, promises, decisions, reality] = await Promise.all([
    pool.query<{
      title: string;
      status: string;
      asked_by: string;
      asked_of: string;
      by_name: string;
      of_name: string;
      due_at: Date | null;
      counter_due_at: Date | null;
    }>(
      `SELECT i.title, a.status, a.asked_by, a.asked_of, by_u.name AS by_name,
              of_u.name AS of_name, a.due_at, a.counter_due_at
         FROM task_asks a
         JOIN items i ON i.id = a.item_id
         JOIN users by_u ON by_u.id = a.asked_by
         JOIN users of_u ON of_u.id = a.asked_of
        WHERE (a.asked_of = $1 OR a.asked_by = $1)
          AND a.status IN ('open', 'countered')
        ORDER BY a.updated_at DESC LIMIT 30`,
      [ctx.user.id],
    ),
    pool.query<{
      title: string;
      status: string;
      owner_id: string | null;
      created_by: string;
      owner_name: string | null;
      due_at: Date | null;
    }>(
      `SELECT w.title, w.status, w.owner_id, w.created_by, o.name AS owner_name, w.due_at
         FROM work_records w LEFT JOIN users o ON o.id = w.owner_id
        WHERE w.kind = 'promise' AND w.status IN ('proposed', 'open')
          AND (w.owner_id = $1 OR w.created_by = $1)
        ORDER BY w.due_at NULLS LAST LIMIT 30`,
      [ctx.user.id],
    ),
    pool.query<{ title: string; project_name: string | null }>(
      `SELECT w.title, p.name AS project_name
         FROM work_records w LEFT JOIN projects p ON p.id = w.project_id
        WHERE w.kind = 'decision' AND w.status = 'open' AND w.linked_item_id IS NULL
          AND ((w.team_id IS NULL AND w.created_by = $1)
            OR w.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
        ORDER BY w.created_at DESC LIMIT 20`,
      [ctx.user.id],
    ),
    planReality(pool, ctx.user.id),
  ]);
  const me = ctx.user.id;
  const day = (d: Date | null) => (d ? localDate(d, ctx.timezone) : null);
  return {
    asks_waiting_for_you: asks.rows
      .filter(
        (a) =>
          (a.asked_of === me && a.status === "open") ||
          (a.asked_by === me && a.status === "countered"),
      )
      .map((a) => ({
        task: clean(a.title, 200),
        from: clean(a.asked_by === me ? a.of_name : a.by_name, 80),
        by: day(a.status === "countered" ? a.counter_due_at : a.due_at),
        state:
          a.status === "countered"
            ? "they suggested other terms"
            : "asked of you",
      })),
    asks_waiting_on_others: asks.rows
      .filter(
        (a) =>
          (a.asked_by === me && a.status === "open") ||
          (a.asked_of === me && a.status === "countered"),
      )
      .map((a) => ({
        task: clean(a.title, 200),
        with: clean(a.asked_by === me ? a.of_name : a.by_name, 80),
        by: day(a.due_at),
      })),
    promises: promises.rows.map((p) => ({
      title: clean(p.title, 200),
      promised_by:
        p.owner_id === me ? "you" : clean(p.owner_name ?? "someone", 80),
      due: day(p.due_at),
      overdue: !!p.due_at && p.due_at.getTime() < Date.now(),
      awaiting_answer: p.status === "proposed",
    })),
    decisions_without_a_task: decisions.rows.map((d) => ({
      title: clean(d.title, 200),
      project: d.project_name ? clean(d.project_name, 80) : null,
    })),
    plans_kept_lately: reality.enough
      ? `${Math.round((reality.rate ?? 0) * 100)}% of time set aside for tasks went into them over the last ${reality.window_days} days`
      : "Not enough planned time yet to say how plans hold up.",
  };
}
