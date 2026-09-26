import type { Queryable } from "../db/pool.js";

/**
 * Where text in Orbyn came from, when that isn't simply who made the row:
 *
 * - a booking's event on its host's calendar holds what the guest typed
 *   (their name, email address, note and answers): "booking_guest";
 * - a task or event sent in by email holds the email (its subject is the
 *   title, and can set the place): "inbound_email";
 * - a team page may have been written by teammates after whoever made it.
 *
 * The SQL here is added to the queries that read such rows, so provenance
 * is decided in the same statement as visibility.
 */

/**
 * SQL for an item's outside source: 'booking_guest', 'inbound_email' or
 * NULL, for the items table under `alias`. The source is kept on the item
 * (item_sources), so it lasts as long as the item does, even after the
 * booking or its page is deleted; a booking that still names the item is
 * the fallback.
 */
export function itemSourceSql(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias))
    throw new Error(`Not a safe SQL name: ${alias}`);
  return `coalesce(
    (SELECT s.source FROM item_sources s WHERE s.item_id = ${alias}.id),
    CASE WHEN EXISTS (SELECT 1 FROM bookings bk WHERE bk.item_ids @> ARRAY[${alias}.id])
      THEN 'booking_guest' END
  )`;
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

/** An item's outside source (see itemSourceSql). */
export type ItemSource = "booking_guest" | "inbound_email";

/**
 * The outside source of each of `ids` that has one: the events a booking
 * put on its host's calendar, and the tasks and events sent in by email.
 * An id not in the map is the person's own (or a teammate's).
 */
export async function itemSources(
  db: Queryable,
  ids: string[],
): Promise<Map<string, ItemSource>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  return new Map(
    (
      await db.query<{ id: string; source: ItemSource }>(
        `SELECT x.id, ${itemSourceSql("x")} AS source
           FROM unnest($1::uuid[]) AS x(id)`,
        [unique],
      )
    ).rows.flatMap((r) => (r.source ? [[r.id, r.source] as const] : [])),
  );
}
