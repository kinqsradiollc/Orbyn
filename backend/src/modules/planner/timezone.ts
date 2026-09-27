import { dayZone, isTimeZone, localDateKey } from "@orbyn/core";
import { pool, type Queryable } from "../../db/pool.js";

/**
 * The zone someone's days are read in (core's `dayZone`): their planner
 * zone, the same one the agenda, digests and agents use. `device` (the
 * zone an app says it is in) counts only while the account has none of its
 * own yet. It only reads.
 */
export async function dayZoneFor(
  db: Queryable,
  userId: string,
  device?: string,
) {
  const row = (
    await db.query<{ timezone: string; timezone_chosen: boolean }>(
      "SELECT timezone, timezone_chosen FROM planner_prefs WHERE user_id = $1",
      [userId],
    )
  ).rows[0];
  return dayZone(row?.timezone, !!row?.timezone_chosen, device);
}

/**
 * Adopt the time zone of the device someone is using, unless they picked one
 * themselves in Planning settings. Everything the server writes in words —
 * agendas, digests, reminders — and working hours are read in the planner
 * zone, which defaulted to UTC for anyone who never opened those settings.
 *
 * On a change, subscribed calendars are read again in the new zone, and
 * today's agenda is dropped if it was never edited, so it's written again
 * with the right times the next time it's opened.
 */
export async function adoptDeviceZone(userId: string, timezone: string) {
  if (!timezone || !isTimeZone(timezone) || timezone === "UTC")
    return { adopted: false };
  const before =
    (
      await pool.query<{ timezone: string }>(
        "SELECT timezone FROM planner_prefs WHERE user_id = $1",
        [userId],
      )
    ).rows[0]?.timezone ?? "UTC";
  const changed = await pool.query(
    `INSERT INTO planner_prefs (user_id, timezone) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET timezone = EXCLUDED.timezone, updated_at = now()
       WHERE NOT planner_prefs.timezone_chosen
         AND planner_prefs.timezone IS DISTINCT FROM EXCLUDED.timezone
     RETURNING user_id`,
    [userId, timezone],
  );
  if (!changed.rowCount) return { adopted: false };
  await pool.query(
    `UPDATE calendar_subscriptions SET etag = NULL, last_modified = NULL,
       content_hash = NULL, last_fetched_at = NULL
     WHERE user_id = $1`,
    [userId],
  );
  // Only today's page (today as either zone has it), only if untouched,
  // and never one in Trash: other days' agendas — the diary, and a page just
  // asked for yesterday or tomorrow — stay as they are.
  const now = new Date();
  const zoneBefore = isTimeZone(before) ? before : "UTC";
  await pool.query(
    `DELETE FROM docs WHERE user_id = $1 AND kind = 'agenda' AND version = 1
       AND team_id IS NULL AND deleted_at IS NULL
       AND agenda_date = ANY ($2::date[])`,
    [
      userId,
      [
        ...new Set([
          localDateKey(now, zoneBefore),
          localDateKey(now, timezone),
        ]),
      ],
    ],
  );
  return { adopted: true };
}
