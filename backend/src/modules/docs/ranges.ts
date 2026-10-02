import {
  blockText,
  docReferenceLinks,
  hiddenLinkLabels,
  objectRefsInValue,
  redactQuote,
  type DocBlock,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { linkPrivacy } from "../links/privacy.js";

/** A remark or proposal on some of a line's words. */
export type Ranged = {
  block_id?: string | null;
  range_start?: number | null;
  range_end?: number | null;
  quote?: string | null;
};

/**
 * Carry the words remarks and proposals are about between a line as it's
 * stored and as `userId` is shown it (D3aF): a reader shown "Private page"
 * in place of a link's words counts places in the words they see, and the
 * page counts them in its own. "stored" takes a reader's new ones in;
 * "shown" gives kept ones back out.
 *
 * Going out, the quoted words are the reader's too: a quote of words on
 * the line as it stands is read off the reader's own line, so words
 * inside a hidden link read "Private page" (a remark made on those words
 * keeps the title in the page, never in what the reader gets back). A
 * quote that can't be matched to the line (the line has gone, the words
 * changed, or it was cut short) goes through {@link redactQuote}.
 */
export async function carryRanges<T extends Ranged>(
  db: Queryable,
  userId: string,
  docId: string,
  rows: T[],
  way: "stored" | "shown",
): Promise<T[]> {
  const placed = rows.some((r) => r.block_id && r.range_start != null);
  if (way === "stored" ? !placed : !rows.some((r) => r.quote || placed))
    return rows;
  const content =
    (
      await db.query<{ content: DocBlock[] | null }>(
        "SELECT content FROM docs WHERE id = $1",
        [docId],
      )
    ).rows[0]?.content ?? [];
  const quotes = rows.map((r) => r.quote ?? null);
  // A quote may hold a hidden link's title as plain words after the link
  // itself has left the page; the page's recent history still names it.
  const past =
    way === "shown" && quotes.some(Boolean) ? await pastLinks(db, docId) : [];
  const links = await linkPrivacy(db, userId, content, quotes, past);
  const labels =
    way === "shown"
      ? hiddenLinkLabels([content, quotes, past], links.hidden)
      : new Map<string, string>();
  // Past links too, so a line cut mid-address whose link has since left
  // the page still reads as its own words to someone who can open it.
  const known = way === "shown" ? objectRefsInValue([content, past]) : [];
  const references = docReferenceLinks(content);
  return rows.map((row) => {
    const block = row.block_id
      ? content.find((b) => b.id === row.block_id)
      : undefined;
    const ranged =
      block && row.range_start != null && row.range_end != null
        ? { start: row.range_start, end: row.range_end }
        : null;
    const stored = block ? blockText(block) : "";
    const line = links.line(stored, references);
    if (way === "stored") {
      if (!ranged || !line.changed) return row;
      const start = line.toStored(ranged.start);
      const end = Math.max(start, line.toStored(ranged.end, true));
      return {
        ...row,
        range_start: start,
        range_end: end,
        ...(row.quote === line.text.slice(ranged.start, ranged.end)
          ? { quote: stored.slice(start, end) }
          : {}),
      };
    }
    // Going out.
    if (ranged && line.changed) {
      const start = line.toShown(ranged.start);
      const end = Math.max(start, line.toShown(ranged.end, true));
      const faithful =
        row.quote != null &&
        row.quote === stored.slice(ranged.start, ranged.end);
      return {
        ...row,
        range_start: start,
        range_end: end,
        ...(row.quote == null
          ? {}
          : {
              quote: faithful
                ? line.text.slice(start, end)
                : redactQuote(row.quote, links.hidden, labels, known),
            }),
      };
    }
    if (row.quote == null) return row;
    // Words still on a line with nothing hidden are the reader's already.
    if (ranged && row.quote === stored.slice(ranged.start, ranged.end))
      return row;
    const quote = redactQuote(row.quote, links.hidden, labels, known);
    return quote === row.quote ? row : { ...row, quote };
  });
}

/** How many past states of a page are searched for link words. */
const PAST_STATES = 50;

/**
 * The links (as `[words](orbyn://…)`) the page's recent past states held,
 * each once. Only the link text is read out of the database, never whole
 * past pages. Reference definitions and their resolved usage are selected
 * separately as page-scoped blocks. Inline words holding
 * a quote mark or backslash are skipped (their JSON escapes would need
 * undoing); such a title is still hidden wherever its link is. A link
 * added and taken out again within one sitting never reaches the history
 * (only a sitting's first state is kept), so its title quoted as plain
 * words is the one case still given back as quoted.
 */
async function pastLinks(db: Queryable, docId: string): Promise<unknown[]> {
  const inline = (
    await db.query<{ link: string }>(
      `SELECT DISTINCT '[' || m[1] || '](' || m[2] || ')' AS link
         FROM (SELECT content::text AS t FROM doc_versions
                WHERE doc_id = $1 ORDER BY created_at DESC LIMIT $2) v,
              regexp_matches(v.t, $3, 'g') AS m`,
      [docId, PAST_STATES, PAST_LINK],
    )
  ).rows.map((r) => r.link);
  // Keep each historical page separate: a reused reference label must never
  // borrow another revision's destination. Select definitions and actual usage,
  // not arbitrary prose or code, and let the shared projection read exact JSON
  // strings (including quote marks and backslashes in private titles).
  const references = await db.query<{ content: DocBlock[] }>(
    `SELECT selected.content
       FROM (SELECT content FROM doc_versions WHERE doc_id = $1
             ORDER BY created_at DESC LIMIT $2) v
       CROSS JOIN LATERAL (
         SELECT coalesce(jsonb_agg(b.value ORDER BY b.ordinality), '[]'::jsonb) AS content
           FROM jsonb_array_elements(v.content) WITH ORDINALITY b
          WHERE (b.value->>'type' = 'paragraph' AND b.value->>'text' ~ '^ {0,3}\\['
                 AND b.value->>'text' ~ '\\]:')
             OR coalesce(nullif(b.value->>'id', ''), '#' || (b.ordinality - 1)) IN
                (SELECT block_id FROM doc_reference_targets(v.content))
       ) selected`,
    [docId, PAST_STATES],
  );
  return [...inline, ...references.rows.map((row) => row.content)];
}

/** A picker link inside a page's JSON text (Postgres regular expression). */
const PAST_LINK = String.raw`\[([^]\\"\n]+)\]\((orbyn://[a-z]+/[0-9a-fA-F-]+)`;
