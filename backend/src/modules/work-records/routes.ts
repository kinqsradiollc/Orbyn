import type { FastifyInstance } from "fastify";
import {
  workRecordInput,
  workRecordResponse,
  workRecordUpdate,
  type ExperimentEvidence,
  type WorkRecord,
} from "@orbyn/core";
import { reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import {
  COLUMNS,
  JOINS,
  VISIBLE,
  listQuery,
  readRecord,
  createRecord,
  updateRecord,
  respondToRecord,
  recordEvidence,
} from "./service.js";
import { announceWrites } from "../presence/live.js";

/** Promises and decisions use the same privacy boundary as their source work. */
export async function workRecordRoutes(app: FastifyInstance) {
  announceWrites(app, "records");
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
    const created = await transaction((db) => createRecord(db, u, d));
    reply.code(201);
    return created;
  });

  app.put("/work-records/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = workRecordUpdate.parse(r.body);
    return transaction((db) => updateRecord(db, u, id, d));
  });

  // An experiment's before and after, from what was planned, focused on and
  // finished: a fair look, not a verdict.
  app.get(
    "/work-records/:id/evidence",
    async (r): Promise<ExperimentEvidence> => {
      const u = await authenticate(r);
      return recordEvidence(reader(r.headers), u, idParam(r));
    },
  );

  app.post("/work-records/:id/respond", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { decision } = workRecordResponse.parse(r.body);
    return transaction((db) => respondToRecord(db, u, id, decision));
  });
}
