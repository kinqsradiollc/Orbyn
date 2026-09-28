import {
  DEFAULT_STAGES,
  fail,
  projectInput,
  projectUpdate,
  type Project,
  type ProjectLink,
  type ProjectStage,
} from "@orbyn/core";
import type { z } from "zod";
import { actAs } from "../../lib/actor.js";
import { announceTo } from "../presence/live.js";
import { type Db, type Queryable } from "../../db/pool.js";
import { type UserRow } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import { PROJECT_COUNTS } from "./counts.js";
import { visibleProjects } from "../../lib/visibility.js";
import { coverLetGo, requireCoverPicture } from "../../lib/page-file-access.js";

import type { QueryResultRow } from "pg";
/**
 * The projects service: which projects someone can see, reading one or a
 * list, and checking a change is theirs to make. The REST routes, the
 * assistant and agents read projects through these.
 */
// A brief page in Trash is no brief: the project reads as having none until
// the page is restored (the link itself is kept for that).
export const COLUMNS = `p.id, p.user_id, p.team_id, t.name AS team_name, p.name, p.summary,
  p.status, p.deadline, p.aliases, p.assistant_off, p.cover_file_id, p.icon,
  (SELECT b.id FROM docs b WHERE b.id = p.doc_id AND b.deleted_at IS NULL) AS doc_id,
  p.created_at, p.updated_at,
  ${PROJECT_COUNTS}`;

/** Projects `$1` can see: their own, and their teams'. */
export const VISIBLE = visibleProjects("p");

export type Owned = { id: string; user_id: string; team_id: string | null };

export async function requireProject(
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
export async function stagesFor(db: Queryable, ids: string[]) {
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
export async function loadProject(db: Queryable, id: string): Promise<Project> {
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

/** How a list of projects is ordered. */
const ORDER = {
  /** Archived last, then the most recently changed. */
  recent: "p.status = 'archived', p.updated_at DESC",
  /** Archived last, then the nearest deadline, then the most recently changed. */
  deadline: "p.status = 'archived', p.deadline NULLS LAST, p.updated_at DESC",
} as const;

/**
 * The projects `userId` can see (without their stages): GET /projects and
 * the assistant's list_projects both list them through here.
 */
export async function listProjects<T = Project>(
  db: Queryable,
  userId: string,
  o: {
    includeArchived?: boolean;
    order?: keyof typeof ORDER;
    limit?: number;
  } = {},
): Promise<T[]> {
  return (
    await db.query<T & QueryResultRow>(
      `SELECT ${COLUMNS} FROM projects p LEFT JOIN teams t ON t.id = p.team_id
        WHERE ${VISIBLE} ${o.includeArchived === false ? "AND p.status <> 'archived'" : ""}
        ORDER BY ${ORDER[o.order ?? "recent"]}
        LIMIT $2`,
      [userId, o.limit ?? 200],
    )
  ).rows;
}

/**
 * One project `userId` can see (without its stages), or null: GET
 * /projects/:id and the assistant's get_project read it through here.
 */
export async function findProject<T = Project>(
  db: Queryable,
  userId: string,
  id: string,
): Promise<T | null> {
  return (
    (
      await db.query<T & QueryResultRow>(
        `SELECT ${COLUMNS} FROM projects p LEFT JOIN teams t ON t.id = p.team_id
          WHERE p.id = $2 AND ${VISIBLE}`,
        [userId, id],
      )
    ).rows[0] ?? null
  );
}

/** Whether `userId` can see project `id` (the check before reading its parts). */
export async function projectVisible(
  db: Queryable,
  userId: string,
  id: string,
): Promise<boolean> {
  return !!(
    await db.query(`SELECT 1 FROM projects p WHERE p.id = $2 AND ${VISIBLE}`, [
      userId,
      id,
    ])
  ).rowCount;
}

/** Tells open apps that a space's projects changed. */
export const announceProjects = (
  db: Queryable,
  owner: { user_id: string; team_id: string | null; id?: string },
) =>
  announceTo(
    db as never,
    { user_id: owner.user_id, team_id: owner.team_id },
    "changed",
    {
      area: "projects",
      ...(owner.id
        ? { entity_type: "project" as const, entity_id: owner.id }
        : {}),
    },
  );

export type ProjectCreate = z.output<typeof projectInput>;

/**
 * A new project with its stages (the default ones when none are given):
 * POST /projects, an agent's create_project and an approved proposal.
 */
export async function createProject(
  db: Db,
  u: UserRow,
  data: ProjectCreate,
): Promise<Project> {
  await actAs(db, u.id);
  if (data.team_id) await requireTeam(data.team_id, u, "items:write", db);
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
  await announceProjects(db, { user_id: u.id, team_id: data.team_id, id });
  return loadProject(db, id);
}

/** Delete a project; its tasks outlive it, simply unfiled. */
export async function deleteProject(db: Db, u: UserRow, id: string) {
  await actAs(db, u.id);
  const row = await requireProject(db, id, u, "items:write");
  await db.query("DELETE FROM projects WHERE id = $1", [id]);
  await announceProjects(db, row);
  return row;
}

/**
 * Change a project's name, summary, status, deadline, main page, cover,
 * icon or stages.
 * Stages given without an id are new; ones left out are removed (their
 * tasks stay in the project with no stage). Callers that must keep stages
 * they weren't told about (agents) pass every stage.
 */
export async function updateProject(
  db: Db,
  u: UserRow,
  id: string,
  body: z.output<typeof projectUpdate>,
): Promise<Project> {
  await actAs(db, u.id);
  const owned = await requireProject(db, id, u, "items:write");
  await announceProjects(db, owned);
  const before = (
    await db.query<{
      name: string;
      deadline: Date | null;
      cover_file_id: string | null;
    }>("SELECT name, deadline, cover_file_id FROM projects WHERE id = $1", [id])
  ).rows[0];
  // A new cover is a picture the changer can see (W6).
  if (body.cover_file_id && body.cover_file_id !== before.cover_file_id)
    await requireCoverPicture(db, u.id, body.cover_file_id);
  await db.query(
    `UPDATE projects SET
       name = coalesce($2, name),
       summary = coalesce($3, summary),
       status = coalesce($4, status),
       deadline = CASE WHEN $5::boolean THEN $6::timestamptz ELSE deadline END,
       doc_id = CASE WHEN $7::boolean THEN $8::uuid ELSE doc_id END,
       aliases = coalesce($9::text[], aliases),
       cover_file_id = CASE WHEN $10::boolean THEN $11::uuid ELSE cover_file_id END,
       icon = CASE WHEN $12::boolean THEN $13::text ELSE icon END,
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
      body.aliases ?? null,
      body.cover_file_id !== undefined,
      body.cover_file_id ?? null,
      body.icon !== undefined,
      body.icon ?? null,
    ],
  );
  if (
    body.cover_file_id !== undefined &&
    body.cover_file_id !== before.cover_file_id
  )
    await coverLetGo(db, before.cover_file_id);
  // Pages are found by their project's name too: index them again.
  if (body.name !== undefined && body.name !== before.name)
    await db.query(
      "UPDATE docs SET project_id = project_id WHERE project_id = $1",
      [id],
    );
  // Tasks carry their project's deadline (their latest date): open apps
  // and offline copies pick up the change on their next sync.
  if (
    body.deadline !== undefined &&
    (body.deadline ? Date.parse(body.deadline) : null) !==
      (before.deadline?.getTime() ?? null)
  )
    await db.query(
      `UPDATE items SET updated_at = now()
        WHERE project_id = $1 AND status NOT IN ('done', 'cancelled')`,
      [id],
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
}

/** Pin a web link on a project's Home (20 at most; the same address is renamed). */
export async function addProjectLink(
  db: Db,
  u: UserRow,
  id: string,
  input: { url: string; title: string },
): Promise<ProjectLink> {
  // requireProject locks the project row (FOR UPDATE), so two adds at
  // once are counted one after the other and never pass 20 together.
  const owned = await requireProject(db, id, u, "items:write");
  await announceProjects(db, owned);
  const existing = await db.query(
    "SELECT 1 FROM project_links WHERE project_id = $1 AND url = $2",
    [id, input.url],
  );
  const count = await db.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM project_links WHERE project_id = $1",
    [id],
  );
  if (!existing.rows.length && Number(count.rows[0].count) >= 20)
    fail(409, "Project links are full");
  return (
    await db.query<ProjectLink>(
      `INSERT INTO project_links (project_id, url, title) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, url) DO UPDATE SET title = EXCLUDED.title
       RETURNING id, project_id, url, title, created_at`,
      [id, input.url, input.title],
    )
  ).rows[0];
}

/** Take a pinned link off a project's Home. */
export async function removeProjectLink(
  db: Db,
  u: UserRow,
  projectId: string,
  linkId: string,
) {
  const owned = await requireProject(db, projectId, u, "items:write");
  await announceProjects(db, owned);
  const removed = await db.query(
    "DELETE FROM project_links WHERE id = $1 AND project_id = $2 RETURNING id",
    [linkId, projectId],
  );
  if (!removed.rows.length) fail(404, "Link not found");
}
