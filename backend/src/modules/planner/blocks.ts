import {
  fail,
  type PlanApplied,
  type PlanMove,
  type TimeBlock,
} from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import { queueWebhooks } from "../../lib/webhooks.js";
import { visibleItems } from "../../lib/visibility.js";
import { withSessionFacts } from "./sessions.js";
import { busyIntervals } from "./calendar.js";

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
              b.started_at, b.outcome,
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

/**
 * Put a plan's sessions on `userId`'s calendar, and make the moves it
 * offers: the app's plan apply and an agent's schedule_sessions both come
 * here, so each is checked the same way first. A move is made only if its
 * session is still yours, unmoved since, and its task still open; a new
 * session only if its task is still open and visible to you; neither if it
 * now clashes with anything on the calendar. What fails a check is skipped
 * and counted, never an error. Moves go first (the sessions being moved
 * don't stand in their own way).
 */
export async function placeSessions(
  db: Db,
  userId: string,
  planId: string | null,
  blocks: { item_id: string; start_at: string; end_at: string }[],
  moves: PlanMove[],
): Promise<PlanApplied> {
  const spans = [...blocks, ...moves];
  if (!spans.length)
    return { blocks: [], skipped: 0, moved: [], moves_skipped: 0 };
  const starts = spans.map((b) => Date.parse(b.start_at));
  const ends = spans.map((b) => Date.parse(b.end_at));
  const busy = await busyIntervals(
    db,
    userId,
    new Date(Math.min(...starts)),
    new Date(Math.max(...ends)),
    {
      blocks: true,
      derived: true,
      excludeBlockIds: moves.map((m) => m.block_id),
    },
  );
  const clashes = (b: { start_at: string; end_at: string }) =>
    busy.some((x) => x.start_at < b.end_at && b.start_at < x.end_at);

  const moved: TimeBlock[] = [];
  let movesSkipped = 0;
  for (const m of moves) {
    const same = await db.query(
      `SELECT 1 FROM time_blocks b JOIN items i ON i.id = b.item_id
       WHERE b.id = $1 AND b.user_id = $2 AND b.item_id = $3
         AND b.start_at = $4 AND b.end_at = $5
         AND i.status NOT IN ('done', 'cancelled')
       FOR UPDATE OF b`,
      [m.block_id, userId, m.item_id, m.from_start_at, m.from_end_at],
    );
    if (!same.rowCount || clashes(m)) {
      movesSkipped++;
      continue;
    }
    await db.query(
      "UPDATE time_blocks SET start_at = $2, end_at = $3 WHERE id = $1",
      [m.block_id, m.start_at, m.end_at],
    );
    await db.query(
      "UPDATE notifications SET read = true WHERE kind = 'conflict' AND ref = $1",
      [m.block_id],
    );
    moved.push(await plainBlockById(db, m.block_id, userId));
  }

  const created: TimeBlock[] = [];
  let skipped = 0;
  // Two new sessions of the same plan never land on each other either.
  const placed: { start_at: string; end_at: string }[] = [];
  const placing: { item_id: string; start_at: string; end_at: string }[] = [];
  for (const b of blocks) {
    const clash =
      clashes(b) ||
      placed.some((x) => x.start_at < b.end_at && b.start_at < x.end_at);
    const open = await db.query(
      `SELECT 1 FROM items i WHERE i.id = $2 AND i.kind = 'task'
         AND i.status NOT IN ('done', 'cancelled') AND ${visibleItems()}`,
      [userId, b.item_id],
    );
    if (clash || !open.rowCount) {
      skipped++;
      continue;
    }
    placed.push(b);
    placing.push(b);
  }
  // One statement, so a project's History reads "3 sessions planned".
  if (placing.length) {
    const ids = (
      await db.query<{ id: string }>(
        `INSERT INTO time_blocks (item_id, user_id, start_at, end_at, source, plan_id)
         SELECT x.item_id, $2, x.start_at, x.end_at, 'planner', $3
           FROM unnest($1::uuid[], $4::timestamptz[], $5::timestamptz[])
                WITH ORDINALITY AS x(item_id, start_at, end_at, n)
          ORDER BY x.n
         RETURNING id`,
        [
          placing.map((b) => b.item_id),
          userId,
          planId,
          placing.map((b) => b.start_at),
          placing.map((b) => b.end_at),
        ],
      )
    ).rows;
    const byKey = new Map<string, string>();
    for (const row of (
      await db.query<{ id: string; item_id: string; start_at: Date }>(
        "SELECT id, item_id, start_at FROM time_blocks WHERE id = ANY($1::uuid[])",
        [ids.map((row) => row.id)],
      )
    ).rows)
      byKey.set(`${row.item_id}|${row.start_at.getTime()}`, row.id);
    for (const b of placing) {
      const id = byKey.get(`${b.item_id}|${Date.parse(b.start_at)}`);
      if (id) created.push(await plainBlockById(db, id, userId));
    }
  }
  // Numbered together, once every session of the plan is in place.
  const facts = await withSessionFacts(db, userId, [...created, ...moved]);
  const saved = facts.slice(0, created.length);
  const shifted = facts.slice(created.length);
  if (created.length)
    await queueWebhooks(
      db,
      "block.scheduled",
      { user_id: userId, team_id: null },
      { plan_id: planId, blocks: saved },
    );
  // Other devices and webhooks hear about each moved session.
  for (const b of shifted)
    await queueWebhooks(
      db,
      "block.updated",
      { user_id: userId, team_id: null },
      b,
    );
  return {
    blocks: saved,
    skipped,
    moved: shifted,
    moves_skipped: movesSkipped,
  };
}
