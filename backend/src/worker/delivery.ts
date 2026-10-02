import {
  isClosed,
  DEFAULT_REMINDER_NUDGES,
  reminderNudgeSettingsInput,
  reminderNudgesQuiet,
} from "@orbyn/core";
import { transaction, type Db } from "../db/pool.js";
import { bookerReminder } from "../modules/booking/service.js";
import { emailEnabled, sendEmail } from "./channels/email.js";
import { sendPush } from "./channels/push.js";
import { visibleItems } from "../lib/visibility.js";
import { reminderNudgeCandidates } from "./reminder-nudges.js";
import { loadPrefs } from "../modules/planner/calendar.js";

import { assistantJobSourcesVisible } from "../lib/assistant-job-sources.js";
import { assistantChatVisible } from "../lib/assistant-visibility.js";

const MAX_ATTEMPTS = 8;
const RECEIPT_DELAY = "15 minutes";
/** Planner notices: sent by `planner_notices`, not `email_reminders`. */
const PLANNER_KINDS = [
  "conflict",
  "rollforward",
  "at_risk",
  "deadline",
  "project",
  "session",
];

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
    const item = n.item_id
      ? (
          await db.query(
            `SELECT i.status, i.reminder_version, u.email_reminders, u.disabled,
              ${visibleItems("i", { user: "u.id" })} AS can_see
             FROM items i JOIN users u ON u.id=$2 WHERE i.id=$1`,
            [n.item_id, n.user_id],
          )
        ).rows[0]
      : undefined;
    const deviceExists =
      n.channel === "push"
        ? (
            await db.query(
              "SELECT 1 FROM devices WHERE token=$1 AND user_id=$2",
              [n.destination, n.user_id],
            )
          ).rowCount
        : true;
    // A booker's reminder is written now, with the booking as it is.
    const bookerMail =
      n.kind === "booker_reminder" && (await emailEnabled())
        ? await bookerReminder(db, n.ref)
        : null;
    if (bookerMail) Object.assign(n, bookerMail);
    const stale =
      n.kind === "booker_reminder"
        ? !bookerMail
        : n.kind === "promise"
          ? !(
              await db.query("SELECT 1 FROM work_records WHERE id = $1", [
                n.ref,
              ])
            ).rowCount
          : n.kind === "ask"
            ? // Only while the ask is still waiting on someone.
              !(
                await db.query(
                  "SELECT 1 FROM task_asks WHERE id = $1 AND status IN ('open', 'countered')",
                  [n.ref],
                )
              ).rowCount
            : n.kind === "template"
              ? // About a template, not a task: stale only if the template went.
                !(
                  await db.query(
                    "SELECT 1 FROM project_templates WHERE id = $1",
                    [n.ref],
                  )
                ).rowCount
              : n.kind === "invite"
                ? await inviteStale(db, n)
                : n.kind === "reminder_nudge"
                  ? await reminderNudgeStale(db, n)
                  : n.kind === "assistant"
                    ? await assistantNoticeStale(db, n)
                    : n.kind === "agent"
                      ? // About the person's own security or team: goes out
                        // while their account is active.
                        !(
                          await db.query(
                            "SELECT 1 FROM users WHERE id = $1 AND NOT disabled",
                            [n.user_id],
                          )
                        ).rowCount
                      : PLANNER_KINDS.includes(n.kind)
                        ? await plannerNoticeStale(db, n, item)
                        : !item ||
                          !item.can_see ||
                          item.disabled ||
                          isClosed(item.status) ||
                          item.reminder_version !== n.item_version ||
                          (n.channel === "email" && !item.email_reminders);
    if (stale || !deviceExists) {
      await db.query("UPDATE notifications SET state='cancelled' WHERE id=$1", [
        n.id,
      ]);
      return true;
    }
    if (
      n.kind === "reminder_nudge" &&
      n.state === "pending" &&
      (await deferQuietReminderNudge(db, n))
    )
      return true;

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

/** A delayed reminder waits through quiet hours without consuming retry attempts. */
export async function deferQuietReminderNudge(
  db: Db,
  notice: { id: string; user_id: string },
  now = new Date(),
): Promise<boolean> {
  const row = (
    await db.query(
      "SELECT reminder_nudges FROM agent_settings WHERE user_id = $1",
      [notice.user_id],
    )
  ).rows[0];
  const parsed = reminderNudgeSettingsInput.safeParse(row?.reminder_nudges);
  const settings = parsed.success ? parsed.data : DEFAULT_REMINDER_NUDGES;
  const prefs = await loadPrefs(db, notice.user_id);
  if (!reminderNudgesQuiet(now, prefs.timezone, settings)) return false;
  await db.query(
    `UPDATE notifications SET available_at = $3::timestamptz + interval '15 minutes'
     WHERE id = $1 AND user_id = $2 AND state = 'pending'`,
    [notice.id, notice.user_id, now],
  );
  return true;
}

/** Assistant notices remain private to the owner of their saved chat or night. */
export async function assistantNoticeStale(
  db: Db,
  notice: { user_id: string; ref: string },
): Promise<boolean> {
  return !(
    await db.query(
      `SELECT 1 FROM ai_chats c JOIN users u ON u.id = c.user_id
                       WHERE c.id::text = split_part($2, ':', 2)
                         AND ${assistantChatVisible()} AND NOT u.disabled AND split_part($2, ':', 1) = 'chat'
                         AND EXISTS(SELECT 1 FROM ai_jobs j
                           WHERE j.id::text=split_part($2, ':', 3) AND j.user_id=$1 AND j.chat_id=c.id
                             AND j.run_origin='person' AND j.state=split_part($2, ':', 4)
                             AND ${assistantJobSourcesVisible()}
                             AND (j.state<>'waiting' OR j.run_state->'state'->'waiting'->>'id'=split_part($2, ':', 5)))
                       UNION ALL SELECT 1 FROM assistant_nights n JOIN users u ON u.id = n.user_id
                       WHERE n.id::text = split_part($2, ':', 2) AND n.user_id = $1 AND NOT u.disabled
                         AND split_part($2, ':', 1) = 'overnight'
                         AND EXISTS(SELECT 1 FROM agent_grants g WHERE g.user_id = u.id AND g.kind = 'assistant'
                           AND g.revoked_at IS NULL AND g.suspended_at IS NULL)`,
      [notice.user_id, notice.ref],
    )
  ).rowCount;
}

/** Recheck the personal source and channel preferences even when chat is off. */
export async function reminderNudgeStale(
  db: Db,
  notice: { user_id: string; ref: string; channel: string },
  now = new Date(),
): Promise<boolean> {
  const id = notice.ref.split(":").at(-1);
  const row = (
    await db.query(
      `SELECT n.entity_kind, n.entity_id, a.reminder_nudges
       FROM assistant_nudges n JOIN users u ON u.id = n.user_id
       JOIN agent_grants g ON g.user_id = u.id AND g.kind = 'assistant'
       LEFT JOIN agent_settings a ON a.user_id = u.id
       WHERE n.id::text = $2 AND n.user_id = $1 AND NOT n.stopped AND NOT u.disabled
         AND NOT EXISTS (SELECT 1 FROM assistant_nudges stopped
           WHERE stopped.user_id = n.user_id AND stopped.nudge_key = n.nudge_key AND stopped.stopped)
         AND g.suspended_at IS NULL AND g.revoked_at IS NULL`,
      [notice.user_id, id],
    )
  ).rows[0];
  if (
    !row ||
    row.reminder_nudges?.enabled === false ||
    row.reminder_nudges?.[notice.channel] === false
  )
    return true;
  const prefs = await loadPrefs(db, notice.user_id);
  const current = (
    await reminderNudgeCandidates(notice.user_id, prefs.timezone, now, db, row)
  ).find(
    (candidate) =>
      candidate.entity_kind === row.entity_kind &&
      candidate.entity_id === row.entity_id,
  );
  return (
    !current ||
    (notice.channel === "email" &&
      !["overdue", "deadline"].includes(current.category))
  );
}

/**
 * An invitation goes out while SMTP is still set up and the organizer's
 * account is active. One for a person since taken off the event is dropped
 * (they get the cancellation instead); cancellations always go.
 */
async function inviteStale(
  db: Db,
  n: { user_id: string; ref: string },
): Promise<boolean> {
  if (!(await emailEnabled())) return true;
  const owner = (
    await db.query<{ disabled: boolean }>(
      "SELECT disabled FROM users WHERE id = $1",
      [n.user_id],
    )
  ).rows[0];
  if (!owner || owner.disabled) return true;
  const [method, attendee] = n.ref.split(":");
  if (method === "REQUEST") {
    const still = await db.query(
      "SELECT 1 FROM item_attendees WHERE id::text = $1",
      [attendee],
    );
    if (!still.rowCount) return true;
  }
  return false;
}

/**
 * A planner notice (conflict, roll forward, at risk, due soon) goes out on
 * push or email only while the recipient is active and still wants that
 * lane, the notice hasn't been dealt with in the app (a rescheduled block
 * marks its conflict read), its task is open and visible to them, and a
 * conflict's block still exists.
 */
async function plannerNoticeStale(
  db: Db,
  n: {
    user_id: string;
    item_id: string | null;
    channel: string;
    kind: string;
    ref: string;
    read: boolean;
  },
  item: { status: string; can_see: boolean; disabled: boolean } | undefined,
) {
  const who = (
    await db.query<{ disabled: boolean; push: boolean; email: boolean }>(
      `SELECT u.disabled,
         coalesce((p.planner_notices->>'push')::boolean, true) AS push,
         coalesce((p.planner_notices->>'email')::boolean, false) AS email
       FROM users u LEFT JOIN planner_prefs p ON p.user_id = u.id WHERE u.id = $1`,
      [n.user_id],
    )
  ).rows[0];
  if (!who || who.disabled || n.read) return true;
  if (n.channel === "email" && !who.email) return true;
  // A session reminder is asked for on its own, so it goes to the phone
  // whatever the other planner notices do.
  if (n.channel === "push" && !who.push && n.kind !== "session") return true;
  if (n.item_id && (!item || !item.can_see || isClosed(item.status)))
    return true;
  if (n.kind === "project") {
    const projectId = n.ref.split(":")[0];
    const visible = await db.query(
      `SELECT 1 FROM projects p JOIN items i ON i.project_id = p.id
       WHERE p.id::text = $1 AND p.status = 'active' AND p.deadline > now()
         AND i.kind = 'task' AND i.status NOT IN ('done', 'cancelled')
         AND (CASE WHEN i.team_id IS NULL THEN i.user_id = $2
                   ELSE i.assignee_id = $2 AND EXISTS (
                     SELECT 1 FROM team_members m WHERE m.team_id = i.team_id AND m.user_id = $2) END)
       LIMIT 1`,
      [projectId, n.user_id],
    );
    if (!visible.rowCount) return true;
  }
  if (n.kind === "session") {
    // Only for the session as it is now: still there, at the same start,
    // and not started yet.
    const [blockId, epoch] = n.ref.split(":");
    const block = await db.query(
      `SELECT 1 FROM time_blocks WHERE id::text = $1 AND user_id = $2
         AND round(extract(epoch FROM start_at))::bigint::text = $3
         AND started_at IS NULL`,
      [blockId, n.user_id, epoch ?? ""],
    );
    if (!block.rowCount) return true;
  }
  if (n.kind === "conflict") {
    const block = await db.query(
      "SELECT 1 FROM time_blocks WHERE id::text = $1 AND user_id = $2",
      [n.ref, n.user_id],
    );
    if (!block.rowCount) return true;
  }
  return false;
}
