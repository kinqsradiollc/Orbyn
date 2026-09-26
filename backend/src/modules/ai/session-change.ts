import { fail, sessionChangeSchema, type SessionChange } from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import { busyIntervals } from "../planner/calendar.js";
import { moveSession, removeSession } from "../planner/blocks.js";
import { visibleItems } from "../../lib/visibility.js";

/** Apply one reviewed session change after checking it is still the same session. */
export async function applySessionChange(
  db: Db,
  userId: string,
  raw: unknown,
): Promise<SessionChange> {
  const change = sessionChangeSchema.parse(raw);
  const current = (
    await db.query<{
      id: string;
      item_id: string;
      project_id: string | null;
      start_at: Date;
      end_at: Date;
      status: string;
    }>(
      `SELECT b.id, b.item_id, i.project_id, b.start_at, b.end_at, i.status
         FROM time_blocks b JOIN items i ON i.id = b.item_id
        WHERE b.id = $2 AND b.user_id = $1 AND ${visibleItems()}
        FOR UPDATE OF b`,
      [userId, change.block_id],
    )
  ).rows[0];
  if (
    !current ||
    current.item_id !== change.item_id ||
    (change.project_id && current.project_id !== change.project_id)
  )
    fail(404, "This session is no longer in the selected task or project.");
  if (
    current.start_at.toISOString() !== change.from_start_at ||
    current.end_at.toISOString() !== change.from_end_at
  )
    fail(
      409,
      "This session changed since the proposal. Ask again to review it.",
    );
  if (change.operation === "move") {
    if (current.status === "done" || current.status === "cancelled")
      fail(409, "The task is closed. Review its sessions again.");
    const start = new Date(change.start_at);
    const end = new Date(change.end_at);
    if (end <= start) fail(422, "Session end must be after its start.");
    const busy = await busyIntervals(db, userId, start, end, {
      blocks: true,
      derived: true,
      excludeBlockIds: [change.block_id],
    });
    if (
      busy.some(
        (time) =>
          time.start_at < change.end_at && change.start_at < time.end_at,
      )
    )
      fail(409, "That time is no longer free. Ask for a new proposal.");
    // The same write as moving it by hand (the planner's blocks service).
    await moveSession(
      db,
      userId,
      change.block_id,
      change.start_at,
      change.end_at,
    );
  } else {
    await removeSession(db, userId, change.block_id);
  }
  return change;
}
