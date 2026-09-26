import {
  dayBounds,
  todayDue,
  todayList,
  TODAY_LATE_SHOWN,
  type CalendarEntry,
  type DeadlineFit,
  type ExternalEntry,
  type TodayInput,
  type TodayList,
} from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import {
  inSpaces,
  Params,
  scopeFor,
  visibleItems,
  type Spaces,
} from "../../lib/visibility.js";
import { calendarEntries, loadPrefs, timeBlocks } from "./calendar.js";
import { FIT_COLUMNS, fitsFor, sessionsFor, type FitRow } from "./planned.js";
import { unfinishedBlocks } from "./plans.js";
import { withSessionFacts } from "./sessions.js";
import { externalEntries } from "./subscriptions.js";

/** Open tasks looked at for "due today" and "late", at most. */
const DUE_LIMIT = 1000;

/** What the Today list is made from, gathered once (see {@link todaySources}). */
export type TodaySources = {
  /** The zone whose day it is, and the day's first and last moments. */
  zone: string;
  from: Date;
  to: Date;
  /** The day's calendar entries in reach (events and everything drawn). */
  entries: CalendarEntry[];
  /** Subscribed calendars' shown events on the day. */
  subscribed: ExternalEntry[];
  /** The input to core's todayList(). */
  input: TodayInput;
};

/**
 * Everything the Today list for one person (`todayList` in core) is made
 * from: the day's events (yours, your teams' and your subscribed calendars'
 * shown ones), your sessions, your tasks due today and late ones (yours, or
 * assigned to you), each with its status, and unfinished sessions from
 * earlier days (the review's rule, so nothing new is stored). The day is
 * `timezone`'s, or the planner's when not given. It only reads.
 *
 * `spaces` narrows it to some of the person's spaces (an agent connection
 * that reaches only some teams, or not Personal): nothing outside them is
 * listed, and subscribed calendars come only with Personal. The app's own
 * `GET /today` and the agents' get_today both come through here, so the two
 * lists never drift apart.
 */
export async function todaySources(
  db: Db,
  userId: string,
  now = new Date(),
  timezone?: string,
  spaces?: Spaces,
): Promise<TodaySources> {
  const zone = timezone ?? (await loadPrefs(db, userId)).timezone;
  const { from, to } = dayBounds(now, zone);
  const reach = (teamId: string | null) => !spaces || inSpaces(spaces, teamId);
  // Open tasks of yours dated before the day ends, latest first.
  const p = new Params();
  const scope = spaces ? scopeFor(spaces, p) : { user: p.add(userId) };
  const before = p.add(to);
  const [entries, subscribed, blocks, dueRows, unfinished] = await Promise.all([
    calendarEntries(db, userId, from, to).then((e) =>
      e.filter((x) => reach(x.team_id)),
    ),
    !spaces || spaces.personal
      ? externalEntries(db, userId, from, to, { visible: true })
      : Promise.resolve([]),
    timeBlocks(db, userId, from, to).then((b) =>
      withSessionFacts(
        db,
        userId,
        b.filter((x) => reach(x.team_id)),
      ),
    ),
    db.query<FitRow>(
      `SELECT ${FIT_COLUMNS}
       FROM items i
       WHERE ${visibleItems("i", scope)} AND i.kind = 'task'
         AND i.status NOT IN ('done', 'cancelled') AND i.due_at IS NOT NULL
         AND i.due_at < ${before}
         AND ((i.team_id IS NULL AND i.user_id = ${scope.user}) OR i.assignee_id = ${scope.user})
       ORDER BY i.due_at DESC, i.id
       LIMIT ${DUE_LIMIT}`,
      p.values,
    ),
    unfinishedBlocks(db, userId, from, now).then((b) =>
      b.filter((x) => reach(x.team_id)),
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

  return {
    zone,
    from,
    to,
    entries,
    subscribed,
    input: {
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
    },
  };
}

/** The Today list for one person (`GET /today`): core's todayList() over {@link todaySources}. */
export async function todayFor(
  db: Db,
  userId: string,
  now = new Date(),
  timezone?: string,
  spaces?: Spaces,
): Promise<TodayList> {
  return todayList(
    (await todaySources(db, userId, now, timezone, spaces)).input,
  );
}
