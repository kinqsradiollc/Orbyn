import { agendaTitle, isTimeZone } from "@orbyn/core";
import { pool } from "../../db/pool.js";

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
  // Only today's page (as either zone names it), and only if untouched:
  // earlier days' agendas are the diary and stay as they are.
  const now = new Date();
  await pool.query(
    `DELETE FROM docs WHERE user_id = $1 AND kind = 'agenda' AND version = 1
       AND title = ANY ($2::text[]) AND created_at > now() - interval '36 hours'`,
    [userId, [agendaTitle(now, before), agendaTitle(now, timezone)]],
  );
  return { adopted: true };
}
