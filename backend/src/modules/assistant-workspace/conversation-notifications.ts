import { env } from "../../config/env.js";
import { transaction, type Queryable } from "../../db/pool.js";
import { assistantChatContainerVisible } from "../../lib/assistant-visibility.js";
import { conversationWaitingKind } from "./conversation-questions.js";
import { conversationEntryVisible } from "./conversation-feed.js";
import { conversationAttention } from "./conversation-attention.js";

/** Notice references contain identities only; source titles never enter push bodies. */
export function conversationNoticeVisible(notice = "n", owner = "$1") {
  return `EXISTS(SELECT 1 FROM assistant_conversation_entries e
    JOIN assistant_conversation_streams s ON s.id=e.destination_id
    JOIN ai_chats c ON c.id=s.chat_id JOIN users u ON u.id=s.owner_id
    WHERE ${notice}.ref='conversation:' || s.id::text || ':' || e.id::text
      AND s.owner_id=${owner} AND c.user_id=${owner} AND NOT u.disabled
      AND s.retired_at IS NULL AND c.swept_at IS NULL
      AND ((s.personal AND c.project_id IS NULL AND c.scope_kind IS NULL)
        OR (NOT s.personal AND ${assistantChatContainerVisible("c", owner)}))
      AND ${conversationEntryVisible("e", owner)})`;
}

export function conversationNoticeUnseen(notice = "n", owner = "$1") {
  return `(${conversationNoticeVisible(notice, owner)} AND EXISTS(
    SELECT 1 FROM assistant_conversation_entries unread_entry JOIN assistant_conversation_streams unread_stream
      ON unread_stream.id=unread_entry.destination_id
    WHERE ${notice}.ref='conversation:' || unread_stream.id::text || ':' || unread_entry.id::text
      AND unread_stream.owner_id=${owner} AND unread_stream.read_sequence<unread_entry.sequence
      AND (unread_entry.payload->>'event' IS DISTINCT FROM 'question'
        OR ${conversationWaitingKind("unread_entry.payload", owner)} IS NOT NULL)))`;
}

/** Logical alerts enter the existing durable outbox exactly once. OS push is best effort. */
export async function flushConversationAlerts(
  now = new Date(),
  onlyOwner?: string,
) {
  if (env.ASSISTANT_CONVERSATION_ENABLED !== "true") return 0;
  return transaction(async (db) => {
    const alerts = (
      await db.query<{
        entry_id: string;
        owner_id: string;
        destination_id: string;
        ref: string;
      }>(
        `SELECT a.entry_id,s.owner_id,e.destination_id,'conversation:'||s.id::text||':'||e.id::text AS ref
       FROM assistant_conversation_alerts a JOIN assistant_conversation_entries e ON e.id=a.entry_id
       JOIN assistant_conversation_streams s ON s.id=e.destination_id
       WHERE a.state='pending' AND a.available_at<=$1 AND ($2::uuid IS NULL OR s.owner_id=$2) ORDER BY a.available_at,a.entry_id
       LIMIT 25 FOR UPDATE OF a SKIP LOCKED`,
        [now, onlyOwner ?? null],
      )
    ).rows;
    let queued = 0;
    for (const alert of alerts) {
      const visible = (
        await db.query(
          `SELECT 1 FROM (SELECT $2::text AS ref) n WHERE ${conversationNoticeUnseen()}`,
          [alert.owner_id, alert.ref],
        )
      ).rowCount;
      if (!visible) {
        await db.query(
          "UPDATE assistant_conversation_alerts SET state='blocked' WHERE entry_id=$1",
          [alert.entry_id],
        );
        continue;
      }
      const attention = await conversationAttention(db, alert.owner_id, now);
      if (attention.muted) {
        await db.query(
          "UPDATE assistant_conversation_alerts SET state='suppressed' WHERE entry_id=$1",
          [alert.entry_id],
        );
        continue;
      }
      if (attention.availableAt > now) {
        await db.query(
          "UPDATE assistant_conversation_alerts SET available_at=$2 WHERE entry_id=$1",
          [alert.entry_id, attention.availableAt],
        );
        continue;
      }
      await db.query(
        `INSERT INTO notifications(user_id,item_version,channel,destination,title,body,state,kind,ref)
        SELECT u.id,0,d.channel,d.destination,'Orbyn','An assistant update is ready.',
          CASE WHEN d.channel='inapp' THEN 'sent' ELSE 'pending' END,'assistant',$2
        FROM users u CROSS JOIN LATERAL (
          SELECT 'inapp' AS channel,u.id::text AS destination
          UNION ALL SELECT 'push',token FROM devices WHERE user_id=u.id) d
        WHERE u.id=$1 AND NOT u.disabled ON CONFLICT DO NOTHING`,
        [alert.owner_id, alert.ref],
      );
      await db.query(
        "UPDATE assistant_conversation_alerts SET state='sent',sent_at=$2 WHERE entry_id=$1",
        [alert.entry_id, now],
      );
      queued++;
    }
    return queued;
  });
}

/** Called immediately before transport, including after retries/reconnects. */
export async function deferConversationNotice(
  db: Queryable,
  notice: { id: string; user_id: string; ref: string },
  now = new Date(),
) {
  if (!notice.ref.startsWith("conversation:")) return false;
  const attention = await conversationAttention(db, notice.user_id, now);
  if (attention.muted) {
    await db.query(
      "UPDATE notifications SET state='cancelled' WHERE id=$1 AND user_id=$2",
      [notice.id, notice.user_id],
    );
    return true;
  }
  const availableAt =
    env.ASSISTANT_CONVERSATION_ENABLED === "true"
      ? attention.availableAt
      : new Date(now.getTime() + 60000);
  if (availableAt <= now) return false;
  await db.query(
    "UPDATE notifications SET available_at=$3 WHERE id=$1 AND user_id=$2 AND state='pending'",
    [notice.id, notice.user_id, availableAt],
  );
  return true;
}
