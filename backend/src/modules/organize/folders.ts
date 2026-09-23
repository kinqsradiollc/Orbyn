import type { FastifyInstance } from "fastify";
import {
  fail,
  favouriteInput,
  folderInput,
  folderUpdate,
  type Favourite,
  type Folder,
} from "@orbyn/core";
import { pool, reader, transaction, type Db } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";

/**
 * Folders group documents inside a workspace, and favourites pin the few
 * things someone keeps coming back to. Folders are flat by design; personal
 * ones belong to their creator and team ones follow the team's roles.
 */

/** Selects a folder; `$1` must be the reader's id (docs they can't see aren't counted). */
const COLUMNS = `f.id, f.user_id, f.team_id, f.name, f.position, f.created_at,
  (SELECT count(*)::int FROM docs d WHERE d.folder_id = f.id
     AND ((d.team_id IS NULL AND d.user_id = $1)
       OR d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))) AS doc_count`;

const VISIBLE = `((f.team_id IS NULL AND f.user_id = $1)
  OR f.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

async function requireFolder(
  db: Db,
  id: string,
  u: UserRow,
): Promise<{ id: string; user_id: string; team_id: string | null }> {
  const row = (
    await db.query<{ id: string; user_id: string; team_id: string | null }>(
      "SELECT id, user_id, team_id FROM folders WHERE id = $1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Folder not found");
  if (row.team_id) await requireTeam(row.team_id, u, "items:write", db);
  else if (row.user_id !== u.id) fail(404, "Folder not found");
  return row;
}

export async function folderRoutes(app: FastifyInstance) {
  app.get("/folders", async (r) => {
    const u = await authenticate(r);
    return (
      await reader(r.headers).query<Folder>(
        `SELECT ${COLUMNS} FROM folders f
          WHERE ${VISIBLE} ORDER BY f.team_id NULLS FIRST, f.position, lower(f.name)`,
        [u.id],
      )
    ).rows;
  });

  app.post("/folders", async (r, reply) => {
    const u = await authenticate(r);
    const data = folderInput.parse(r.body);
    if (data.team_id) await requireTeam(data.team_id, u, "items:write");
    const folder = await transaction(async (db) => {
      const next = (
        await db.query<{ next: number }>(
          `SELECT coalesce(max(position), -1) + 1 AS next FROM folders
            WHERE user_id = $1 AND team_id IS NOT DISTINCT FROM $2`,
          [u.id, data.team_id],
        )
      ).rows[0].next;
      const id = (
        await db.query<{ id: string }>(
          "INSERT INTO folders (user_id, team_id, name, position) VALUES ($1,$2,$3,$4) RETURNING id",
          [u.id, data.team_id, data.name, next],
        )
      ).rows[0].id;
      return (
        await db.query<Folder>(
          `SELECT ${COLUMNS} FROM folders f WHERE f.id = $2`,
          [u.id, id],
        )
      ).rows[0];
    });
    reply.code(201);
    return folder;
  });

  app.put("/folders/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = folderUpdate.parse(r.body);
    return transaction(async (db) => {
      await requireFolder(db, id, u);
      await db.query(
        `UPDATE folders SET name = coalesce($2, name),
           position = coalesce($3, position) WHERE id = $1`,
        [id, body.name ?? null, body.position ?? null],
      );
      return (
        await db.query<Folder>(
          `SELECT ${COLUMNS} FROM folders f WHERE f.id = $2`,
          [u.id, id],
        )
      ).rows[0];
    });
  });

  /** Deleting a folder keeps its documents; they simply become unfiled. */
  app.delete("/folders/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction(async (db) => {
      await requireFolder(db, id, u);
      await db.query("DELETE FROM folders WHERE id = $1", [id]);
    });
    reply.code(204);
  });

  app.get("/favourites", async (r) => {
    const u = await authenticate(r);
    return (
      await reader(r.headers).query<Favourite>(
        "SELECT kind, target_id, created_at FROM favourites WHERE user_id = $1 ORDER BY created_at",
        [u.id],
      )
    ).rows;
  });

  /** Star or unstar something. Starring twice is harmless. */
  app.put("/favourites", async (r, reply) => {
    const u = await authenticate(r);
    const body = favouriteInput.parse(r.body);
    // Only what this person can see can be starred.
    if (body.starred) {
      const table = body.kind === "doc" ? "docs" : "projects";
      const visible = (
        await pool.query(
          `SELECT 1 FROM ${table} x WHERE x.id = $2
             AND ((x.team_id IS NULL AND x.user_id = $1)
               OR x.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`,
          [u.id, body.target_id],
        )
      ).rowCount;
      if (!visible) fail(404, "Not found");
    }
    if (body.starred)
      await pool.query(
        `INSERT INTO favourites (user_id, kind, target_id) VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`,
        [u.id, body.kind, body.target_id],
      );
    else
      await pool.query(
        "DELETE FROM favourites WHERE user_id=$1 AND kind=$2 AND target_id=$3",
        [u.id, body.kind, body.target_id],
      );
    reply.code(204);
  });
}
