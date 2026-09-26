import { readableDocs, visibleDocs } from "./visibility.js";

/**
 * The one rule for which pages a person can see, by a user expression
 * (`$1`, `b.user_id`), for queries that take the person that way. The rule
 * itself is lib/visibility.ts's ({@link visibleDocs}, {@link readableDocs}).
 */

/** SQL true when `alias` is a page `user` may read: their own, or their team's. */
export function docReadableBy(user: string, alias = "d") {
  return readableDocs(alias, { user });
}

/**
 * Whether pages can be moved to the Trash in this build (the docs table has
 * `deleted_at`, migration 072_doc_trash). The tripwire test in
 * `tests/doc-visibility.test.ts` checks it against the real table.
 */
export const DOCS_HAVE_TRASH = true;

/**
 * SQL true when `alias` is a live page `user` may read: readable and not in
 * the Trash. Links, task context, search and the assistant use this; project
 * history uses {@link docReadableBy}, since a trashed page's history remains.
 */
export function docVisibleTo(user: string, alias = "d") {
  return visibleDocs(alias, { user });
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
