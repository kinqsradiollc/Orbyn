import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  fail,
  type ProjectCheckpoint,
  type ProjectSnapshot,
} from "@orbyn/core";
import { reader, type Queryable } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { visibleProjectActivity } from "./activity-visibility.js";
import { docReadableBy } from "../../lib/doc-visibility.js";

const eventOrderSchema = z
  .string()
  .refine(
    (value) =>
      /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n,
  );

const listQuery = z
  .object({
    before: eventOrderSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

type Latest = {
  entity_type: "project" | "stage" | "task" | "note" | "record";
  entity_id: string;
  after_state: Record<string, unknown> | null;
};

async function requireVisible(db: Queryable, id: string, u: UserRow) {
  const visible = await db.query(
    `SELECT 1 FROM projects p WHERE p.id = $2 AND
      ((p.team_id IS NULL AND p.user_id = $1)
        OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`,
    [u.id, id],
  );
  if (!visible.rowCount) fail(404, "Project not found");
}

const value = (state: Record<string, unknown>, key: string) =>
  String(state[key] ?? "");
const nullable = (state: Record<string, unknown>, key: string) =>
  state[key] == null || state[key] === "" ? null : String(state[key]);

/** Read-only project snapshots, assembled from the private planning-state log. */
export async function projectTimeMachineRoutes(app: FastifyInstance) {
  app.get("/projects/:id/time-machine/checkpoints", async (request) => {
    const user = await authenticate(request);
    const projectId = idParam(request);
    const query = listQuery.parse(request.query);
    const db = reader(request.headers);
    await requireVisible(db, projectId, user);
    return (
      await db.query<ProjectCheckpoint>(
        `SELECT a.event_order, a.created_at, a.summary, u.name AS actor_name
       FROM project_activity a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.project_id = $1 AND ($2::bigint IS NULL OR a.event_order < $2)
         AND ${visibleProjectActivity("$4")}
         AND a.event_order >= coalesce((
           SELECT max(b.event_order) FROM project_activity b
           WHERE b.project_id = $1 AND b.after_state ? 'baseline_stages'
         ), 0)
       ORDER BY a.event_order DESC LIMIT $3`,
        [projectId, query.before ?? null, query.limit, user.id],
      )
    ).rows;
  });

  app.get("/projects/:id/time-machine/:eventOrder", async (request) => {
    const user = await authenticate(request);
    const projectId = idParam(request);
    const raw = (request.params as { eventOrder: string }).eventOrder;
    const parsed = eventOrderSchema.safeParse(raw);
    if (!parsed.success) fail(422, "Choose a valid point in project history.");
    const eventOrder = parsed.data;
    const db = reader(request.headers);
    await requireVisible(db, projectId, user);
    const point = (
      await db.query<{ created_at: string }>(
        `SELECT a.created_at FROM project_activity a
          WHERE a.project_id = $1 AND a.event_order = $2
            AND ${visibleProjectActivity("$3")}`,
        [projectId, eventOrder, user.id],
      )
    ).rows[0];
    if (!point) fail(404, "Project history point not found");
    const baseline = (
      await db.query<{
        event_order: string;
        after_state: Record<string, unknown>;
      }>(
        `SELECT event_order, after_state FROM project_activity
         WHERE project_id = $1 AND event_order <= $2
           AND after_state ? 'baseline_stages'
         ORDER BY event_order DESC LIMIT 1`,
        [projectId, eventOrder],
      )
    ).rows[0];
    const baselineOrder = baseline?.event_order ?? "0";
    if (!baseline) {
      const laterBaseline = (
        await db.query(
          `SELECT 1 FROM project_activity WHERE project_id = $1
           AND after_state ? 'baseline_stages' LIMIT 1`,
          [projectId],
        )
      ).rowCount;
      if (laterBaseline) fail(404, "Project history begins at a later change.");
    }
    const visible = (
      await db.query<{ entity_type: "task" | "note" | "record"; id: string }>(
        `SELECT 'task' AS entity_type, i.id FROM items i WHERE (i.project_id = $1 OR EXISTS (
           SELECT 1 FROM project_activity a WHERE a.project_id = $1 AND a.entity_id = i.id))
           AND ((i.team_id IS NULL AND i.user_id = $2)
             OR i.team_id IN (SELECT team_id FROM team_members WHERE user_id = $2))
         UNION ALL
         SELECT 'note', d.id FROM docs d WHERE (d.project_id = $1 OR EXISTS (
           SELECT 1 FROM project_activity a WHERE a.project_id = $1 AND a.entity_id = d.id))
           AND ${docReadableBy("$2")}
         UNION ALL
         SELECT 'record', w.id FROM work_records w WHERE (w.project_id = $1 OR EXISTS (
           SELECT 1 FROM project_activity a WHERE a.project_id = $1 AND a.entity_id = w.id))
           AND ((w.team_id IS NULL AND w.created_by = $2)
             OR w.team_id IN (SELECT team_id FROM team_members WHERE user_id = $2))
         UNION ALL
         SELECT DISTINCT a.entity_type, a.entity_id FROM project_activity a
           WHERE a.project_id = $1 AND a.entity_type IN ('task', 'note', 'record')
             AND ${visibleProjectActivity("$2")}`,
        [projectId, user.id],
      )
    ).rows;
    const allowed = new Set(
      visible.map((row) => `${row.entity_type}:${row.id}`),
    );
    const latest = (
      await db.query<Latest>(
        `SELECT DISTINCT ON (a.entity_type, a.entity_id)
         a.entity_type, a.entity_id, a.after_state
       FROM project_activity a
       WHERE a.project_id = $1 AND a.event_order <= $2 AND a.event_order >= $3
         AND ${visibleProjectActivity("$4")}
       ORDER BY a.entity_type, a.entity_id, a.event_order DESC`,
        [projectId, eventOrder, baselineOrder, user.id],
      )
    ).rows;
    const projectState = latest.find(
      (row) => row.entity_type === "project",
    )?.after_state;
    if (!projectState) fail(404, "Project history point not found");
    const active = (type: Latest["entity_type"]) => {
      const rows = new Map<
        string,
        Latest & { after_state: Record<string, unknown> }
      >();
      const base = baseline?.after_state[`baseline_${type}s`];
      if (Array.isArray(base))
        for (const state of base) {
          if (
            state &&
            typeof state === "object" &&
            typeof state.id === "string"
          )
            rows.set(state.id, {
              entity_type: type,
              entity_id: state.id,
              after_state: state,
            });
        }
      for (const row of latest.filter((entry) => entry.entity_type === type)) {
        if (row.after_state)
          rows.set(
            row.entity_id,
            row as Latest & { after_state: Record<string, unknown> },
          );
        else rows.delete(row.entity_id);
      }
      return [...rows.values()].filter(
        (row) =>
          type === "project" ||
          type === "stage" ||
          allowed.has(`${type}:${row.entity_id}`),
      );
    };
    const snapshot: ProjectSnapshot = {
      event_order: eventOrder,
      created_at: point.created_at,
      project: {
        name: value(projectState, "name"),
        summary: value(projectState, "summary"),
        status: value(projectState, "status"),
        deadline: nullable(projectState, "deadline"),
      },
      stages: active("stage")
        .map((row) => ({
          id: row.entity_id,
          name: value(row.after_state, "name"),
          position: Number(row.after_state.position ?? 0),
        }))
        .sort((a, b) => a.position - b.position),
      tasks: active("task")
        .map((row) => ({
          id: row.entity_id,
          title: value(row.after_state, "title"),
          status: value(row.after_state, "status"),
          due_at: nullable(row.after_state, "due_at"),
          progress: Number(row.after_state.progress ?? 0),
          stage_id: nullable(row.after_state, "stage_id"),
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      notes: active("note")
        .map((row) => ({
          id: row.entity_id,
          title: value(row.after_state, "title"),
          version: Number(row.after_state.version ?? 1),
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      records: active("record")
        .map((row) => ({
          id: row.entity_id,
          kind: value(row.after_state, "kind"),
          title: value(row.after_state, "title"),
          status: value(row.after_state, "status"),
          due_at: nullable(row.after_state, "due_at"),
          review_at: nullable(row.after_state, "review_at"),
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    };
    return snapshot;
  });
}
