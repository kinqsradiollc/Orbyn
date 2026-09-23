import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  fail,
  workRecordInput,
  workRecordResponse,
  workRecordUpdate,
  WORK_RECORD_KINDS,
  type ExperimentEvidence,
  type WorkRecord,
} from "@orbyn/core";
import { periodMeasures } from "../followthrough/reality.js";
import { reader, transaction, type Db, type Queryable } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";

type Scope = { created_by: string; team_id: string | null };
type RecordRow = Scope & {
  id: string;
  owner_id: string | null;
  project_id: string | null;
  kind: WorkRecord["kind"];
  status: WorkRecord["status"];
  version: number;
};

const COLUMNS = `w.*, coalesce(owner.name, 'Unassigned') AS owner_name,
  linked.title AS linked_item_title, linked.status AS linked_item_status`;
const JOINS = `LEFT JOIN users owner ON owner.id = w.owner_id
  LEFT JOIN items linked ON linked.id = w.linked_item_id
    AND linked.team_id IS NOT DISTINCT FROM w.team_id
    AND (w.team_id IS NOT NULL OR linked.user_id = w.created_by)`;
const VISIBLE = `((w.team_id IS NULL AND w.created_by = $1)
  OR w.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

const listQuery = z
  .object({
    kind: z.enum(WORK_RECORD_KINDS).optional(),
    project_id: z.uuid().optional(),
    owner_id: z.uuid().optional(),
    /** Records about one task or event (a meeting's outcome). */
    source_item_id: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

async function readRecord(db: Queryable, id: string, u: UserRow) {
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

async function lockRecord(db: Db, id: string, u: UserRow) {
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

async function checkProject(
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

async function checkDoc(
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
       FROM docs WHERE id = $1`,
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

async function checkItem(
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

async function checkOwner(
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
async function notifyPromise(
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

/** Promises and decisions use the same privacy boundary as their source work. */
export async function workRecordRoutes(app: FastifyInstance) {
  app.get("/work-records", async (r) => {
    const u = await authenticate(r);
    const q = listQuery.parse(r.query);
    return (
      await reader(r.headers).query<WorkRecord>(
        `SELECT ${COLUMNS} FROM work_records w ${JOINS}
         WHERE ${VISIBLE}
           AND ($2::text IS NULL OR w.kind = $2)
           AND ($3::uuid IS NULL OR w.project_id = $3)
           AND ($4::uuid IS NULL OR w.owner_id = $4)
           AND ($6::uuid IS NULL OR w.source_item_id = $6)
         ORDER BY (w.status = 'proposed') DESC,
           (w.status = 'open') DESC, w.updated_at DESC LIMIT $5`,
        [
          u.id,
          q.kind ?? null,
          q.project_id ?? null,
          q.owner_id ?? null,
          q.limit,
          q.source_item_id ?? null,
        ],
      )
    ).rows;
  });

  app.get("/work-records/:id", async (r) => {
    const u = await authenticate(r);
    return readRecord(reader(r.headers), idParam(r), u);
  });

  app.post("/work-records", async (r, reply) => {
    const u = await authenticate(r);
    const d = workRecordInput.parse(r.body);
    const ownerId = d.owner_id ?? u.id;
    const created = await transaction(async (db) => {
      if (d.team_id) await requireTeam(d.team_id, u, "items:write", db);
      await checkProject(db, d.project_id, d.team_id, u);
      await checkDoc(db, d.source_doc_id, d.source_block_id, d.team_id, u);
      await checkItem(db, d.source_item_id, d.team_id, u, false);
      await checkItem(db, d.linked_item_id, d.team_id, u, true);
      await checkOwner(db, ownerId, d.team_id, u);
      if (ownerId !== u.id && d.kind !== "promise")
        fail(422, "Only a promise can be offered to someone else.");
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
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
    });
    reply.code(201);
    return created;
  });

  app.put("/work-records/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = workRecordUpdate.parse(r.body);
    return transaction(async (db) => {
      const current = await lockRecord(db, id, u);
      if (current.version !== d.version)
        fail(409, "This record changed. Refresh and try again.");
      if (d.status === "proposed" || d.status === "declined")
        fail(422, "Use the response action for a proposed promise.");
      if (d.status && ["proposed", "declined"].includes(current.status))
        fail(409, "This promise is waiting for its owner's response.");
      if (d.linked_item_id !== undefined)
        await checkItem(db, d.linked_item_id, current.team_id, u, true);
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
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
    });
  });

  // An experiment's before and after, from what was planned, focused on and
  // finished: a fair look, not a verdict.
  app.get(
    "/work-records/:id/evidence",
    async (r): Promise<ExperimentEvidence> => {
      const u = await authenticate(r);
      const db = reader(r.headers);
      const record = await readRecord(db, idParam(r), u);
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
    },
  );

  app.post("/work-records/:id/respond", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { decision } = workRecordResponse.parse(r.body);
    return transaction(async (db) => {
      const current = (
        await db.query<RecordRow>(
          "SELECT id, created_by, team_id, owner_id, project_id, kind, status, version FROM work_records WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!current || current.owner_id !== u.id) fail(404, "Promise not found");
      if (current.team_id)
        await requireTeam(current.team_id, u, "items:read", db);
      if (current.kind !== "promise" || current.status !== "proposed")
        fail(409, "This promise is no longer waiting for a response.");
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
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
    });
  });
}
