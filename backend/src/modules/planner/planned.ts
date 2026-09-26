import {
  deadlineFit,
  deadlineOf,
  planningDeadline,
  endsAfterDeadline,
  isClosed,
  remainingOf,
  sessionDueFor,
  splitSessions,
  type DeadlineFit,
  type Kind,
  type PlannedFeed,
  type PlannedTask,
  type SeriesSource,
  type Status,
} from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";
import { busyIntervals, loadPrefs } from "./calendar.js";
import { FREE_LOOKAHEAD_DAYS, freeSpans, workingSpans } from "./free.js";
import { CHILD_COLUMNS } from "./plans.js";
import { dependentTargets } from "./targets.js";

/**
 * The planned feed: your planned time, task by task, with each task's one
 * "does it fit?" status, worked out the way a task's Sessions card does it
 * (`itemSessions`), but for many tasks at once. Task rows read it for
 * "Planned 9:15" and their status chip, "Tasks to place" for what's still
 * to plan, and the Today list for its chips. It's kept out of the task
 * itself: sessions change without the task changing, and devices sync tasks
 * by when they last changed.
 */

/** What a task's status is worked out from. */
export type FitRow = SeriesSource & {
  id: string;
  title: string;
  kind: Kind;
  status: Status;
  estimate_minutes: number | null;
  project_deadline: Date | null;
  dependent_deadline?: string | null;
  spent_minutes: number;
  open_children: number;
  children_remaining: number;
  /** Yours to plan: your own, or assigned to you. */
  mine: boolean;
  /** You have sessions for it, past or future. */
  has_sessions: boolean;
};

/** The columns for a `FitRow`, on alias `i`, with the user as `$1`. */
export const FIT_COLUMNS = `i.id, i.title, i.kind, i.status, i.due_at, i.end_at, i.all_day,
  i.timezone, i.rrule, i.series_start, i.exdates, i.estimate_minutes, i.spent_minutes,
  (SELECT p.deadline FROM projects p WHERE p.id = i.project_id) AS project_deadline,
  (CASE WHEN i.team_id IS NULL THEN i.user_id = $1 ELSE i.assignee_id = $1 END) AS mine,
  EXISTS (SELECT 1 FROM time_blocks x WHERE x.item_id = i.id AND x.user_id = $1) AS has_sessions,
  ${CHILD_COLUMNS}`;

type Span = { id: string; item_id: string; start_at: string; end_at: string };

/**
 * Your sessions for these tasks that haven't ended by `now`, plus those in
 * [from, to) when a window is given, soonest first, by task.
 */
export async function sessionsFor(
  db: Db,
  userId: string,
  itemIds: string[],
  now: Date,
  window?: { from: Date; to: Date } | null,
): Promise<Map<string, Span[]>> {
  const out = new Map<string, Span[]>();
  if (!itemIds.length) return out;
  const rows = (
    await db.query<{
      id: string;
      item_id: string;
      start_at: Date;
      end_at: Date;
    }>(
      `SELECT id, item_id, start_at, end_at FROM time_blocks
       WHERE user_id = $1 AND item_id = ANY($2::uuid[])
         AND (end_at > $3 OR ($4::timestamptz IS NOT NULL AND start_at < $5 AND end_at > $4))
       ORDER BY start_at, id`,
      [userId, itemIds, now, window?.from ?? null, window?.to ?? null],
    )
  ).rows;
  for (const b of rows) {
    const span = {
      id: b.id,
      item_id: b.item_id,
      start_at: b.start_at.toISOString(),
      end_at: b.end_at.toISOString(),
    };
    out.set(b.item_id, [...(out.get(b.item_id) ?? []), span]);
  }
  return out;
}

/** How much of a task's time still to come counts, and its status. */
export type TaskFit = {
  planned_minutes: number;
  late_minutes: number;
  fit: DeadlineFit | null;
};

/**
 * Each task's planned time and status. A status is told only for an open
 * task that's yours to plan or has your sessions (as on its Sessions card).
 * Free time before a deadline is worked out once, for the two weeks ahead,
 * and used only for tasks short of time and due within them: sessions are
 * busy, as for the planner, the review and the daily notice, so all of them
 * measure the same room.
 */
export async function fitsFor(
  db: Db,
  userId: string,
  rows: FitRow[],
  sessions: Map<string, Span[]>,
  now = new Date(),
): Promise<Map<string, TaskFit>> {
  const out = new Map<string, TaskFit>();
  const dependent = await dependentTargets(
    db,
    userId,
    rows.map((row) => row.id),
  );
  const short: { id: string; input: Parameters<typeof deadlineFit>[0] }[] = [];
  const horizon = now.getTime() + FREE_LOOKAHEAD_DAYS * 86_400_000;
  for (const r of rows) {
    r.dependent_deadline = dependent.get(r.id) ?? null;
    const ahead = (sessions.get(r.id) ?? []).filter(
      (s) => Date.parse(s.end_at) > now.getTime(),
    );
    const latest = planningDeadline(r.project_deadline, r.dependent_deadline);
    const split = splitSessions(r, ahead, now, latest);
    const told =
      r.kind === "task" && !isClosed(r.status) && (r.mine || r.has_sessions);
    if (!told) {
      out.set(r.id, {
        planned_minutes: split.planned_minutes,
        late_minutes: split.late_minutes,
        fit: null,
      });
      continue;
    }
    const deadline = planningDeadline(deadlineOf(r), latest);
    const input = {
      deadline_at: deadline,
      needed_minutes: remainingOf(r),
      planned_minutes: split.planned_minutes,
      late_minutes: split.late_minutes,
      estimated: r.estimate_minutes != null,
      now,
    };
    const fit = deadlineFit(input);
    out.set(r.id, {
      planned_minutes: split.planned_minutes,
      late_minutes: split.late_minutes,
      fit,
    });
    if (
      fit.short_minutes &&
      fit.status !== "overdue" &&
      fit.status !== "no_deadline" &&
      deadline &&
      Date.parse(deadline) <= horizon
    )
      short.push({ id: r.id, input });
  }
  if (!short.length) return out;
  const to = new Date(horizon);
  const [prefs, busy] = await Promise.all([
    loadPrefs(db, userId),
    busyIntervals(db, userId, now, to, { blocks: true, derived: true }),
  ]);
  const free = freeSpans(workingSpans(prefs, now, to), busy);
  for (const { id, input } of short) {
    const dueAt = Date.parse(input.deadline_at!);
    const freeMinutes = Math.round(
      free.reduce(
        (sum, s) =>
          sum + Math.max(0, Math.min(s.end, dueAt) - s.start) / 60_000,
        0,
      ),
    );
    out.set(id, {
      ...out.get(id)!,
      fit: deadlineFit({ ...input, free_minutes: freeMinutes }),
    });
  }
  return out;
}

/** Tasks the feed lists without `item_ids`, at most. */
const FEED_LIMIT = 500;

/**
 * `GET /planned`: with `item_ids`, those tasks (any you can see); without,
 * every open task that's yours to plan, plus any task with a session of
 * yours in the window. With a window (`from` and `to`), each task lists your
 * sessions in it.
 */
export async function plannedFeed(
  db: Db,
  userId: string,
  q: { item_ids?: string[]; from?: string; to?: string },
  now = new Date(),
): Promise<PlannedFeed> {
  const window =
    q.from && q.to ? { from: new Date(q.from), to: new Date(q.to) } : null;
  const rows = (
    await db.query<FitRow>(
      `SELECT ${FIT_COLUMNS}
       FROM items i
       WHERE ${VISIBLE_ITEMS} AND i.kind = 'task' AND (
         CASE WHEN $2::uuid[] IS NOT NULL THEN i.id = ANY ($2::uuid[])
         ELSE (i.status NOT IN ('done', 'cancelled')
               AND ((i.team_id IS NULL AND i.user_id = $1) OR i.assignee_id = $1))
           OR ($3::timestamptz IS NOT NULL AND EXISTS (
                SELECT 1 FROM time_blocks b WHERE b.item_id = i.id AND b.user_id = $1
                  AND b.start_at < $4 AND b.end_at > $3))
         END)
       ORDER BY i.due_at NULLS LAST, i.created_at, i.id
       LIMIT ${FEED_LIMIT}`,
      [userId, q.item_ids ?? null, window?.from ?? null, window?.to ?? null],
    )
  ).rows;
  const sessions = await sessionsFor(
    db,
    userId,
    rows.map((r) => r.id),
    now,
    window,
  );
  const fits = await fitsFor(db, userId, rows, sessions, now);
  const tasks: PlannedTask[] = rows.map((r) => {
    const mine = sessions.get(r.id) ?? [];
    const dueFor = sessionDueFor(r);
    const next = mine.find((s) => Date.parse(s.end_at) > now.getTime());
    const f = fits.get(r.id)!;
    return {
      item_id: r.id,
      sessions: window
        ? mine
            .filter(
              (s) =>
                Date.parse(s.start_at) < window.to.getTime() &&
                Date.parse(s.end_at) > window.from.getTime(),
            )
            .map((s) => ({
              id: s.id,
              start_at: s.start_at,
              end_at: s.end_at,
              after_deadline: endsAfterDeadline(
                s.end_at,
                planningDeadline(
                  dueFor(s.end_at)?.deadline_at,
                  planningDeadline(r.project_deadline, r.dependent_deadline),
                ),
              ),
            }))
        : [],
      next: next ? { start_at: next.start_at, end_at: next.end_at } : null,
      planned_minutes: f.planned_minutes,
      late_minutes: f.late_minutes,
      fit: f.fit,
    };
  });
  return {
    from: window ? window.from.toISOString() : null,
    to: window ? window.to.toISOString() : null,
    tasks,
  };
}
