import {
  dayBounds,
  todayDue,
  todayList,
  TODAY_LATE_SHOWN,
  type DeadlineFit,
  type TodayList,
} from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";
import { calendarEntries, loadPrefs, timeBlocks } from "./calendar.js";
import { FIT_COLUMNS, fitsFor, sessionsFor, type FitRow } from "./planned.js";
import { unfinishedBlocks } from "./plans.js";
import { withSessionFacts } from "./sessions.js";
import { externalEntries } from "./subscriptions.js";

/** Open tasks looked at for "due today" and "late", at most. */
const DUE_LIMIT = 1000;

/**
 * The Today list for one person (`todayList` in core): the day's events
 * (yours, your teams' and your subscribed calendars' shown ones), your
 * sessions, your tasks due today and late ones (yours, or assigned to you),
 * each with its status, and unfinished sessions from earlier days (the
 * review's rule, so nothing new is stored). The day is `timezone`'s, or the
 * planner's when not given. It only reads.
 */
export async function todayFor(
  db: Db,
  userId: string,
  now = new Date(),
  timezone?: string,
): Promise<TodayList> {
  const zone = timezone ?? (await loadPrefs(db, userId)).timezone;
  const { from, to } = dayBounds(now, zone);
  const [entries, subscribed, blocks, dueRows, unfinished] = await Promise.all([
    calendarEntries(db, userId, from, to),
    externalEntries(db, userId, from, to, { visible: true }),
    timeBlocks(db, userId, from, to).then((b) =>
      withSessionFacts(db, userId, b),
    ),
    // Open tasks of yours dated before the day ends, latest first.
    db.query<FitRow>(
      `SELECT ${FIT_COLUMNS}
       FROM items i
       WHERE ${VISIBLE_ITEMS} AND i.kind = 'task'
         AND i.status NOT IN ('done', 'cancelled') AND i.due_at IS NOT NULL
         AND i.due_at < $2
         AND ((i.team_id IS NULL AND i.user_id = $1) OR i.assignee_id = $1)
       ORDER BY i.due_at DESC, i.id
       LIMIT ${DUE_LIMIT}`,
      [userId, to],
    ),
    // A session checked in as done for today isn't unfinished.
    unfinishedBlocks(db, userId, from, now).then((rows) =>
      rows.filter((b) => b.outcome !== "done"),
    ),
  ]);

  // Statuses only for the tasks the list names: due today, the latest late
  // ones, and any with a session today.
  const due = dueRows.rows
    .map((r) => ({ r, when: todayDue(r, now, zone) }))
    .filter((x) => x.when);
  const named = [
    ...due.filter((x) => x.when === "today").map((x) => x.r),
    ...due
      .filter((x) => x.when === "late")
      .slice(0, TODAY_LATE_SHOWN)
      .map((x) => x.r),
  ];
  const planned = new Set(blocks.map((b) => b.item_id));
  const alsoPlanned = due
    .filter((x) => x.when === "late" && planned.has(x.r.id))
    .map((x) => x.r)
    .filter((r) => !named.includes(r));
  const needFit = [...named, ...alsoPlanned];
  const sessions = await sessionsFor(
    db,
    userId,
    needFit.map((r) => r.id),
    now,
  );
  const fits = await fitsFor(db, userId, needFit, sessions, now);
  const fitById: Record<string, DeadlineFit | null> = {};
  for (const [id, f] of fits) fitById[id] = f.fit;

  return todayList({
    now,
    timezone: zone,
    events: [
      ...entries
        .filter((e) => e.kind === "event")
        .map((e) => ({
          item_id: e.item_id,
          title: e.title,
          start_at: e.start_at,
          end_at: e.end_at,
          all_day: !!e.all_day,
          occurrence: e.occurrence,
          status: e.status,
        })),
      ...subscribed.map((e) => ({
        item_id: null,
        title: e.title,
        start_at: e.start_at,
        end_at: e.end_at,
        all_day: e.all_day,
        calendar: e.name,
      })),
    ],
    sessions: blocks.map((b) => ({
      id: b.id,
      item_id: b.item_id,
      title: b.title,
      start_at: b.start_at,
      end_at: b.end_at,
      status: b.status,
      kind: b.kind,
      part: b.part,
      parts: b.parts,
      due_at: b.due_at ?? null,
      due_all_day: !!b.due_all_day,
      deadline_at: b.deadline_at ?? null,
      after_deadline: !!b.after_deadline,
    })),
    tasks: due.map(({ r }) => ({
      id: r.id,
      title: r.title,
      kind: "task" as const,
      status: r.status,
      due_at: r.due_at,
      end_at: r.end_at,
      all_day: r.all_day,
      timezone: r.timezone,
    })),
    fits: fitById,
    unfinished: unfinished.map((b) => ({
      id: b.id,
      item_id: b.item_id,
      title: b.title,
      start_at: b.start_at,
      end_at: b.end_at,
    })),
  });
}
