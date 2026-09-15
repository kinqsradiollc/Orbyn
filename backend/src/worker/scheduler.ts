import { transaction } from "../db/pool.js";
import { emailEnabled } from "./channels/email.js";

/**
 * Queue reminders for every open item whose reminder window has opened: one
 * row per channel and destination. The unique key on
 * (item_id, item_version, channel, destination) makes this idempotent, so any
 * number of workers can run it. Also sweeps expired sessions and proposals.
 */
export async function enqueue() {
  await transaction(async (db) => {
    // Serialize schedulers; delivery workers still run concurrently.
    await db.query("SELECT pg_advisory_xact_lock(786240)");
    await db.query(
      `INSERT INTO notifications(user_id,item_id,item_version,channel,destination,title,body,state)
   SELECT i.user_id,i.id,i.reminder_version,c.channel,c.destination,'Coming up: '||i.title,
    i.title||' — '||to_char(i.due_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI')||' UTC',
    CASE WHEN c.channel='inapp' THEN 'sent' ELSE 'pending' END
   FROM items i JOIN users u ON u.id=i.user_id
   CROSS JOIN LATERAL (
    SELECT 'inapp' AS channel,'' AS destination
    UNION ALL SELECT 'email',u.email WHERE u.email_reminders AND $1::boolean
    UNION ALL SELECT 'push',d.token FROM devices d WHERE d.user_id=i.user_id
   ) c WHERE i.status='todo' AND i.due_at IS NOT NULL
    AND i.due_at-make_interval(mins=>i.reminder_minutes)<=now()
   ON CONFLICT(item_id,item_version,channel,destination) DO NOTHING`,
      [emailEnabled],
    );
    await db.query("DELETE FROM sessions WHERE expires_at<now()");
    await db.query(
      "DELETE FROM proposals WHERE expires_at<now()-interval '1 day'",
    );
  });
}
