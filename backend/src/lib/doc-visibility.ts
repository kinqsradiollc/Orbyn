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
export const DOCS_HAVE_TRASH = true;

/**
 * SQL true when `alias` is a live page `user` may read: readable and not in
 * the Trash. Links, task context, search and the assistant use this; project
 * history uses {@link docReadableBy}, since a trashed page's history remains.
 */
export function docVisibleTo(user: string, alias = "d") {
  const live = DOCS_HAVE_TRASH ? ` AND ${alias}.deleted_at IS NULL` : "";
  return `(${docReadableBy(user, alias)}${live})`;
}

/**
 * SQL true when `alias` is archived (SRCH-03): the page itself, or the
 * folder it is in. Archived pages leave the library, the quick switcher,
 * search, the link picker and "Mentioned without a link" unless asked for.
 */
export function docArchived(alias = "d") {
  return `(${alias}.archived_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM folders af WHERE af.id = ${alias}.folder_id
       AND af.archived_at IS NOT NULL))`;
}

/**
 * SQL true when the assistant may read `alias` (OTH-04): a personal page, or
 * a team page in a team that hasn't kept its pages out of the assistant.
 */
export function assistantMayRead(alias = "d") {
  return `(${alias}.team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM teams ast WHERE ast.id = ${alias}.team_id
       AND NOT ast.assistant_allowed))`;
}
