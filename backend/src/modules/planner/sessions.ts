import {
  deadlineOf,
  endsAfterDeadline,
  fail,
  numberSessions,
  sessionDueFor,
  type ItemSessions,
  type PlannedBlock,
  type SessionDue,
  type TimeBlock,
} from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";

/**
 * Sessions with what they're for: the task's deadline (or the occurrence's,
 * for a repeating task), whether the session ends after it, the project, and
 * its number among all of your sessions for the task. Worked out here, on
 * top of the plain lists (`timeBlocks()` stays as it is, because busy time,
 * feeds, digests and the assistant read it and need none of this).
 */

/** A task's dates, to tell which due date each session is for. */
type SeriesRow = {
  id: string;
  due_at: Date | null;
  end_at: Date | null;
  all_day: boolean;
  timezone: string;
  rrule: string | null;
  series_start: Date | null;
  exdates: Date[] | null;
  project_id: string | null;
};

type Span = { id?: string; item_id: string; start_at: string; end_at: string };

type Facts = Required<
  Pick<
    TimeBlock,
    | "due_at"
    | "due_all_day"
    | "deadline_at"
    | "project_id"
    | "part"
    | "parts"
    | "after_deadline"
  >
>;

const iso = (v: Date | string) => new Date(v).toISOString();

async function seriesOf(db: Db, itemIds: string[]) {
  const rows = (
    await db.query<SeriesRow>(
      `SELECT id, due_at, end_at, all_day, timezone, rrule, series_start, exdates, project_id
       FROM items WHERE id = ANY($1::uuid[])`,
      [itemIds],
    )
  ).rows;
  return new Map(rows.map((r) => [r.id, r]));
}

/** Every session `userId` has for these tasks, past and future. */
async function sessionsOf(db: Db, userId: string, itemIds: string[]) {
  return (
    await db.query<{
      id: string;
      item_id: string;
      start_at: Date;
      end_at: Date;
    }>(
      `SELECT id, item_id, start_at, end_at FROM time_blocks
       WHERE user_id = $1 AND item_id = ANY($2::uuid[])`,
      [userId, itemIds],
    )
  ).rows.map((b) => ({
    id: b.id,
    item_id: b.item_id,
    start_at: iso(b.start_at),
    end_at: iso(b.end_at),
  }));
}

/**
 * The facts for each of `spans`, numbered together per task (and, for a
 * repeating task, per occurrence). Spans of tasks not in `series` get none.
 */
function factsFor<T extends Span>(
  series: Map<string, SeriesRow>,
  spans: T[],
): Map<T, Facts> {
  const dueFor = new Map<string, (end: string) => SessionDue | null>();
  for (const s of series.values())
    dueFor.set(
      s.id,
      sessionDueFor({
        due_at: s.due_at,
        end_at: s.end_at,
        all_day: s.all_day,
        timezone: s.timezone,
        rrule: s.rrule,
        series_start: s.series_start,
        exdates: s.exdates,
      }),
    );
  const known = spans.filter((s) => series.has(s.item_id));
  const due = new Map(known.map((s) => [s, dueFor.get(s.item_id)!(s.end_at)]));
  const numbers = numberSessions(
    known,
    (s) => `${s.item_id}|${due.get(s)?.deadline_at ?? ""}`,
  );
  const out = new Map<T, Facts>();
  for (const s of known) {
    const d = due.get(s) ?? null;
    const n = numbers.get(s)!;
    out.set(s, {
      due_at: d?.due_at ?? null,
      due_all_day: !!d && series.get(s.item_id)!.all_day,
      deadline_at: d?.deadline_at ?? null,
      project_id: series.get(s.item_id)!.project_id,
      part: n.part,
      parts: n.parts,
      after_deadline: endsAfterDeadline(s.end_at, d?.deadline_at),
    });
  }
  return out;
}

/**
 * `blocks` (all `userId`'s) with their deadline, number and project added.
 * Two small queries, whatever the number of blocks.
 */
export async function withSessionFacts(
  db: Db,
  userId: string,
  blocks: TimeBlock[],
): Promise<TimeBlock[]> {
  if (!blocks.length) return blocks;
  const ids = [...new Set(blocks.map((b) => b.item_id))];
  const [series, all] = await Promise.all([
    seriesOf(db, ids),
    sessionsOf(db, userId, ids),
  ]);
  // A block saved a moment ago may not be in `all` yet on a replica.
  const byId = new Map(all.map((b) => [b.id, b]));
  for (const b of blocks)
    if (!byId.has(b.id)) {
      const span = {
        id: b.id,
        item_id: b.item_id,
        start_at: b.start_at,
        end_at: b.end_at,
      };
      all.push(span);
      byId.set(b.id, span);
    }
  const facts = factsFor(series, all);
  return blocks.map((b) => {
    const f = facts.get(byId.get(b.id)!);
    return f ? { ...b, ...f } : b;
  });
}

/**
 * A plan's blocks numbered among the sessions each task already has, the
 * way they'll be numbered once saved: "Session 3 of 4" in the preview is
 * session 3 of 4 on the calendar. Tasks that don't exist (an assistant's
 * "what if") keep the plan's own numbers.
 */
export async function numberPlanBlocks(
  db: Db,
  userId: string,
  blocks: PlannedBlock[],
): Promise<PlannedBlock[]> {
  if (!blocks.length) return blocks;
  const ids = [...new Set(blocks.map((b) => b.item_id))];
  const [series, saved] = await Promise.all([
    seriesOf(db, ids),
    sessionsOf(db, userId, ids),
  ]);
  const planned = blocks.map((b, n) => ({
    id: `~${String(n).padStart(4, "0")}`,
    item_id: b.item_id,
    start_at: iso(b.start_at),
    end_at: iso(b.end_at),
    block: b,
  }));
  const facts = factsFor(series, [...saved, ...planned]);
  return planned.map((p) => {
    const f = facts.get(p);
    return f ? { ...p.block, part: f.part, parts: f.parts } : p.block;
  });
}

/**
 * Your sessions for one task you can see, past ones too, and how much of the
 * time still to come ends by its deadline. For a repeating task, the
 * sessions of occurrences already finished are left out.
 */
export async function itemSessions(
  db: Db,
  userId: string,
  itemId: string,
  now = new Date(),
): Promise<ItemSessions> {
  const item = (
    await db.query<{
      id: string;
      due_at: Date | null;
      end_at: Date | null;
      all_day: boolean;
      timezone: string;
      rrule: string | null;
      project_deadline: Date | null;
    }>(
      `SELECT i.id, i.due_at, i.end_at, i.all_day, i.timezone, i.rrule, p.deadline AS project_deadline
       FROM items i LEFT JOIN projects p ON p.id = i.project_id
       WHERE i.id = $2 AND ${VISIBLE_ITEMS}`,
      [userId, itemId],
    )
  ).rows[0];
  if (!item) fail(404, "Item not found");
  const deadline = deadlineOf(item);
  const rows = (
    await db.query<TimeBlock>(
      `SELECT b.id, b.item_id, b.user_id, b.start_at, b.end_at, b.source, b.plan_id,
              i.title, i.status, i.kind, i.priority, i.team_id, i.list_id, i.estimate_minutes
       FROM time_blocks b JOIN items i ON i.id = b.item_id
       WHERE b.user_id = $1 AND b.item_id = $2
       ORDER BY b.start_at, b.id`,
      [userId, itemId],
    )
  ).rows.map((b) => ({
    ...b,
    start_at: iso(b.start_at),
    end_at: iso(b.end_at),
  }));
  const all = await withSessionFacts(db, userId, rows);
  // A repeating task's current occurrence is its deadline; sessions for
  // occurrences before it belong to work already finished.
  const sessions =
    item.rrule && deadline
      ? all.filter((s) => !s.deadline_at || s.deadline_at >= deadline)
      : all;
  const upcoming = (s: TimeBlock) =>
    Math.max(
      0,
      (Date.parse(s.end_at) - Math.max(Date.parse(s.start_at), now.getTime())) /
        60_000,
    );
  let planned = 0;
  let late = 0;
  for (const s of sessions) {
    if (s.after_deadline) late += upcoming(s);
    // For a repeating task, only the current occurrence's time counts.
    else if (!deadline || !s.deadline_at || s.deadline_at <= deadline)
      planned += upcoming(s);
  }
  return {
    item_id: item.id,
    due_at: item.due_at ? iso(item.due_at) : null,
    due_all_day: !!item.due_at && item.all_day,
    deadline_at: deadline,
    project_deadline: item.project_deadline ? iso(item.project_deadline) : null,
    sessions,
    planned_minutes: Math.round(planned),
    late_minutes: Math.round(late),
  };
}
