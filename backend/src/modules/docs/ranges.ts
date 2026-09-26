import {
  blockText,
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
  const links = await linkPrivacy(db, userId, content, quotes);
  const labels =
    way === "shown"
      ? hiddenLinkLabels([content, quotes], links.hidden)
      : new Map<string, string>();
  const known = way === "shown" ? objectRefsInValue(content) : [];
  return rows.map((row) => {
    const block = row.block_id
      ? content.find((b) => b.id === row.block_id)
      : undefined;
    const ranged =
      block && row.range_start != null && row.range_end != null
        ? { start: row.range_start, end: row.range_end }
        : null;
    const stored = block ? blockText(block) : "";
    const line = links.line(stored);
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
