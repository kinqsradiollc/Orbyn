import { transaction } from "../db/pool.js";
import { emailEnabled } from "./channels/email.js";

/**
 * Queue reminders for every open item whose reminder window has opened: one
 * row per recipient, channel and destination. Personal items notify their
 * owner; team items notify every active team member. The unique key on
 * (item_id, item_version, channel, destination) makes this idempotent, so any
 * number of workers can run it. Also sweeps expired sessions and proposals.
 */
export async function enqueue() {
  await transaction(async (db) => {
    // Serialize schedulers; delivery workers still run concurrently.
    await db.query("SELECT pg_advisory_xact_lock(786240)");
    await db.query(
      `INSERT INTO notifications(user_id,item_id,item_version,channel,destination,title,body,state)
   SELECT u.id,i.id,i.reminder_version,c.channel,c.destination,'Coming up: '||i.title,
    i.title||' — '||to_char(i.due_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI')||' UTC'
      ||COALESCE(' · '||t.name,''),
    CASE WHEN c.channel='inapp' THEN 'sent' ELSE 'pending' END
   FROM items i
   LEFT JOIN teams t ON t.id=i.team_id
   CROSS JOIN LATERAL (
    SELECT i.user_id AS user_id WHERE i.team_id IS NULL
    UNION SELECT m.user_id FROM team_members m WHERE m.team_id=i.team_id
   ) r
   JOIN users u ON u.id=r.user_id AND NOT u.disabled
   CROSS JOIN LATERAL (
    SELECT 'inapp' AS channel,u.id::text AS destination
    UNION ALL SELECT 'email',u.email WHERE u.email_reminders AND $1::boolean
    UNION ALL SELECT 'push',d.token FROM devices d WHERE d.user_id=u.id
   ) c WHERE i.status <> 'done' AND i.due_at IS NOT NULL
    -- Bounded by the longest reminder window (7 days) plus a day of catch-up,
    -- so each cycle scans a small index range, not every item ever created.
    AND i.due_at > now() - interval '1 day'
    AND i.due_at <= now() + interval '7 days'
    AND i.due_at-make_interval(mins=>i.reminder_minutes)<=now()
   ON CONFLICT(item_id,item_version,channel,destination) DO NOTHING`,
      [emailEnabled],
    );
    await db.query("DELETE FROM sessions WHERE expires_at<now()");
    await db.query(
      "DELETE FROM proposals WHERE expires_at<now()-interval '1 day'",
    );
    // Finished reminder records are kept for 90 days, then removed.
    await db.query(
      "DELETE FROM notifications WHERE created_at < now() - interval '90 days' AND state IN ('sent','cancelled','failed')",
    );
  });
}
