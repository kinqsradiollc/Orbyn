import {
  fail,
  type Folder,
  type FavouriteKind,
  type Tag,
  type TaskList,
} from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import {
  readableDocs,
  visibleFolders,
  visibleOwned,
} from "../../lib/visibility.js";

/**
 * Lists, tags, folders and stars, for the routes and the agents' organize
 * tool alike. Personal ones belong to their creator; team ones follow team
 * roles like team items do (viewers read, members and above write).
 */

export const LIST_COLUMNS = `l.id, l.user_id, l.team_id, t.name AS team_name, l.name, l.color, l.position, l.created_at,
  (SELECT count(*)::int FROM items i WHERE i.list_id = l.id AND i.status NOT IN ('done', 'cancelled')) AS item_count`;

/** Selects a folder; `$1` must be the reader's id (docs they can't see aren't counted). */
export const FOLDER_COLUMNS = `f.id, f.user_id, f.team_id, f.name, f.position, f.created_at,
  (SELECT count(*)::int FROM docs d WHERE d.folder_id = f.id
     AND d.deleted_at IS NULL
     AND ${readableDocs("d")}) AS doc_count`;

export const VISIBLE_FOLDERS = visibleFolders("f");

type Owned = { id: string; user_id: string; team_id: string | null };

/** A list or tag `u` may use with `permission` (404 otherwise), locked. */
export async function requireOwned(
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

const listById = async (db: Queryable, id: string) =>
  (
    await db.query<TaskList>(
      `SELECT ${LIST_COLUMNS} FROM lists l LEFT JOIN teams t ON t.id = l.team_id WHERE l.id = $1`,
      [id],
    )
  ).rows[0];

export async function createList(
  db: Db,
  u: UserRow,
  d: { team_id: string | null; name: string; color?: string | null },
): Promise<TaskList> {
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
  return listById(db, id);
}

export async function updateList(
  db: Db,
  u: UserRow,
  id: string,
  d: { name?: string; color?: string; position?: number },
): Promise<TaskList> {
  await requireOwned(db, "lists", id, u, "items:write");
  await db.query(
    `UPDATE lists SET name = coalesce($2, name), color = coalesce($3, color),
       position = coalesce($4, position) WHERE id = $1`,
    [id, d.name ?? null, d.color ?? null, d.position ?? null],
  );
  return listById(db, id);
}

/** Deleting a list keeps its items; they just leave the list. */
export async function deleteList(db: Db, u: UserRow, id: string) {
  await requireOwned(db, "lists", id, u, "items:write");
  await db.query("DELETE FROM lists WHERE id = $1", [id]);
}

export async function createTag(
  db: Db,
  u: UserRow,
  d: { team_id: string | null; name: string; color?: string | null },
): Promise<Tag> {
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
}

export async function updateTag(
  db: Db,
  u: UserRow,
  id: string,
  d: { name?: string; color?: string },
): Promise<Tag> {
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
}

export async function deleteTag(db: Db, u: UserRow, id: string) {
  await requireOwned(db, "tags", id, u, "items:write");
  await db.query("DELETE FROM tags WHERE id = $1", [id]);
}

/** A folder `u` may change (404 otherwise), locked. */
export async function requireFolder(
  db: Db,
  id: string,
  u: UserRow,
): Promise<Owned> {
  const row = (
    await db.query<Owned>(
      "SELECT id, user_id, team_id FROM folders WHERE id = $1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Folder not found");
  if (row.team_id) await requireTeam(row.team_id, u, "items:write", db);
  else if (row.user_id !== u.id) fail(404, "Folder not found");
  return row;
}

const folderById = async (db: Queryable, userId: string, id: string) =>
  (
    await db.query<Folder>(
      `SELECT ${FOLDER_COLUMNS} FROM folders f WHERE f.id = $2`,
      [userId, id],
    )
  ).rows[0];

export async function createFolder(
  db: Db,
  u: UserRow,
  data: { team_id: string | null; name: string },
): Promise<Folder> {
  if (data.team_id) await requireTeam(data.team_id, u, "items:write", db);
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
  return folderById(db, u.id, id);
}

export async function updateFolder(
  db: Db,
  u: UserRow,
  id: string,
  body: { name?: string; position?: number },
): Promise<Folder> {
  await requireFolder(db, id, u);
  await db.query(
    `UPDATE folders SET name = coalesce($2, name),
       position = coalesce($3, position) WHERE id = $1`,
    [id, body.name ?? null, body.position ?? null],
  );
  return folderById(db, u.id, id);
}

/** Deleting a folder keeps its documents; they simply become unfiled. */
export async function deleteFolder(db: Db, u: UserRow, id: string) {
  await requireFolder(db, id, u);
  await db.query("DELETE FROM folders WHERE id = $1", [id]);
}

const STARRABLE: Record<FavouriteKind, string> = {
  doc: "docs",
  project: "projects",
  view: "saved_views",
};

/**
 * Star or unstar something for `userId`. Only what they can see can be
 * starred (404 otherwise); starring twice is harmless.
 */
export async function setFavourite(
  db: Queryable,
  userId: string,
  kind: FavouriteKind,
  targetId: string,
  starred: boolean,
) {
  if (starred) {
    const table = STARRABLE[kind];
    const visible = (
      await db.query(
        `SELECT 1 FROM ${table} x WHERE x.id = $2
           ${table === "docs" ? "AND x.deleted_at IS NULL" : ""}
           AND ${visibleOwned("x", "user_id")}`,
        [userId, targetId],
      )
    ).rowCount;
    if (!visible) fail(404, "Not found");
    await db.query(
      `INSERT INTO favourites (user_id, kind, target_id) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
      [userId, kind, targetId],
    );
  } else
    await db.query(
      "DELETE FROM favourites WHERE user_id=$1 AND kind=$2 AND target_id=$3",
      [userId, kind, targetId],
    );
}
