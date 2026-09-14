import { fail, itemData, type Action, type Item } from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import { requireTeam } from "../../lib/teams.js";

type Actor = { id: string; role: "admin" | "member" };

export type ItemRow = Item & {
  user_id: string;
  team_id: string | null;
  progress: number;
};

/**
 * Personal items belong to their creator alone. Team items follow team roles:
 * viewers read, members and above write. Anyone else gets 404.
 */
export async function requireItemAccess(
  actor: Actor,
  item: ItemRow,
  permission: "items:read" | "items:write",
  db?: Db,
) {
  if (item.team_id) await requireTeam(item.team_id, actor, permission, db);
  else if (item.user_id !== actor.id) fail(404, "Item not found");
}

/** Lock an item row for the rest of the transaction, or 404. */
export async function lockItem(db: Db, id: string): Promise<ItemRow> {
  const item = (
    await db.query<ItemRow>("SELECT * FROM items WHERE id=$1 FOR UPDATE", [id])
  ).rows[0];
  if (!item) fail(404, "Item not found");
  return item;
}

/**
 * Refresh the stored checklist counts. When a task has checklist steps, its
 * progress is the share of steps done.
 * Ticking the first step moves a to-do task to in progress; finishing every
 * step does not mark it done, so people still close it deliberately.
 */
export async function recomputeProgress(db: Db, itemId: string) {
  await db.query(
    `UPDATE items i SET
       steps_total = s.total,
       steps_done = s.done,
       progress = CASE WHEN s.total > 0 THEN s.pct ELSE i.progress END,
       status = CASE WHEN s.total > 0 AND i.status = 'todo' AND s.pct > 0 THEN 'in_progress' ELSE i.status END,
       updated_at = now()
     FROM (
       SELECT count(*)::int AS total,
              count(*) FILTER (WHERE done)::int AS done,
              round(count(*) FILTER (WHERE done) * 100.0 / NULLIF(count(*), 0))::int AS pct
       FROM item_steps WHERE item_id = $1
     ) s
     WHERE i.id = $1`,
    [itemId],
  );
}

/**
 * The single write path for planner items, used by the REST routes and by AI
 * proposal application. Enforces RBAC and optimistic locking on `version`.
 * Must run inside a transaction (it takes a row lock).
 */
export async function mutate(
  db: Db,
  actor: Actor,
  action: Action,
): Promise<Item | null> {
  const { operation, item_id, version } = action;
  let item: ItemRow | undefined;
  if (operation !== "create") {
    item = await lockItem(db, item_id!);
    await requireItemAccess(actor, item, "items:write", db);
    if (item.version !== version)
      fail(409, "This item changed. Refresh and try again.");
    if (operation === "delete") {
      await db.query("DELETE FROM items WHERE id=$1", [item_id]);
      return null;
    }
  }
  const d = itemData.parse(action.data);
  if (operation === "create") {
    if (d.team_id) await requireTeam(d.team_id, actor, "items:write", db);
    return (
      await db.query<Item>(
        "INSERT INTO items(title,notes,kind,status,priority,due_at,end_at,reminder_minutes,team_id,user_id,progress) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
        [
          d.title,
          d.notes,
          d.kind,
          d.status,
          d.priority,
          d.due_at,
          d.end_at,
          d.reminder_minutes,
          d.team_id,
          actor.id,
          d.progress ?? (d.status === "done" ? 100 : 0),
        ],
      )
    ).rows[0];
  }
  const current = item!;
  let owner = current.user_id;
  if (d.team_id !== current.team_id) {
    // Moving into a team needs write access there; moving out of a team needs
    // member-management rights in the team it leaves.
    if (d.team_id) await requireTeam(d.team_id, actor, "items:write", db);
    if (current.team_id) {
      await requireTeam(current.team_id, actor, "members:manage", db);
      if (!d.team_id) owner = actor.id;
    }
  }
  // Omitted progress keeps the saved value; marking done completes it.
  const progress = d.progress ?? (d.status === "done" ? 100 : current.progress);
  // reminder_version only bumps when the schedule changes, a done item is
  // reopened, or the item moves (its audience changes), so content-only edits
  // never resend an already delivered reminder.
  return (
    await db.query<Item>(
      `UPDATE items SET title=$1,notes=$2,kind=$3,status=$4,priority=$5,due_at=$6,end_at=$7,reminder_minutes=$8,team_id=$9,user_id=$10,progress=$12,version=version+1,reminder_version=CASE WHEN due_at IS DISTINCT FROM $6::timestamptz OR reminder_minutes<>$8 OR (status='done' AND $4<>'done') OR team_id IS DISTINCT FROM $9::uuid THEN reminder_version+1 ELSE reminder_version END,updated_at=now() WHERE id=$11 RETURNING *`,
      [
        d.title,
        d.notes,
        d.kind,
        d.status,
        d.priority,
        d.due_at,
        d.end_at,
        d.reminder_minutes,
        d.team_id,
        owner,
        current.id,
        progress,
      ],
    )
  ).rows[0];
}
