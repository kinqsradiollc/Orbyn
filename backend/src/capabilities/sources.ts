import type { Queryable } from "../db/pool.js";

/**
 * Where text in Orbyn came from, when that isn't simply who made the row:
 *
 * - a booking's event on its host's calendar holds what the guest typed
 *   (their name, email address, note and answers): "booking_guest";
 * - a task sent in by email holds the email: "inbound_email";
 * - a team page may have been written by teammates after whoever made it.
 *
 * The SQL here is added to the queries that read such rows, so provenance
 * is decided in the same statement as visibility.
 */

/**
 * SQL for an item's outside source: 'booking_guest', 'inbound_email' or
 * NULL, for the items table under `alias`.
 */
export function itemSourceSql(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias))
    throw new Error(`Not a safe SQL name: ${alias}`);
  return `CASE
    WHEN EXISTS (SELECT 1 FROM bookings bk WHERE bk.item_ids @> ARRAY[${alias}.id]) THEN 'booking_guest'
    ELSE (SELECT s.source FROM item_sources s WHERE s.item_id = ${alias}.id)
  END`;
}

/**
 * SQL for the names of the people other than `viewer` (a placeholder) who
 * saved a team page under `alias` after it was made, from its history; NULL
 * for a personal page (only its owner writes it).
 */
export function docEditorsSql(alias: string, viewer: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias) || !/^\$\d+$/.test(viewer))
    throw new Error(`Not a safe SQL name: ${alias} ${viewer}`);
  return `CASE WHEN ${alias}.team_id IS NULL THEN NULL ELSE (
    SELECT array_agg(DISTINCT coalesce(eu.name, 'someone'))
      FROM doc_versions dv LEFT JOIN users eu ON eu.id = dv.user_id
     WHERE dv.doc_id = ${alias}.id AND dv.user_id IS DISTINCT FROM ${viewer}::uuid
  ) END`;
}

/** Which of `ids` are the events a booking put on its host's calendar. */
export async function bookingItemIds(
  db: Queryable,
  ids: string[],
): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set();
  return new Set(
    (
      await db.query<{ id: string }>(
        `SELECT DISTINCT x.id FROM unnest($1::uuid[]) AS x(id)
          WHERE EXISTS (SELECT 1 FROM bookings bk WHERE bk.item_ids @> ARRAY[x.id])`,
        [unique],
      )
    ).rows.map((r) => r.id),
  );
}
