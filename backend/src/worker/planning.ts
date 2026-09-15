import { nextOccurrence } from "@orbyn/core";
import { pool } from "../db/pool.js";
import {
  calendarEntries,
  loadPrefs,
  timeBlocks,
} from "../modules/planner/calendar.js";

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
  for (const { user_id } of users) {
    const [blocks, entries, prefs] = await Promise.all([
      timeBlocks(pool, user_id, now, horizon),
      calendarEntries(pool, user_id, now, horizon),
      loadPrefs(pool, user_id),
    ]);
    const events = entries.filter(
      (e) => e.kind === "event" && e.status !== "done" && e.end_at,
    );
    const when = new Intl.DateTimeFormat("en-AU", {
      timeZone: prefs.timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
    const nowIso = now.toISOString();
    for (const b of blocks) {
      if (b.start_at <= nowIso) continue;
      const clash = events.find(
        (e) => e.start_at < b.end_at && b.start_at < e.end_at!,
      );
      if (!clash) continue;
      await pool.query(
        `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
           title, body, state, kind, ref)
         VALUES ($1::uuid, $2, 0, 'inapp', $1::text, $3, $4, 'sent', 'conflict', $5)
         ON CONFLICT (item_id, item_version, channel, destination, kind, ref) DO NOTHING`,
        [
          user_id,
          b.item_id,
          `Conflict: ${b.title}`,
          `"${clash.title}" now overlaps the time set aside for "${b.title}" on ${when.format(new Date(b.start_at))}. Reschedule it to your next free time?`,
          b.id,
        ],
      );
    }
  }
}
