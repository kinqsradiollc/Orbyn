import {
  addDays,
  dayTime,
  fail,
  isClosed,
  isLocalMidnight,
  itemData,
  localDateKey,
  measureProgress,
  nextOccurrence,
  type Action,
  type Item,
  type ItemInput,
  type Kind,
  type Status,
} from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import { requireTeam, VISIBLE_ITEMS } from "../../lib/teams.js";
import { queueWebhooks } from "../../lib/webhooks.js";
import { openAsk } from "../followthrough/asks.js";
import {
  isOccurrence,
  loadPrefs,
  occurrenceEnd,
  type SeriesRow,
} from "../planner/calendar.js";
import {
  inviteSnapshot,
  loadInviteItem,
  queueCancellations,
  queueInvites,
  syncAttendees,
} from "./attendees.js";

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
  all_day: boolean;
  busy: boolean;
  color: string | null;
  alerts: number[];
  parent_id: string | null;
  position: number;
};

/**
 * Item columns for responses: the team and assignee names, tag ids, the time
 * left (estimate − spent, never below 0) and subtask counts (cancelled
 * subtasks aren't counted).
 */
export const ITEM_COLUMNS = `i.*, t.name AS team_name, a.name AS assignee_name,
  coalesce((SELECT array_agg(it.tag_id ORDER BY it.tag_id) FROM item_tags it WHERE it.item_id = i.id), '{}') AS tag_ids,
  coalesce((SELECT array_agg(dep.prerequisite_id ORDER BY dep.prerequisite_id) FROM item_dependencies dep WHERE dep.item_id = i.id), '{}') AS prerequisite_ids,
  CASE WHEN i.estimate_minutes IS NULL THEN NULL
       ELSE greatest(0, i.estimate_minutes - i.spent_minutes) END AS remaining_minutes,
  (SELECT count(*)::int FROM items c WHERE c.parent_id = i.id AND c.status <> 'cancelled') AS child_count,
  (SELECT count(*)::int FROM items c WHERE c.parent_id = i.id AND c.status = 'done') AS children_done`;

/** Subtasks go this many levels deep at most (a task, its subtask, and theirs). */
export const MAX_SUBTASK_DEPTH = 3;

/**
 * SQL predicate (on alias `x`) for the items sharing a manual order with an
 * item: the same parent, else the same list, else the same space (a team,
 * or someone's personal items). Arguments are parameter references.
 */
export const siblingsOf = (
  parent: string,
  list: string,
  team: string,
  user: string,
) => `CASE WHEN ${parent}::uuid IS NOT NULL THEN x.parent_id = ${parent}::uuid
  WHEN ${list}::uuid IS NOT NULL THEN x.parent_id IS NULL AND x.list_id = ${list}::uuid
  WHEN ${team}::uuid IS NOT NULL THEN x.parent_id IS NULL AND x.list_id IS NULL AND x.team_id = ${team}::uuid
  ELSE x.parent_id IS NULL AND x.list_id IS NULL AND x.team_id IS NULL AND x.user_id = ${user}::uuid END`;
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

/**
 * A task's number to reach (a key result). Omitted fields keep what is
 * saved. While a target is set, progress follows current / target — unless
 * the task is done, which stays at 100.
 */
async function setMeasure(
  db: Db,
  id: string,
  d: {
    target_value?: number | null;
    current_value?: number | null;
    value_unit?: string;
  },
) {
  if (
    d.target_value === undefined &&
    d.current_value === undefined &&
    d.value_unit === undefined
  )
    return;
  const saved = (
    await db.query<{
      target_value: number | null;
      current_value: number | null;
      value_unit: string;
      status: string;
    }>(
      "SELECT target_value, current_value, value_unit, status FROM items WHERE id = $1",
      [id],
    )
  ).rows[0];
  const next = {
    target_value:
      d.target_value === undefined ? saved.target_value : d.target_value,
    current_value:
      d.current_value === undefined ? saved.current_value : d.current_value,
    value_unit: d.value_unit ?? saved.value_unit,
  };
  const pct = measureProgress(next);
  await db.query(
    `UPDATE items SET target_value = $2, current_value = $3, value_unit = $4,
       progress = CASE WHEN $5::int IS NULL OR status = 'done' THEN progress ELSE $5::int END
     WHERE id = $1`,
    [id, next.target_value, next.current_value, next.value_unit, pct],
  );
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

/**
 * A subtask's parent must be a task the actor can see, in the same space
 * (the same team, or both personal to the same person), with no loops and
 * at most three levels in all.
 */
async function checkParent(
  db: Db,
  actor: Actor,
  parentId: string,
  itemId: string | null,
  teamId: string | null,
  owner: string,
) {
  const parent = (
    await db.query<{ user_id: string; team_id: string | null; kind: Kind }>(
      "SELECT user_id, team_id, kind FROM items WHERE id = $1",
      [parentId],
    )
  ).rows[0];
  const hidden = "That parent task isn't one you can see.";
  if (!parent) fail(422, hidden);
  const visible = parent.team_id
    ? (
        await db.query(
          "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2",
          [parent.team_id, actor.id],
        )
      ).rowCount
    : parent.user_id === actor.id;
  if (!visible) fail(422, hidden);
  if (parent.kind !== "task") fail(422, "Subtasks go under a task.");
  const same = teamId
    ? parent.team_id === teamId
    : !parent.team_id && parent.user_id === owner;
  if (!same)
    fail(
      422,
      teamId
        ? "A team task's parent must be one of this team's tasks."
        : "A personal task's parent must be one of your personal tasks.",
    );
  // The parent and everything above it.
  const above = (
    await db.query<{ id: string }>(
      `WITH RECURSIVE up (id, parent_id, depth) AS (
         SELECT id, parent_id, 1 FROM items WHERE id = $1
         UNION ALL
         SELECT i.id, i.parent_id, up.depth + 1 FROM items i JOIN up ON i.id = up.parent_id
         WHERE up.depth < 10)
       SELECT id FROM up`,
      [parentId],
    )
  ).rows.map((r) => r.id);
  if (itemId && above.includes(itemId))
    fail(422, "A task can't be a subtask of itself or of its own subtasks.");
  // The item and the levels of subtasks below it.
  const height = itemId
    ? (
        await db.query<{ n: number }>(
          `WITH RECURSIVE down (id, depth) AS (
             SELECT id, 1 FROM items WHERE id = $1
             UNION ALL
             SELECT c.id, down.depth + 1 FROM items c JOIN down ON c.parent_id = down.id
             WHERE down.depth < 10)
           SELECT max(depth)::int AS n FROM down`,
          [itemId],
        )
      ).rows[0].n
    : 1;
  if (above.length + height > MAX_SUBTASK_DEPTH)
    fail(422, `Subtasks go ${MAX_SUBTASK_DEPTH} levels deep at most.`);
}

/** Replace an item's links, keeping their order. */
async function setLinks(
  db: Db,
  itemId: string,
  links: { url: string; title: string }[],
) {
  await db.query("DELETE FROM item_links WHERE item_id = $1", [itemId]);
  if (links.length)
    await db.query(
      `INSERT INTO item_links (item_id, url, title, position)
       SELECT $1, l.url, l.title, l.n - 1
       FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS l (url, title, n)`,
      [itemId, links.map((l) => l.url), links.map((l) => l.title ?? "")],
    );
}

/** Parents' subtask counts changed: mark them changed for incremental sync. */
async function touch(db: Db, ids: (string | null | undefined)[]) {
  const set = [...new Set(ids.filter((id): id is string => !!id))];
  if (set.length)
    await db.query(
      "UPDATE items SET updated_at = now() WHERE id = ANY ($1::uuid[])",
      [set],
    );
}

/**
 * Record items about to be deleted (with all their subtasks), so incremental
 * sync can report them to whoever could see them: the owner of a personal
 * item, or the item's team. Returns every item recorded.
 */
export async function recordDeletions(db: Db, ids: string[]) {
  if (!ids.length) return [];
  return (
    await db.query<{
      id: string;
      title: string;
      user_id: string;
      team_id: string | null;
    }>(
      `WITH RECURSIVE tree (id) AS (
         SELECT id FROM items WHERE id = ANY ($1::uuid[])
         UNION
         SELECT c.id FROM items c JOIN tree ON c.parent_id = tree.id),
       recorded AS (
         INSERT INTO deleted_items (item_id, user_id, team_id)
         SELECT i.id, i.user_id, i.team_id FROM items i JOIN tree ON tree.id = i.id
         ON CONFLICT (item_id) DO UPDATE SET deleted_at = now()
         RETURNING item_id)
       SELECT i.id, i.title, i.user_id, i.team_id
       FROM items i JOIN recorded r ON r.item_id = i.id`,
      [ids],
    )
  ).rows;
}

/**
 * With `count_blocks_as_spent` on, completing a task adds the past time of
 * its blocks to its time spent. Each block counts once, even if the task is
 * reopened and completed again.
 */
export async function countBlocksAsSpent(
  db: Db,
  actorId: string,
  itemId: string,
) {
  if (!(await loadPrefs(db, actorId)).count_blocks_as_spent) return;
  await db.query(
    `WITH counted AS (
       UPDATE time_blocks SET counted = true
       WHERE item_id = $1 AND NOT counted AND start_at < now()
       RETURNING extract(epoch FROM (least(end_at, now()) - start_at)) / 60 AS minutes)
     UPDATE items SET spent_minutes = spent_minutes
       + coalesce((SELECT round(sum(minutes))::int FROM counted), 0)
     WHERE id = $1`,
    [itemId],
  );
}

/**
 * Move an item in its manual order: before or after another item in the
 * same place, or to an index. The items in that place are numbered again
 * from 0. Like checklist steps, this doesn't change the edit version.
 */
export async function moveItem(
  db: Db,
  item: ItemRow,
  to: { before_id?: string; after_id?: string; position?: number },
) {
  const scope = [item.parent_id, item.list_id, item.team_id, item.user_id];
  // One reorder at a time per place.
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `position:${scope.map((s) => s ?? "").join(":")}`,
  ]);
  const order = (
    await db.query<{ id: string }>(
      `SELECT x.id FROM items x WHERE ${siblingsOf("$1", "$2", "$3", "$4")}
       ORDER BY x.position, x.created_at, x.id`,
      scope,
    )
  ).rows
    .map((r) => r.id)
    .filter((id) => id !== item.id);
  const other = to.before_id ?? to.after_id;
  let index: number;
  if (other !== undefined) {
    if (other === item.id) fail(422, "Pick another item to move it next to.");
    const at = order.indexOf(other);
    if (at < 0)
      fail(422, "That item isn't in the same list, so it can't go next to it.");
    index = to.before_id ? at : at + 1;
  } else index = Math.min(to.position ?? 0, order.length);
  order.splice(index, 0, item.id);
  await db.query(
    `UPDATE items x SET position = v.n - 1, updated_at = now()
     FROM unnest($1::uuid[]) WITH ORDINALITY AS v (id, n)
     WHERE x.id = v.id AND x.position IS DISTINCT FROM (v.n - 1)::int`,
    [order],
  );
}

/**
 * Check and save what a task waits on.
 *
 * A prerequisite has to be a task the same person can already see, or the
 * planner would leak one space's titles into another's schedule. A task
 * cannot wait on itself, and it cannot wait on anything that is already
 * waiting on it however far down the chain — a cycle would leave every task
 * in it permanently unplaceable, with nothing to say why.
 */
async function setPrerequisites(
  db: Db,
  actor: Actor,
  itemId: string,
  ids: string[],
) {
  const wanted = [...new Set(ids)].filter((id) => id !== itemId);
  if (wanted.length !== new Set(ids).size)
    fail(422, "A task can't wait on itself.");
  if (wanted.length) {
    const visible = (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM items i
          WHERE i.id = ANY($2::uuid[]) AND i.kind = 'task' AND (${VISIBLE_ITEMS})`,
        [actor.id, wanted],
      )
    ).rows[0].n;
    if (visible !== wanted.length)
      fail(422, "A task can only wait on tasks you can see.");
    const cycle = await db.query(
      `WITH RECURSIVE chain(id) AS (
         SELECT unnest($2::uuid[])
         UNION
         SELECT d.prerequisite_id FROM item_dependencies d JOIN chain c ON d.item_id = c.id
       )
       SELECT 1 FROM chain WHERE id = $1 LIMIT 1`,
      [itemId, wanted],
    );
    if (cycle.rowCount)
      fail(
        422,
        "That would make a loop: these tasks would wait on each other.",
      );
  }
  await db.query("DELETE FROM item_dependencies WHERE item_id = $1", [itemId]);
  if (wanted.length)
    await db.query(
      `INSERT INTO item_dependencies (item_id, prerequisite_id)
       SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [itemId, wanted],
    );
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
 * An all-day item's times: `due_at` must be midnight in its time zone and
 * `end_at` the midnight after its last day. An all-day event without an
 * end lasts one day; an all-day task can have no end.
 */
export function allDayTimes(
  kind: Kind,
  dueAt: string | null,
  endAt: string | null,
  timeZone: string,
) {
  if (!dueAt) fail(422, "All-day items need a date.");
  const start = new Date(dueAt);
  if (!isLocalMidnight(start, timeZone))
    fail(
      422,
      `All-day items start at midnight in their time zone (${timeZone}).`,
    );
  if (endAt && !isLocalMidnight(new Date(endAt), timeZone))
    fail(422, "All-day items end at midnight at the end of their last day.");
  return {
    due_at: start.toISOString(),
    end_at: endAt
      ? new Date(endAt).toISOString()
      : kind === "event"
        ? dayTime(
            addDays(localDateKey(start, timeZone), 1),
            0,
            timeZone,
          ).toISOString()
        : null,
  };
}

const smallest = (alerts: number[]) =>
  alerts.length ? Math.min(...alerts) : null;

/**
 * The alerts an item gets. Given alerts win. An older app's
 * `reminder_minutes` sets them on a new item, and on an edit replaces the
 * smallest (soonest) alert when it changed, so the others survive. Otherwise
 * an edit keeps the saved alerts; a new item gets `defaults`.
 */
function alertsFor(
  d: ItemInput,
  saved: number[] | undefined,
  defaults: number[],
): number[] {
  if (d.alerts !== undefined) return d.alerts;
  if (d.reminder_minutes !== undefined) {
    if (!saved) return [d.reminder_minutes];
    const soonest = smallest(saved);
    if (soonest === d.reminder_minutes) return saved;
    return [
      ...new Set([...saved.filter((a) => a !== soonest), d.reminder_minutes]),
    ].sort((a, b) => a - b);
  }
  return saved ?? defaults;
}

/**
 * The single write path for planner items, used by the REST routes, AI
 * proposal application, and bookings. Enforces RBAC and optimistic locking on
 * `version`. Must run inside a transaction (it takes a row lock). Planning
 * and event fields left out of an edit keep their saved values. People
 * invited to an event are emailed about changes to it (when SMTP is set up).
 */
export async function mutate(
  db: Db,
  actor: Actor,
  action: Action,
  /** For a create: the id the device already gave it (made offline). */
  createId?: string,
): Promise<Item | null> {
  const { operation, item_id, version } = action;
  await db.query("SELECT set_config('orbyn.user_id', $1, true)", [actor.id]);
  let item: ItemRow | undefined;
  if (operation !== "create") {
    item = await lockItem(db, item_id!);
    await requireItemAccess(actor, item, "items:write", db);
    if (item.version !== version)
      fail(409, "This item changed. Refresh and try again.");
    if (operation === "delete") {
      const invited = await inviteSnapshot(db, item.id);
      // Its subtasks go with it; sync hears about every one.
      const gone = await recordDeletions(db, [item.id]);
      await db.query("DELETE FROM items WHERE id=$1", [item_id]);
      await touch(db, [item.parent_id]);
      if (invited)
        await queueCancellations(db, invited.item, invited.people, false);
      for (const g of [item, ...gone.filter((g) => g.id !== item!.id)])
        await queueWebhooks(db, "item.deleted", g, {
          id: g.id,
          title: g.title,
          team_id: g.team_id,
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
    const parentId = d.parent_id ?? null;
    if (parentId)
      await checkParent(db, actor, parentId, null, d.team_id, actor.id);
    const prefs = await loadPrefs(db, actor.id);
    const allDay = d.all_day ?? false;
    // An all-day item keeps its days in the planner's zone unless it has its own.
    const timezone = d.timezone ?? (allDay ? prefs.timezone : "UTC");
    const times = allDay
      ? allDayTimes(d.kind, d.due_at, d.end_at, timezone)
      : { due_at: d.due_at, end_at: d.end_at };
    const alerts = alertsFor(
      d,
      undefined,
      prefs.default_alerts![allDay ? "all_day" : d.kind],
    );
    const created = (
      await db.query<{ id: string }>(
        `INSERT INTO items (id, title, notes, kind, status, priority, due_at, end_at,
           reminder_minutes, team_id, user_id, progress, estimate_minutes, list_id,
           assignee_id, location, meeting_url, rrule, timezone, series_start,
           all_day, busy, color, alerts, parent_id, position)
         VALUES (coalesce($24::uuid, gen_random_uuid()),
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
           CASE WHEN $17::text IS NULL THEN NULL ELSE $6::timestamptz END,
           $19,$20,$21,$22::integer[],$23,
           (SELECT coalesce(max(x.position), -1) + 1 FROM items x
            WHERE ${siblingsOf("$23", "$13", "$9", "$10")}))
         RETURNING id`,
        [
          d.title,
          d.notes,
          d.kind,
          d.status,
          d.priority,
          times.due_at,
          times.end_at,
          smallest(alerts),
          d.team_id,
          actor.id,
          d.progress ?? (d.status === "done" ? 100 : 0),
          d.estimate_minutes ?? null,
          listId,
          d.assignee_id ?? null,
          d.location ?? "",
          d.meeting_url ?? "",
          d.rrule ?? null,
          timezone,
          allDay,
          d.busy ?? true,
          d.color ?? null,
          alerts,
          parentId,
          createId ?? null,
        ],
      )
    ).rows[0];
    await setTags(db, created.id, tagIds);
    if (d.kind === "task") await setMeasure(db, created.id, d);
    // Only a task waits on anything; an event happens when it happens.
    if (d.prerequisite_ids?.length && d.kind === "task")
      await setPrerequisites(db, actor, created.id, d.prerequisite_ids);
    if (d.links?.length) await setLinks(db, created.id, d.links);
    await touch(db, [parentId]);
    if (d.attendees?.length) {
      await syncAttendees(db, created.id, d.attendees);
      await queueInvites(db, created.id);
    }
    const result = await loadItem(db, created.id);
    await queueWebhooks(
      db,
      "item.created",
      { user_id: actor.id, team_id: d.team_id },
      result,
    );
    // Handed to someone else: they're asked, not told.
    if (d.team_id && d.kind === "task") await openAsk(db, actor.id, result);
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
  // A saved assignee who has since left the team doesn't stop other changes,
  // such as ticking the task off; a new one, or one taken to another space,
  // has to be a member.
  if (moved || assignee !== current.assignee_id)
    await checkAssignee(db, d.team_id, d.team_id ? assignee : null);
  // A subtask moved to another space leaves its parent, like its list.
  const parentId =
    d.kind === "task"
      ? keep(d.parent_id, moved ? null : current.parent_id)
      : null;
  if (parentId && (parentId !== current.parent_id || moved))
    await checkParent(db, actor, parentId, current.id, d.team_id, owner);
  if (moved || d.kind !== "task") {
    const children = (
      await db.query("SELECT 1 FROM items WHERE parent_id = $1 LIMIT 1", [
        current.id,
      ])
    ).rowCount;
    if (children)
      fail(
        422,
        moved
          ? "Move or detach its subtasks first."
          : "A task with subtasks stays a task.",
      );
  }
  // A new parent, list or space puts it at the end of the order there.
  const reorder =
    parentId !== current.parent_id || listId !== current.list_id || moved;
  const rrule = keep(d.rrule, current.rrule);
  const allDay = keep(d.all_day, current.all_day);
  let timezone = keep(d.timezone, current.timezone);
  // Turning an item all-day keeps its days in the planner's zone.
  if (
    allDay &&
    !current.all_day &&
    d.timezone === undefined &&
    timezone === "UTC"
  )
    timezone = (await loadPrefs(db, actor.id)).timezone;
  const location = keep(d.location, current.location);
  const meetingUrl = keep(d.meeting_url, current.meeting_url);
  const alerts = alertsFor(d, current.alerts.map(Number), []);

  let status = d.status;
  let dueAt = d.due_at;
  let endAt = d.end_at;
  if (allDay)
    ({ due_at: dueAt, end_at: endAt } = allDayTimes(
      d.kind,
      dueAt,
      endAt,
      timezone,
    ));
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
      const series: SeriesRow = {
        id: current.id,
        kind: d.kind,
        due_at: new Date(dueAt),
        end_at: endAt ? new Date(endAt) : null,
        rrule,
        timezone,
        series_start: new Date(seriesStart),
        exdates: exdates.map((x) => new Date(x)),
        all_day: allDay,
      };
      dueAt = next.toISOString();
      endAt = occurrenceEnd(series, next)?.toISOString() ?? null;
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
       exdates=$21::timestamptz[], all_day=$22, busy=$23, color=$24,
       alerts=$25::integer[], parent_id=$26, version=version+1,
       position = CASE WHEN $27::boolean
         THEN (SELECT coalesce(max(x.position), -1) + 1 FROM items x
               WHERE ${siblingsOf("$26", "$14", "$9", "$10")} AND x.id <> $11)
         ELSE position END,
       reminder_version = CASE WHEN due_at IS DISTINCT FROM $6::timestamptz
         OR alerts IS DISTINCT FROM $25::integer[]
         OR (status IN ('done', 'cancelled') AND $4 NOT IN ('done', 'cancelled'))
         OR team_id IS DISTINCT FROM $9::uuid
         THEN reminder_version + 1 ELSE reminder_version END,
       -- A project belongs to one space: moved to another, the task leaves
       -- the project and its stage, which the new space can't see.
       project_id = CASE WHEN team_id IS DISTINCT FROM $9::uuid
         THEN NULL ELSE project_id END,
       stage_id = CASE WHEN team_id IS DISTINCT FROM $9::uuid
         THEN NULL ELSE stage_id END,
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
      smallest(alerts),
      d.team_id,
      owner,
      current.id,
      progress,
      keep(d.estimate_minutes, current.estimate_minutes),
      listId,
      d.team_id ? assignee : null,
      location,
      meetingUrl,
      rrule,
      timezone,
      seriesStart,
      exdates,
      allDay,
      keep(d.busy, current.busy),
      keep(d.color, current.color),
      alerts,
      parentId,
      reorder,
    ],
  );
  // A page line tied to this task now reads ticked or not with it, and a
  // tick there counts from what it shows (see syncTicks in docs/routes.ts).
  // A page's own tick puts its line's state back afterwards.
  if ((status === "done") !== (current.status === "done"))
    await db.query("UPDATE doc_task_links SET done = $2 WHERE item_id = $1", [
      current.id,
      status === "done",
    ]);
  await setTags(db, current.id, tagIds);
  if (d.kind === "task") await setMeasure(db, current.id, d);
  else
    await db.query(
      "UPDATE items SET target_value = NULL, current_value = NULL, value_unit = '' WHERE id = $1",
      [current.id],
    );
  // Omitted keeps what is saved, like the other planning fields; a task that
  // stops being a task stops waiting on anything.
  if (d.kind !== "task")
    await db.query("DELETE FROM item_dependencies WHERE item_id = $1", [
      current.id,
    ]);
  else if (d.prerequisite_ids !== undefined)
    await setPrerequisites(db, actor, current.id, d.prerequisite_ids);
  if (d.links !== undefined) await setLinks(db, current.id, d.links);
  if (parentId !== current.parent_id || status !== current.status)
    await touch(db, [current.parent_id, parentId]);

  // Changes to single occurrences stay only while they're still occurrences.
  if (!rrule)
    await db.query("DELETE FROM item_overrides WHERE item_id = $1", [
      current.id,
    ]);
  else if (
    rrule !== current.rrule ||
    seriesStart !== iso(current.series_start) ||
    timezone !== current.timezone
  ) {
    const series: SeriesRow = {
      id: current.id,
      kind: d.kind,
      due_at: new Date(dueAt!),
      end_at: endAt ? new Date(endAt) : null,
      rrule,
      timezone,
      series_start: seriesStart ? new Date(seriesStart) : null,
      exdates: exdates.map((x) => new Date(x)),
      all_day: allDay,
    };
    const stale = (
      await db.query<{ occurrence: Date }>(
        "SELECT occurrence FROM item_overrides WHERE item_id = $1",
        [current.id],
      )
    ).rows
      .map((r) => r.occurrence)
      .filter((at) => !isOccurrence(series, at));
    if (stale.length)
      await db.query(
        "DELETE FROM item_overrides WHERE item_id = $1 AND occurrence = ANY ($2::timestamptz[])",
        [current.id, stale],
      );
  }

  // Invitees: only events have them. They hear about changes to what, when
  // and where; people added or taken off hear about that.
  const invitees = d.kind === "event" ? d.attendees : [];
  const sync = invitees
    ? await syncAttendees(db, current.id, invitees)
    : { added: [], removed: [] };
  if (sync.removed.length) {
    const now = await loadInviteItem(db, current.id);
    if (now)
      await queueCancellations(
        db,
        { ...now, kind: current.kind },
        sync.removed,
        true,
      );
  }
  const noticeable =
    current.kind !== d.kind ||
    current.title !== d.title ||
    iso(current.due_at) !== iso(dueAt) ||
    iso(current.end_at) !== iso(endAt) ||
    current.location !== location ||
    current.meeting_url !== meetingUrl ||
    current.rrule !== rrule ||
    current.all_day !== allDay ||
    (!!rrule && current.timezone !== timezone);
  if (d.kind === "event") {
    if (noticeable) await queueInvites(db, current.id, { updated: true });
    else if (sync.added.length)
      await queueInvites(db, current.id, { only: sync.added });
  }

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
  // Completing counts the blocks' past time as spent (when asked to).
  if (d.status === "done" && current.status !== "done")
    await countBlocksAsSpent(db, actor.id, current.id);
  // Sessions for work that's finished or cancelled aren't needed any more. A
  // repeating task that moved on keeps the sessions meant for its next
  // occurrence: only those before the finished one's deadline go.
  if (completedOccurrence)
    await db.query(
      `DELETE FROM time_blocks
        WHERE item_id = $1 AND start_at > now() AND start_at < $2`,
      [current.id, completedOccurrence],
    );
  else if (isClosed(status) && !isClosed(current.status))
    await db.query(
      "DELETE FROM time_blocks WHERE item_id = $1 AND start_at > now()",
      [current.id],
    );
  const result = await loadItem(db, current.id);
  // Handed to someone new: they're asked, not told.
  if (
    d.team_id &&
    d.kind === "task" &&
    assignee &&
    assignee !== current.assignee_id
  )
    await openAsk(db, actor.id, result);
  const audience = { user_id: owner, team_id: d.team_id };
  await queueWebhooks(db, "item.updated", audience, result);
  if (d.status === "done" && current.status !== "done")
    await queueWebhooks(db, "item.completed", audience, result);
  return result;
}

/**
 * Change a task's status the way any other edit does: through `mutate`, so
 * finishing it clears its future sessions, a repeating task moves on to its
 * next occurrence, and webhooks and open apps hear about it. Used by the
 * quick tick (a progress update) and by ticking a page's checklist line.
 * No version is needed: a tick is never a stale edit. Only the core fields
 * are sent, so every planning field keeps its saved value and isn't checked
 * again (a tick shouldn't fail over a tag or a prerequisite). Progress
 * follows the usual rule (100 when done, otherwise kept) unless one is
 * given. Must run inside a transaction.
 */
export async function setItemStatus(
  db: Db,
  actor: Actor,
  itemId: string,
  status: Status,
  progress?: number,
): Promise<Item> {
  const row = await lockItem(db, itemId);
  const iso = (v: Date | string | null) =>
    v ? new Date(v).toISOString() : null;
  return (await mutate(db, actor, {
    operation: "update",
    item_id: itemId,
    version: row.version,
    data: itemData.parse({
      title: row.title,
      notes: row.notes,
      kind: row.kind,
      status,
      priority: row.priority,
      due_at: iso(row.due_at),
      end_at: iso(row.end_at),
      team_id: row.team_id,
      ...(progress === undefined ? {} : { progress }),
    }),
  }))!;
}
