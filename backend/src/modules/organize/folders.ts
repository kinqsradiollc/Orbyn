import type { FastifyInstance } from "fastify";
import {
  favouriteInput,
  folderInput,
  folderUpdate,
  type Favourite,
  type Folder,
} from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { announceWrites } from "../presence/live.js";
import {
  FOLDER_COLUMNS as COLUMNS,
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
  announceWrites(app, "organize");
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
        "SELECT kind, target_id, created_at FROM favourites WHERE user_id = $1 ORDER BY created_at",
        [u.id],
      )
    ).rows;
  });

  /** Star or unstar something. Starring twice is harmless. */
  app.put("/favourites", async (r, reply) => {
    const u = await authenticate(r);
    const body = favouriteInput.parse(r.body);
    await setFavourite(pool, u.id, body.kind, body.target_id, body.starred);
    reply.code(204);
  });
}
