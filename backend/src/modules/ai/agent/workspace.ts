import {
  deadlineOf,
  isClosed,
  priorityScore,
  projectPlanStatus,
  projectProgress,
  type AssistantSource,
} from "@orbyn/core";
import { pool } from "../../../db/pool.js";
import { VISIBLE_ITEMS } from "../../../lib/teams.js";
import {
  agendaEntries,
  busyIntervals,
  loadPrefs,
  timeBlocks,
} from "../../planner/calendar.js";
import { externalEntries } from "../../planner/subscriptions.js";
import {
  LIVE_CARDS,
  studyOverview,
  syncCards,
  upcomingExams,
} from "../../study/service.js";
import {
  freeSpans,
  largestFreeMinutes,
  workingSpans,
} from "../../planner/plans.js";
import { planReality } from "../../followthrough/reality.js";
import { PROJECT_COUNTS } from "../../projects/counts.js";
import { projectPlanning } from "../../projects/planning.js";
import { withSessionFacts } from "../../planner/sessions.js";
import { clean, isUuid, localDate, toInstant, whenLabel } from "./format.js";
import type { AgentContext } from "./tools.js";
import { assistantMayRead, docVisibleTo } from "../../../lib/doc-visibility.js";
import { readableLinks } from "../../links/privacy.js";

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
  all_day: boolean;
  timezone: string;
  estimate_minutes: number | null;
  spent_minutes: number;
  team_name: string | null;
  project_name: string | null;
  list_name: string | null;
};

/**
 * When a task is due by (`deadlineOf`: the end of the day for an all-day
 * task, the end time for one that has it), as an ISO string or null.
 */
const deadlineOfRow = (row: TaskRow) =>
  deadlineOf({
    due_at: row.due_at,
    end_at: row.end_at,
    all_day: row.all_day,
    timezone: row.timezone,
  });

/** Why a task ranks where it does, in words a person would use. */
function reasons(row: TaskRow, now: Date, timezone: string) {
  const out: string[] = [];
  // Overdue once the deadline has passed: not during an all-day task's day.
  const deadline = deadlineOfRow(row);
  const due = deadline ? Date.parse(deadline) : undefined;
  if (due !== undefined && due < now.getTime()) out.push("overdue");
  else if (due !== undefined) {
    const days = (due - now.getTime()) / 86_400_000;
    // The day it's due on: an all-day deadline is the midnight after it.
    const dueDay = new Date(due - (row.all_day ? 60_000 : 0));
    if (localDate(dueDay, timezone) === localDate(now, timezone))
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
    i.all_day, i.timezone, i.estimate_minutes, i.spent_minutes, t.name AS team_name,
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
          deadline_at: deadlineOfRow(r),
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
      "The app's own priority score: 3 x priority + 4 x urgency (rises over the week before the deadline; an all-day task is due by the end of its day, one with an end time when it ends) + 2 once the deadline has passed + how well the remaining estimate fits today's largest free stretch; started work rises, blocked work sinks.",
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
  doc_id: string | null;
  team_id: string | null;
  status: string;
  deadline: Date | null;
  team_name: string | null;
  task_count: number;
  done_count: number;
  updated_at: Date;
};

const PROJECT_SELECT = `SELECT p.id, p.name, p.summary, p.doc_id, p.team_id,
    p.status, p.deadline, p.updated_at,
    t.name AS team_name,
    ${PROJECT_COUNTS}
  FROM projects p LEFT JOIN teams t ON t.id = p.team_id`;
const VISIBLE_PROJECTS = `((p.team_id IS NULL AND p.user_id = $1)
  OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;
/** Pages `$1` can open (as docs/routes.ts): their own, and their teams'. */
const VISIBLE_DOCS = `((d.team_id IS NULL AND d.user_id = $1)
  OR d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;
/** Work records `$1` can open (as work-records/routes.ts). */
const VISIBLE_RECORDS = `((w.team_id IS NULL AND w.created_by = $1)
  OR w.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

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
  };
};

/** How many projects' plans list_projects checks, nearest deadline first. */
const RISK_CHECKS = 12;

/**
 * At risk the way the project page's strip says it (`projectPlanStatus`):
 * the person's part isn't fully planned before the deadline. Only active
 * projects with a deadline can be; finished tasks never count.
 */
async function projectRisk(userId: string, p: ProjectRow) {
  if (p.status !== "active" || !p.deadline) return false;
  const planning = await projectPlanning(
    pool,
    userId,
    { id: p.id, deadline: p.deadline, team_id: p.team_id },
    false,
  );
  return projectPlanStatus(planning)?.status === "not_fully_planned";
}

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
  const checked = new Set(
    rows
      .filter((p) => p.status === "active" && p.deadline)
      .sort((a, b) => a.deadline!.getTime() - b.deadline!.getTime())
      .slice(0, RISK_CHECKS)
      .map((p) => p.id),
  );
  const risks = new Map(
    await Promise.all(
      rows
        .filter((p) => checked.has(p.id))
        .map(async (p) => [p.id, await projectRisk(ctx.user.id, p)] as const),
    ),
  );
  return {
    projects: rows.map((p) => ({
      ...projectView(p, ctx.timezone),
      // Unchecked (no deadline, not active, or beyond the nearest few): left out.
      ...(risks.has(p.id) ? { at_risk: risks.get(p.id) } : {}),
    })),
  };
}

/**
 * One project in full: its stages and the open tasks in each, its notes by
 * title, and the decisions and promises kept beside it — flagging decisions
 * that no task delivers yet.
 */
export async function getProject(ctx: AgentContext, a: { project_id: string }) {
  if (
    ctx.scope?.kind === "project" &&
    !ctx.allowOutsideScope &&
    a.project_id !== ctx.scope.id
  )
    throw new Error("This conversation is scoped to a different project.");
  if (!isUuid(a.project_id))
    throw new Error("Use a project id from list_projects.");
  const project = (
    await pool.query<ProjectRow>(
      `${PROJECT_SELECT} WHERE p.id = $2 AND ${VISIBLE_PROJECTS}`,
      [ctx.user.id, a.project_id],
    )
  ).rows[0];
  if (!project) throw new Error("No project with that id in this workspace.");
  const now = new Date();
  const [stages, tasks, notes, records, plan, upcoming] = await Promise.all([
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
    pool.query<{
      id: string;
      title: string;
      updated_at: Date;
      lines: { id?: string; text?: string }[];
    }>(
      `SELECT d.id, d.title, d.updated_at,
              coalesce((SELECT jsonb_agg(x.block ORDER BY x.pos)
                FROM (SELECT b.block, b.pos FROM jsonb_array_elements(d.content)
                  WITH ORDINALITY AS b(block, pos)
                  WHERE nullif(btrim(b.block->>'text'), '') IS NOT NULL
                  ORDER BY b.pos LIMIT 4) x), '[]'::jsonb) AS lines
         FROM docs d
        WHERE d.project_id = $2
          AND ${docVisibleTo("$1")} AND ${assistantMayRead("d")}
        ORDER BY (d.id = $3) DESC, d.updated_at DESC LIMIT 20`,
      [ctx.user.id, a.project_id, project.doc_id],
    ),
    pool.query<{
      id: string;
      kind: string;
      title: string;
      status: string;
      due_at: Date | null;
      linked_item_id: string | null;
    }>(
      `SELECT w.id, w.kind, w.title, w.status, w.due_at, w.linked_item_id FROM work_records w
        WHERE w.project_id = $2 AND ${VISIBLE_RECORDS} AND w.status IN ('proposed', 'open')
        ORDER BY w.created_at DESC LIMIT 30`,
      [ctx.user.id, a.project_id],
    ),
    projectPlanning(pool, ctx.user.id, project, false, now),
    timeBlocks(
      pool,
      ctx.user.id,
      now,
      new Date(now.getTime() + 14 * 86_400_000),
    ),
  ]);
  const ownSessions = await withSessionFacts(
    pool,
    ctx.user.id,
    upcoming.filter((session) =>
      tasks.rows.some((task) => task.id === session.item_id),
    ),
  );
  // The first lines of the project's pages, with the words of links this
  // person can't open read "Private page" (D3aF).
  const pages = await readableLinks(pool, ctx.user.id, notes.rows);
  const cite = (key: string, source: AssistantSource) => {
    if (!ctx.cited) return null;
    const number = ctx.cited.get(key)?.number ?? ctx.cited.size + 1;
    ctx.cited.set(key, { ...source, number });
    return `[${number}]`;
  };
  const task = (t: (typeof tasks.rows)[number]) => ({
    id: t.id,
    title: clean(t.title, 200),
    status: t.status,
    priority: t.priority,
    when: whenLabel(t.due_at, t.end_at, ctx.timezone),
    source_ref: cite(`task:${t.id}`, {
      kind: "task",
      id: t.id,
      title: clean(t.title, 200),
      quote: whenLabel(t.due_at, t.end_at, ctx.timezone) ?? "No deadline",
    }),
  });
  const inStage = (id: string | null) =>
    tasks.rows.filter((t) => t.stage_id === id && !isClosed(t.status));
  return {
    ...projectView(project, ctx.timezone),
    summary: clean(project.summary, 600),
    stages: [
      ...stages.rows.map((s) => ({
        id: s.id,
        name: clean(s.name, 80),
        open_tasks: inStage(s.id).map(task),
      })),
      { id: null, name: "No stage", open_tasks: inStage(null).map(task) },
    ],
    finished_tasks: tasks.rows.filter((t) => isClosed(t.status)).length,
    brief:
      pages
        .find((d) => d.id === project.doc_id)
        ?.lines.map((line) => clean(line.text, 200)) ?? [],
    notes: pages.map((d) => ({
      id: d.id,
      title: clean(d.title, 120),
      first_lines: d.lines.slice(0, 2).map((line) => ({
        block_id: line.id ?? null,
        text: clean(line.text, 160),
      })),
    })),
    your_plan: plan,
    your_sessions: ownSessions.slice(0, 12).map((session) => ({
      id: session.id,
      task_id: session.item_id,
      start_at: session.start_at,
      end_at: session.end_at,
      deadline_at: session.planning_deadline_at ?? null,
      after_deadline: session.after_deadline ?? false,
    })),
    open_records: records.rows.map((r) => ({
      id: r.id,
      source_ref:
        r.kind === "decision"
          ? cite(`decision:${r.id}`, {
              kind: "decision",
              id: r.id,
              project_id: project.id,
              title: clean(r.title, 200),
              quote: r.status,
            })
          : null,
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
      ? `${Math.round((reality.rate ?? 0) * 100)}% of session time went into its task over the last ${reality.window_days} days`
      : "Not enough planned time yet to say how plans hold up.",
  };
}

/** One calendar entry as the assistant sees it: when, what, and whose. */
function calendarLine(
  e: Awaited<ReturnType<typeof agendaEntries>>[number],
  timezone: string,
) {
  const start = new Date(e.start_at);
  return {
    when: e.all_day
      ? `${new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          weekday: "short",
          day: "numeric",
          month: "short",
        }).format(start)} (all day)`
      : whenLabel(start, new Date(e.end_at), timezone),
    title: clean(e.title, 120),
    ...(e.location ? { location: clean(e.location, 80) } : {}),
    calendar:
      e.source === "subscription"
        ? `${e.calendar}${e.calendar_kind ? ` (${e.calendar_kind})` : ""}`
        : "yours",
    ...(e.busy ? {} : { free: true }),
    ...(e.source === "subscription" ? { read_only: true } : {}),
  };
}

/**
 * What the next few days actually look like, for the assistant's overview:
 * every event on the calendar (your own, repeating ones expanded, and the
 * calendars you subscribe to — classes, shifts, exams), the time set aside
 * for tasks, and how much free working time is left today. Providers that
 * don't use tools answer from this alone, so it has to be the real day.
 */
export async function calendarGlance(ctx: AgentContext, days = 3) {
  const now = new Date();
  const start = Date.parse(
    toInstant(localDate(now, ctx.timezone), ctx.timezone),
  );
  const from = new Date(start);
  const to = new Date(start + days * 86_400_000);
  const endOfToday = new Date(start + 86_400_000);
  const [entries, blocks, prefs, busy] = await Promise.all([
    agendaEntries(pool, ctx.user.id, from, to),
    timeBlocks(pool, ctx.user.id, from, to),
    loadPrefs(pool, ctx.user.id),
    busyIntervals(pool, ctx.user.id, now, endOfToday, {
      blocks: true,
      derived: true,
    }),
  ]);
  const free =
    now < endOfToday
      ? freeSpans(workingSpans(prefs, now, endOfToday), busy).filter(
          (s) => s.end - s.start >= 15 * 60_000,
        )
      : [];
  return {
    calendar: entries.slice(0, 40).map((e) => calendarLine(e, ctx.timezone)),
    ...(entries.length > 40 ? { calendar_more: entries.length - 40 } : {}),
    set_aside: blocks
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
      .slice(0, 12)
      .map((b) => ({
        when: whenLabel(new Date(b.start_at), new Date(b.end_at), ctx.timezone),
        title: clean(b.title, 120),
      })),
    free_today: {
      minutes: Math.round(
        free.reduce((n, s) => n + (s.end - s.start), 0) / 60_000,
      ),
      stretches: free
        .slice(0, 5)
        .map((s) =>
          whenLabel(new Date(s.start), new Date(s.end), ctx.timezone),
        ),
    },
  };
}

/**
 * Events on subscribed calendars whose titles share words with a request, in
 * the next two months, so "when is my Research Methods lecture?" is answered
 * from the timetable without a tool call.
 */
export async function calendarMatches(ctx: AgentContext, words: string[]) {
  if (!words.length) return [];
  const now = new Date();
  const to = new Date(now.getTime() + 60 * 86_400_000);
  const seen = new Set<string>();
  const found: Awaited<ReturnType<typeof externalEntries>> = [];
  for (const word of words.slice(0, 6))
    for (const e of await externalEntries(pool, ctx.user.id, now, to, {
      visible: true,
      words: [`%${word.replace(/[\\%_]/g, "\\$&")}%`],
    })) {
      const key = `${e.subscription_id}|${e.start_at}|${e.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(e);
    }
  // The soonest ones: the next lecture, not all thirteen weeks of it.
  return found
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .slice(0, 10)
    .map((e) =>
      calendarLine(
        {
          source: "subscription",
          item_id: null,
          title: e.title,
          start_at: e.start_at,
          end_at: e.end_at,
          all_day: e.all_day,
          location: e.location,
          busy: e.busy,
          calendar: e.name,
          calendar_kind: e.calendar_kind ?? null,
        },
        ctx.timezone,
      ),
    );
}

/**
 * Study at a glance for the overview: cards due, and the next exam with how
 * ready the attached pages are. Null when the person has no cards, so the
 * overview stays small for everyone else.
 */
export async function studyGlance(ctx: AgentContext) {
  await syncCards(pool, ctx.user.id);
  const counts = (
    await pool.query<{ cards: number; due: number }>(
      `SELECT count(*)::int AS cards,
              count(*) FILTER (WHERE c.due_at <= now() + interval '12 hours')::int AS due
         FROM ${LIVE_CARDS} WHERE c.user_id = $1`,
      [ctx.user.id],
    )
  ).rows[0];
  if (!counts.cards) return null;
  const exams = await upcomingExams(pool, ctx.user.id);
  return {
    cards: counts.cards,
    due_soon: counts.due,
    next_exams: exams.slice(0, 3).map((e) => ({
      title: clean(e.title, 120),
      when: e.all_day
        ? localDate(new Date(e.starts_at), ctx.timezone)
        : whenLabel(new Date(e.starts_at), null, ctx.timezone),
      days_left: e.days_left,
    })),
  };
}

/**
 * Study in full, read only: each page with cards and how many are due, new
 * and known; upcoming exams with the pages attached and how ready they are;
 * and the cards forgotten most. For "what should I revise", "am I ready for
 * my exam". Planning revision and adding cards happen in Study, approved there.
 */
export async function getStudy(ctx: AgentContext) {
  const s = await studyOverview(ctx.user.id);
  return {
    due_today: s.due_today,
    new_cards_today: s.new_cards,
    reviewed_today: s.reviewed_today,
    streak_days: s.streak,
    pages_with_cards: s.decks.slice(0, 20).map((d) => ({
      title: clean(d.title, 120),
      cards: d.cards,
      due: d.due,
      new: d.new,
      known_well: d.known,
    })),
    exams: s.exams.slice(0, 8).map((e) => ({
      title: clean(e.title, 120),
      when: e.all_day
        ? localDate(new Date(e.starts_at), ctx.timezone)
        : whenLabel(new Date(e.starts_at), null, ctx.timezone),
      days_left: e.days_left,
      pages_attached: e.doc_ids.length,
      readiness:
        e.readiness == null
          ? "no pages attached"
          : `${Math.round(e.readiness * 100)}% known well`,
    })),
    forgotten_most: s.weak.map((w) => ({
      question: clean(w.question, 160),
      page: clean(w.doc_title, 120),
      times_forgotten: w.lapses,
    })),
  };
}
