/**
 * The phone's keyboard toolbar: one row of icons over the keyboard that acts
 * on the line being typed. A line is typed as its Markdown ("- [ ] milk",
 * "## Plan"), so these helpers keep the marker at the start of the line out
 * of every style, and tell the toolbar which styles the caret sits in so it
 * can show them as on.
 */
import { isStyledRun, parseDocInline, type HighlightTint } from "./docs.js";
import {
  isUrl,
  linkTarget,
  STYLE_MARKERS,
  styleRange,
  tintRange,
  type InlineStyle,
  type Restyled,
} from "./doc-editing.js";

/** The marker a line of each kind starts with, as the editor shows it. */
const LINE_MARKER =
  /^(#{1,6}\s+|[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d{1,9}[.)]\s+|>\s?\[![A-Za-z]+\][-+]?\s*|>\s?|\[\^[\w-]{1,24}\]:\s*)/;

/**
 * Where the words of a line start in its Markdown: after "# ", "- [ ] ",
 * "- ", "3. " or "> ", and 0 for a plain line.
 */
export const lineWordsStart = (source: string): number =>
  LINE_MARKER.exec(source)?.[0].length ?? 0;

/**
 * Whether the words of this line can be styled: code, maths and a divider
 * are written as they are, so bold and links mean nothing there.
 */
export const canStyleLine = (source: string): boolean => {
  const s = source.trimStart();
  return !(
    s.startsWith("```") ||
    s.startsWith("$$") ||
    /^(---|\*\*\*|___)\s*$/.test(s)
  );
};

/** A caret or selection moved past the line's marker, into its words. */
function intoWords(source: string, start: number, end: number) {
  if (end < start) [start, end] = [end, start];
  const from = lineWordsStart(source);
  return {
    start: Math.min(Math.max(start, from), source.length),
    end: Math.min(Math.max(end, from), source.length),
  };
}

/**
 * The style whose two markers sit empty either side of the caret, as Bold
 * leaves them when nothing was chosen ("**|**"), or null.
 */
function emptyPairAt(source: string, caret: number): InlineStyle | null {
  // Longest first, so "**|**" isn't read as italic.
  for (const style of [
    "bold",
    "highlight",
    "strike",
    "italic",
    "code",
  ] as const) {
    const m = STYLE_MARKERS[style];
    if (
      source.slice(caret - m.length, caret) === m &&
      source.slice(caret, caret + m.length) === m
    )
      return style;
  }
  return null;
}

/** The line with an empty pair of markers around the caret taken out. */
function dropEmptyPair(source: string, caret: number, style: InlineStyle) {
  const m = STYLE_MARKERS[style];
  return {
    text: source.slice(0, caret - m.length) + source.slice(caret + m.length),
    at: caret - m.length,
  };
}

/** A style the toolbar can show as on, links included. */
export type ToolbarStyle = InlineStyle | "link";

/**
 * The styles the caret, or every character of the selection, sits inside:
 * the toolbar tints those icons. A caret at the very edge of styled words
 * counts as inside them, which is where it lands after styling them, and
 * an empty pair of markers around the caret counts as that style on.
 */
export function stylesAt(
  source: string,
  start: number,
  end: number,
): ToolbarStyle[] {
  if (end < start) [start, end] = [end, start];
  const runs = parseDocInline(source);
  const on = (run: (typeof runs)[number]): ToolbarStyle[] =>
    [
      run.bold && "bold",
      run.italic && "italic",
      run.highlight && "highlight",
      run.strike && "strike",
      run.code && "code",
      run.link && "link",
    ].filter((s): s is ToolbarStyle => !!s);
  if (start === end) {
    const run = runs.find(
      (r) =>
        on(r).length && start >= r.start && start <= r.start + r.text.length,
    );
    const styles = run ? on(run) : [];
    // Bold pressed with nothing chosen leaves "**|**": it's on, ready to
    // type into, and pressing it again takes it off.
    const pair = emptyPairAt(source, start);
    return pair && !styles.includes(pair) ? [...styles, pair] : styles;
  }
  // A selection shows a style only when all of it has that style.
  const covering = runs.filter(
    (r) => r.start < end && r.start + r.text.length > start,
  );
  if (!covering.length) return [];
  const [first, ...rest] = covering.map(on);
  return first.filter((s) => rest.every((more) => more.includes(s)));
}

/**
 * Bold, italic or highlight from the toolbar: the style goes on the chosen
 * words, or comes off them, never over the line's marker. With nothing
 * chosen the two markers go in at the caret, ready to type between. Null
 * when these words can't take it (see `styleRange`), or the line is code,
 * maths or a divider.
 */
export function toolbarStyle(
  source: string,
  start: number,
  end: number,
  style: InlineStyle,
): Restyled | null {
  if (!canStyleLine(source)) return null;
  const at = intoWords(source, start, end);
  // Pressed again before typing: the empty markers come out again.
  if (at.start === at.end && emptyPairAt(source, at.start) === style) {
    const dropped = dropEmptyPair(source, at.start, style);
    return { text: dropped.text, start: dropped.at, end: dropped.at };
  }
  return styleRange(source, at.start, at.end, style);
}

/**
 * The highlighter's other colours from the toolbar (EDT-05): the chosen
 * words highlighted green or pink, or highlighted words given that colour.
 */
export function toolbarTint(
  source: string,
  start: number,
  end: number,
  tint: HighlightTint,
): Restyled | null {
  if (!canStyleLine(source)) return null;
  const at = intoWords(source, start, end);
  return tintRange(source, at.start, at.end, tint);
}

/** "https://www.example.com/a/b" as "example.com/a/b", for a link's words. */
export function shortAddress(url: string): string {
  const bare = url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^mailto:/i, "")
    .replace(/^www\./i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  return bare.length > 60 ? `${bare.slice(0, 59)}…` : bare;
}

/**
 * The toolbar's Link: the chosen words become a link to `url`. With nothing
 * chosen, or with an address chosen, the link goes in at the caret with the
 * short address as its words. Null for an address that isn't one, or words
 * that already carry another style.
 */
export function toolbarLink(
  source: string,
  start: number,
  end: number,
  url: string,
): Restyled | null {
  if (!canStyleLine(source)) return null;
  const target = linkTarget(url);
  if (!target) return null;
  let at = intoWords(source, start, end);
  // Styles don't hold links: empty markers waiting at the caret go first.
  const pair = at.start === at.end ? emptyPairAt(source, at.start) : null;
  if (pair) {
    const dropped = dropEmptyPair(source, at.start, pair);
    source = dropped.text;
    at = { start: dropped.at, end: dropped.at };
  }
  const picked = source.slice(at.start, at.end);
  if (picked.trim() && !isUrl(picked)) {
    const words = picked.replace(/[[\]]/g, "");
    if (!words.trim()) return null;
    const lead = picked.length - picked.trimStart().length;
    const tail = picked.length - picked.trimEnd().length;
    const s = at.start + lead;
    const e = at.end - tail;
    // Only words that aren't styled another way; the same rule as desktop.
    const plain = parseDocInline(source).every(
      (r) => r.start + r.text.length <= s || r.start >= e || !isStyledRun(r),
    );
    if (!plain) return null;
    const inner = source.slice(s, e).replace(/[[\]]/g, "");
    const next = `${source.slice(0, s)}[${inner}](${target})${source.slice(e)}`;
    return { text: next, start: s + 1, end: s + 1 + inner.length };
  }
  // A caret inside words already styled can't start a link there.
  const inside = parseDocInline(source).some(
    (r) =>
      isStyledRun(r) &&
      at.start > r.start &&
      at.start < r.start + r.text.length,
  );
  if (inside) return null;
  const words = shortAddress(target).replace(/[[\]]/g, "") || target;
  const before = source.slice(0, at.start);
  // A link typed against the word before it gets a space of its own.
  const gap = before && !/\s$/.test(before) ? " " : "";
  const link = `${gap}[${words}](${target})`;
  const next = before + link + source.slice(at.end);
  const caret = at.start + link.length;
  return { text: next, start: caret, end: caret };
}

/**
 * A stretch of the line's Markdown as the same stretch of its words, which
 * is how remarks and the assistant measure a line (the marker isn't part of
 * it). Nothing chosen means the whole line.
 */
export function wordsRange(
  source: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const from = lineWordsStart(source);
  // A line's words are kept without the spaces typed after them.
  const length = source.slice(from).trimEnd().length;
  const at = intoWords(source, start, end);
  const clamp = (n: number) => Math.min(Math.max(n - from, 0), length);
  const s = clamp(at.start);
  const e = clamp(at.end);
  if (s === e) return { start: 0, end: length };
  return { start: s, end: e };
}
