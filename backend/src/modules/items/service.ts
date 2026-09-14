import { fail, itemData, type Action, type Item } from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import { requireTeam } from "../../lib/teams.js";

type Actor = { id: string; role: "admin" | "member" };

type ItemRow = Item & { user_id: string; team_id: string | null };

/**
 * Personal items belong to their creator alone. Team items follow team roles:
 * viewers read, members and above write. Anyone else gets 404.
 */
async function requireItemWrite(db: Db, actor: Actor, item: ItemRow) {
  if (item.team_id) await requireTeam(item.team_id, actor, "items:write", db);
  else if (item.user_id !== actor.id) fail(404, "Item not found");
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
    item = (
      await db.query<ItemRow>("SELECT * FROM items WHERE id=$1 FOR UPDATE", [
        item_id,
      ])
    ).rows[0];
    if (!item) fail(404, "Item not found");
    await requireItemWrite(db, actor, item);
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
        "INSERT INTO items(title,notes,kind,status,priority,due_at,end_at,reminder_minutes,team_id,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
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
  // reminder_version only bumps when the schedule changes, a done item is
  // reopened, or the item moves (its audience changes), so content-only edits
  // never resend an already delivered reminder.
  return (
    await db.query<Item>(
      `UPDATE items SET title=$1,notes=$2,kind=$3,status=$4,priority=$5,due_at=$6,end_at=$7,reminder_minutes=$8,team_id=$9,user_id=$10,version=version+1,reminder_version=CASE WHEN due_at IS DISTINCT FROM $6::timestamptz OR reminder_minutes<>$8 OR (status='done' AND $4='todo') OR team_id IS DISTINCT FROM $9::uuid THEN reminder_version+1 ELSE reminder_version END,updated_at=now() WHERE id=$11 RETURNING *`,
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
      ],
    )
  ).rows[0];
}
