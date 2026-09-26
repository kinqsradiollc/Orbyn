import { fail, type TimeBlock } from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import { queueWebhooks } from "../../lib/webhooks.js";
import { visibleItems } from "../../lib/visibility.js";
import { withSessionFacts } from "./sessions.js";

/**
 * Sessions (time set aside for a task): adding, moving and removing one.
 * The one write path for a person's sessions: the planner's routes, the
 * assistant's reviewed session changes (ai/session-change.ts) and agents
 * all come here, so each write clears the conflict it answers, is told to
 * webhooks the same way, and stays the caller's own.
 */

/** One of `userId`'s sessions, locked for a change; 404 when it isn't theirs. */
export async function ownBlock(db: Db, id: string, userId: string) {
  const row = (
    await db.query<{
      id: string;
      start_at: Date;
      end_at: Date;
      item_id: string;
    }>(
      "SELECT id, start_at, end_at, item_id FROM time_blocks WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [id, userId],
    )
  ).rows[0];
  if (!row) fail(404, "Session not found");
  return row;
}

/** One of your sessions as stored, with its task's title and status. */
export async function plainBlockById(
  db: Db,
  id: string,
  userId: string,
): Promise<TimeBlock> {
  const b = (
    await db.query<TimeBlock>(
      `SELECT b.id, b.item_id, b.user_id, b.start_at, b.end_at, b.source, b.plan_id,
              i.title, i.status, i.kind, i.priority, i.team_id, i.list_id, i.estimate_minutes
       FROM time_blocks b JOIN items i ON i.id = b.item_id WHERE b.id = $1 AND b.user_id = $2`,
      [id, userId],
    )
  ).rows[0];
  return {
    ...b,
    start_at: new Date(b.start_at).toISOString(),
    end_at: new Date(b.end_at).toISOString(),
  };
}

/** One of your sessions, with its deadline, number and project (see sessions.ts). */
export async function blockById(db: Db, id: string, userId: string) {
  return (
    await withSessionFacts(db, userId, [await plainBlockById(db, id, userId)])
  )[0];
}

/**
 * Set time aside for a task `userId` can see: 404 for one they can't, 422
 * for anything but a task. Returns the new session.
 */
export async function addSession(
  db: Db,
  userId: string,
  s: { item_id: string; start_at: string; end_at: string },
): Promise<TimeBlock> {
  const item = (
    await db.query<{ id: string; kind: string }>(
      `SELECT i.id, i.kind FROM items i WHERE i.id = $2 AND ${visibleItems()}`,
      [userId, s.item_id],
    )
  ).rows[0];
  if (!item) fail(404, "Item not found");
  if (item.kind !== "task") fail(422, "Only tasks can have sessions.");
  const { id } = (
    await db.query<{ id: string }>(
      `INSERT INTO time_blocks (item_id, user_id, start_at, end_at) VALUES ($1, $2, $3, $4) RETURNING id`,
      [s.item_id, userId, s.start_at, s.end_at],
    )
  ).rows[0];
  const created = await blockById(db, id, userId);
  await queueWebhooks(
    db,
    "block.scheduled",
    { user_id: userId, team_id: null },
    created,
  );
  return created;
}

/**
 * Move one of `userId`'s sessions. It is placed by hand now (a later plan
 * offers to move it only unticked), and no longer has the conflict it was
 * flagged for. Returns the moved session.
 */
export async function moveSession(
  db: Db,
  userId: string,
  blockId: string,
  start_at: string,
  end_at: string,
): Promise<TimeBlock> {
  const b = await ownBlock(db, blockId, userId);
  await db.query(
    "UPDATE time_blocks SET start_at = $2, end_at = $3, source = 'manual' WHERE id = $1",
    [b.id, start_at, end_at],
  );
  await db.query(
    "UPDATE notifications SET read = true WHERE kind = 'conflict' AND ref = $1",
    [b.id],
  );
  const moved = await blockById(db, b.id, userId);
  // Other devices and webhooks hear about it, so a "Planned" time shown
  // elsewhere doesn't go stale.
  await queueWebhooks(
    db,
    "block.updated",
    { user_id: userId, team_id: null },
    moved,
  );
  return moved;
}

/** Remove one of `userId`'s sessions; 404 when it isn't theirs. */
export async function removeSession(
  db: Db,
  userId: string,
  blockId: string,
): Promise<void> {
  const gone = (
    await db.query<{
      id: string;
      item_id: string;
      start_at: Date;
      end_at: Date;
    }>(
      `DELETE FROM time_blocks WHERE id = $1 AND user_id = $2
       RETURNING id, item_id, start_at, end_at`,
      [blockId, userId],
    )
  ).rows[0];
  if (!gone) fail(404, "Session not found");
  await queueWebhooks(
    db,
    "block.deleted",
    { user_id: userId, team_id: null },
    {
      id: gone.id,
      item_id: gone.item_id,
      start_at: gone.start_at.toISOString(),
      end_at: gone.end_at.toISOString(),
    },
  );
}
