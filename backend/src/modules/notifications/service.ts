import type { Queryable } from "../../db/pool.js";
import { visibleItems } from "../../lib/visibility.js";

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
    }>(
      `SELECT n.id, n.title, n.body, n.read, n.created_at, n.kind, n.item_id, n.ref
       FROM notifications n LEFT JOIN items i ON i.id = n.item_id
       WHERE n.user_id = $1 AND n.channel = 'inapp'
         AND (n.item_id IS NULL OR ${visibleItems()})
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
