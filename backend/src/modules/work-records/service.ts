import { z } from "zod";
import {
  fail,
  WORK_RECORD_KINDS,
  workRecordInput,
  workRecordUpdate,
  type ExperimentEvidence,
  type WorkRecord,
  type WorkRecordInput,
  type WorkRecordUpdate,
} from "@orbyn/core";
import { actAs } from "../../lib/actor.js";
import { periodMeasures } from "../followthrough/reality.js";
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

/** Make a promise, decision or experiment (a promise may be offered to a teammate). */
export async function createRecord(
  db: Db,
  u: UserRow,
  input: WorkRecordInput,
): Promise<WorkRecord> {
  const d = workRecordInput.parse(input);
  const ownerId = d.owner_id ?? u.id;
  if (d.team_id) await requireTeam(d.team_id, u, "items:write", db);
  await checkProject(db, d.project_id, d.team_id, u);
  await checkDoc(db, d.source_doc_id, d.source_block_id, d.team_id, u);
  await checkItem(db, d.source_item_id, d.team_id, u, false);
  await checkItem(db, d.linked_item_id, d.team_id, u, true);
  await checkOwner(db, ownerId, d.team_id, u);
  if (ownerId !== u.id && d.kind !== "promise")
    fail(422, "Only a promise can be offered to someone else.");
  await actAs(db, u.id);
  const id = (
    await db.query<{ id: string }>(
      `INSERT INTO work_records
        (created_by, owner_id, team_id, project_id, kind, title, details,
         status, due_at, review_at, source_doc_id, source_block_id,
         source_item_id, linked_item_id, meeting_minutes, participant_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        u.id,
        ownerId,
        d.team_id,
        d.project_id,
        d.kind,
        d.title,
        d.details,
        ownerId === u.id ? "open" : "proposed",
        d.due_at,
        d.review_at,
        d.source_doc_id,
        d.source_block_id,
        d.source_item_id,
        d.linked_item_id,
        d.meeting_minutes,
        d.participant_count,
      ],
    )
  ).rows[0].id;
  if (ownerId !== u.id)
    await notifyPromise(
      db,
      ownerId,
      id,
      `${u.name} asked you to promise: ${d.title}`,
      d.due_at
        ? "Take it on or say no in Projects → Promises."
        : "Take it on or say no in Projects → Promises.",
    );
  return readRecord(db, id, u);
}

/** Change a record (version-checked). */
export async function updateRecord(
  db: Db,
  u: UserRow,
  id: string,
  input: WorkRecordUpdate,
): Promise<WorkRecord> {
  const d = workRecordUpdate.parse(input);
  const current = await lockRecord(db, id, u);
  if (current.version !== d.version)
    fail(409, "This record changed. Refresh and try again.");
  if (d.status === "proposed" || d.status === "declined")
    fail(422, "Use the response action for a proposed promise.");
  if (d.status && ["proposed", "declined"].includes(current.status))
    fail(409, "This promise is waiting for its owner's response.");
  if (d.linked_item_id !== undefined)
    await checkItem(db, d.linked_item_id, current.team_id, u, true);
  await actAs(db, u.id);
  await db.query(
    `UPDATE work_records SET
      title = coalesce($2, title), details = coalesce($3, details),
      status = coalesce($4, status),
      due_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE due_at END,
      review_at = CASE WHEN $7::boolean THEN $8::timestamptz ELSE review_at END,
      linked_item_id = CASE WHEN $9::boolean THEN $10::uuid ELSE linked_item_id END,
      outcome = coalesce($11, outcome),
      version = version + 1, updated_at = now()
     WHERE id = $1`,
    [
      id,
      d.title ?? null,
      d.details ?? null,
      d.status ?? null,
      d.due_at !== undefined,
      d.due_at ?? null,
      d.review_at !== undefined,
      d.review_at ?? null,
      d.linked_item_id !== undefined,
      d.linked_item_id ?? null,
      d.outcome ?? null,
    ],
  );
  return readRecord(db, id, u);
}

/** Take on, or turn down, a promise offered to `u`. */
export async function respondToRecord(
  db: Db,
  u: UserRow,
  id: string,
  decision: "accept" | "decline",
): Promise<WorkRecord> {
  const current = (
    await db.query<RecordRow>(
      "SELECT id, created_by, team_id, owner_id, project_id, kind, status, version FROM work_records WHERE id = $1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!current || current.owner_id !== u.id) fail(404, "Promise not found");
  if (current.team_id) await requireTeam(current.team_id, u, "items:read", db);
  if (current.kind !== "promise" || current.status !== "proposed")
    fail(409, "This promise is no longer waiting for a response.");
  await actAs(db, u.id);
  await db.query(
    "UPDATE work_records SET status = $2, version = version + 1, updated_at = now() WHERE id = $1",
    [id, decision === "accept" ? "open" : "declined"],
  );
  const record = await readRecord(db, id, u);
  await notifyPromise(
    db,
    current.created_by,
    id,
    decision === "accept"
      ? `${u.name} promised: ${record.title}`
      : `${u.name} can't promise: ${record.title}`,
    decision === "accept"
      ? "It's on their list now."
      : "You may want to ask someone else.",
  );
  return record;
}

/**
 * An experiment's before and after, from what was planned, focused on and
 * finished: a fair look, not a verdict.
 */
export async function recordEvidence(
  db: Queryable,
  u: UserRow,
  id: string,
): Promise<ExperimentEvidence> {
  const record = await readRecord(db, id, u);
  if (record.kind !== "experiment")
    fail(422, "Only an experiment has before and after.");
  const start = new Date(record.created_at);
  const end = new Date(
    Math.min(
      Date.now(),
      record.review_at ? Date.parse(record.review_at) : Date.now(),
    ),
  );
  // At least a week either side, so a new experiment still compares.
  const span = Math.max(end.getTime() - start.getTime(), 7 * 86_400_000);
  const before = { from: new Date(start.getTime() - span), to: start };
  const during = { from: start, to: new Date(start.getTime() + span) };
  const who = record.owner_id ?? record.created_by;
  const [b, d] = await Promise.all([
    periodMeasures(db, who, before.from, before.to),
    periodMeasures(db, who, during.from, during.to),
  ]);
  return {
    before: {
      ...b,
      from: before.from.toISOString(),
      to: before.to.toISOString(),
    },
    during: {
      ...d,
      from: during.from.toISOString(),
      to: during.to.toISOString(),
    },
  };
}
