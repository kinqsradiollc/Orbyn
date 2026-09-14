import { transaction } from "../db/pool.js";
import { sendEmail } from "./channels/email.js";
import { sendPush } from "./channels/push.js";

const MAX_ATTEMPTS = 8;
const RECEIPT_DELAY = "15 minutes";

/**
 * Claim and deliver one due notification. Returns false when the queue is
 * empty. Uses SKIP LOCKED so several workers can drain the queue together.
 * Stale reminders (item done, rescheduled, device gone) are cancelled instead
 * of sent. Failures back off exponentially up to an hour.
 */
export async function deliverOne(): Promise<boolean> {
  return transaction(async (db) => {
    const n = (
      await db.query(
        "SELECT * FROM notifications WHERE state IN ('pending','receipt') AND available_at<=now() ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!n) return false;

    // Re-check against the recipient, not the item owner: they may have been
    // disabled, left the team, or turned email off since this was queued.
    const item = (
      await db.query(
        `SELECT i.status, i.reminder_version, u.email_reminders, u.disabled,
          ((i.team_id IS NULL AND i.user_id=u.id) OR EXISTS (
            SELECT 1 FROM team_members m WHERE m.team_id=i.team_id AND m.user_id=u.id)) AS can_see
         FROM items i JOIN users u ON u.id=$2 WHERE i.id=$1`,
        [n.item_id, n.user_id],
      )
    ).rows[0];
    const deviceExists =
      n.channel === "push"
        ? (
            await db.query(
              "SELECT 1 FROM devices WHERE token=$1 AND user_id=$2",
              [n.destination, n.user_id],
            )
          ).rowCount
        : true;
    const stale =
      !item ||
      !item.can_see ||
      item.disabled ||
      item.status === "done" ||
      item.reminder_version !== n.item_version ||
      (n.channel === "email" && !item.email_reminders) ||
      !deviceExists;
    if (stale) {
      await db.query("UPDATE notifications SET state='cancelled' WHERE id=$1", [
        n.id,
      ]);
      return true;
    }

    try {
      let state = "sent";
      let receipt: string | null = null;
      if (n.channel === "email") {
        await sendEmail(n);
      } else if (n.channel === "push") {
        const outcome = await sendPush(n, n.state === "receipt");
        if (outcome.kind === "unregistered") {
          await db.query("DELETE FROM devices WHERE token=$1", [n.destination]);
          state = "cancelled";
        } else if (outcome.kind === "ticket") {
          state = "receipt";
          receipt = outcome.receiptId;
        }
      }
      await db.query(
        `UPDATE notifications SET state=$1,receipt_id=COALESCE($2,receipt_id),available_at=now()+interval '${RECEIPT_DELAY}' WHERE id=$3`,
        [state, receipt, n.id],
      );
    } catch {
      await db.query(
        `UPDATE notifications SET attempts=attempts+1,state=CASE WHEN attempts>=$2 THEN 'failed' ELSE state END,available_at=now()+make_interval(secs=>LEAST(3600,30*power(2,attempts)::int)) WHERE id=$1`,
        [n.id, MAX_ATTEMPTS - 1],
      );
      console.error(
        JSON.stringify({
          event: "notification_retry",
          id: n.id,
          attempt: n.attempts + 1,
        }),
      );
    }
    return true;
  });
}
