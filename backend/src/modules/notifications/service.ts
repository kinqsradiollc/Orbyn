import type { Queryable } from "../../db/pool.js";
import { visibleItems } from "../../lib/visibility.js";

import { assistantSourceVisible } from "../../lib/assistant-source-visibility.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";

/**
 * The in-app notification tray, for the routes and the agents (get_today
 * counts them; mark_notifications_read marks them).
 */

/** The in-app notices `userId` can still see, newest first (100 at most). */
export async function listNotifications(
  db: Queryable,
  userId: string,
  limit = 100,
) {
  return (
    await db.query<{
      id: string;
      title: string;
      body: string;
      read: boolean;
      created_at: Date;
      kind: string;
      item_id: string | null;
      ref: string | null;
      via_agent: string | null;
    }>(
      `SELECT n.id, n.title, n.body, n.read, n.created_at, n.kind, n.item_id, n.ref,
              COALESCE(
                (SELECT coalesce(nullif(g.client_name, ''), g.name)
                   FROM agent_grants g WHERE g.id = n.via_grant_id),
                CASE WHEN p.source = 'assistant' THEN coalesce(nullif(agent.name, ''), 'Orbyn') END
              ) AS via_agent
       FROM notifications n LEFT JOIN items i ON i.id = n.item_id
       LEFT JOIN proposals p ON n.kind = 'review'
         AND n.ref = 'proposal:' || p.id::text
       LEFT JOIN agent_settings agent ON agent.user_id = n.user_id
       WHERE n.user_id = $1 AND n.channel = 'inapp'
         AND (n.item_id IS NULL OR ${visibleItems()})
         AND (n.kind <> 'assistant' OR split_part(coalesce(n.ref,''), ':', 1) <> 'chat'
           OR EXISTS(SELECT 1 FROM ai_chats c JOIN ai_jobs j ON j.chat_id=c.id
             WHERE c.id::text=split_part(n.ref, ':', 2) AND j.id::text=split_part(n.ref, ':', 3)
               AND ${assistantChatVisible()} AND ${assistantJobSourcesVisible()}))
         AND (n.kind <> 'reminder_nudge' OR EXISTS(SELECT 1 FROM assistant_nudges source_nudge WHERE source_nudge.id::text=split_part(n.ref, ':', array_length(string_to_array(n.ref, ':'), 1)) AND source_nudge.user_id=$1 AND ${assistantSourceVisible("source_nudge.entity_kind", "source_nudge.entity_id")}))
       ORDER BY n.created_at DESC LIMIT $2`,
      [userId, limit],
    )
  ).rows;
}

/** Mark notices read; returns how many were `userId`'s to mark. */
export async function markNotificationsRead(
  db: Queryable,
  userId: string,
  ids: string[],
): Promise<number> {
  const result = await db.query(
    `UPDATE notifications n SET read = true
     WHERE n.id = ANY ($2::uuid[]) AND n.user_id = $1 AND n.channel = 'inapp'
       AND (n.item_id IS NULL
         OR EXISTS (SELECT 1 FROM items i WHERE i.id = n.item_id AND ${visibleItems()}))`,
    [userId, ids],
  );
  return result.rowCount ?? 0;
}
