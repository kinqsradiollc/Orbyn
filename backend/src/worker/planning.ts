import {
  clockMinutes,
  dayTime,
  localDateKey,
  nextOccurrence,
  weekdayOf,
} from "@orbyn/core";
import { pool } from "../db/pool.js";
import {
  calendarEntries,
  loadPrefs,
  timeBlocks,
} from "../modules/planner/calendar.js";
import {
  atRiskFor,
  openTasks,
  unfinishedBlocks,
} from "../modules/planner/plans.js";
import { DEFAULT_ESTIMATE_MINUTES } from "../modules/planner/scheduler.js";
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
      `SELECT id, due_at, end_at, rrule, timezone, series_start, exdates FROM items
       WHERE rrule IS NOT NULL AND kind = 'event' AND status <> 'done'
         AND coalesce(end_at, due_at) < $1 AND due_at > $1 - interval '30 days'
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
  "conflict" | "rollforward" | "at_risk" | "deadline";

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
 * Tell people when an event now overlaps time they set aside for a task, once
 * per block. The notice's `ref` is the block, so the apps can offer a one-tap
 * Reschedule.
 */
export async function scanConflicts(now = new Date()) {
  const horizon = new Date(now.getTime() + 7 * 86_400_000);
  const users = (
    await pool.query<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM time_blocks
       WHERE start_at > $1 AND start_at < $2 LIMIT 500`,
      [now, horizon],
    )
  ).rows;
  const email = await emailEnabled();
  for (const { user_id } of users) {
    const [blocks, entries, prefs] = await Promise.all([
      timeBlocks(pool, user_id, now, horizon),
      calendarEntries(pool, user_id, now, horizon),
      loadPrefs(pool, user_id),
    ]);
    const events = entries.filter(
      (e) => e.kind === "event" && e.status !== "done" && e.end_at,
    );
    const when = whenFormat(prefs.timezone);
    const nowIso = now.toISOString();
    for (const b of blocks) {
      if (b.start_at <= nowIso) continue;
      const clash = events.find(
        (e) => e.start_at < b.end_at && b.start_at < e.end_at!,
      );
      if (!clash) continue;
      await notify(
        {
          userId: user_id,
          itemId: b.item_id,
          kind: "conflict",
          ref: b.id,
          title: `Conflict: ${b.title}`,
          body: `"${clash.title}" now overlaps the time set aside for "${b.title}" on ${when.format(new Date(b.start_at))}. Reschedule it to your next free time?`,
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
 * roll forward or open tasks due in the next two weeks.
 */
const ACTIVE_USERS = `
  SELECT a.user_id FROM (
    SELECT user_id FROM planner_prefs
    UNION SELECT user_id FROM time_blocks WHERE end_at > $1::timestamptz - interval '14 days'
  ) a JOIN users u ON u.id = a.user_id AND NOT u.disabled
  WHERE ($2::uuid[] IS NULL OR a.user_id = ANY ($2::uuid[]))
    AND (EXISTS (SELECT 1 FROM time_blocks b WHERE b.user_id = a.user_id
                  AND b.end_at > $1::timestamptz - interval '14 days' AND b.end_at < $1)
      OR EXISTS (SELECT 1 FROM items i WHERE i.kind = 'task' AND i.status <> 'done'
                  AND i.due_at > $1 AND i.due_at < $1::timestamptz + interval '14 days'
                  AND ((i.team_id IS NULL AND i.user_id = a.user_id) OR i.assignee_id = a.user_id)))
  ORDER BY a.user_id LIMIT 1000`;

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
 * `only` limits the scan to some people (tests and manual runs).
 */
export async function scanPlanningNotices(now = new Date(), only?: string[]) {
  const users = (
    await pool.query<{ user_id: string }>(ACTIVE_USERS, [now, only ?? null])
  ).rows;
  const email = await emailEnabled();
  for (const { user_id } of users) {
    const prefs = await loadPrefs(pool, user_id);
    const tz = prefs.timezone;
    const today = localDateKey(now, tz);
    const when = whenFormat(tz);

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
              body: `${plural(blocks.length, "block")} from earlier didn't get finished: ${quoted(titles)}. Roll forward to plan time for ${titles.length === 1 ? "it" : "them"}?`,
            },
            email,
          );
      }
    }

    const atRisk = await atRiskFor(pool, user_id, now);
    for (const t of atRisk)
      await notify(
        {
          userId: user_id,
          itemId: t.item_id,
          kind: "at_risk",
          ref: today,
          title: `At risk: ${t.title}`,
          body: `${t.reason} It's due ${when.format(new Date(t.due_at!))}. Plan it?`,
        },
        email,
      );

    const days = prefs.deadline_notice_days ?? 1;
    if (!days) continue;
    const horizon = now.getTime() + days * 86_400_000;
    const flagged = new Set(atRisk.map((t) => t.item_id));
    for (const t of await openTasks(pool, user_id)) {
      if (!t.due_at || flagged.has(t.id)) continue;
      const due = Date.parse(t.due_at);
      if (due <= now.getTime() || due > horizon) continue;
      const left =
        (t.estimate_minutes ?? DEFAULT_ESTIMATE_MINUTES) -
        t.spent_minutes -
        t.scheduled_minutes;
      // Time already blocked out for the rest of it: nothing to warn about.
      if (left <= 0) continue;
      await notify(
        {
          userId: user_id,
          itemId: t.id,
          kind: "deadline",
          ref: today,
          title: `Due soon: ${t.title}`,
          body: `"${t.title}" is due ${when.format(new Date(due))}, and there's no time set aside for it yet. Plan it?`,
        },
        email,
      );
    }
  }
}
