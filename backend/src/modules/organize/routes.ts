import type { FastifyInstance } from "fastify";
import {
  fail,
  listInput,
  listUpdate,
  tagInput,
  tagUpdate,
  type Tag,
  type TaskList,
} from "@orbyn/core";
import { reader, transaction, type Db } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";

/**
 * Lists and tags. Personal ones belong to their creator; team ones follow
 * team roles like team items do (viewers read, members and above write).
 */
const LIST_COLUMNS = `l.id, l.user_id, l.team_id, t.name AS team_name, l.name, l.color, l.position, l.created_at,
  (SELECT count(*)::int FROM items i WHERE i.list_id = l.id AND i.status <> 'done') AS item_count`;

/** Rows `$1` can see: their own personal ones and their teams' ones. */
const VISIBLE = (alias: string) =>
  `((${alias}.team_id IS NULL AND ${alias}.user_id = $1) OR ${alias}.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

type Owned = { id: string; user_id: string; team_id: string | null };

async function requireOwned(
  db: Db,
  table: "lists" | "tags",
  id: string,
  u: UserRow,
  permission: "items:read" | "items:write",
): Promise<Owned> {
  const row = (
    await db.query<Owned>(
      `SELECT id, user_id, team_id FROM ${table} WHERE id = $1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
  const missing = table === "lists" ? "List not found" : "Tag not found";
  if (!row) fail(404, missing);
  if (row.team_id) await requireTeam(row.team_id, u, permission, db);
  else if (row.user_id !== u.id) fail(404, missing);
  return row;
}

const duplicateTag = (error: unknown) =>
  (error as { code?: string }).code === "23505"
    ? fail(409, "There's already a tag with that name here.")
    : Promise.reject(error);

export async function organizeRoutes(app: FastifyInstance) {
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
    const list = await transaction(async (db) => {
      if (d.team_id) await requireTeam(d.team_id, u, "items:write", db);
      const { id } = (
        await db.query<{ id: string }>(
          `INSERT INTO lists (user_id, team_id, name, color, position)
           VALUES ($1, $2, $3, coalesce($4, '#376c51'),
             (SELECT coalesce(max(position), -1) + 1 FROM lists
              WHERE CASE WHEN $2::uuid IS NULL THEN team_id IS NULL AND user_id = $1 ELSE team_id = $2 END))
           RETURNING id`,
          [u.id, d.team_id, d.name, d.color ?? null],
        )
      ).rows[0];
      return (
        await db.query<TaskList>(
          `SELECT ${LIST_COLUMNS} FROM lists l LEFT JOIN teams t ON t.id = l.team_id WHERE l.id = $1`,
          [id],
        )
      ).rows[0];
    });
    reply.code(201);
    return list;
  });

  app.put("/lists/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = listUpdate.parse(r.body);
    return transaction(async (db) => {
      await requireOwned(db, "lists", id, u, "items:write");
      await db.query(
        `UPDATE lists SET name = coalesce($2, name), color = coalesce($3, color),
           position = coalesce($4, position) WHERE id = $1`,
        [id, d.name ?? null, d.color ?? null, d.position ?? null],
      );
      return (
        await db.query<TaskList>(
          `SELECT ${LIST_COLUMNS} FROM lists l LEFT JOIN teams t ON t.id = l.team_id WHERE l.id = $1`,
          [id],
        )
      ).rows[0];
    });
  });

  // Deleting a list keeps its items; they just leave the list.
  app.delete("/lists/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction(async (db) => {
      await requireOwned(db, "lists", id, u, "items:write");
      await db.query("DELETE FROM lists WHERE id = $1", [id]);
    });
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
    const tag = await transaction(async (db) => {
      if (d.team_id) await requireTeam(d.team_id, u, "items:write", db);
      return (
        await db
          .query<Tag>(
            `INSERT INTO tags (user_id, team_id, name, color)
             VALUES ($1, $2, $3, coalesce($4, '#6d8a6f'))
             RETURNING id, user_id, team_id, name, color, created_at`,
            [u.id, d.team_id, d.name, d.color ?? null],
          )
          .catch(duplicateTag)
      ).rows[0];
    });
    reply.code(201);
    return tag;
  });

  app.put("/tags/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = tagUpdate.parse(r.body);
    return transaction(async (db) => {
      await requireOwned(db, "tags", id, u, "items:write");
      return (
        await db
          .query<Tag>(
            `UPDATE tags SET name = coalesce($2, name), color = coalesce($3, color)
             WHERE id = $1 RETURNING id, user_id, team_id, name, color, created_at`,
            [id, d.name ?? null, d.color ?? null],
          )
          .catch(duplicateTag)
      ).rows[0];
    });
  });

  app.delete("/tags/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction(async (db) => {
      await requireOwned(db, "tags", id, u, "items:write");
      await db.query("DELETE FROM tags WHERE id = $1", [id]);
    });
    return reply.code(204).send();
  });
}
