import { docLibrary, fail } from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { visibleDocs } from "../../lib/visibility.js";

/**
 * Pages inside pages (W5). A page may sit under another page of its own
 * space (your own pages, or one team's) and its own library (Memory and
 * Agent notes keep to themselves), never under itself or a page inside it.
 * A nested page takes its parent's folder, and pages inside a page follow
 * it wherever it is filed. Deleting a page for good lets its pages move up
 * (the foreign key sets them loose); a page in Trash keeps them, and the
 * apps show them at the top level until it's back (packages/core
 * doc-tree.ts). Every move in a space waits for any other move there, so
 * two moves at once can't make a loop between them.
 */

/** SQL for the library a page's kind lives in, as docLibrary says. */
const LIBRARY = (alias: string) =>
  `(CASE WHEN ${alias}.kind IN ('memory', 'agent') THEN ${alias}.kind ELSE 'library' END)`;

/** Wait for any other move of pages in this space. */
export async function lockTree(
  db: Queryable,
  space: { team_id: string | null; user_id: string },
) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `doc-tree:${space.team_id ?? `user:${space.user_id}`}`,
  ]);
}

/**
 * The page `parentId` names, when `page` may go inside it: one `u` can see,
 * in the page's space and library, and not the page itself or inside it.
 * 404 for a page `u` can't see (as for one that doesn't exist); 422 for one
 * they can see that isn't a place this page can go.
 */
export async function checkParent(
  db: Queryable,
  u: UserRow,
  page: {
    id?: string;
    user_id: string;
    team_id: string | null;
    kind: string;
  },
  parentId: string,
): Promise<{ id: string; folder_id: string | null }> {
  const parent = (
    await db.query<{
      id: string;
      user_id: string;
      team_id: string | null;
      kind: string;
      folder_id: string | null;
    }>(
      `SELECT d.id, d.user_id, d.team_id, d.kind, d.folder_id FROM docs d
        WHERE d.id = $2 AND ${visibleDocs("d")}`,
      [u.id, parentId],
    )
  ).rows[0];
  if (!parent) fail(404, "Page not found");
  if (
    (parent.team_id ?? null) !== (page.team_id ?? null) ||
    (!page.team_id && parent.user_id !== page.user_id)
  )
    fail(
      422,
      page.team_id
        ? "A team's page can only go inside another page of that team."
        : "Your own page can only go inside another of your own pages.",
    );
  if (docLibrary(parent.kind) !== docLibrary(page.kind))
    fail(
      422,
      page.kind === "memory" || parent.kind === "memory"
        ? "Memory notes only go inside other Memory notes."
        : "Agent notes only go inside other Agent notes.",
    );
  if (page.id) {
    if (page.id === parent.id) fail(422, "A page can't go inside itself.");
    // Walk up from the new parent: meeting the page means a loop.
    const loop = (
      await db.query(
        `WITH RECURSIVE up AS (
           SELECT id, parent_id FROM docs WHERE id = $1
           UNION
           SELECT d.id, d.parent_id FROM docs d JOIN up ON d.id = up.parent_id
         )
         SELECT 1 FROM up WHERE id = $2`,
        [parent.id, page.id],
      )
    ).rowCount;
    if (loop) fail(422, "A page can't go inside a page that's inside it.");
  }
  return { id: parent.id, folder_id: parent.folder_id };
}

/** Pages inside `id`, at any depth, follow it into `folderId`. */
export async function followFolder(
  db: Queryable,
  id: string,
  folderId: string | null,
) {
  await db.query(
    `WITH RECURSIVE inside AS (
       SELECT id FROM docs WHERE parent_id = $1
       UNION
       SELECT d.id FROM docs d JOIN inside ON d.parent_id = inside.id
     )
     UPDATE docs SET folder_id = $2
      WHERE id IN (SELECT id FROM inside) AND id <> $1
        AND folder_id IS DISTINCT FROM $2`,
    [id, folderId],
  );
}

/**
 * Put page `id` at `position` among the pages beside it (0 first; past the
 * end is last): the same parent, or at the top level the same folder,
 * space and library. They are numbered afresh in their shown order, which
 * is the order given so far, then by title.
 */
export async function placeAt(db: Db, id: string, position: number) {
  const page = (
    await db.query<{
      parent_id: string | null;
      folder_id: string | null;
      team_id: string | null;
      user_id: string;
      kind: string;
    }>(
      "SELECT parent_id, folder_id, team_id, user_id, kind FROM docs WHERE id = $1",
      [id],
    )
  ).rows[0];
  if (!page) return;
  const siblings = (
    await db.query<{ id: string }>(
      `SELECT s.id FROM docs s
        WHERE s.id <> $1 AND s.deleted_at IS NULL
          AND (($2::uuid IS NOT NULL AND s.parent_id = $2::uuid)
            OR ($2::uuid IS NULL AND s.parent_id IS NULL
                AND s.folder_id IS NOT DISTINCT FROM $3::uuid
                AND s.team_id IS NOT DISTINCT FROM $4::uuid
                AND ($4::uuid IS NOT NULL OR s.user_id = $5::uuid)
                AND ${LIBRARY("s")} = $6::text))
        ORDER BY s.sort_order NULLS LAST,
                 coalesce(nullif(s.title, ''), 'Untitled'), s.id`,
      [
        id,
        page.parent_id,
        page.folder_id,
        page.team_id,
        page.user_id,
        docLibrary(page.kind),
      ],
    )
  ).rows.map((r) => r.id);
  const at = Math.min(Math.max(position, 0), siblings.length);
  const order = [...siblings.slice(0, at), id, ...siblings.slice(at)];
  await db.query(
    `UPDATE docs d SET sort_order = o.n
       FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, n)
      WHERE d.id = o.id AND d.sort_order IS DISTINCT FROM o.n::int`,
    [order],
  );
}

/** How a save moves a page in the tree, worked out by planMove. */
export type TreeMove = {
  /** The new parent (null: top level), or undefined when it stays. */
  parent?: string | null;
  /** The new folder, or undefined when it stays. */
  folder?: string | null;
  /** Whether its parent really changes (it then goes last in its place). */
  moved?: boolean;
};

/**
 * What a save's parent_id and folder_id mean for the page (see docUpdate):
 * nesting takes the parent's folder; a new folder alone leaves a parent
 * that is filed elsewhere. Checks the parent, under the space's lock.
 */
export async function planMove(
  db: Db,
  u: UserRow,
  page: {
    id: string;
    user_id: string;
    team_id: string | null;
    kind: string;
  },
  body: { parent_id?: string | null; folder_id?: string | null },
): Promise<TreeMove> {
  if (body.parent_id === undefined && body.folder_id === undefined) return {};
  await lockTree(db, page);
  const now = (
    await db.query<{ parent_id: string | null; parent_folder: string | null }>(
      `SELECT d.parent_id, p.folder_id AS parent_folder
         FROM docs d LEFT JOIN docs p ON p.id = d.parent_id WHERE d.id = $1`,
      [page.id],
    )
  ).rows[0];
  const was = now?.parent_id ?? null;
  if (body.parent_id) {
    const parent = await checkParent(db, u, page, body.parent_id);
    return {
      parent: parent.id,
      folder: parent.folder_id,
      moved: was !== parent.id,
    };
  }
  if (body.parent_id === null)
    return { parent: null, folder: body.folder_id, moved: was !== null };
  const leaves = !!was && (now?.parent_folder ?? null) !== body.folder_id;
  return {
    folder: body.folder_id,
    ...(leaves ? { parent: null, moved: true } : {}),
  };
}
