import type { PageSource } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";

/**
 * Sources agents read and saved for pages (H2, save_source): what the
 * page's Info lists under Sources. A source is kept in one space (Personal
 * or a team) and only linked to pages in that space, so whoever can read a
 * page can read its sources. Orbyn never opens a source's address.
 */

/** The site's name from its address: the host without www. */
export const siteOf = (url: string) =>
  new URL(url).hostname.replace(/^www\./, "");

export type SourceRow = {
  id: string;
  team_id: string | null;
  url: string;
  title: string;
  site: string;
  author: string | null;
  quote: string | null;
  accessed_on: string;
  lines: string[] | null;
};

export const asSource = (r: SourceRow): PageSource => ({
  id: r.id,
  url: r.url,
  title: r.title,
  site: r.site || siteOf(r.url),
  author: r.author,
  quote: r.quote,
  accessed_on: r.accessed_on,
  lines: (r.lines ?? []).filter(Boolean),
});

/**
 * The sources a page uses, newest first. Whoever can read the page can read
 * them (a source is always in the page's own space).
 */
export async function pageSources(
  db: Queryable,
  pageId: string,
): Promise<PageSource[]> {
  return (
    await db.query<SourceRow>(
      `SELECT s.id, s.team_id, s.url, s.title, s.site, s.author, s.quote,
              to_char(s.accessed_on, 'YYYY-MM-DD') AS accessed_on,
              array_agg(u.block_id ORDER BY u.created_at) AS lines
         FROM source_uses u JOIN sources s ON s.id = u.source_id
         JOIN docs d ON d.id = u.doc_id
        WHERE u.doc_id = $1
          AND s.team_id IS NOT DISTINCT FROM d.team_id
        GROUP BY s.id
        ORDER BY max(u.created_at) DESC, s.title
        LIMIT 200`,
      [pageId],
    )
  ).rows.map(asSource);
}
