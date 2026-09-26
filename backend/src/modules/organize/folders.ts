import type { FastifyInstance } from "fastify";
import {
  fail,
  favouriteInput,
  folderInput,
  folderUpdate,
  type Favourite,
  type Folder,
  type StarredItem,
} from "@orbyn/core";
import { pool, reader, transaction, type Db } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";
import { visibleItems, visibleProjects } from "../../lib/visibility.js";

/**
 * Folders group documents inside a workspace, and favourites pin the few
 * things someone keeps coming back to. Folders are flat by design; personal
 * ones belong to their creator and team ones follow the team's roles.
 */

/** Selects a folder; `$1` must be the reader's id (docs they can't see aren't counted). */
const COLUMNS = `f.id, f.user_id, f.team_id, f.name, f.position, f.created_at,
  f.archived_at,
  (SELECT count(*)::int FROM docs d WHERE d.folder_id = f.id
     AND d.deleted_at IS NULL
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
        `SELECT kind, target_id, block_id, created_at FROM favourites
          WHERE user_id = $1 ORDER BY created_at`,
        [u.id],
      )
    ).rows;
  });

  /**
   * The Starred group (NAV-07): every star with its live title, newest
   * first. Stars on things the reader can no longer open are left out
   * (and stay, in case access comes back).
   */
  app.get("/starred", async (r): Promise<StarredItem[]> => {
    const u = await authenticate(r);
    const rows = (
      await reader(r.headers).query<{
        kind: StarredItem["kind"];
        id: string;
        block_id: string;
        title: string | null;
        hint: string | null;
        closed: boolean;
        created_at: Date;
        content: { id?: string; type?: string; text?: string }[] | null;
      }>(
        `SELECT f.kind, f.target_id AS id, f.block_id, f.created_at,
                coalesce(d.title, i.title, p.name, v.name) AS title,
                CASE f.kind
                  WHEN 'task' THEN coalesce(ip.name,
                    CASE WHEN i.kind = 'event' THEN 'Event' ELSE 'Task' END)
                  WHEN 'view' THEN initcap(v.source)
                  WHEN 'doc' THEN dp.name
                  WHEN 'heading' THEN d.title
                  ELSE NULL END AS hint,
                coalesce(i.status IN ('done', 'cancelled'),
                         p.status IN ('done', 'archived'), false) AS closed,
                CASE WHEN f.kind = 'heading' THEN d.content END AS content
           FROM favourites f
           LEFT JOIN docs d ON f.kind IN ('doc', 'heading') AND d.id = f.target_id
                AND ${docVisibleTo("$1")}
           LEFT JOIN projects dp ON dp.id = d.project_id
           LEFT JOIN items i ON f.kind = 'task' AND i.id = f.target_id
                AND ${visibleItems("i")}
           LEFT JOIN projects ip ON ip.id = i.project_id
           LEFT JOIN projects p ON f.kind = 'project' AND p.id = f.target_id
                AND ${visibleProjects("p")}
           LEFT JOIN saved_views v ON f.kind = 'view' AND v.id = f.target_id
                AND ((v.team_id IS NULL AND v.user_id = $1)
                  OR v.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
          WHERE f.user_id = $1
            AND coalesce(d.id, i.id, p.id, v.id) IS NOT NULL
          ORDER BY f.created_at DESC
          LIMIT 200`,
        [u.id],
      )
    ).rows;
    const out: StarredItem[] = [];
    for (const row of rows) {
      let title = row.title || "Untitled";
      if (row.kind === "heading") {
        // A heading's words as the page has them now; gone once the line is.
        const line = (row.content ?? []).find((b) => b.id === row.block_id);
        if (!line) continue;
        title = (line.text ?? "").replace(/[*_`=~]/g, "").trim() || "Untitled";
      }
      out.push({
        kind: row.kind,
        id: row.id,
        block_id: row.block_id,
        title,
        hint: row.hint,
        closed: row.closed,
        created_at: row.created_at.toISOString(),
      });
    }
    return out;
  });

  /** Star or unstar something. Starring twice is harmless. */
  app.put("/favourites", async (r, reply) => {
    const u = await authenticate(r);
    const body = favouriteInput.parse(r.body);
    const blockId = body.block_id ?? "";
    // Only what this person can see can be starred.
    if (body.starred) {
      const visible = {
        doc: `SELECT 1 FROM docs d WHERE d.id = $2 AND ${docVisibleTo("$1")}`,
        heading: `SELECT 1 FROM docs d WHERE d.id = $2 AND ${docVisibleTo("$1")}
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements(
                      CASE WHEN jsonb_typeof(d.content) = 'array'
                           THEN d.content ELSE '[]'::jsonb END) b
                     WHERE b->>'id' = $3)`,
        task: `SELECT 1 FROM items i WHERE i.id = $2 AND ${visibleItems("i")}`,
        project: `SELECT 1 FROM projects p WHERE p.id = $2 AND ${visibleProjects("p")}`,
        view: `SELECT 1 FROM saved_views x WHERE x.id = $2
                 AND ((x.team_id IS NULL AND x.user_id = $1)
                   OR x.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`,
      }[body.kind];
      const found = (
        await pool.query(
          visible,
          body.kind === "heading"
            ? [u.id, body.target_id, blockId]
            : [u.id, body.target_id],
        )
      ).rowCount;
      if (!found) fail(404, "Not found");
      // A few hundred stars is plenty; a runaway script isn't.
      const count = (
        await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM favourites WHERE user_id = $1",
          [u.id],
        )
      ).rows[0].n;
      if (count >= STAR_LIMIT)
        fail(
          409,
          `You can star up to ${STAR_LIMIT} things. Unstar some first.`,
        );
    }
    if (body.starred)
      await pool.query(
        `INSERT INTO favourites (user_id, kind, target_id, block_id)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [u.id, body.kind, body.target_id, blockId],
      );
    else
      await pool.query(
        `DELETE FROM favourites
          WHERE user_id=$1 AND kind=$2 AND target_id=$3 AND block_id=$4`,
        [u.id, body.kind, body.target_id, blockId],
      );
    reply.code(204);
  });
}

/** How many stars one person may have. */
export const STAR_LIMIT = 500;
