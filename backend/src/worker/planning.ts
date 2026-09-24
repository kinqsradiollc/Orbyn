import {
  clockMinutes,
  dayTime,
  localDateKey,
  nextOccurrence,
  weekdayOf,
} from "@orbyn/core";
import { pool } from "../db/pool.js";
import {
  agendaEntries,
  loadPrefs,
  timeBlocks,
} from "../modules/planner/calendar.js";
import { externalOccurrences } from "../modules/planner/subscriptions.js";
import {
  atRiskFor,
  openTasks,
  unfinishedBlocks,
} from "../modules/planner/plans.js";
import { remainingOf } from "../modules/planner/scheduler.js";
import { queueWebhooks } from "../lib/webhooks.js";
import { emailEnabled } from "./channels/email.js";

/**
 * Move repeating events whose current occurrence has ended on to the next
 * one, so reminders keep coming for every occurrence. The edit version stays
 * the same (nobody edited the event); the reminder version moves on.
 */
export async function advanceRepeating(now = new Date()) {
  const rows = (
    await pool.query<{
      id: string;
      due_at: Date;
      end_at: Date | null;
      rrule: string;
      timezone: string;
      series_start: Date | null;
      exdates: Date[];
    }>(
      // An occurrence moved on its own moves on once its own time has ended.
      `SELECT i.id, i.due_at, i.end_at, i.rrule, i.timezone, i.series_start, i.exdates
       FROM items i
       LEFT JOIN item_overrides o ON o.item_id = i.id AND o.occurrence = i.due_at
       WHERE i.rrule IS NOT NULL AND i.kind = 'event' AND i.status NOT IN ('done', 'cancelled')
         AND coalesce((o.data->>'end_at')::timestamptz, (o.data->>'due_at')::timestamptz,
                      i.end_at, i.due_at) < $1
         AND i.due_at > $1 - interval '30 days'
       LIMIT 200`,
      [now],
    )
  ).rows;
  for (const r of rows) {
    const length = r.end_at ? r.end_at.getTime() - r.due_at.getTime() : 0;
    // The first occurrence still running or yet to come.
    const next = nextOccurrence(
      r.series_start ?? r.due_at,
      r.rrule,
      r.timezone,
      new Date(Math.max(now.getTime() - length, r.due_at.getTime())),
      r.exdates,
    );
    if (!next) continue;
    await pool.query(
      `UPDATE items SET due_at = $2, end_at = $3, reminder_version = reminder_version + 1
       WHERE id = $1 AND due_at = $4`,
      [r.id, next, length ? new Date(next.getTime() + length) : null, r.due_at],
    );
  }
}

export type PlannerNoticeKind =
  "conflict" | "rollforward" | "at_risk" | "deadline" | "calendar";

/**
 * One planner notice: in the app always, and on push and email as the
 * person's `planner_notices` preference says (email only with SMTP set up).
 * The unique keys make it idempotent: `notifications_once` for notices about
 * an item, `notifications_planner_once` for roll-forward (no item).
 */
async function notify(
  n: {
    userId: string;
    itemId: string | null;
    kind: PlannerNoticeKind;
    ref: string;
    title: string;
    body: string;
  },
  email: boolean,
) {
  await pool.query(
    `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
       title, body, state, kind, ref)
     SELECT $1::uuid, $2::uuid, 0, c.channel, c.destination, $3, $4,
       CASE WHEN c.channel = 'inapp' THEN 'sent' ELSE 'pending' END, $5, $6
     FROM users u
     LEFT JOIN planner_prefs p ON p.user_id = u.id
     CROSS JOIN LATERAL (
       SELECT 'inapp' AS channel, u.id::text AS destination
       UNION ALL SELECT 'email', u.email
         WHERE $7::boolean AND coalesce((p.planner_notices->>'email')::boolean, false)
       UNION ALL SELECT 'push', d.token FROM devices d
         WHERE d.user_id = u.id AND coalesce((p.planner_notices->>'push')::boolean, true)
     ) c
     WHERE u.id = $1::uuid AND NOT u.disabled
     ON CONFLICT DO NOTHING`,
    [
      n.userId,
      n.itemId,
      n.title.slice(0, 200),
      n.body.slice(0, 2000),
      n.kind,
      n.ref,
      email,
    ],
  );
}

/** "Fri 2 Oct", for a task due on a whole day. */
const dayFormat = (timeZone: string) =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const whenFormat = (timeZone: string) =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * The people a scan covers, a page at a time in id order, so everyone is
 * reached however many there are. `sql` takes `params`, then the last id of
 * the page before (null for the first) and the page size, and must keep to
 * `user_id > after ORDER BY user_id LIMIT size`.
 */
async function* pagedUsers(sql: string, params: unknown[], pageSize: number) {
  let after: string | null = null;
  for (;;) {
    const rows: { user_id: string }[] = (
      await pool.query<{ user_id: string }>(sql, [...params, after, pageSize])
    ).rows;
    for (const r of rows) yield r.user_id;
    if (rows.length < pageSize) return;
    after = rows[rows.length - 1].user_id;
  }
}

/** People with a session in the next week, for the conflict scan. */
const UPCOMING_SESSIONS = `
  SELECT DISTINCT user_id FROM time_blocks
  WHERE start_at > $1 AND start_at < $2
    AND ($3::uuid IS NULL OR user_id > $3::uuid)
  ORDER BY user_id LIMIT $4`;

/**
 * Tell people when an event now overlaps time they set aside for a task, once
 * per block. The notice's `ref` is the block, so the apps can offer a one-tap
 * Reschedule. Everyone with a session in the next week is checked, a page of
 * people at a time.
 */
export async function scanConflicts(now = new Date(), pageSize = 500) {
  const horizon = new Date(now.getTime() + 7 * 86_400_000);
  const email = await emailEnabled();
  for await (const user_id of pagedUsers(
    UPCOMING_SESSIONS,
    [now, horizon],
    pageSize,
  )) {
    const [blocks, entries, prefs] = await Promise.all([
      timeBlocks(pool, user_id, now, horizon),
      agendaEntries(pool, user_id, now, horizon, { hidden: true }),
      loadPrefs(pool, user_id),
    ]);
    // Only busy time clashes, from your events or subscribed calendars.
    const events = entries.filter((e) => e.busy);
    const when = whenFormat(prefs.timezone);
    const nowIso = now.toISOString();
    for (const b of blocks) {
      if (b.start_at <= nowIso) continue;
      const clash = events.find(
        (e) => e.start_at < b.end_at && b.start_at < e.end_at,
      );
      if (!clash) continue;
      await notify(
        {
          userId: user_id,
          itemId: b.item_id,
          kind: "conflict",
          ref: b.id,
          title: `Conflict: ${b.title}`,
          body: `"${clash.title}" now overlaps your session for "${b.title}" on ${when.format(new Date(b.start_at))}. Reschedule it to your next free time?`,
        },
        email,
      );
    }
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const quoted = (titles: string[]) =>
  titles.length > 3
    ? `${titles
        .slice(0, 3)
        .map((t) => `"${t}"`)
        .join(", ")} and ${titles.length - 3} more`
    : titles.map((t) => `"${t}"`).join(", ");

/**
 * People with planner activity worth a notice: they use the planner (saved
 * settings or blocks in the last two weeks) and have either recent blocks to
 * roll forward or open tasks due in the next two weeks. A task counts until
 * its deadline (`deadlineOf`): its end time when it has one, and the end of
 * its day when it's all-day (a day and an hour after its midnight here, to
 * cover a daylight-saving change; the notices check exactly).
 */
const ACTIVE_USERS = `
  SELECT a.user_id FROM (
    SELECT user_id FROM planner_prefs
    UNION SELECT user_id FROM time_blocks WHERE end_at > $1::timestamptz - interval '14 days'
  ) a JOIN users u ON u.id = a.user_id AND NOT u.disabled
  WHERE ($2::uuid[] IS NULL OR a.user_id = ANY ($2::uuid[]))
    AND (EXISTS (SELECT 1 FROM time_blocks b WHERE b.user_id = a.user_id
                  AND b.end_at > $1::timestamptz - interval '14 days' AND b.end_at < $1)
      OR EXISTS (SELECT 1 FROM items i WHERE i.kind = 'task' AND i.status NOT IN ('done', 'cancelled')
                  AND coalesce(i.end_at, i.due_at + CASE WHEN i.all_day
                        THEN interval '25 hours' ELSE interval '0 hours' END) > $1
                  AND i.due_at < $1::timestamptz + interval '14 days'
                  AND ((i.team_id IS NULL AND i.user_id = a.user_id) OR i.assignee_id = a.user_id)))
    AND ($3::uuid IS NULL OR a.user_id > $3::uuid)
  ORDER BY a.user_id LIMIT $4`;

/**
 * The planner's daily notices, each at most once a day (the `ref` is the
 * person's local date):
 *
 * - roll forward: from their working start on a working day, when blocks
 *   from earlier days are unfinished (once per person);
 * - at risk: a task's remaining estimate is more than the free time before
 *   it's due (once per task);
 * - due soon: a task is due within `deadline_notice_days` and has no time set
 *   aside for what's left of it (once per task, not for tasks already at risk).
 *
 * Everyone active is reached, a page of people at a time. `only` limits the
 * scan to some people (tests and manual runs).
 */
export async function scanPlanningNotices(
  now = new Date(),
  only?: string[],
  pageSize = 1000,
) {
  const email = await emailEnabled();
  for await (const user_id of pagedUsers(
    ACTIVE_USERS,
    [now, only ?? null],
    pageSize,
  )) {
    const prefs = await loadPrefs(pool, user_id);
    const tz = prefs.timezone;
    const today = localDateKey(now, tz);
    const when = whenFormat(tz);
    /**
     * A deadline in words, in this person's zone: its day and time, or for
     * an all-day task the day it's due by (its deadline is the midnight
     * after, so the minute before names the day).
     */
    const dueWords = (deadline: string, allDay: boolean) =>
      allDay
        ? dayFormat(tz).format(new Date(Date.parse(deadline) - 60_000))
        : when.format(new Date(deadline));

    const workStart = dayTime(today, clockMinutes(prefs.work_start), tz);
    if (now >= workStart && prefs.work_days.includes(weekdayOf(today))) {
      const sent = await pool.query(
        `SELECT 1 FROM notifications
         WHERE user_id = $1 AND kind = 'rollforward' AND ref = $2 AND channel = 'inapp'`,
        [user_id, today],
      );
      if (!sent.rowCount) {
        const blocks = await unfinishedBlocks(
          pool,
          user_id,
          dayTime(today, 0, tz),
        );
        const titles = [...new Set(blocks.map((b) => b.title))];
        if (blocks.length)
          await notify(
            {
              userId: user_id,
              itemId: null,
              kind: "rollforward",
              ref: today,
              title: "Unfinished work to roll forward",
              body: `${plural(blocks.length, "session")} from earlier didn't get finished: ${quoted(titles)}. Roll forward to plan time for ${titles.length === 1 ? "it" : "them"}?`,
            },
            email,
          );
      }
    }

    const atRisk = await atRiskFor(pool, user_id, now);
    for (const t of atRisk) {
      await notify(
        {
          userId: user_id,
          itemId: t.item_id,
          kind: "at_risk",
          ref: today,
          title: `At risk: ${t.title}`,
          body: `${t.reason} It's due ${dueWords(
            t.deadline_at ?? t.due_at!,
            !!t.due_all_day,
          )}. Plan it?`,
        },
        email,
      );
      // With the notice, once per task per day, to this person's webhooks.
      await queueWebhooks(
        pool,
        "task.at_risk",
        { user_id, team_id: null },
        {
          item_id: t.item_id,
          title: t.title,
          due_at: t.due_at,
          deadline_at: t.deadline_at ?? null,
          remaining_minutes: t.remaining_minutes,
          free_minutes: t.free_minutes,
          reason: t.reason,
        },
        `at_risk:${t.item_id}:${today}`,
      );
    }

    const days = prefs.deadline_notice_days ?? 1;
    if (!days) continue;
    const horizon = now.getTime() + days * 86_400_000;
    const flagged = new Set(atRisk.map((t) => t.item_id));
    for (const t of await openTasks(pool, user_id)) {
      if (!t.deadline_at || flagged.has(t.id)) continue;
      const due = Date.parse(t.deadline_at);
      if (due <= now.getTime() || due > horizon) continue;
      const left = remainingOf(t) - t.scheduled_minutes;
      // Time already blocked out for the rest of it: nothing to warn about.
      if (left <= 0) continue;
      await notify(
        {
          userId: user_id,
          itemId: t.id,
          kind: "deadline",
          ref: today,
          title: `Due soon: ${t.title}`,
          body: `"${t.title}" is due ${dueWords(
            t.deadline_at,
            !!t.due_all_day,
          )}, and no session is planned for it yet. Plan it?`,
        },
        email,
      );
    }
  }
}

/**
 * Reminders for events on subscribed calendars that ask for them (exams the
 * day before, meetings ten minutes before, or whatever you chose). Each
 * occurrence is reminded once, recorded in external_reminders; one missed
 * by more than a few minutes (the worker was down) is skipped rather than
 * sent late.
 */
export async function remindSubscribed(now = new Date()) {
  const subs = (
    await pool.query<{
      id: string;
      user_id: string;
      name: string;
      reminder_minutes: number;
    }>(
      `SELECT s.id, s.user_id, s.name, s.reminder_minutes FROM calendar_subscriptions s
         JOIN users u ON u.id = s.user_id AND NOT u.disabled
       WHERE s.reminder_minutes IS NOT NULL LIMIT 2000`,
    )
  ).rows;
  if (!subs.length) return 0;
  const byUser = new Map<string, typeof subs>();
  for (const sub of subs)
    byUser.set(sub.user_id, [...(byUser.get(sub.user_id) ?? []), sub]);
  const email = await emailEnabled();
  const grace = 5 * 60_000;
  let sent = 0;
  for (const [userId, mine] of byUser) {
    const reminders = new Map(mine.map((m) => [m.id, m]));
    const longest = Math.max(...mine.map((m) => m.reminder_minutes));
    const [occurrences, prefs] = await Promise.all([
      externalOccurrences(
        pool,
        userId,
        new Date(now.getTime() - grace),
        new Date(now.getTime() + (longest + 1) * 60_000),
      ),
      loadPrefs(pool, userId),
    ]);
    const when = whenFormat(prefs.timezone);
    for (const o of occurrences) {
      const sub = reminders.get(o.subscription_id);
      if (!sub) continue;
      const start = Date.parse(o.start_at);
      const due = start - sub.reminder_minutes * 60_000;
      if (now.getTime() < due || now.getTime() > due + grace) continue;
      const claimed = await pool.query(
        `INSERT INTO external_reminders (subscription_id, uid, starts_at)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [o.subscription_id, o.uid, o.start_at],
      );
      if (!claimed.rowCount) continue;
      await notify(
        {
          userId,
          itemId: null,
          kind: "calendar",
          ref: `${o.subscription_id}:${o.start_at}:${o.uid}`.slice(0, 500),
          title: o.title || sub.name,
          body: `${o.all_day ? "All day" : when.format(new Date(start))}${o.location ? ` · ${o.location}` : ""} · ${sub.name}`,
        },
        email,
      );
      sent++;
    }
  }
  return sent;
}
