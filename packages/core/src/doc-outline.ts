/**
 * A page's headings as its contents (NAV-03), and the one Info panel's
 * facts about a page (NAV-04).
 *
 * The outline is read from the lines themselves, so it is always the page
 * as it stands. Long pages (three headings or more) show it beside the text
 * on a wide screen and as a Contents sheet on a phone; the Info panel lists
 * it for any page that has headings.
 */
import {
  plainText,
  type DocBlock,
  type PageSource,
  type DocVersion,
} from "./docs.js";

/** One heading in a page's contents. */
export type OutlineEntry = {
  /** Where the heading is among the page's lines. */
  index: number;
  /** The heading's block id, when it has one (for links to it). */
  id?: string;
  level: 1 | 2 | 3;
  text: string;
};

/** A page shows its contents beside it from this many headings. */
export const OUTLINE_MIN = 3;

/** The page's headings, in order, each with its words as they read. */
export function docOutline(blocks: DocBlock[]): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  blocks.forEach((b, index) => {
    if (b.type !== "heading") return;
    const text = plainText(b.text).replace(/\s+/g, " ").trim();
    if (!text) return;
    out.push({ index, ...(b.id ? { id: b.id } : {}), level: b.level, text });
  });
  return out;
}

/** Whether a page is long enough for its contents to sit beside it. */
export const showsOutline = (outline: OutlineEntry[]): boolean =>
  outline.length >= OUTLINE_MIN;

/**
 * Which entry of the outline the reader is in, given the first line on
 * screen: the last heading at or above it, or -1 above the first heading.
 */
export function currentHeading(
  outline: OutlineEntry[],
  lineIndex: number,
): number {
  let at = -1;
  for (let n = 0; n < outline.length; n++) {
    if (outline[n].index > lineIndex) break;
    at = n;
  }
  return at;
}

/**
 * The lines a heading's section covers: from the heading up to (not
 * including) the next heading at its level or above, or the page's end.
 */
export function sectionRange(
  blocks: DocBlock[],
  headingIndex: number,
): { start: number; end: number } {
  const head = blocks[headingIndex];
  if (!head || head.type !== "heading")
    return { start: headingIndex, end: headingIndex + 1 };
  let end = headingIndex + 1;
  while (end < blocks.length) {
    const b = blocks[end];
    if (b.type === "heading" && b.level <= head.level) break;
    end++;
  }
  return { start: headingIndex, end };
}

/**
 * Move a heading's whole section so it starts where line `before` is now
 * (`blocks.length` for the end). The same page back when the place is inside
 * the section itself, or where it already is.
 */
export function moveSection(
  blocks: DocBlock[],
  headingIndex: number,
  before: number,
): DocBlock[] {
  const { start, end } = sectionRange(blocks, headingIndex);
  if (before >= start && before <= end) return blocks;
  if (before < 0 || before > blocks.length) return blocks;
  const section = blocks.slice(start, end);
  const rest = [...blocks.slice(0, start), ...blocks.slice(end)];
  const at = before > end ? before - (end - start) : before;
  return [...rest.slice(0, at), ...section, ...rest.slice(at)];
}

// ---------------------------------------------------------------- folds ---

/**
 * Which lines are hidden by folded headings (EDT-14): everything in a
 * folded heading's section but the heading itself. `folded` holds the
 * headings' block ids; a fold on a line that isn't a heading is ignored.
 */
export function foldedLines(
  blocks: DocBlock[],
  folded: ReadonlySet<string>,
): boolean[] {
  const hidden = blocks.map(() => false);
  if (!folded.size) return hidden;
  blocks.forEach((b, i) => {
    if (b.type !== "heading" || !b.id || !folded.has(b.id) || hidden[i]) return;
    const { end } = sectionRange(blocks, i);
    for (let n = i + 1; n < end; n++) hidden[n] = true;
  });
  return hidden;
}

/** Whether a heading has anything under it to fold away. */
export const canFold = (blocks: DocBlock[], index: number): boolean => {
  const b = blocks[index];
  if (b?.type !== "heading") return false;
  return sectionRange(blocks, index).end > index + 1;
};

/** The ids of every heading that can fold: "Collapse all". */
export const foldableHeadings = (blocks: DocBlock[]): string[] =>
  blocks.flatMap((b, i) =>
    b.type === "heading" && b.id && canFold(blocks, i) ? [b.id] : [],
  );

/** The most folds kept for one page. */
export const MAX_FOLDS = 200;

// -------------------------------------------------------------- sections ---

/**
 * The lines a link or an embed to one line stands for: a heading's whole
 * section, or the one line. Empty when the line isn't on the page.
 */
export function sectionOf(blocks: DocBlock[], blockId: string): DocBlock[] {
  const at = blocks.findIndex((b) => b.id === blockId);
  if (at < 0) return [];
  const { start, end } = sectionRange(blocks, at);
  return blocks.slice(start, end);
}

/**
 * The lines "Move to new page" takes (ORG-05): a heading's whole section,
 * or the one line, by index.
 */
export function movedRange(
  blocks: DocBlock[],
  index: number,
): { start: number; end: number } {
  return sectionRange(blocks, index);
}

/**
 * Everything the Info panel says about a page that isn't in the page itself
 * (`GET /docs/:id/info`). Viewers are live and come from presence; words
 * and the outline are read from the lines on the device.
 */
export type DocInfo = {
  id: string;
  kind: "doc" | "note" | "agenda" | "meeting";
  /** The team it belongs to, or null for your own page. */
  team: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  /** The event it is the note of. */
  event: { id: string; title: string; due_at: string | null } | null;
  folder: { id: string; name: string } | null;
  tags: { id: string; name: string; color: string }[];
  /** How many places you can open link to it. */
  linked_here: number;
  /** Kept versions: how many, and the latest few with who saved them. */
  versions: { count: number; recent: DocVersion[] };
  /** When it last changed, and when someone last confirmed it still true. */
  updated_at: string;
  reviewed_at: string | null;
  /** Whether you may confirm it or ask for it to be updated. */
  can_write: boolean;
  /** Web sources an agent read and saved for this page (H2), newest first. */
  sources: PageSource[];
};

/** How many recent versions the Info panel lists. */
export const INFO_VERSIONS = 3;
