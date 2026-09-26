import { z } from "zod";
import { fail, WORK_RECORD_KINDS, type WorkRecord } from "@orbyn/core";
import { type Db, type Queryable } from "../../db/pool.js";
import { type UserRow } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import { visibleRecords } from "../../lib/visibility.js";
/**
 * The work-records service: promises, decisions and experiments, which
 * ones someone can see, reading and locking one, and checking what a record
 * may point at. The REST routes, the assistant and agents go through these.
 */
export type Scope = { created_by: string; team_id: string | null };
export type RecordRow = Scope & {
  id: string;
  owner_id: string | null;
  project_id: string | null;
  kind: WorkRecord["kind"];
  status: WorkRecord["status"];
  version: number;
};

// A source note in Trash is not linked to: the record reads as having no
// source until the note is restored (these two replace w.*'s own columns).
export const COLUMNS = `w.*, coalesce(owner.name, 'Unassigned') AS owner_name,
  linked.title AS linked_item_title, linked.status AS linked_item_status,
  CASE WHEN src.deleted_at IS NULL THEN w.source_doc_id END AS source_doc_id,
  CASE WHEN src.deleted_at IS NULL THEN w.source_block_id END AS source_block_id`;
export const JOINS = `LEFT JOIN docs src ON src.id = w.source_doc_id
  LEFT JOIN users owner ON owner.id = w.owner_id
  LEFT JOIN items linked ON linked.id = w.linked_item_id
    AND linked.team_id IS NOT DISTINCT FROM w.team_id
    AND (w.team_id IS NOT NULL OR linked.user_id = w.created_by)`;
export const VISIBLE = visibleRecords("w");

export const listQuery = z
  .object({
    kind: z.enum(WORK_RECORD_KINDS).optional(),
    project_id: z.uuid().optional(),
    owner_id: z.uuid().optional(),
    /** Records about one task or event (a meeting's outcome). */
    source_item_id: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export async function readRecord(db: Queryable, id: string, u: UserRow) {
  const row = (
    await db.query<WorkRecord>(
      `SELECT ${COLUMNS} FROM work_records w ${JOINS}
       WHERE w.id = $2 AND ${VISIBLE}`,
      [u.id, id],
    )
  ).rows[0];
  if (!row) fail(404, "Record not found");
  return row;
}

export async function lockRecord(db: Db, id: string, u: UserRow) {
  const row = (
    await db.query<RecordRow>(
      "SELECT id, created_by, team_id, owner_id, project_id, kind, status, version FROM work_records WHERE id = $1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Record not found");
  if (row.team_id) await requireTeam(row.team_id, u, "items:write", db);
  else if (row.created_by !== u.id) fail(404, "Record not found");
  return row;
}

export async function checkProject(
  db: Db,
  projectId: string | null,
  teamId: string | null,
  u: UserRow,
) {
  if (!projectId) return;
  const row = (
    await db.query<Scope>(
      "SELECT user_id AS created_by, team_id FROM projects WHERE id = $1",
      [projectId],
    )
  ).rows[0];
  if (
    !row ||
    row.team_id !== teamId ||
    (teamId === null && row.created_by !== u.id)
  )
    fail(404, "Project not found in this space");
}

export async function checkDoc(
  db: Db,
  docId: string | null,
  blockId: string | null,
  teamId: string | null,
  u: UserRow,
) {
  if (!docId) {
    if (blockId) fail(422, "Choose a source note for this line.");
    return;
  }
  const row = (
    await db.query<Scope & { has_block: boolean }>(
      `SELECT user_id AS created_by, team_id,
        CASE WHEN $2::text IS NULL THEN true ELSE EXISTS (
          SELECT 1 FROM jsonb_array_elements(content) b WHERE b->>'id' = $2
        ) END AS has_block
       FROM docs WHERE id = $1 AND deleted_at IS NULL`,
      [docId, blockId],
    )
  ).rows[0];
  if (
    !row ||
    row.team_id !== teamId ||
    (teamId === null && row.created_by !== u.id)
  )
    fail(404, "Source note not found in this space");
  if (!row.has_block) fail(422, "That line is no longer in the source note.");
}

export async function checkItem(
  db: Db,
  itemId: string | null,
  teamId: string | null,
  u: UserRow,
  taskOnly: boolean,
) {
  if (!itemId) return;
  const row = (
    await db.query<Scope & { kind: string }>(
      "SELECT user_id AS created_by, team_id, kind FROM items WHERE id = $1",
      [itemId],
    )
  ).rows[0];
  if (
    !row ||
    row.team_id !== teamId ||
    (teamId === null && row.created_by !== u.id)
  )
    fail(404, "Linked item not found in this space");
  if (taskOnly && row.kind !== "task")
    fail(422, "The linked work must be a task.");
}

export async function checkOwner(
  db: Db,
  ownerId: string,
  teamId: string | null,
  u: UserRow,
) {
  if (!teamId) {
    if (ownerId !== u.id) fail(422, "A personal promise belongs to you.");
    return;
  }
  const member = (
    await db.query(
      "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2",
      [teamId, ownerId],
    )
  ).rowCount;
  if (!member) fail(422, "Choose someone on this team.");
}

/** Tell someone about a promise, in the app and on their phone. */
export async function notifyPromise(
  db: Queryable,
  userId: string,
  recordId: string,
  title: string,
  body: string,
) {
  await db.query(
    `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
       title, body, state, kind, ref)
     SELECT $1::uuid, NULL, 0, c.channel, c.destination, $2, $3,
       CASE WHEN c.channel = 'inapp' THEN 'sent' ELSE 'pending' END, 'promise', $4
     FROM users u
     CROSS JOIN LATERAL (
       SELECT 'inapp' AS channel, u.id::text AS destination
       UNION ALL SELECT 'push', d.token FROM devices d WHERE d.user_id = u.id
     ) c
     WHERE u.id = $1::uuid AND NOT u.disabled
     ON CONFLICT DO NOTHING`,
    [userId, title.slice(0, 200), body.slice(0, 2000), recordId],
  );
}

/**
 * An open decision in project `projectId` that no task delivers yet, if
 * `userId` can see it: what a task may be linked to as the decision's
 * delivery. The assistant checks one through here before proposing the
 * task, and applying the proposal links it with {@link linkDecision}.
 */
export async function openDecision(
  db: Queryable,
  userId: string,
  decisionId: string,
  projectId: string,
): Promise<{ id: string; title: string } | null> {
  return (
    (
      await db.query<{ id: string; title: string }>(
        `SELECT w.id, w.title FROM work_records w
          WHERE w.id = $2 AND w.project_id = $3 AND w.kind = 'decision'
            AND w.status = 'open' AND w.linked_item_id IS NULL
            AND ${VISIBLE}`,
        [userId, decisionId, projectId],
      )
    ).rows[0] ?? null
  );
}

/**
 * Link task `itemId` to the open decision it delivers, if the decision is
 * still open, unlinked, in the task's project and visible to `userId`.
 * Returns whether it was linked.
 */
export async function linkDecision(
  db: Queryable,
  userId: string,
  decisionId: string,
  itemId: string,
  projectId: string,
): Promise<boolean> {
  return !!(
    await db.query(
      `UPDATE work_records w SET linked_item_id = $1, version = version + 1,
          updated_at = now()
        WHERE w.id = $2 AND w.kind = 'decision' AND w.status = 'open'
          AND w.linked_item_id IS NULL AND w.project_id = $3
          AND ${visibleRecords("w", { user: "$4" })}`,
      [itemId, decisionId, projectId, userId],
    )
  ).rowCount;
}
