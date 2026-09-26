import type { FastifyInstance } from "fastify";
import {
  listInput,
  listUpdate,
  tagInput,
  tagUpdate,
  type Tag,
  type TaskList,
} from "@orbyn/core";
import { reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { visibleOwned } from "../../lib/visibility.js";
import { announceWrites } from "../presence/live.js";
import {
  LIST_COLUMNS,
  createList,
  createTag,
  deleteList,
  deleteTag,
  updateList,
  updateTag,
} from "./service.js";

/** Rows `$1` can see: their own personal ones and their teams' ones. */
const VISIBLE = (alias: string) => visibleOwned(alias, "user_id");

/**
 * Lists and tags. Personal ones belong to their creator; team ones follow
 * team roles like team items do (viewers read, members and above write).
 * The changes themselves are in service.ts, shared with agents.
 */
export async function organizeRoutes(app: FastifyInstance) {
  announceWrites(app, "organize");
  app.get("/lists", async (r) => {
    const u = await authenticate(r);
    return (
      await reader(r.headers).query<TaskList>(
        `SELECT ${LIST_COLUMNS} FROM lists l LEFT JOIN teams t ON t.id = l.team_id
         WHERE ${VISIBLE("l")} ORDER BY l.team_id NULLS FIRST, l.position, lower(l.name)`,
        [u.id],
      )
    ).rows;
  });

  app.post("/lists", async (r, reply) => {
    const u = await authenticate(r);
    const d = listInput.parse(r.body);
    const list = await transaction((db) => createList(db, u, d));
    reply.code(201);
    return list;
  });

  app.put("/lists/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = listUpdate.parse(r.body);
    return transaction((db) => updateList(db, u, id, d));
  });

  // Deleting a list keeps its items; they just leave the list.
  app.delete("/lists/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction((db) => deleteList(db, u, id));
    return reply.code(204).send();
  });

  app.get("/tags", async (r) => {
    const u = await authenticate(r);
    return (
      await reader(r.headers).query<Tag>(
        `SELECT g.id, g.user_id, g.team_id, g.name, g.color, g.created_at FROM tags g
         WHERE ${VISIBLE("g")} ORDER BY g.team_id NULLS FIRST, lower(g.name)`,
        [u.id],
      )
    ).rows;
  });

  app.post("/tags", async (r, reply) => {
    const u = await authenticate(r);
    const d = tagInput.parse(r.body);
    const tag = await transaction((db) => createTag(db, u, d));
    reply.code(201);
    return tag;
  });

  app.put("/tags/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = tagUpdate.parse(r.body);
    return transaction((db) => updateTag(db, u, id, d));
  });

  app.delete("/tags/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction((db) => deleteTag(db, u, id));
    return reply.code(204).send();
  });
}
