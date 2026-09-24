/**
 * Editing help for pages: styling a stretch of a line, counting what a page
 * holds, and comparing two versions of it line by line. Kept apart from
 * docs.ts, which is the page's shape; this is what the editors do to it.
 */
import {
  docPlainText,
  parseDocInline,
  type DocBlock,
  type DocInline,
  type DocKind,
} from "./docs.js";

// ---------------------------------------------------------------- styles ---

/** The styles the selection bar and the editor's shortcuts put on words. */
export type InlineStyle = "bold" | "italic" | "highlight" | "code";

/** The Markdown written around words to give them each style. */
export const STYLE_MARKERS: Record<InlineStyle, string> = {
  bold: "**",
  italic: "*",
  highlight: "==",
  code: "`",
};

/** A line after an edit, with the words that were acted on still selected. */
export type Restyled = { text: string; start: number; end: number };

const isStyled = (run: DocInline) =>
  !!(
    run.bold ||
    run.italic ||
    run.code ||
    run.math ||
    run.link ||
    run.highlight
  );

const hasStyle = (run: DocInline, style: InlineStyle) =>
  style === "bold"
    ? !!run.bold
    : style === "italic"
      ? !!run.italic
      : style === "code"
        ? !!run.code
        : !!run.highlight;

/** Characters a style's words cannot hold, since they would end it early. */
const FORBIDDEN: Record<InlineStyle, string> = {
  bold: "*",
  italic: "*",
  highlight: "=",
  code: "`",
};

/**
 * True when every character of the stretch is plain text: no markers, and
 * nothing already styled. A line's styles don't nest yet, so only plain
 * words can take a new one.
 */
function allPlain(text: string, start: number, end: number): boolean {
  let covered = 0;
  for (const run of parseDocInline(text)) {
    const from = Math.max(start, run.start);
    const to = Math.min(end, run.start + run.text.length);
    if (to <= from) continue;
    if (isStyled(run)) return false;
    covered += to - from;
  }
  return covered === end - start;
}

/** The stretch with its spaces at either edge left outside it. */
function hug(text: string, start: number, end: number) {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  return { s, e };
}

/**
 * Put a style on part of a line's Markdown, or take it off.
 *
 * `start` and `end` are positions in the line's source. Inside words that
 * already have the style, the style comes off the whole run. Over plain
 * words it goes on, with spaces at the edges kept outside the markers so the
 * Markdown still reads. With nothing selected, the two markers go in with
 * the caret between them, ready to type into.
 *
 * Returns null when the words can't take the style: a stretch that crosses
 * words styled another way, or words holding the style's own marker.
 */
export function styleRange(
  text: string,
  start: number,
  end: number,
  style: InlineStyle,
): Restyled | null {
  if (end < start) [start, end] = [end, start];
  const m = STYLE_MARKERS[style];
  const runs = parseDocInline(text);
  for (const run of runs) {
    if (!hasStyle(run, style)) continue;
    const runEnd = run.start + run.text.length;
    const open = run.start - m.length;
    const unwrapped =
      text.slice(0, open) + run.text + text.slice(runEnd + m.length);
    // The words with their markers selected: the style comes off them.
    if (start === open && end === runEnd + m.length)
      return { text: unwrapped, start: open, end: open + run.text.length };
    if (start >= run.start && end <= runEnd)
      return { text: unwrapped, start: start - m.length, end: end - m.length };
  }
  if (start === end) {
    // A caret inside words styled some other way can't start a new style.
    const inside = runs.some(
      (r) => isStyled(r) && start > r.start && start < r.start + r.text.length,
    );
    if (inside) return null;
    return {
      text: text.slice(0, start) + m + m + text.slice(start),
      start: start + m.length,
      end: start + m.length,
    };
  }
  if (!allPlain(text, start, end)) return null;
  const { s, e } = hug(text, start, end);
  if (s === e) return null;
  const inner = text.slice(s, e);
  if (inner.includes(FORBIDDEN[style])) return null;
  const next = text.slice(0, s) + m + inner + m + text.slice(e);
  // Only hand back what really reads as the style: a marker next to one of
  // the line's own could otherwise pair with it instead.
  const took = parseDocInline(next).some(
    (r) => hasStyle(r, style) && r.start === s + m.length && r.text === inner,
  );
  return took ? { text: next, start: s + m.length, end: e + m.length } : null;
}

/** Whether the words at `start`–`end` could take this style right now. */
export const canStyle = (
  text: string,
  start: number,
  end: number,
  style: InlineStyle,
) => styleRange(text, start, end, style) !== null;

/** True for text that is a web or mail address and nothing else. */
export const isUrl = (text: string) =>
  /^(https?:\/\/|mailto:)[^\s]+$/i.test(text.trim()) ||
  /^www\.[^\s/]+\.[^\s]+$/i.test(text.trim());

/**
 * An address as a link can hold it: a bare "www." gains https, and the
 * brackets that would end a Markdown link early are escaped.
 */
export function linkTarget(url: string): string | null {
  const u = url.trim();
  if (!u || /\s/.test(u)) return null;
  const full = /^www\./i.test(u)
    ? `https://${u}`
    : /^[a-z][a-z0-9+.-]*:/i.test(u)
      ? u
      : /^[^/\s]+\.[a-z]{2,}(\/|$)/i.test(u)
        ? `https://${u}`
        : null;
  if (!full || !/^(https?:|mailto:)/i.test(full)) return null;
  return full.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/**
 * Make the selected words a link to `url`. Returns null for words that
 * aren't plain, or an address that isn't one.
 */
export function linkRange(
  text: string,
  start: number,
  end: number,
  url: string,
): Restyled | null {
  if (end < start) [start, end] = [end, start];
  const target = linkTarget(url);
  if (!target || start === end || !allPlain(text, start, end)) return null;
  const { s, e } = hug(text, start, end);
  if (s === e) return null;
  const inner = text.slice(s, e).replace(/[[\]]/g, "");
  if (!inner) return null;
  const next = `${text.slice(0, s)}[${inner}](${target})${text.slice(e)}`;
  return { text: next, start: s + 1, end: s + 1 + inner.length };
}

/**
 * ⌘K in a line being typed: the selected words become a link's text with
 * the caret where its address goes, or a selected address becomes the link
 * with the caret where its words go. Nothing selected starts an empty link.
 */
export function linkShortcut(
  text: string,
  start: number,
  end: number,
): Restyled {
  if (end < start) [start, end] = [end, start];
  const picked = text.slice(start, end);
  const target = picked && isUrl(picked) ? linkTarget(picked) : null;
  if (target) {
    const next = `${text.slice(0, start)}[](${target})${text.slice(end)}`;
    return { text: next, start: start + 1, end: start + 1 };
  }
  const words = picked.replace(/[[\]]/g, "");
  const next = `${text.slice(0, start)}[${words}]()${text.slice(end)}`;
  const at = start + words.length + 3;
  return { text: next, start: at, end: at };
}

// ----------------------------------------------------------------- counts ---

/** Words a minute, for the reading time in a page's footer. */
export const READING_WPM = 238;

const WORD = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu;

/** How many words some text holds. Numbers count; punctuation doesn't. */
export const countWords = (text: string) => (text.match(WORD) ?? []).length;

/** How long a page is: its words, and the minutes it takes to read. */
export function docStats(blocks: DocBlock[]): {
  words: number;
  minutes: number;
} {
  const words = countWords(docPlainText(blocks));
  return {
    words,
    minutes: words ? Math.max(1, Math.round(words / READING_WPM)) : 0,
  };
}

/** "1,204": a count as a person writes it. */
const figure = (n: number) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "just now", "2 min ago", "3 hours ago", "yesterday", "on 4 Sep". */
export function savedAgo(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const seconds = Math.max(0, (now.getTime() - at.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `on ${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * The quiet line at the end of a page: "1,204 words · 5 min read · Saved 2
 * min ago". With words selected it counts those first ("12 of 1,204
 * words"), and while a save is under way it says so instead of when.
 */
export function pageFooter(o: {
  words: number;
  minutes: number;
  /** Words in the current selection, when there is one. */
  selected?: number;
  /** When the page was last saved. */
  savedAt?: string | null;
  saving?: boolean;
  failed?: boolean;
  now?: Date;
}): string {
  const parts = [
    o.selected
      ? `${figure(o.selected)} of ${figure(o.words)} words`
      : `${figure(o.words)} ${o.words === 1 ? "word" : "words"}`,
  ];
  if (o.minutes) parts.push(`${o.minutes} min read`);
  if (o.saving) parts.push("Saving…");
  else if (o.failed) parts.push("Not saved");
  else if (o.savedAt) parts.push(`Saved ${savedAgo(o.savedAt, o.now)}`);
  return parts.join(" · ");
}

// ------------------------------------------------------------ show changes ---

/**
 * One line of a comparison between two versions of a page. Lines the same
 * in both are kept so the changes read in place; a line edited where it
 * stood shows as its old words removed and its new words added, marked
 * `edited` so the two can be read as one change.
 */
export type DocDiffLine = {
  change: "same" | "added" | "removed";
  block: DocBlock;
  /** Where the line sits in the version it comes from. */
  index: number;
  edited?: boolean;
};

/** A line's content, without the name that only bookkeeping reads. */
const lineKey = (b: DocBlock) => {
  const { id: _id, ...rest } = b;
  return JSON.stringify(rest);
};

/** Above this many cells, a comparison marks the middle as all changed. */
const MAX_CELLS = 4_000_000;

/**
 * Compare two versions of a page line by line: what `after` added to
 * `before`, and what it took away. Lines are matched on what they say, the
 * longest run in common first, so a line moved or edited shows as removed
 * where it was and added where it is. A line that kept its name but not its
 * words is marked edited, with its old words just above its new ones.
 */
export function diffBlocks(
  before: DocBlock[],
  after: DocBlock[],
): DocDiffLine[] {
  const ka = before.map(lineKey);
  const kb = after.map(lineKey);
  let head = 0;
  while (head < ka.length && head < kb.length && ka[head] === kb[head]) head++;
  let tail = 0;
  while (
    tail < ka.length - head &&
    tail < kb.length - head &&
    ka[ka.length - 1 - tail] === kb[kb.length - 1 - tail]
  )
    tail++;
  const out: DocDiffLine[] = [];
  for (let i = 0; i < head; i++)
    out.push({ change: "same", block: after[i], index: i });

  const n = ka.length - head - tail;
  const m = kb.length - head - tail;
  const middle: DocDiffLine[] = [];
  if (n * m > MAX_CELLS) {
    for (let i = 0; i < n; i++)
      middle.push({
        change: "removed",
        block: before[head + i],
        index: head + i,
      });
    for (let j = 0; j < m; j++)
      middle.push({ change: "added", block: after[head + j], index: head + j });
  } else {
    // Longest common run, filled from the end so the walk goes forwards.
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i * width + j] =
          ka[head + i] === kb[head + j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && ka[head + i] === kb[head + j]) {
        middle.push({
          change: "same",
          block: after[head + j],
          index: head + j,
        });
        i++;
        j++;
      } else if (
        j >= m ||
        (i < n && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
      ) {
        middle.push({
          change: "removed",
          block: before[head + i],
          index: head + i,
        });
        i++;
      } else {
        middle.push({
          change: "added",
          block: after[head + j],
          index: head + j,
        });
        j++;
      }
    }
  }
  out.push(...pairEdits(middle));
  for (let t = tail; t > 0; t--)
    out.push({
      change: "same",
      block: after[kb.length - t],
      index: kb.length - t,
    });
  return out;
}

/**
 * Within each stretch of changes, a line removed and a line added under the
 * same name are one line edited: mark both, and put the old words directly
 * above the new ones.
 */
function pairEdits(lines: DocDiffLine[]): DocDiffLine[] {
  const out: DocDiffLine[] = [];
  let at = 0;
  while (at < lines.length) {
    if (lines[at].change === "same") {
      out.push(lines[at++]);
      continue;
    }
    const gap: DocDiffLine[] = [];
    while (at < lines.length && lines[at].change !== "same")
      gap.push(lines[at++]);
    const removedById = new Map(
      gap.flatMap((l) =>
        l.change === "removed" && l.block.id ? [[l.block.id, l] as const] : [],
      ),
    );
    const paired = new Set<DocDiffLine>();
    for (const l of gap)
      if (l.change === "added" && l.block.id && removedById.has(l.block.id)) {
        paired.add(l);
        paired.add(removedById.get(l.block.id)!);
      }
    const addedById = new Map(
      gap.flatMap((l) =>
        l.change === "added" && paired.has(l)
          ? [[l.block.id!, l] as const]
          : [],
      ),
    );
    // The old words, then straight away the new ones, where the old ones were.
    for (const l of gap) {
      if (!paired.has(l)) out.push(l);
      else if (l.change === "removed")
        out.push(
          { ...l, edited: true },
          { ...addedById.get(l.block.id!)!, edited: true },
        );
    }
  }
  return out;
}

/** How much changed: lines added, lines removed, and lines edited in place. */
export function diffCounts(lines: DocDiffLine[]): {
  added: number;
  removed: number;
  edited: number;
} {
  let added = 0;
  let removed = 0;
  let edited = 0;
  for (const l of lines) {
    if (l.edited) {
      if (l.change === "added") edited++;
    } else if (l.change === "added") added++;
    else if (l.change === "removed") removed++;
  }
  return { added, removed, edited };
}

/** Where a line from another version sits on this page, or -1. */
function findLine(blocks: DocBlock[], line: DocBlock): number {
  if (line.id) {
    const at = blocks.findIndex((b) => b.id === line.id);
    if (at >= 0) return at;
  }
  const key = lineKey(line);
  return blocks.findIndex((b) => lineKey(b) === key);
}

/**
 * Put one line from another version back on the page as it is now.
 *
 * A line that is still on the page under the same name gets its old words
 * back where it stands. A line that has gone comes back after the nearest
 * line above it (in the version it comes from) that is still on the page,
 * or at the top when none is. It keeps its name, so remarks written about
 * it, and the task a checklist line became, find it again.
 */
export function restoreLine(
  current: DocBlock[],
  source: DocBlock[],
  index: number,
): DocBlock[] {
  const line = source[index];
  if (!line) return current;
  if (line.id) {
    const at = current.findIndex((b) => b.id === line.id);
    if (at >= 0) {
      const next = current.slice();
      next[at] = line;
      return next;
    }
  }
  for (let j = index - 1; j >= 0; j--) {
    const at = findLine(current, source[j]);
    if (at >= 0) {
      const next = current.slice();
      next.splice(at + 1, 0, line);
      return next;
    }
  }
  // A page that is one blank line takes the line in its place.
  if (current.length === 1 && !lineText(current[0]).trim()) return [line];
  return [line, ...current];
}

const lineText = (b: DocBlock) => (b.type === "divider" ? "" : b.text);

// ------------------------------------------------------------------ trash ---

/** How long a deleted page waits in Trash before it goes for good. */
export const TRASH_DAYS = 30;

/** A page in Trash, as the Trash list shows it. */
export type TrashedDoc = {
  id: string;
  title: string;
  kind: DocKind;
  team_id: string | null;
  team_name: string | null;
  deleted_at: string;
  /** Who moved it there, when it was someone. */
  deleted_by: string | null;
  /** When it will be deleted for good. */
  purge_at: string;
  preview: string;
  /** Whether this reader may bring it back or delete it for good. */
  can_restore: boolean;
};

/** "Deleted for good in 27 days", or "tomorrow", for a page in Trash. */
export function trashLeft(purgeAt: string, now = new Date()): string {
  const days = Math.ceil(
    (new Date(purgeAt).getTime() - now.getTime()) / 86_400_000,
  );
  if (days <= 0) return "Deleted for good today";
  if (days === 1) return "Deleted for good tomorrow";
  return `Deleted for good in ${days} days`;
}
