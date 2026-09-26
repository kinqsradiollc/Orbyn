/**
 * The one rule for which pages a person can see, for queries outside the docs
 * module (task context, the assistant, project search and history). Keep new
 * queries on these helpers instead of inlining the SQL, so a change to the
 * rule (like pages in the Trash) reaches every caller at once.
 */

/** SQL true when `alias` is a page `user` may read: their own, or their team's. */
export function docReadableBy(user: string, alias = "d") {
  return `((${alias}.team_id IS NULL AND ${alias}.user_id = ${user})
    OR ${alias}.team_id IN (SELECT team_id FROM team_members WHERE user_id = ${user}))`;
}

/**
 * Whether pages can be moved to the Trash in this build. When the docs table
 * gains `deleted_at` (migration 072_doc_trash on main), set this to true: the
 * tripwire test in `tests/doc-visibility.test.ts` fails until it is.
 */
export const DOCS_HAVE_TRASH = false;

/**
 * SQL true when `alias` is a live page `user` may read: readable and not in
 * the Trash. Links, task context, search and the assistant use this; project
 * history uses {@link docReadableBy}, since a trashed page's history remains.
 */
export function docVisibleTo(user: string, alias = "d") {
  const live = DOCS_HAVE_TRASH ? ` AND ${alias}.deleted_at IS NULL` : "";
  return `(${docReadableBy(user, alias)}${live})`;
}
