import type { FastifyInstance } from "fastify";
import {
  favouriteInput,
  folderInput,
  folderUpdate,
  type Favourite,
  type Folder,
  type StarredItem,
} from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { announceWrites } from "../presence/live.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";
import {
  visibleItems,
  visibleProjects,
  visibleViews,
} from "../../lib/visibility.js";
import {
  FOLDER_COLUMNS as COLUMNS,
  STAR_LIMIT,
  VISIBLE_FOLDERS as VISIBLE,
  createFolder,
  deleteFolder,
  setFavourite,
  updateFolder,
} from "./service.js";

/**
 * Folders group documents inside a workspace, and favourites pin the few
 * things someone keeps coming back to. Folders are flat by design; personal
 * ones belong to their creator and team ones follow the team's roles.
 */

export async function folderRoutes(app: FastifyInstance) {
  announceWrites(app, "organize", "folder");
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
    const folder = await transaction((db) => createFolder(db, u, data));
    reply.code(201);
    return folder;
  });

  app.put("/folders/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = folderUpdate.parse(r.body);
    return transaction((db) => updateFolder(db, u, id, body));
  });

  /** Deleting a folder keeps its documents; they simply become unfiled. */
  app.delete("/folders/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction((db) => deleteFolder(db, u, id));
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
                AND ${visibleViews("v")}
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
    await setFavourite(
      pool,
      u.id,
      body.kind,
      body.target_id,
      body.starred,
      body.block_id ?? "",
    );
    reply.code(204);
  });
}

export { STAR_LIMIT };
