import { fail, progressUpdateInput, type ItemDetail } from "@orbyn/core";
import type { z } from "zod";
import type { Db } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import {
  itemDetail,
  lockItem,
  requireItemAccess,
  setItemStatus,
  via,
} from "./service.js";

/**
 * A task's progress: notes with an optional status or percent, and minutes
 * worked. The routes and the agents' add_progress and log_focus share these.
 */

/** Add a progress note, optionally setting status or percent. */
export async function addProgressUpdate(
  db: Db,
  u: UserRow,
  id: string,
  input: z.input<typeof progressUpdateInput>,
): Promise<ItemDetail> {
  const d = progressUpdateInput.parse(input);
  const item = await lockItem(db, id);
  await requireItemAccess(u, item, "items:write", db);
  if (d.progress !== undefined) {
    const steps = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM item_steps WHERE item_id=$1",
        [id],
      )
    ).rows[0].n;
    if (steps > 0) fail(409, "This task's progress follows its checklist.");
  }
  // A new status goes the way every edit does (see setItemStatus): a
  // finished task loses its future sessions, a repeating one moves on to
  // its next occurrence, and webhooks and open apps hear about it.
  const changed =
    d.status && d.status !== item.status
      ? await setItemStatus(db, u, id, d.status)
      : null;
  // A repeating task that moved on has already said so in its timeline,
  // so a bare tick doesn't add a second, empty entry.
  const movedOn = !!changed && changed.status !== d.status;
  if (d.body || d.progress !== undefined || !movedOn) {
    await db.query(
      "INSERT INTO item_updates(item_id, user_id, body, status, progress) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        u.id,
        d.body,
        movedOn ? null : (d.status ?? null),
        d.progress ?? null,
      ],
    );
    await db.query(
      "UPDATE items SET updates_count = updates_count + 1, last_update_at = now() WHERE id=$1",
      [id],
    );
  }
  if (d.progress !== undefined)
    await db.query(
      `UPDATE items SET
     progress = $1::int,
     status = CASE WHEN status = 'todo' AND $1::int > 0 THEN 'in_progress' ELSE status END,
     updated_at = now()
   WHERE id = $2`,
      [d.progress, id],
    );
  return itemDetail(id, via(db));
}

/**
 * Minutes worked on a task (the focus timer). Like checklist steps, this
 * doesn't change the edit version, so an open editor never conflicts.
 */
export async function logTime(
  db: Db,
  u: UserRow,
  id: string,
  minutes: number,
): Promise<ItemDetail> {
  const item = await lockItem(db, id);
  await requireItemAccess(u, item, "items:write", db);
  await db.query(
    "UPDATE items SET spent_minutes = spent_minutes + $1, updated_at = now() WHERE id = $2",
    [minutes, id],
  );
  return itemDetail(id, via(db));
}
