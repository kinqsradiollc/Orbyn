import type { FastifyInstance } from "fastify";
import {
  DEFAULT_STAGES,
  fail,
  projectAssign,
  projectInput,
  projectUpdate,
  type Project,
  type ProjectStage,
} from "@orbyn/core";
import { reader, transaction, type Db, type Queryable } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";

/**
 * Projects group planner tasks into a named piece of work with ordered
 * stages. Personal projects belong to their creator; team projects follow the
 * same team roles as team items. Tasks are not copied — a project only sets
 * `project_id` and `stage_id` on the items that belong to it, so scheduling,
 * reminders and the calendar keep working untouched.
 */

const COLUMNS = `p.id, p.user_id, p.team_id, t.name AS team_name, p.name, p.summary,
  p.status, p.deadline, p.doc_id, p.created_at, p.updated_at,
  (SELECT count(*)::int FROM items i WHERE i.project_id = p.id) AS task_count,
  (SELECT count(*)::int FROM items i WHERE i.project_id = p.id AND i.status = 'done') AS done_count`;

/** Projects `$1` can see: their own, and their teams'. */
const VISIBLE = `((p.team_id IS NULL AND p.user_id = $1)
  OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

type Owned = { id: string; user_id: string; team_id: string | null };

async function requireProject(
  db: Db,
  id: string,
  u: UserRow,
  permission: "items:read" | "items:write",
): Promise<Owned> {
  const row = (
    await db.query<Owned>(
      "SELECT id, user_id, team_id FROM projects WHERE id = $1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Project not found");
  if (row.team_id) await requireTeam(row.team_id, u, permission, db);
  else if (row.user_id !== u.id) fail(404, "Project not found");
  return row;
}

/** Stages for a set of projects, in order, keyed by project. */
async function stagesFor(db: Queryable, ids: string[]) {
  if (!ids.length) return new Map<string, ProjectStage[]>();
  const rows = (
    await db.query<ProjectStage>(
      `SELECT id, project_id, name, position FROM project_stages
        WHERE project_id = ANY($1::uuid[]) ORDER BY position, name`,
      [ids],
    )
  ).rows;
  const map = new Map<string, ProjectStage[]>();
  for (const s of rows)
    map.set(s.project_id, [...(map.get(s.project_id) ?? []), s]);
  return map;
}

/** Read one project back with its stages attached. */
async function loadProject(db: Queryable, id: string): Promise<Project> {
  const row = (
    await db.query<Project>(
      `SELECT ${COLUMNS} FROM projects p LEFT JOIN teams t ON t.id = p.team_id
        WHERE p.id = $1`,
      [id],
    )
  ).rows[0];
  const stages = await stagesFor(db, [id]);
  return { ...row, stages: stages.get(id) ?? [] };
}

export async function projectRoutes(app: FastifyInstance) {
  app.get("/projects", async (r) => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    const rows = (
      await db.query<Project>(
        `SELECT ${COLUMNS} FROM projects p LEFT JOIN teams t ON t.id = p.team_id
          WHERE ${VISIBLE} ORDER BY p.status = 'archived', p.updated_at DESC
          LIMIT 200`,
        [u.id],
      )
    ).rows;
    const stages = await stagesFor(
      db,
      rows.map((p) => p.id),
    );
    return rows.map((p) => ({ ...p, stages: stages.get(p.id) ?? [] }));
  });

  app.post("/projects", async (r, reply) => {
    const u = await authenticate(r);
    const data = projectInput.parse(r.body);
    if (data.team_id) await requireTeam(data.team_id, u, "items:write");
    const project = await transaction(async (db) => {
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO projects (user_id, team_id, name, summary, deadline)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [u.id, data.team_id, data.name, data.summary, data.deadline],
        )
      ).rows[0].id;
      const names = data.stages?.length ? data.stages : DEFAULT_STAGES;
      for (const [position, name] of names.entries())
        await db.query(
          "INSERT INTO project_stages (project_id, name, position) VALUES ($1,$2,$3)",
          [id, name, position],
        );
      return loadProject(db, id);
    });
    reply.code(201);
    return project;
  });

  app.get("/projects/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const row = (
      await db.query<Project>(
        `SELECT ${COLUMNS} FROM projects p LEFT JOIN teams t ON t.id = p.team_id
          WHERE p.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!row) fail(404, "Project not found");
    const stages = await stagesFor(db, [id]);
    return { ...row, stages: stages.get(id) ?? [] };
  });

  app.put("/projects/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = projectUpdate.parse(r.body);
    return transaction(async (db) => {
      await requireProject(db, id, u, "items:write");
      await db.query(
        `UPDATE projects SET
           name = coalesce($2, name),
           summary = coalesce($3, summary),
           status = coalesce($4, status),
           deadline = CASE WHEN $5::boolean THEN $6::timestamptz ELSE deadline END,
           doc_id = CASE WHEN $7::boolean THEN $8::uuid ELSE doc_id END,
           updated_at = now()
         WHERE id = $1`,
        [
          id,
          body.name ?? null,
          body.summary ?? null,
          body.status ?? null,
          body.deadline !== undefined,
          body.deadline ?? null,
          body.doc_id !== undefined,
          body.doc_id ?? null,
        ],
      );
      if (body.stages) {
        // Stages given without an id are new; ones left out are removed, and
        // the tasks that sat in them fall back to the project with no stage.
        const keep = body.stages.filter((s) => s.id).map((s) => s.id!);
        await db.query(
          `DELETE FROM project_stages
            WHERE project_id = $1 AND NOT (id = ANY($2::uuid[]))`,
          [id, keep],
        );
        for (const [position, stage] of body.stages.entries()) {
          if (stage.id)
            await db.query(
              "UPDATE project_stages SET name = $2, position = $3 WHERE id = $1 AND project_id = $4",
              [stage.id, stage.name, position, id],
            );
          else
            await db.query(
              "INSERT INTO project_stages (project_id, name, position) VALUES ($1,$2,$3)",
              [id, stage.name, position],
            );
        }
      }
      return loadProject(db, id);
    });
  });

  app.delete("/projects/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction(async (db) => {
      await requireProject(db, id, u, "items:write");
      // The tasks outlive the project; they simply become unfiled.
      await db.query("DELETE FROM projects WHERE id = $1", [id]);
    });
    reply.code(204);
  });

  /** Put a task in a project and stage, or take it out of both. */
  app.put("/items/:id/project", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = projectAssign.parse(r.body);
    return transaction(async (db) => {
      const item = (
        await db.query<{ id: string; user_id: string; team_id: string | null }>(
          "SELECT id, user_id, team_id FROM items WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!item) fail(404, "Item not found");
      if (item.team_id) await requireTeam(item.team_id, u, "items:write", db);
      else if (item.user_id !== u.id) fail(404, "Item not found");

      if (body.project_id) {
        await requireProject(db, body.project_id, u, "items:write");
        if (body.stage_id) {
          const ok = (
            await db.query(
              "SELECT 1 FROM project_stages WHERE id = $1 AND project_id = $2",
              [body.stage_id, body.project_id],
            )
          ).rowCount;
          if (!ok) fail(422, "That stage isn't in this project.");
        }
      }
      await db.query(
        "UPDATE items SET project_id = $2, stage_id = $3, updated_at = now() WHERE id = $1",
        [id, body.project_id, body.project_id ? body.stage_id : null],
      );
      return { ok: true };
    });
  });
}
