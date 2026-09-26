import {
  CHECK_IN_DAYS,
  fail,
  type SessionCheckIn,
  type SessionCheckedIn,
  type SessionOutcome,
} from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";

/**
 * Session check-in and "started": what happened to a session once its time
 * came. A check-in answer is the person's own word for it, so it outranks
 * anything the planner would otherwise guess (see learning.ts keptBlocks).
 *
 * Time counted by a check-in goes into the task's time spent once: focus
 * time already logged on the task inside the session isn't counted again,
 * and a session already counted when its task was finished
 * (count_blocks_as_spent) adds nothing more. Changing an answer takes back
 * exactly what the earlier one added.
 */

/** A session may be started from this long before it begins. */
const START_EARLY_MS = 15 * 60_000;

type BlockRow = {
  id: string;
  item_id: string;
  start_at: Date;
  end_at: Date;
  outcome: SessionOutcome | null;
  counted: boolean;
  spent_added: number;
  started_at: Date | null;
};

async function ownSession(db: Db, id: string, userId: string) {
  const b = (
    await db.query<BlockRow>(
      `SELECT b.id, b.item_id, b.start_at, b.end_at, b.outcome, b.counted,
              b.spent_added, b.started_at
         FROM time_blocks b JOIN items i ON i.id = b.item_id
        WHERE b.id = $2 AND b.user_id = $1 AND ${VISIBLE_ITEMS}
        FOR UPDATE OF b`,
      [userId, id],
    )
  ).rows[0];
  if (!b) fail(404, "Session not found");
  return b;
}

/** Sessions that ended in the last few days and haven't been checked in. */
export async function pendingCheckIns(
  db: Queryable,
  userId: string,
  now = new Date(),
): Promise<SessionCheckIn[]> {
  const rows = (
    await db.query<{
      id: string;
      item_id: string;
      title: string;
      start_at: Date;
      end_at: Date;
      project_id: string | null;
      project_name: string | null;
      estimate_minutes: number | null;
      spent_minutes: number;
    }>(
      `SELECT b.id, b.item_id, i.title, b.start_at, b.end_at, i.project_id,
              p.name AS project_name, i.estimate_minutes, i.spent_minutes
         FROM time_blocks b JOIN items i ON i.id = b.item_id
         LEFT JOIN projects p ON p.id = i.project_id
        WHERE b.user_id = $1 AND b.outcome IS NULL
          AND b.end_at <= $2 AND b.end_at > $2::timestamptz - make_interval(days => $3)
          AND i.kind = 'task' AND i.status NOT IN ('done', 'cancelled')
          AND ${VISIBLE_ITEMS}
        ORDER BY b.end_at DESC LIMIT 10`,
      [userId, now, CHECK_IN_DAYS],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    item_id: r.item_id,
    title: r.title,
    start_at: r.start_at.toISOString(),
    end_at: r.end_at.toISOString(),
    minutes: Math.round((r.end_at.getTime() - r.start_at.getTime()) / 60_000),
    project_id: r.project_id,
    project_name: r.project_name,
    remaining_minutes:
      r.estimate_minutes == null
        ? null
        : Math.max(0, r.estimate_minutes - r.spent_minutes),
  }));
}

/** Focus minutes already logged on the task while the session ran. */
async function focusInside(db: Db, userId: string, b: BlockRow) {
  const row = (
    await db.query<{ minutes: number | null }>(
      `SELECT sum(minutes)::int AS minutes FROM focus_sessions
        WHERE user_id = $1 AND item_id = $2 AND kind = 'work'
          AND started_at < $4 AND ended_at > $3`,
      [userId, b.item_id, b.start_at, b.end_at],
    )
  ).rows[0];
  return row?.minutes ?? 0;
}

/** Answer a check-in, or change an earlier answer. */
export async function checkIn(
  db: Db,
  userId: string,
  id: string,
  outcome: SessionOutcome,
  moreMinutes?: number,
  now = new Date(),
): Promise<SessionCheckedIn> {
  const b = await ownSession(db, id, userId);
  if (b.start_at.getTime() > now.getTime())
    fail(409, "This session hasn't started yet.");
  // Take back what an earlier answer counted.
  if (b.spent_added)
    await db.query(
      `UPDATE items SET spent_minutes = greatest(0, spent_minutes - $2) WHERE id = $1`,
      [b.item_id, b.spent_added],
    );
  let counted = 0;
  const alreadyCounted = b.counted && !b.spent_added;
  if (outcome !== "skipped" && !alreadyCounted) {
    const ran = Math.round(
      (Math.min(b.end_at.getTime(), now.getTime()) - b.start_at.getTime()) /
        60_000,
    );
    counted = Math.max(0, ran - (await focusInside(db, userId, b)));
  }
  const task = (
    await db.query<{ estimate_minutes: number | null; spent_minutes: number }>(
      `UPDATE items SET spent_minutes = spent_minutes + $2,
              estimate_minutes = CASE
                WHEN $3::int IS NULL THEN estimate_minutes
                WHEN estimate_minutes IS NULL
                  OR estimate_minutes - (spent_minutes + $2) < $3
                  THEN spent_minutes + $2 + $3
                ELSE estimate_minutes END,
              version = version + 1, updated_at = now()
        WHERE id = $1
        RETURNING estimate_minutes, spent_minutes`,
      [b.item_id, counted, outcome === "more" ? (moreMinutes ?? 30) : null],
    )
  ).rows[0];
  await db.query(
    `UPDATE time_blocks SET outcome = $2, outcome_at = now(), spent_added = $3,
            counted = CASE WHEN $2 = 'skipped' THEN counted AND spent_added = 0
                           ELSE true END
      WHERE id = $1`,
    [b.id, outcome, counted],
  );
  return {
    id: b.id,
    outcome,
    counted_minutes: counted,
    remaining_minutes:
      task.estimate_minutes == null
        ? null
        : Math.max(0, task.estimate_minutes - task.spent_minutes),
  };
}

/**
 * Mark a session started: from its reminder ("Start"), or when focus mode
 * starts on its task while it runs. Starting twice changes nothing.
 */
export async function startSession(
  db: Db,
  userId: string,
  id: string,
  now = new Date(),
): Promise<{ id: string; item_id: string; started_at: string }> {
  const b = await ownSession(db, id, userId);
  if (b.started_at)
    return {
      id: b.id,
      item_id: b.item_id,
      started_at: b.started_at.toISOString(),
    };
  if (
    now.getTime() < b.start_at.getTime() - START_EARLY_MS ||
    now.getTime() >= b.end_at.getTime()
  )
    fail(409, "This session isn't on now.");
  const row = (
    await db.query<{ started_at: Date }>(
      "UPDATE time_blocks SET started_at = $2 WHERE id = $1 RETURNING started_at",
      [b.id, now],
    )
  ).rows[0];
  return {
    id: b.id,
    item_id: b.item_id,
    started_at: row.started_at.toISOString(),
  };
}

/** Focus mode started on a task: the session of it that's on now, if any, has started. */
export async function startSessionsFor(
  db: Db,
  userId: string,
  itemId: string,
  now = new Date(),
) {
  await db.query(
    `UPDATE time_blocks SET started_at = $3
      WHERE user_id = $1 AND item_id = $2 AND started_at IS NULL
        AND start_at - interval '15 minutes' <= $3 AND end_at > $3`,
    [userId, itemId, now],
  );
}
