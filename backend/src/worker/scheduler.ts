import { transaction } from "../db/pool.js";
import { expireInvites } from "../modules/booking/invites.js";
import { emailEnabled } from "./channels/email.js";

/**
 * Queue reminders for every open item whose next alert has come due: one
 * row per recipient, channel and destination. Personal items notify their
 * owner; team items notify every active team member, each with the due time
 * in their own planner time zone. An item can have up to five alerts; each
 * cycle queues the latest one whose time has passed (an item created ten
 * minutes before it's due gets one reminder, not every earlier alert), and
 * the reminder's `ref` is that alert's minutes. The unique key on
 * (item_id, item_version, channel, destination, kind, ref) makes this
 * idempotent, so any number of workers can run it. A repeating item's
 * current occurrence follows its own changes (time, title, alerts) and is
 * skipped when it was cancelled. Also sweeps expired sessions and proposals.
 */
export async function enqueue() {
  await transaction(async (db) => {
    // Serialize schedulers; delivery workers still run concurrently.
    await db.query("SELECT pg_advisory_xact_lock(786240)");
    await db.query(
      `INSERT INTO notifications(user_id,item_id,item_version,channel,destination,title,body,state,ref)
   SELECT u.id,i.id,i.reminder_version,c.channel,c.destination,'Coming up: '||x.title,
    x.title||' — '||CASE WHEN i.all_day
      THEN split_part(orbyn_local_time(x.at,i.timezone),',',1)||' (all day)'
      ELSE orbyn_local_time(x.at,COALESCE(p.timezone,'UTC')) END
      ||COALESCE(' · '||t.name,''),
    CASE WHEN c.channel='inapp' THEN 'sent' ELSE 'pending' END,
    a.minutes::text
   FROM items i
   LEFT JOIN item_overrides o ON o.item_id=i.id AND o.occurrence=i.due_at AND i.rrule IS NOT NULL
   CROSS JOIN LATERAL (
    SELECT COALESCE((o.data->>'due_at')::timestamptz,i.due_at) AS at,
     COALESCE(o.data->>'title',i.title) AS title,
     CASE WHEN o.data ? 'alerts'
      THEN ARRAY(SELECT v::int FROM jsonb_array_elements_text(o.data->'alerts') v)
      ELSE i.alerts::int[] END AS alerts
   ) x
   -- The latest alert whose time has come; earlier ones went out before (or are moot).
   CROSS JOIN LATERAL (
    SELECT min(m) AS minutes FROM unnest(x.alerts) m WHERE x.at-make_interval(mins=>m)<=now()
   ) a
   LEFT JOIN teams t ON t.id=i.team_id
   CROSS JOIN LATERAL (
    SELECT i.user_id AS user_id WHERE i.team_id IS NULL
    UNION SELECT m.user_id FROM team_members m WHERE m.team_id=i.team_id
   ) r
   JOIN users u ON u.id=r.user_id AND NOT u.disabled
   LEFT JOIN planner_prefs p ON p.user_id=u.id
   CROSS JOIN LATERAL (
    SELECT 'inapp' AS channel,u.id::text AS destination
    UNION ALL SELECT 'email',u.email WHERE u.email_reminders AND $1::boolean
    UNION ALL SELECT 'push',d.token FROM devices d WHERE d.user_id=u.id
   ) c WHERE i.status NOT IN ('done', 'cancelled') AND i.due_at IS NOT NULL AND a.minutes IS NOT NULL
    AND NOT (i.due_at = ANY (i.exdates))
    -- Bounded by the longest alert (4 weeks) plus a day of catch-up, so each
    -- cycle scans a small index range, not every item ever created.
    AND i.due_at > now() - interval '30 days'
    AND i.due_at <= now() + interval '29 days'
    AND x.at > now() - interval '1 day'
   ON CONFLICT(item_id,item_version,channel,destination,kind,ref) DO NOTHING`,
      [await emailEnabled()],
    );
    // Reminders to bookers before confirmed bookings, by email: the latest
    // value whose time has come, once per booking, start time and value, and
    // none whose time had already passed when the booking was made.
    await db.query(
      `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
         title, body, state, kind, ref)
       SELECT coalesce(p.owner_id, oi.owner_id), NULL, 0, 'email', b.email,
         'Reminder: ' || coalesce(p.title, oi.title), '', 'pending', 'booker_reminder',
         b.id || ':' || round(extract(epoch FROM b.start_at))::bigint || ':' || r.minutes
       FROM bookings b
       LEFT JOIN booking_pages p ON p.id = b.page_id
       LEFT JOIN open_invites oi ON oi.id = b.invite_id
       CROSS JOIN LATERAL (
         SELECT min(m) AS minutes
         FROM unnest(coalesce(p.remind_before_minutes, oi.remind_before_minutes)) m
         WHERE b.start_at - make_interval(mins => m) <= now()
           AND b.start_at - make_interval(mins => m) > b.created_at
       ) r
       WHERE $1::boolean AND b.status = 'confirmed' AND r.minutes IS NOT NULL
         AND b.start_at > now() AND b.start_at <= now() + interval '8 days'
       ON CONFLICT DO NOTHING`,
      [await emailEnabled()],
    );
    // A reminder when a session starts, for people who asked for one
    // (planner_prefs.session_reminder_minutes): in the app and on their
    // phones, once per session and start time. A session moved later gets
    // a reminder for its new time; one already started gets none.
    await db.query(
      `INSERT INTO notifications (user_id, item_id, item_version, channel,
         destination, title, body, state, kind, ref)
       SELECT b.user_id, b.item_id, 0, c.channel, c.destination,
         left(CASE WHEN p.session_reminder_minutes = 0 THEN 'Session starting: '
           ELSE 'Session in ' || p.session_reminder_minutes || ' min: ' END || i.title, 200),
         lower(to_char(b.start_at AT TIME ZONE p.timezone, 'FMHH12:MI am')) || '–' ||
           lower(to_char(b.end_at AT TIME ZONE p.timezone, 'FMHH12:MI am')) ||
           coalesce(' · ' || pr.name, ''),
         CASE WHEN c.channel = 'inapp' THEN 'sent' ELSE 'pending' END,
         'session', b.id || ':' || round(extract(epoch FROM b.start_at))::bigint
       FROM time_blocks b
       JOIN planner_prefs p ON p.user_id = b.user_id
         AND p.session_reminder_minutes IS NOT NULL
       JOIN users u ON u.id = b.user_id AND NOT u.disabled
       JOIN items i ON i.id = b.item_id
       LEFT JOIN projects pr ON pr.id = i.project_id
       CROSS JOIN LATERAL (
         SELECT 'inapp' AS channel, u.id::text AS destination
         UNION ALL SELECT 'push', d.token FROM devices d WHERE d.user_id = u.id
       ) c
       WHERE b.start_at > now() - interval '5 minutes'
         AND b.start_at <= now() + interval '61 minutes'
         AND b.start_at - make_interval(mins => p.session_reminder_minutes) <= now()
         AND b.started_at IS NULL
         AND i.status NOT IN ('done', 'cancelled')
         AND ((i.team_id IS NULL AND i.user_id = b.user_id)
           OR i.team_id IN (SELECT team_id FROM team_members WHERE user_id = b.user_id))
       ON CONFLICT DO NOTHING`,
    );
    await expireInvites(db);
    // Expired and outdated records are cleared hourly by the sweeper
    // (lib/sweep.ts), in slices, rather than on every cycle.
  });
}
