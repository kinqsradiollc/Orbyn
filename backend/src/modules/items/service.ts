import {
  fail,
  itemData,
  nextOccurrence,
  type Action,
  type Item,
} from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import { requireTeam } from "../../lib/teams.js";
import { queueWebhooks } from "../../lib/webhooks.js";

type Actor = { id: string; role: "admin" | "member" };

export type ItemRow = Item & {
  user_id: string;
  team_id: string | null;
  progress: number;
  estimate_minutes: number | null;
  list_id: string | null;
  assignee_id: string | null;
  location: string;
  meeting_url: string;
  rrule: string | null;
  timezone: string;
  series_start: Date | string | null;
  exdates: (Date | string)[];
};

/** Item columns for responses: the team and assignee names and tag ids. */
export const ITEM_COLUMNS = `i.*, t.name AS team_name, a.name AS assignee_name,
  coalesce((SELECT array_agg(it.tag_id ORDER BY it.tag_id) FROM item_tags it WHERE it.item_id = i.id), '{}') AS tag_ids`;
export const ITEM_FROM = `items i LEFT JOIN teams t ON t.id = i.team_id LEFT JOIN users a ON a.id = i.assignee_id`;

/** One item as the API returns it. */
export async function loadItem(db: Db, id: string): Promise<Item> {
  return (
    await db.query<Item>(
      `SELECT ${ITEM_COLUMNS} FROM ${ITEM_FROM} WHERE i.id = $1`,
      [id],
    )
  ).rows[0];
}

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
 * A list or tags must belong where the item lives: the owner's own for a
 * personal item, the item's team for a team item.
 */
async function checkPlacement(
  db: Db,
  owner: string,
  teamId: string | null,
  listId: string | null,
  tagIds: string[],
) {
  const scope = `CASE WHEN $2::uuid IS NULL THEN x.team_id IS NULL AND x.user_id = $1 ELSE x.team_id = $2 END`;
  if (listId) {
    const ok = await db.query(
      `SELECT 1 FROM lists x WHERE x.id = $3 AND ${scope}`,
      [owner, teamId, listId],
    );
    if (!ok.rowCount)
      fail(
        422,
        teamId
          ? "That list isn't one of this team's lists."
          : "That list isn't one of your personal lists.",
      );
  }
  if (tagIds.length) {
    const found = (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tags x WHERE x.id = ANY($3::uuid[]) AND ${scope}`,
        [owner, teamId, tagIds],
      )
    ).rows[0].n;
    if (found !== new Set(tagIds).size)
      fail(
        422,
        teamId
          ? "Use this team's tags on team items."
          : "Use your personal tags on personal items.",
      );
  }
}

async function checkAssignee(
  db: Db,
  teamId: string | null,
  assignee: string | null,
) {
  if (!assignee) return;
  const member = await db.query(
    "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, assignee],
  );
  if (!member.rowCount) fail(422, "Assign team items to someone in the team.");
}

async function setTags(db: Db, itemId: string, tagIds: string[]) {
  await db.query("DELETE FROM item_tags WHERE item_id = $1", [itemId]);
  if (tagIds.length)
    await db.query(
      "INSERT INTO item_tags (item_id, tag_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING",
      [itemId, [...new Set(tagIds)]],
    );
}

const iso = (v: Date | string | null | undefined) =>
  v == null ? null : new Date(v).toISOString();

/**
 * The single write path for planner items, used by the REST routes, AI
 * proposal application, and bookings. Enforces RBAC and optimistic locking on
 * `version`. Must run inside a transaction (it takes a row lock). Planning
 * fields left out of an edit keep their saved values.
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
      await queueWebhooks(db, "item.deleted", item, {
        id: item.id,
        title: item.title,
        team_id: item.team_id,
      });
      return null;
    }
  }
  const d = itemData.parse(action.data);

  if (operation === "create") {
    if (d.team_id) await requireTeam(d.team_id, actor, "items:write", db);
    const listId = d.list_id ?? null;
    const tagIds = d.tag_ids ?? [];
    await checkPlacement(db, actor.id, d.team_id, listId, tagIds);
    await checkAssignee(db, d.team_id, d.assignee_id ?? null);
    const created = (
      await db.query<{ id: string }>(
        `INSERT INTO items (title, notes, kind, status, priority, due_at, end_at,
           reminder_minutes, team_id, user_id, progress, estimate_minutes, list_id,
           assignee_id, location, meeting_url, rrule, timezone, series_start)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
           CASE WHEN $17::text IS NULL THEN NULL ELSE $6::timestamptz END)
         RETURNING id`,
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
          d.estimate_minutes ?? null,
          listId,
          d.assignee_id ?? null,
          d.location ?? "",
          d.meeting_url ?? "",
          d.rrule ?? null,
          d.timezone ?? "UTC",
        ],
      )
    ).rows[0];
    await setTags(db, created.id, tagIds);
    const result = await loadItem(db, created.id);
    await queueWebhooks(
      db,
      "item.created",
      { user_id: actor.id, team_id: d.team_id },
      result,
    );
    return result;
  }

  const current = item!;
  let owner = current.user_id;
  const moved = d.team_id !== current.team_id;
  if (moved) {
    // Moving into a team needs write access there; moving out of a team needs
    // member-management rights in the team it leaves.
    if (d.team_id) await requireTeam(d.team_id, actor, "items:write", db);
    if (current.team_id) {
      await requireTeam(current.team_id, actor, "members:manage", db);
      if (!d.team_id) owner = actor.id;
    }
  }
  // Omitted planning fields keep their saved values; a list, tags or assignee
  // that no longer fit after a move to another team are dropped.
  const keep = <T>(value: T | undefined, saved: T) =>
    value === undefined ? saved : value;
  const savedTags = (
    await db.query<{ tag_id: string }>(
      "SELECT tag_id FROM item_tags WHERE item_id = $1",
      [current.id],
    )
  ).rows.map((r) => r.tag_id);
  const listId = keep(d.list_id, moved ? null : current.list_id);
  const tagIds = keep(d.tag_ids, moved ? [] : savedTags);
  const assignee = keep(d.assignee_id, moved ? null : current.assignee_id);
  await checkPlacement(db, owner, d.team_id, listId, tagIds);
  await checkAssignee(db, d.team_id, d.team_id ? assignee : null);
  const rrule = keep(d.rrule, current.rrule);
  const timezone = keep(d.timezone, current.timezone);

  let status = d.status;
  let dueAt = d.due_at;
  let endAt = d.end_at;
  let progress = d.progress ?? (d.status === "done" ? 100 : current.progress);
  let seriesStart = rrule ? (iso(current.series_start) ?? dueAt) : null;
  // A changed rule or a moved first date starts the series again from here.
  if (rrule && (rrule !== current.rrule || iso(current.due_at) !== iso(dueAt)))
    seriesStart = dueAt;
  let exdates = rrule ? current.exdates.map((x) => iso(x)!) : [];
  let completedOccurrence: string | null = null;

  // Completing a repeating task moves it to its next occurrence instead.
  if (
    rrule &&
    d.kind === "task" &&
    status === "done" &&
    current.status !== "done" &&
    dueAt &&
    seriesStart
  ) {
    const next = nextOccurrence(
      new Date(seriesStart),
      rrule,
      timezone,
      new Date(dueAt),
      exdates,
    );
    if (next) {
      completedOccurrence = dueAt;
      const length = endAt ? Date.parse(endAt) - Date.parse(dueAt) : 0;
      dueAt = next.toISOString();
      endAt = length ? new Date(next.getTime() + length).toISOString() : null;
      status = "todo";
      progress = 0;
      await db.query("UPDATE item_steps SET done = false WHERE item_id = $1", [
        current.id,
      ]);
    }
  }
  if (!rrule) exdates = [];

  // reminder_version only bumps when the schedule changes, a done item is
  // reopened, or the item moves (its audience changes), so content-only edits
  // never resend an already delivered reminder.
  await db.query(
    `UPDATE items SET title=$1, notes=$2, kind=$3, status=$4, priority=$5,
       due_at=$6, end_at=$7, reminder_minutes=$8, team_id=$9, user_id=$10,
       progress=$12, estimate_minutes=$13, list_id=$14, assignee_id=$15,
       location=$16, meeting_url=$17, rrule=$18, timezone=$19, series_start=$20,
       exdates=$21::timestamptz[], version=version+1,
       reminder_version = CASE WHEN due_at IS DISTINCT FROM $6::timestamptz
         OR reminder_minutes <> $8 OR (status='done' AND $4 <> 'done')
         OR team_id IS DISTINCT FROM $9::uuid
         THEN reminder_version + 1 ELSE reminder_version END,
       updated_at = now()
     WHERE id = $11`,
    [
      d.title,
      d.notes,
      d.kind,
      status,
      d.priority,
      dueAt,
      endAt,
      d.reminder_minutes,
      d.team_id,
      owner,
      current.id,
      progress,
      keep(d.estimate_minutes, current.estimate_minutes),
      listId,
      d.team_id ? assignee : null,
      keep(d.location, current.location),
      keep(d.meeting_url, current.meeting_url),
      rrule,
      timezone,
      seriesStart,
      exdates,
    ],
  );
  await setTags(db, current.id, tagIds);
  if (completedOccurrence) {
    await recomputeProgress(db, current.id);
    await db.query(
      `INSERT INTO item_updates (item_id, user_id, body, status) VALUES ($1, $2, $3, 'done')`,
      [
        current.id,
        actor.id,
        `Completed the occurrence due ${completedOccurrence.slice(0, 10)}.`,
      ],
    );
    await db.query(
      "UPDATE items SET updates_count = updates_count + 1, last_update_at = now() WHERE id = $1",
      [current.id],
    );
  }
  // Time set aside for work that's finished isn't needed any more.
  if (d.status === "done" && current.status !== "done")
    await db.query(
      "DELETE FROM time_blocks WHERE item_id = $1 AND start_at > now()",
      [current.id],
    );
  const result = await loadItem(db, current.id);
  const audience = { user_id: owner, team_id: d.team_id };
  await queueWebhooks(db, "item.updated", audience, result);
  if (d.status === "done" && current.status !== "done")
    await queueWebhooks(db, "item.completed", audience, result);
  return result;
}
