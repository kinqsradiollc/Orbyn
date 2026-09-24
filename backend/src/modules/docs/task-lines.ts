import type { Db } from "../../db/pool.js";
import { announceDocChange } from "./live.js";

/**
 * A task tied to page lines was finished or reopened. Every page showing it,
 * other than `exceptDoc` (the page whose tick this is, which deals with its
 * own line), moves on a version:
 *
 * - an editor still showing the old tick can't save it back over the change:
 *   its save is refused as stale (409), so it reads the page again, merges,
 *   and takes the new tick;
 * - open editors hear of it as soon as the change is committed, and re-read;
 * - what the page last said for the line starts again from the task, and
 *   `done_version` notes the first version that shows it (see syncTicks).
 *
 * The version moves without `updated_at`: nobody wrote on the page.
 *
 * A page someone is saving at this moment is locked by that save and is
 * skipped rather than waited for, since that save may itself be waiting for
 * this task (waiting could deadlock). Its save lands next, at the version
 * after the current one; its line was read before this change, so the
 * page's last word on it stands, and the save's answer shows the task as it
 * now is.
 */
export async function followTaskState(
  db: Db,
  itemId: string,
  done: boolean,
  exceptDoc?: string,
): Promise<void> {
  const moved = (
    await db.query<{ id: string; version: number }>(
      `WITH free AS (
         SELECT d.id FROM docs d
          WHERE d.id IN (SELECT l.doc_id FROM doc_task_links l
                          WHERE l.item_id = $1)
            AND d.id IS DISTINCT FROM $2::uuid
          ORDER BY d.id
          FOR UPDATE SKIP LOCKED)
       UPDATE docs d SET version = d.version + 1
         FROM free WHERE d.id = free.id
       RETURNING d.id, d.version`,
      [itemId, exceptDoc ?? null],
    )
  ).rows;
  if (moved.length)
    await db.query(
      `UPDATE doc_task_links l SET done = $2, done_version = m.version
         FROM unnest($3::uuid[], $4::int[]) AS m(doc_id, version)
        WHERE l.item_id = $1 AND l.doc_id = m.doc_id`,
      [itemId, done, moved.map((m) => m.id), moved.map((m) => m.version)],
    );
  // Pages being saved right now: shown from the version that save gives.
  await db.query(
    `UPDATE doc_task_links l SET done_version = d.version + 1
       FROM docs d
      WHERE l.item_id = $1 AND d.id = l.doc_id
        AND d.id IS DISTINCT FROM $2::uuid
        AND NOT (d.id = ANY ($3::uuid[]))`,
    [itemId, exceptDoc ?? null, moved.map((m) => m.id)],
  );
  // Delivered when the change commits, and dropped if it doesn't. Said by
  // no editor, so every open copy re-reads, including one in the tab that
  // made the change somewhere else.
  for (const page of moved)
    await announceDocChange(db, page.id, page.version, "task");
}
