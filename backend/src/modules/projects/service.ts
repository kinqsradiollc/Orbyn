import { fail, type Project, type ProjectStage } from "@orbyn/core";
import { type Db, type Queryable } from "../../db/pool.js";
import { type UserRow } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import { PROJECT_COUNTS } from "./counts.js";
import { visibleProjects } from "../../lib/visibility.js";

import type { QueryResultRow } from "pg";
/**
 * The projects service: which projects someone can see, reading one or a
 * list, and checking a change is theirs to make. The REST routes, the
 * assistant and agents read projects through these.
 */
// A brief page in Trash is no brief: the project reads as having none until
// the page is restored (the link itself is kept for that).
export const COLUMNS = `p.id, p.user_id, p.team_id, t.name AS team_name, p.name, p.summary,
  p.status, p.deadline,
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
