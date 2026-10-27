import { z } from "zod";
import {
  isStyledRun,
  parseDocInline,
  type DocBlock,
  type DocInline,
} from "./docs.js";

/**
 * Tags on pages (ORG-01).
 *
 * Pages share the tag list tasks use, so a tag means the same thing
 * wherever it appears. A tag can be put on a page from its tag row, or by
 * typing it into a line: "#physics" in the text adds the tag "physics" to
 * the page when you move on from the line. The words stay as typed, drawn
 * as a quiet chip, so a page read anywhere else still says what it said.
 *
 * Typing is a shortcut for adding, not a second list of tags: taking the
 * words out later doesn't take the tag off, and taking the tag off doesn't
 * rewrite the words. Only a #tag that wasn't in the page before counts, so
 * a tag someone removed isn't put straight back by the next edit.
 */

/** The most tags one page can carry, as for a task. */
export const PAGE_TAG_LIMIT = 20;
/** The longest a tag's name can be, the same everywhere. */
export const TAG_NAME_MAX = 40;

/**
 * A #tag: a "#" at the start of a line or after a space, then a word. The
 * word may hold letters, digits, "_", "-" and "/" (for nested names later),
 * and needs at least one letter, so "#1" and "# Heading" are not tags.
 */
const TAG_RE = /(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu;

/** One #tag found in a line: where it sits in the source, and its name. */
export type TagSpan = { start: number; end: number; name: string };

/**
 * The #tags in one line's Markdown source, in order. Anything inside code,
 * maths or a link is left alone: "`#include`" and the "#part" of an address
 * are not tags.
 */
export function tagSpans(text: string): TagSpan[] {
  if (!text.includes("#")) return [];
  // Stretches of the source that are code, maths or a link, markers and all.
  const literal: [number, number][] = [];
  for (const run of parseDocInline(text))
    // Each of these opens with one marker character before its words.
    if (run.code || run.math || run.link)
      literal.push([
        Math.max(0, run.start - 1),
        run.start + run.text.length + 1,
      ]);
  const out: TagSpan[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    let name = m[2].replace(/[-/]+$/, "");
    if (!/\p{L}/u.test(name)) continue;
    name = name.slice(0, TAG_NAME_MAX);
    const start = (m.index ?? 0) + m[1].length;
    const end = start + 1 + name.length;
    if (literal.some(([a, b]) => start < b && end > a)) continue;
    // A link's address follows its words: "[notes](https://x#y)".
    if (/\]\([^)]*$/.test(text.slice(0, start))) continue;
    out.push({ start, end, name });
  }
  return out;
}

/** The #tags in one line, each once whatever its case, first spelling kept. */
export function inlineTags(text: string): string[] {
  const seen = new Map<string, string>();
  for (const span of tagSpans(text)) {
    const key = span.name.toLocaleLowerCase();
    if (!seen.has(key)) seen.set(key, span.name);
  }
  return [...seen.values()];
}

/** The #tags anywhere on a page. Code and maths blocks hold none. */
export function docInlineTags(blocks: DocBlock[]): string[] {
  const seen = new Map<string, string>();
  for (const b of blocks) {
    if (b.type === "code" || b.type === "math" || b.type === "divider")
      continue;
    for (const name of inlineTags(b.text)) {
      const key = name.toLocaleLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()];
}

/**
 * The #tags a page gained between two states of it: typed or pasted in
 * since `before`. Names compare without case, so "#Physics" typed on a page
 * that already said "#physics" adds nothing.
 */
export function addedInlineTags(
  before: DocBlock[],
  after: DocBlock[],
): string[] {
  const had = new Set(docInlineTags(before).map((t) => t.toLocaleLowerCase()));
  return docInlineTags(after).filter((t) => !had.has(t.toLocaleLowerCase()));
}

/** A run of a line, split so each #tag stands on its own. */
export type TaggedRun = DocInline & { tag?: string };

/**
 * Split a plain run of text so every #tag in it is a piece of its own,
 * carrying the tag's name, for the page to draw as a quiet chip. Styled
 * runs come back as they are. Every piece keeps its place in the source,
 * so comments and selections still line up with the words.
 */
export function tagRuns(run: DocInline, line?: string): TaggedRun[] {
  if (isStyledRun(run) || !run.text.includes("#")) return [run];
  // A tag needs a space or the start of the line before it. A run that
  // doesn't start the line (it follows **bold**, say) only starts a tag when
  // the line has a space there.
  const joined =
    !!line && run.start > 0 && !/\s/.test(line[run.start - 1] ?? "");
  const spans = tagSpans(run.text).filter((s) => !(joined && s.start === 0));
  if (!spans.length) return [run];
  const out: TaggedRun[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.start > at)
      out.push({ text: run.text.slice(at, span.start), start: run.start + at });
    out.push({
      text: run.text.slice(span.start, span.end),
      start: run.start + span.start,
      tag: span.name,
    });
    at = span.end;
  }
  if (at < run.text.length)
    out.push({ text: run.text.slice(at), start: run.start + at });
  return out;
}

/** Put exactly these tags on a page, by id, from the vocabulary it can use. */
export const docTagsInput = z
  .object({ tags: z.array(z.uuid()).max(PAGE_TAG_LIMIT) })
  .strict();

/**
 * Add tags to a page by name, as typing "#physics" does. A name the page's
 * space has no tag for yet makes that tag.
 */
export const docTagNamesInput = z
  .object({
    names: z
      .array(z.string().trim().min(1).max(TAG_NAME_MAX))
      .min(1)
      .max(PAGE_TAG_LIMIT),
  })
  .strict();

export type DocTag = { id: string; name: string; color: string };
