import { fail, itemData, type Action, type Item } from "@orbyn/core";
import type { Db } from "../../db/pool.js";

/**
 * The single write path for planner items, used by the REST routes and by AI
 * proposal application. Enforces ownership and optimistic locking on `version`.
 * Must run inside a transaction (it takes a row lock).
 */
export async function mutate(
  db: Db,
  userId: string,
  action: Action,
): Promise<Item | null> {
  const { operation, item_id, version } = action;
  if (operation !== "create") {
    const item = (
      await db.query(
        "SELECT * FROM items WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [item_id, userId],
      )
    ).rows[0];
    if (!item) fail(404, "Item not found");
    if (item.version !== version)
      fail(409, "This item changed. Refresh and try again.");
    if (operation === "delete") {
      await db.query("DELETE FROM items WHERE id=$1", [item_id]);
      return null;
    }
  }
  const d = itemData.parse(action.data);
  const values = [
    d.title,
    d.notes,
    d.kind,
    d.status,
    d.priority,
    d.due_at,
    d.end_at,
    d.reminder_minutes,
  ];
  if (operation === "create")
    return (
      await db.query<Item>(
        "INSERT INTO items(title,notes,kind,status,priority,due_at,end_at,reminder_minutes,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [...values, userId],
      )
    ).rows[0];
  // reminder_version only bumps when the schedule changes or a done item is reopened,
  // so content-only edits never resend an already delivered reminder.
  return (
    await db.query<Item>(
      `UPDATE items SET title=$1,notes=$2,kind=$3,status=$4,priority=$5,due_at=$6,end_at=$7,reminder_minutes=$8,version=version+1,reminder_version=CASE WHEN due_at IS DISTINCT FROM $6::timestamptz OR reminder_minutes<>$8 OR (status='done' AND $4='todo') THEN reminder_version+1 ELSE reminder_version END,updated_at=now() WHERE id=$9 RETURNING *`,
      [...values, item_id],
    )
  ).rows[0];
}
