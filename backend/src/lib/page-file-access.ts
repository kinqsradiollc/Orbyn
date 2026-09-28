import { fail } from "@orbyn/core";
import type { Queryable } from "../db/pool.js";
import { docVisibleTo } from "./doc-visibility.js";
import { visibleProjects } from "./visibility.js";

/**
 * Who can read a picture or file in a page (EDT-01), in one place.
 *
 * A file is readable by whoever uploaded it, whoever can read the live page
 * it was added to, or whoever can read a live page that shows it (page_file_refs, migrations 114 and 115). A page
 * only starts showing a file when the person saving it could already read
 * that file: every save that takes lines from a person calls
 * {@link allowPageFiles} in its transaction, and the trigger on docs links
 * only the ids it listed (or files added to that very page). An id copied
 * from somewhere you can't read is left unlinked, so it gives you nothing,
 * and leaving a team unlinks the team's files from your own pages
 * (migration 115).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SQL true when page file `f` is one `user` may read: they uploaded it, or
 * can read a live page it was added to or shown on, or a project or page
 * that wears it as a cover (W6; a cover is set only by someone who could
 * read the picture, see {@link requireCoverPicture}).
 */
export function pageFileReadableBy(user: string, f = "f") {
  return `(${f}.user_id = ${user}
        OR EXISTS (SELECT 1 FROM docs fd
                    WHERE fd.id = ${f}.doc_id AND ${docVisibleTo(user, "fd")})
        OR EXISTS (SELECT 1 FROM page_file_refs fr
                     JOIN docs fs ON fs.id = fr.doc_id
                    WHERE fr.file_id = ${f}.id AND ${docVisibleTo(user, "fs")})
        OR EXISTS (SELECT 1 FROM docs fc
                    WHERE fc.cover_file_id = ${f}.id AND ${docVisibleTo(user, "fc")})
        OR EXISTS (SELECT 1 FROM projects fp
                    WHERE fp.cover_file_id = ${f}.id
                      AND ${visibleProjects("fp", { user })}))`;
}

/**
 * A picture `userId` may set as a cover: one they can read now, uploaded
 * whole. 404 otherwise, the same as for an id that doesn't exist.
 */
export async function requireCoverPicture(
  db: Queryable,
  userId: string,
  fileId: string,
): Promise<void> {
  const ok = (
    await db.query(
      `SELECT 1 FROM page_files f
        WHERE f.id = $2 AND f.kind = 'image' AND f.status = 'ready'
          AND f.doc_id IS NOT NULL AND ${pageFileReadableBy("$1")}`,
      [userId, fileId],
    )
  ).rowCount;
  if (!ok) fail(404, "That cover picture wasn't found.");
}

/**
 * A cover taken off: a picture no page shows and nothing else wears starts
 * its 30 days (as a removed line's does), so undo can still bring it back.
 */
export async function coverLetGo(db: Queryable, fileId: string | null) {
  if (!fileId) return;
  await db.query(
    `UPDATE page_files f SET unused_since = now()
      WHERE f.id = $1
        AND NOT EXISTS (SELECT 1 FROM page_file_refs r WHERE r.file_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM docs d WHERE d.cover_file_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.cover_file_id = f.id)`,
    [fileId],
  );
}

/** The pictures and files a page's lines point at. */
export function pageFileIds(blocks: unknown): string[] {
  if (!Array.isArray(blocks)) return [];
  const ids = new Set<string>();
  for (const b of blocks as { type?: unknown; file?: unknown }[])
    if (
      b &&
      (b.type === "image" || b.type === "file") &&
      typeof b.file === "string" &&
      UUID.test(b.file)
    )
      ids.add(b.file.toLowerCase());
  return [...ids];
}

/**
 * Let the page save in this transaction link the files in `blocks` that
 * `userId` can read now; ids they can't read stay unlinked. Must run inside
 * the transaction that writes the page (the list is transaction-local).
 */
export async function allowPageFiles(
  db: Queryable,
  userId: string,
  blocks: unknown,
): Promise<void> {
  const ids = pageFileIds(blocks);
  if (!ids.length) return;
  const ok = (
    await db.query<{ id: string }>(
      `SELECT f.id FROM page_files f
        WHERE f.id = ANY ($2::uuid[]) AND ${pageFileReadableBy("$1")}`,
      [userId, ids],
    )
  ).rows.map((r) => r.id);
  if (!ok.length) return;
  await db.query(
    `SELECT set_config('orbyn.page_files_ok',
       concat_ws(',', nullif(current_setting('orbyn.page_files_ok', true), ''),
                 $1::text), true)`,
    [ok.join(",")],
  );
}
