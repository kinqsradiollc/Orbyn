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
