/**
 * Documents: notes, briefs and agendas that live beside the planner.
 *
 * A document is a list of blocks. Blocks are stored as JSON so the editor can
 * work on one block at a time, and they round-trip to Markdown — including
 * LaTeX, which is kept as source and rendered at display time — so a document
 * can always be exported and nothing is locked into the editor.
 */

/**
 * What a page is for. A note is an ordinary page that hangs off a project,
 * a task or a team; everything else about it is the same, which is why it
 * is a kind rather than a table of its own.
 */
export const DOC_KINDS = ["doc", "note", "agenda", "meeting"] as const;

/**
 * How a page is being worked on.
 *
 * `edit` changes the page itself; `read` changes nothing and is what a
 * shared page opens in; `suggest` proposes changes an editor accepts or
 * rejects. Remarks can be written in all three, because reading a page and
 * having something to say about it are the same activity.
 */
export const DOC_MODES = ["edit", "suggest", "read"] as const;
export type DocMode = (typeof DOC_MODES)[number];

/**
 * The modes someone may use, given whether they can change the page.
 *
 * Suggesting is open to everyone who can read: proposing a change is a way
 * to say something about the words without being trusted to change them,
 * which is exactly what a viewer needs.
 */
export const modesFor = (canWrite: boolean): DocMode[] =>
  canWrite ? ["edit", "suggest", "read"] : ["suggest", "read"];

/** What each mode is called, and what it does, in the page's own words. */
export const MODE_LABELS: Record<DocMode, { name: string; blurb: string }> = {
  edit: { name: "Editing", blurb: "Your changes go straight into the page." },
  suggest: {
    name: "Suggesting",
    blurb: "Your changes wait for someone to accept them.",
  },
  read: { name: "Viewing", blurb: "Nothing you do changes the page." },
};
export type DocKind = (typeof DOC_KINDS)[number];

/**
 * A block's own name, kept so other things can point at this line and still
 * find it after the page is rewritten around it: the task a checklist line
 * became, and the comments written about it. It is bookkeeping rather than
 * content — it is not written to Markdown, and two blocks that differ only
 * by it are the same block.
 */
type Named = { id?: string };

/**
 * How far a list line is tucked under the list line above it: 1 to
 * `MAX_DEPTH`, left out at the top level. Only lists nest; every other kind
 * of line always sits at the left edge. It is stored rather than read from
 * leading spaces, because an edited line is re-read from its own Markdown
 * and has no neighbours to measure against.
 */
type Nested = { depth?: number };

/** The deepest a list line can be tucked in. */
export const MAX_DEPTH = 3;

export type DocBlock = Named &
  (
    | { type: "heading"; level: 1 | 2 | 3; text: string }
    | { type: "paragraph"; text: string }
    | ({ type: "bullet"; text: string } & Nested)
    /**
     * A numbered line. The number shown is counted from where its list
     * starts; `start` is only kept on a list that begins somewhere other
     * than 1 ("5. …" after a paragraph), and only means anything there.
     */
    | ({ type: "numbered"; text: string; start?: number } & Nested)
    /** A checklist line; `done` is the ticked state. */
    | ({ type: "todo"; text: string; done: boolean } & Nested)
    | { type: "quote"; text: string }
    | { type: "code"; text: string; lang: string }
    /**
     * Display maths. `text` is LaTeX without the `$$` fences. `check` marks
     * an equation read from a file whose layout was a guess; editing it
     * (or confirming it) clears the mark.
     */
    | { type: "math"; text: string; check?: boolean }
    | { type: "divider" }
    /**
     * A set-apart box (EDT-04): Note, Tip, Warning, Question or Summary.
     * Written `> [!tip] words`, as other Markdown apps write callouts; a
     * folded one (`> [!tip]- words`) shows only its first line.
     */
    | { type: "callout"; kind: CalloutKind; text: string; folded?: boolean }
    /**
     * A table (EDT-02). `text` is the table as Markdown (`| a | b |` rows
     * with a `| --- |` line under the header), so it searches, exports and
     * reads anywhere; the apps draw and edit it as cells.
     */
    | { type: "table"; text: string }
    /**
     * A picture kept in Orbyn's own file store (EDT-01): `file` is its id
     * there, `text` its caption, `width` how wide it is drawn, as a share of
     * the page (10 to 100; left out for the full width).
     */
    | { type: "image"; file: string; text: string; width?: number }
    /** A file kept in Orbyn's own file store, shown as a card: `text` is its name. */
    | { type: "file"; file: string; text: string }
    /**
     * A footnote's words (EDT-13), written `[^1]: words`. The marker `[^1]`
     * sits in a line; the page numbers markers in the order they are read
     * and lists the notes at its end.
     */
    | { type: "footnote"; label: string; text: string }
  );

export type DocBlockType = DocBlock["type"];

/** The kinds of callout (EDT-04), in the order menus offer them. */
export const CALLOUT_KINDS = [
  "note",
  "tip",
  "warning",
  "question",
  "summary",
] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** What each kind of callout is called. */
export const CALLOUT_LABELS: Record<CalloutKind, string> = {
  note: "Note",
  tip: "Tip",
  warning: "Warning",
  question: "Question",
  summary: "Summary",
};

/**
 * Callout names other Markdown apps use, read as the nearest of ours so an
 * imported `> [!info]` or `> [!tldr]` still comes in as a callout.
 */
const CALLOUT_ALIASES: Record<string, CalloutKind> = {
  note: "note",
  info: "note",
  important: "note",
  tip: "tip",
  hint: "tip",
  success: "tip",
  example: "tip",
  warning: "warning",
  caution: "warning",
  attention: "warning",
  danger: "warning",
  error: "warning",
  bug: "warning",
  question: "question",
  help: "question",
  faq: "question",
  summary: "summary",
  abstract: "summary",
  tldr: "summary",
  quote: "note",
};

/** The callout kind a name stands for, or null when it isn't one. */
export const calloutKindOf = (name: string): CalloutKind | null =>
  CALLOUT_ALIASES[name.trim().toLowerCase()] ?? null;

/**
 * The highlighter colours (EDT-05): the plain `==words==` is the soft
 * amber the page always used; `=={green}words==` and `=={rose}words==` are
 * the palette's green and rose tints. No new colours.
 */
export const HIGHLIGHT_TINTS = ["amber", "green", "rose"] as const;
export type HighlightTint = (typeof HIGHLIGHT_TINTS)[number];

/** What each highlighter colour is called in a menu. */
export const HIGHLIGHT_LABELS: Record<HighlightTint, string> = {
  amber: "Yellow",
  green: "Green",
  rose: "Pink",
};

/**
 * Editing a line means re-reading its Markdown, which produces fresh blocks
 * that know nothing of what pointed at the old one. This puts the old name
 * back on the first of them, so a checklist line keeps its task and a
 * commented line keeps its comments when the words around them change.
 */
export function carryBlockIds(
  previous: DocBlock | undefined,
  fresh: DocBlock[],
): DocBlock[] {
  if (!previous || !fresh.length) return fresh;
  let first = fresh[0];
  if (previous.id && !first.id) first = { ...first, id: previous.id };
  // A tucked-in line keeps its place under the line above: its Markdown has
  // no neighbours to measure indentation against, so re-reading it alone
  // would bring every edited sub-item back to the left edge. Anything typed
  // or pasted after it on further lines is tucked in by the same amount.
  const depth = blockDepth(previous);
  if (!depth) return first === fresh[0] ? fresh : [first, ...fresh.slice(1)];
  const tuck = (b: DocBlock) =>
    isListBlock(b) ? withDepth(b, blockDepth(b) + depth) : b;
  return [tuck(first), ...fresh.slice(1).map(tuck)];
}

/** The kinds of line that can be tucked under one another. */
export type ListBlock = Extract<
  DocBlock,
  { type: "bullet" | "numbered" | "todo" }
>;

export const isListBlock = (b: DocBlock | undefined): b is ListBlock =>
  !!b && (b.type === "bullet" || b.type === "numbered" || b.type === "todo");

/** How far a line is tucked in: 0 for anything that isn't a list line. */
export const blockDepth = (b: DocBlock | undefined): number =>
  isListBlock(b) ? Math.max(0, Math.min(MAX_DEPTH, b.depth ?? 0)) : 0;

/** The same line tucked in to `depth`, kept between 0 and `MAX_DEPTH`. */
export function withDepth<B extends DocBlock>(block: B, depth: number): B {
  if (!isListBlock(block)) return block;
  const d = Math.max(0, Math.min(MAX_DEPTH, Math.round(depth)));
  const { depth: _old, ...rest } = block as ListBlock;
  return (d ? { ...rest, depth: d } : rest) as B;
}

/**
 * Where each line sits in its list: how far in it is drawn, and the number
 * a numbered line shows.
 *
 * A line is never drawn more than one step deeper than the list line above
 * it, so a sub-item whose parent was deleted comes back out rather than
 * floating. Numbers count up through a list at one depth; lines tucked
 * under an item don't break the count, while anything else at the same
 * depth — a bullet, a paragraph, a heading — ends the list, and the next
 * numbered line starts again from 1 (or from its own `start`).
 */
export function listLayout(
  blocks: DocBlock[],
): { depth: number; number: number | null }[] {
  const out: { depth: number; number: number | null }[] = [];
  // The count at each depth, or null where the run at that depth has ended.
  let counts: (number | null)[] = [];
  let ceiling = 0;
  for (const b of blocks) {
    if (!isListBlock(b)) {
      counts = [];
      ceiling = 0;
      out.push({ depth: 0, number: null });
      continue;
    }
    const depth = Math.min(blockDepth(b), ceiling);
    ceiling = depth + 1;
    // Coming back out to a depth ends every list deeper than it.
    counts = counts.slice(0, depth + 1);
    while (counts.length < depth + 1) counts.push(null);
    if (b.type === "numbered") {
      const at = counts[depth];
      const n = at === null ? (b.start ?? 1) : at + 1;
      counts[depth] = n;
      out.push({ depth, number: n });
    } else {
      counts[depth] = null;
      out.push({ depth, number: null });
    }
  }
  return out;
}

/**
 * A numbered line is typed with the number it shows ("3. …"), so reading it
 * back gives it a `start`. That only means something on the first line of a
 * list; anywhere else the number is counted, and the start is let go.
 * Returns `blocks` itself when there is nothing to let go.
 */
export function keepStart(blocks: DocBlock[], index: number): DocBlock[] {
  const b = blocks[index];
  if (b?.type !== "numbered" || b.start === undefined) return blocks;
  const { start: _start, ...counted } = b;
  const probe = blocks.slice();
  probe[index] = counted;
  return listLayout(probe)[index].number === 1 ? blocks : probe;
}

/**
 * Tuck a list line in (`by` 1) or bring it out (`by` -1), taking the lines
 * tucked under it along so a list keeps its shape. A line can go at most one
 * step deeper than the list line above it; asking for more, or for a line
 * that isn't in a list, hands back the same array untouched.
 */
export function indentBlocks(
  blocks: DocBlock[],
  index: number,
  by: 1 | -1,
): DocBlock[] {
  const block = blocks[index];
  if (!isListBlock(block)) return blocks;
  const depth = blockDepth(block);
  const next = depth + by;
  if (next < 0 || next > MAX_DEPTH) return blocks;
  if (by > 0) {
    const above = blocks[index - 1];
    if (!isListBlock(above) || next > blockDepth(above) + 1) return blocks;
  }
  let end = index + 1;
  while (end < blocks.length) {
    const b = blocks[end];
    if (!isListBlock(b) || blockDepth(b) <= depth) break;
    end++;
  }
  const out = blocks.slice();
  for (let i = index; i < end; i++)
    out[i] = withDepth(blocks[i], blockDepth(blocks[i]) + by);
  return out;
}

/** A name no other block in this document is using. */
export const newBlockId = (): string =>
  `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * A past state of a document, as history lists it. `content` is only
 * carried when one version is asked for by itself; the list holds the size.
 */
export type DocVersion = {
  version: number;
  title: string;
  /** Who saved the state that replaced this one. */
  author: string | null;
  user_id: string | null;
  created_at: string;
  blocks: number;
  content?: DocBlock[];
  /**
   * The outside agent that made the change (its app's name, "Claude"), so
   * history reads "Edited via Claude"; null for a person's own edits.
   */
  via_agent?: string | null;
};

export type Doc = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name?: string | null;
  title: string;
  kind: DocKind;
  content: DocBlock[];
  item_id: string | null;
  /** The project this note belongs to, for a note that belongs to one. */
  project_id: string | null;
  project_name?: string | null;
  /** The tags on this page, from the same vocabulary tasks use. */
  tags?: { id: string; name: string; color: string }[];
  folder_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  /** When someone last confirmed it still true without changing it. */
  reviewed_at?: string | null;
  /** The file this page was imported from, for an imported page. */
  imported_from?: DocImportSource | null;
  /** That file itself, when it was kept ("Keep the original"). */
  original?: {
    id: string;
    doc_id: string | null;
    file_name: string;
    file_type: string;
    bytes: number;
    created_at: string;
  } | null;
  /** Imported and not filed yet: it shows in Uploads until it's moved. */
  in_uploads?: boolean;
  /** For a daily agenda, the day it is for ("2026-09-24"). */
  agenda_date?: string | null;
  /**
   * For the note of one class of a repeating event, which class: its first
   * start, as the calendar's `occurrence`. Null for any other page.
   */
  occurrence?: string | null;
  /**
   * The checklist lines tied to a task, by block id (one page at a time,
   * not in lists). Any line can carry an id, so only these are tasks.
   */
  linked_block_ids?: string[];
  /**
   * Other names the page goes by (LNK-03), such as a course code: the link
   * picker, the quick switcher, search and "Mentioned without a link" all
   * find the page by them too.
   */
  aliases?: string[];
  /** When the page itself was archived (SRCH-03), or null. */
  archived_at?: string | null;
  /** Archived, itself or through its folder: left out of lists and search. */
  archived?: boolean;
};

/** A note an event has (`GET /docs/event-notes`): enough to mark the event. */
export type EventNoteRef = {
  doc_id: string;
  /** The note's title, to say which page opens. */
  title: string;
  item_id: string;
  /** The class it is for, on a repeating event; null for the whole event. */
  occurrence: string | null;
  team_id: string | null;
  /**
   * For a note kept as the whole event's because its class is gone
   * (skipped, deleted, not in a new pattern), the class it was for. Such a
   * note stands in for the event's own only when it has none.
   */
  class_was?: string | null;
};

/**
 * The first of `notes` that `matches`, the event's own notes before those
 * of classes it no longer has — the order the server keeps.
 */
function ownNoteFirst(
  notes: EventNoteRef[],
  matches: (n: EventNoteRef) => boolean,
): EventNoteRef | undefined {
  return notes.find((n) => matches(n) && !n.class_was) ?? notes.find(matches);
}

/**
 * The note an event on the calendar opens, of `notes` (latest edited
 * first): for one time of a repeating event (a calendar entry's
 * `occurrence`), that time's own; for a repeating event with no time
 * given, the series' own; for any other event, its note. A note left by a
 * class that is gone (`class_was`) is the event's only when it has no
 * other. The same rule the server keeps when a note is opened or made.
 */
export function eventNoteFor(
  notes: EventNoteRef[],
  entry: {
    item_id: string;
    occurrence?: string | null;
    rrule?: string | null;
    team_id?: string | null;
  },
): EventNoteRef | undefined {
  const at = entry.occurrence ? Date.parse(entry.occurrence) : null;
  return ownNoteFirst(
    notes,
    (n) =>
      n.item_id === entry.item_id &&
      (n.team_id ?? null) === (entry.team_id ?? null) &&
      (at !== null
        ? n.occurrence !== null && Date.parse(n.occurrence) === at
        : !entry.rrule || n.occurrence === null),
  );
}

/**
 * The note a repeating event keeps for the whole series, to point to when
 * one class of it is open (a calendar entry with an `occurrence`): that
 * class opens its own note, so the series' — the running note of a weekly
 * one-to-one, and every note written before classes had their own — would
 * otherwise go unseen from the calendar. A note left by a class that is
 * gone stands in only when the series has none of its own. Undefined for
 * an event that doesn't repeat, or with no class given (the series' note
 * opens then).
 */
export function seriesNoteFor(
  notes: EventNoteRef[],
  entry: {
    item_id: string;
    occurrence?: string | null;
    team_id?: string | null;
  },
): EventNoteRef | undefined {
  if (!entry.occurrence) return undefined;
  return ownNoteFirst(
    notes,
    (n) =>
      n.item_id === entry.item_id &&
      (n.team_id ?? null) === (entry.team_id ?? null) &&
      n.occurrence === null,
  );
}

/**
 * Where an imported page came from. The file itself is kept only with
 * "Keep the original" (the account setting, or a choice for one import):
 * it is then the page's `original` ({@link Doc}), not part of this.
 */
export type DocImportSource = {
  file_name: string;
  file_type: string;
  pages: number;
  ocr_pages: number;
  imported_at: string;
};

export type DocComment = {
  id: string;
  doc_id: string;
  user_id: string;
  author: string;
  body: string;
  /**
   * The block this was written about, or null for a remark about the page as
   * a whole. A comment whose block is no longer there is not thrown away: it
   * is shown apart, with the words it was written about.
   */
  block_id: string | null;
  /** What the line said when the comment was written. */
  quote: string | null;
  /**
   * Where the quoted words sit in the block's Markdown source, as a
   * half-open character range. Null on a remark about a whole line or the
   * page, which is how every remark written before ranges existed reads.
   */
  range_start: number | null;
  range_end: number | null;
  /** The remark this replies to. A thread is one deep, as in a margin. */
  parent_id: string | null;
  /** True once the words it was written about have gone from the page. */
  detached: boolean;
  /** Who was named in the body, so the page can show them as people. */
  mentions: DocMention[];
  resolved_at: string | null;
  created_at: string;
};

/** Someone named in a comment, by the `@` picker rather than by typing. */
export type DocMention = { user_id: string; name: string };

/** A comment and the replies written under it, oldest first. */
export type DocThread = { comment: DocComment; replies: DocComment[] };

/**
 * Gather replies under the remarks they answer. A reply whose parent is not
 * in the list stands on its own rather than disappearing, which is what
 * happens when only the open remarks are being shown and its parent is
 * resolved.
 */
export function threadComments(comments: DocComment[]): DocThread[] {
  const threads = new Map<string, DocThread>();
  const out: DocThread[] = [];
  for (const c of comments)
    if (!c.parent_id) {
      const thread = { comment: c, replies: [] as DocComment[] };
      threads.set(c.id, thread);
      out.push(thread);
    }
  for (const c of comments)
    if (c.parent_id) {
      const thread = threads.get(c.parent_id);
      if (thread) thread.replies.push(c);
      else out.push({ comment: c, replies: [] });
    }
  return out;
}

/** Where a remark's words sit in a line. */
export type DocRange = { start: number; end: number };

/**
 * Follow a remark's words as the line around them is edited.
 *
 * The words themselves are the anchor, not the place they were at: an edit
 * before them moves them, an edit after them does not, and either way the
 * remark should still point at the same words. So the quote is looked for
 * again, and of several occurrences the one nearest to where it was wins.
 * Only when the words have gone altogether does the remark come loose.
 */
export function reanchor(
  quote: string,
  was: DocRange,
  text: string,
): DocRange | null {
  if (!quote) return null;
  if (text.slice(was.start, was.end) === quote) return was;
  const found: number[] = [];
  for (
    let at = text.indexOf(quote);
    at !== -1;
    at = text.indexOf(quote, at + 1)
  )
    found.push(at);
  if (!found.length) return null;
  const nearest = found.reduce((best, at) =>
    Math.abs(at - was.start) < Math.abs(best - was.start) ? at : best,
  );
  return { start: nearest, end: nearest + quote.length };
}

/**
 * Re-anchor every remark on a page against the blocks as they now stand.
 * Returns only the remarks whose anchor actually moved or came loose, so a
 * save that changed one line doesn't rewrite every row.
 */
export function reanchorComments(
  comments: DocComment[],
  blocks: DocBlock[],
): {
  id: string;
  range_start: number | null;
  range_end: number | null;
  detached: boolean;
}[] {
  const source = new Map(
    blocks.flatMap((b) => (b.id ? [[b.id, blockText(b)] as const] : [])),
  );
  const moved = [];
  for (const c of comments) {
    if (!c.block_id) continue;
    const text = source.get(c.block_id);
    // A block that has gone is handled by the page, not here: the remark
    // keeps its range so it still reads if the block comes back.
    if (text === undefined) continue;
    if (c.range_start === null || c.range_end === null || !c.quote) {
      // A whole-line remark only comes loose when its line goes.
      if (c.detached)
        moved.push({
          id: c.id,
          range_start: null,
          range_end: null,
          detached: false,
        });
      continue;
    }
    const next = reanchor(
      c.quote,
      { start: c.range_start, end: c.range_end },
      text,
    );
    if (!next) {
      if (!c.detached)
        moved.push({
          id: c.id,
          range_start: c.range_start,
          range_end: c.range_end,
          detached: true,
        });
      continue;
    }
    if (next.start !== c.range_start || next.end !== c.range_end || c.detached)
      moved.push({
        id: c.id,
        range_start: next.start,
        range_end: next.end,
        detached: false,
      });
  }
  return moved;
}

/**
 * Sort comments into the ones still attached to a line and the ones whose
 * line has gone. Anchored comments come back in the page's own order, so a
 * margin can lay them out beside the text rather than by when they arrived.
 */
export function anchorComments(
  comments: DocComment[],
  blocks: DocBlock[],
): { anchored: Map<string, DocComment[]>; loose: DocComment[] } {
  const order = new Map(blocks.map((b, i) => [b.id ?? "", i]));
  const anchored = new Map<string, DocComment[]>();
  const loose: DocComment[] = [];
  const byId = new Map(comments.map((c) => [c.id, c]));
  for (const c of comments) {
    // Replies inherit their thread's location; their own block_id is null.
    const root = (c.parent_id && byId.get(c.parent_id)) || c;
    if (root.block_id && order.has(root.block_id) && !root.detached) {
      const list = anchored.get(root.block_id) ?? [];
      list.push(c);
      anchored.set(root.block_id, list);
    } else loose.push(c);
  }
  // Within a line, remarks read left to right, so the cards beside it are in
  // the order the words they point at are read.
  for (const list of anchored.values())
    list.sort((a, b) => (a.range_start ?? -1) - (b.range_start ?? -1));
  return { anchored, loose };
}

/** A document in a list: no body, plus a short preview line. */
export type DocSummary = Omit<Doc, "content"> & { preview: string };

const empty = (): DocBlock => ({ type: "paragraph", text: "" });

/** A new document always has one empty paragraph to type into. */
export const emptyDoc = (): DocBlock[] => [empty()];

// ---------------------------------------------------------------- inline ---

/** A run of inline text. `math` holds LaTeX source without its `$` fences. */
export type DocInline = {
  text: string;
  /**
   * Where `text` starts in the line's Markdown source. Styling markers sit
   * outside it, so `**bold**` gives a run whose `start` is past the stars and
   * whose text is exactly as long as the source it came from. That keeps a
   * comment's character range, which is measured on the source, convertible
   * to a position on screen without a second parse.
   */
  start: number;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  math?: boolean;
  link?: string;
  /** `==words==`, drawn on a soft tint like a highlighter pen. */
  highlight?: boolean;
  /** The highlighter's colour when it isn't the usual amber (`=={green}…==`). */
  tint?: Exclude<HighlightTint, "amber">;
  /** `~~words~~`, struck through (EDT-05). */
  strike?: boolean;
  /** `[^1]`: a footnote marker (EDT-13); `text` is its label. */
  footnote?: string;
};

/** Whether a run carries any style: it can't take another one on top. */
export const isStyledRun = (run: DocInline): boolean =>
  !!(
    run.bold ||
    run.italic ||
    run.code ||
    run.math ||
    run.link ||
    run.highlight ||
    run.strike ||
    run.footnote
  );

// Inline maths first so `$x_1$` isn't mistaken for emphasis, then code (which
// is literal), then footnote markers, links, highlights, strikes, then
// emphasis. A highlight or a strike must hug its words (`==this==`), so
// "a == b" in a note about code stays text.
const INLINE_RE =
  /\$([^$\n]+?)\$|`([^`\n]+)`|\[\^([\w-]{1,24})\]|\[([^\]\n]+)\]\(([^)\s]+)\)|==(\{(?:green|rose)\})?([^=\s](?:[^=\n]*[^=\s])?)==|~~([^~\s](?:[^~\n]*[^~\s])?)~~|\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;

/**
 * Split one line into styled runs. Unmatched text passes through unchanged, so
 * a stray `*` or `$` shows as typed rather than swallowing the rest of a line.
 */
export function parseDocInline(text: string): DocInline[] {
  const out: DocInline[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const start = m.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start), start: at });
    // Each run's `start` skips its opening marker, so it points at the
    // first character its `text` actually holds.
    if (m[1] !== undefined)
      out.push({ text: m[1], start: start + 1, math: true });
    else if (m[2] !== undefined)
      out.push({ text: m[2], start: start + 1, code: true });
    else if (m[3] !== undefined)
      out.push({ text: m[3], start: start + 2, footnote: m[3] });
    else if (m[4] !== undefined)
      out.push({ text: m[4], start: start + 1, link: m[5] });
    else if (m[7] !== undefined) {
      const tint = m[6] ? (m[6].slice(1, -1) as "green" | "rose") : undefined;
      out.push({
        text: m[7],
        start: start + 2 + (m[6]?.length ?? 0),
        highlight: true,
        ...(tint ? { tint } : {}),
      });
    } else if (m[8] !== undefined)
      out.push({ text: m[8], start: start + 2, strike: true });
    else if (m[9] !== undefined)
      out.push({ text: m[9], start: start + 2, bold: true });
    else if (m[10] !== undefined)
      out.push({ text: m[10], start: start + 1, italic: true });
    at = start + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), start: at });
  return out.length ? out : [{ text: "", start: 0 }];
}

/** The shape of an id, as links and embeds write it. */
const UUID_SHAPE_EARLY =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

// --------------------------------------------------------------- anchors ---

/**
 * How Markdown is read and written for agents (H3): the exact form, where
 * every line carries its id as an anchor (` ^b3f9a2` at a line's end, or
 * `^b3f9a2` on its own line under a code block, maths, a table or a
 * divider), an empty line is written `\`, and a maths line's check mark is
 * `$$ % check`. `parseDoc(serializeDoc(blocks, o), o)` then gives back
 * every block exactly: its kind, settings, words and id. Left off, Markdown
 * is what exports and the editors use: no anchors, empty lines dropped.
 */
export type DocMarkdownOptions = { anchors?: boolean };

const ANCHOR_ID = "[A-Za-z0-9_-]{1,64}";
/** A line that is only an anchor: it names the block just above it. */
const OWN_ANCHOR = new RegExp(`^\\^(${ANCHOR_ID})\\s*$`);
/** An anchor at the end of a line, after a space. */
const END_ANCHOR = new RegExp(`(\\s)\\^(${ANCHOR_ID})\\s*$`);
/** Words ending the way an anchor does, which are written with a backslash. */
const ANCHOR_LIKE = new RegExp(`(\\s)(\\\\*\\^${ANCHOR_ID})$`);
/** Such words read back: one backslash comes off. */
const ESCAPED_ANCHOR = new RegExp(`(\\s)\\\\(\\\\*\\^${ANCHOR_ID})(\\s*)$`);
/** An id that can be written as an anchor. */
const WRITABLE_ID = new RegExp(`^${ANCHOR_ID}$`);

/** Kinds whose anchor goes on a line of its own, under them. */
const ownLineAnchor = (b: DocBlock) =>
  b.type === "code" ||
  b.type === "math" ||
  b.type === "table" ||
  b.type === "divider";

/**
 * Whether a paragraph's words would read back as something else — a
 * heading, a list line, a quote, a fence, an anchor — and so are written
 * after a backslash (`\# not a heading`), which reading takes off again.
 */
function paragraphNeedsEscape(text: string, anchors: boolean): boolean {
  const t = text.trim();
  if (anchors && /^\\*$/.test(t)) return true;
  if (OWN_ANCHOR.test(t)) return true;
  if (t.startsWith("\\")) return paragraphNeedsEscape(t.slice(1), anchors);
  const same = (line: string) => {
    const read = parseDoc(line);
    return (
      read.length === 1 && read[0].type === "paragraph" && read[0].text === t
    );
  };
  // An anchor after the words leaves a space behind them ("2) ^b1").
  return !same(t) || (anchors && !same(`${t} `));
}

/** A bullet's words that would read as a checklist box. */
const TICK_LIKE = /^\\*\[( |x|X)\](\s|$)/;
const ESCAPED_TICK = /^\\+\[( |x|X)\](\s|$)/;

/** A quote's words that would read as a callout. */
function calloutLike(text: string, escaped: boolean): boolean {
  const m = (escaped ? /^\\+\[!([A-Za-z]+)\]/ : /^\\*\[!([A-Za-z]+)\]/).exec(
    text,
  );
  return !!m && calloutKindOf(m[1]) !== null;
}

/** The fence a code block needs: longer than any fence-like line inside. */
function codeFence(text: string): string {
  let ticks = 3;
  for (const l of text.split("\n")) {
    const m = /^(`{3,})\s*$/.exec(l);
    if (m && m[1].length >= ticks) ticks = m[1].length + 1;
  }
  return "`".repeat(ticks);
}

// ----------------------------------------------------------------- parse ---

/** How wide a run of leading spaces and tabs is, a tab counting as four. */
const indentWidth = (lead: string) =>
  [...lead].reduce((n, ch) => n + (ch === "\t" ? 4 : 1), 0);

/**
 * Read Markdown into blocks. Unknown syntax becomes a paragraph, never an error.
 *
 * Nested lists are read by how far each item is indented compared with the
 * items above it, not by a fixed number of spaces, so two-space, four-space
 * and tab-indented lists from anywhere all come in with the same shape.
 * With `anchors`, lines' anchors are read as their ids (see
 * {@link DocMarkdownOptions}).
 */
export function parseDoc(
  markdown: string,
  opts: DocMarkdownOptions & {
    /** Told of each table too big for one table line, which is split. */
    onTableSplit?: () => void;
  } = {},
): DocBlock[] {
  const anchors = !!opts.anchors;
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: DocBlock[] = [];
  let i = 0;
  /** Indentation of each depth in the list being read. */
  let indents: number[] = [];
  /** The number each numbered item was written with, by block. */
  const written = new Map<DocBlock, number>();
  /** The anchor read at the end of the line being read. */
  let pending: string | null = null;
  const push = <B extends DocBlock>(b: B): B => {
    const named = pending && !b.id ? { ...b, id: pending } : b;
    pending = null;
    out.push(named);
    return named;
  };
  const depthAt = (width: number): number => {
    if (!indents.length || width <= indents[0]) {
      indents = [width];
      return 0;
    }
    let k = indents.length - 1;
    while (k > 0 && indents[k] > width) k--;
    if (width === indents[k]) {
      indents = indents.slice(0, k + 1);
      return k;
    }
    // Deeper than the item at depth k: its child.
    if (k + 1 > MAX_DEPTH) {
      indents = indents.slice(0, k + 1);
      return k;
    }
    indents = [...indents.slice(0, k + 1), width];
    return k + 1;
  };
  const listItem = <B extends ListBlock>(lead: string, block: B): B => {
    const depth = depthAt(indentWidth(lead));
    return depth ? { ...block, depth } : block;
  };
  /** A line's words without its anchor, the anchor kept for its block. */
  const unanchor = (raw: string): string => {
    const end = END_ANCHOR.exec(raw);
    let line = raw;
    if (end) {
      pending = end[2];
      line = raw.slice(0, end.index) + end[1];
    }
    return line.replace(ESCAPED_ANCHOR, "$1$2$3");
  };

  while (i < lines.length) {
    let line = lines[i];
    pending = null;
    if (anchors) {
      // `^b…` on its own line names the block above it.
      const own = OWN_ANCHOR.exec(line.trim());
      const last = out[out.length - 1];
      if (own && last && !last.id) {
        const named = { ...last, id: own[1] } as DocBlock;
        const typed = written.get(last);
        if (typed !== undefined) written.set(named, typed);
        out[out.length - 1] = named;
        i++;
        continue;
      }
      line = unanchor(line);
    }
    // Anything but a list item (or a blank line between items) ends a list.
    if (line.trim() && !/^\s*([-*]|\d+[.)])\s/.test(line)) indents = [];

    // Fenced code: ```lang … ```, closed by a fence at least as long.
    const fence = /^(`{3,})([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      const ticks = fence[1].length;
      const lang = fence[2] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = /^(`{3,})\s*$/.exec(lines[i]);
        if (close && close[1].length >= ticks) break;
        body.push(lines[i++]);
      }
      i++; // closing fence (or end of input)
      push({ type: "code", text: body.join("\n"), lang });
      continue;
    }

    // Display maths: $$ … $$ on its own lines, or all on one line.
    if (/^\$\$/.test(line.trim())) {
      const single = /^\$\$(.+)\$\$$/.exec(line.trim());
      if (single) {
        push({ type: "math", text: single[1].trim() });
        i++;
        continue;
      }
      const check = anchors && /^\$\$\s*%\s*check\s*$/.test(line.trim());
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\$\$\s*$/.test(lines[i].trim()))
        body.push(lines[i++]);
      i++;
      push({
        type: "math",
        text: body.join("\n").trim(),
        ...(check ? { check: true } : {}),
      });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    if (/^(---|\*\*\*|___)\s*$/.test(line.trim())) {
      push({ type: "divider" });
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      i++;
      continue;
    }

    const todo = /^(\s*)[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (todo) {
      push(
        listItem(todo[1], {
          type: "todo",
          done: todo[2].toLowerCase() === "x",
          text: todo[3].trim(),
        }),
      );
      i++;
      continue;
    }

    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      const text = bullet[2].trim();
      push(
        listItem(bullet[1], {
          type: "bullet",
          text: ESCAPED_TICK.test(text) ? text.slice(1) : text,
        }),
      );
      i++;
      continue;
    }

    const numbered = /^(\s*)(\d{1,9})[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      const block = push(
        listItem(numbered[1], {
          type: "numbered",
          text: numbered[3].trim(),
        }),
      );
      written.set(block, Number(numbered[2]));
      i++;
      continue;
    }

    // A callout: `> [!tip] words`, folded with a `-` after the kind.
    const callout = /^>\s?\[!([A-Za-z]+)\]([-+]?)\s*(.*)$/.exec(line);
    if (callout && calloutKindOf(callout[1])) {
      const body = [callout[3].trim()];
      let id: string | null = pending;
      i++;
      // Its further lines are the quote lines that follow it.
      while (i < lines.length && /^>\s?(?!\[!)/.test(lines[i])) {
        let more = lines[i].replace(/^>\s?/, "");
        const end = anchors ? END_ANCHOR.exec(more) : null;
        if (end) {
          id = end[2];
          more = more.slice(0, end.index);
        }
        more = more.trim();
        if (more) body.push(more);
        i++;
      }
      pending = id;
      push({
        type: "callout",
        kind: calloutKindOf(callout[1])!,
        text: body.filter(Boolean).join(" "),
        ...(callout[2] === "-" ? { folded: true } : {}),
      });
      continue;
    }

    // A table: pipe rows with a `| --- |` line under the first.
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? "")) {
      const rows: string[] = [line];
      let id: string | null = pending;
      i++;
      while (i < lines.length) {
        let row = lines[i];
        if (anchors) {
          const end = END_ANCHOR.exec(row);
          const bare = end ? row.slice(0, end.index) + end[1] : row;
          if (end && TABLE_ROW.test(bare)) {
            id = end[2];
            row = bare;
          }
        }
        if (!TABLE_ROW.test(row)) break;
        rows.push(row);
        i++;
      }
      const parts = splitTable(rows.join("\n"));
      if (parts.length > 1) opts.onTableSplit?.();
      parts.forEach((part, n) => {
        pending = n === 0 ? id : null;
        push(
          "table" in part
            ? { type: "table", text: part.table }
            : { type: "bullet", text: part.line },
        );
      });
      continue;
    }

    // A picture or a file from Orbyn's file store, on a line of its own.
    const image = FILE_IMAGE.exec(line.trim());
    if (image) {
      const width = Number(image[3]);
      push({
        type: "image",
        file: image[2].toLowerCase(),
        text: image[1].trim(),
        ...(width >= 10 && width < 100 ? { width: Math.round(width) } : {}),
      });
      i++;
      continue;
    }
    const file = FILE_LINE.exec(line.trim());
    if (file) {
      push({ type: "file", file: file[2].toLowerCase(), text: file[1] });
      i++;
      continue;
    }

    // A footnote's words: `[^1]: words`.
    const note = /^\[\^([\w-]{1,24})\]:\s*(.*)$/.exec(line.trim());
    if (note) {
      push({ type: "footnote", label: note[1], text: note[2].trim() });
      i++;
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      const text = quote[1].trim();
      push({
        type: "quote",
        text: calloutLike(text, true) ? text.slice(1) : text,
      });
      i++;
      continue;
    }

    // A paragraph; a backslash before words that would read as something
    // else keeps them words.
    const t = line.trim();
    push({
      type: "paragraph",
      text:
        t.startsWith("\\") && paragraphNeedsEscape(t.slice(1), anchors)
          ? t.slice(1)
          : t,
    });
    i++;
  }

  // A list that was written starting somewhere other than 1 keeps its start.
  // Only the first item of a list says where it starts; the numbers written
  // on the rest are counted afresh, as any Markdown reader does.
  if (written.size) {
    const layout = listLayout(out);
    out.forEach((b, n) => {
      if (b.type !== "numbered") return;
      const typed = written.get(b);
      const first = layout[n].number === (b.start ?? 1);
      if (first && typed !== undefined && typed !== 1)
        out[n] = { ...b, start: Math.min(typed, 99_999) };
    });
  }

  return out.length ? out : emptyDoc();
}

// ------------------------------------------------------------- serialize ---

/**
 * Write one block back to Markdown, as the line an editor shows: without the
 * indentation of a nested list item, which belongs to the page around it
 * (see `serializeDoc`). `number` is what a numbered line should be written
 * with, when the caller knows where it sits in its list.
 */
export function serializeBlock(b: DocBlock, number?: number | null): string {
  return blockMarkdown(b, number, false);
}

function blockMarkdown(
  b: DocBlock,
  number: number | null | undefined,
  anchors: boolean,
): string {
  switch (b.type) {
    case "heading":
      return `${"#".repeat(b.level)} ${b.text}`;
    case "paragraph":
      return paragraphNeedsEscape(b.text, anchors) ? `\\${b.text}` : b.text;
    case "bullet":
      return `- ${TICK_LIKE.test(b.text) ? "\\" : ""}${b.text}`;
    case "numbered":
      return `${number ?? b.start ?? 1}. ${b.text}`;
    case "todo":
      return `- [${b.done ? "x" : " "}] ${b.text}`;
    case "quote":
      return `> ${calloutLike(b.text, false) ? "\\" : ""}${b.text}`;
    case "code": {
      const fence = codeFence(b.text);
      return `${fence}${b.lang}\n${b.text}\n${fence}`;
    }
    case "math":
      return `$$${anchors && b.check ? " % check" : ""}\n${b.text}\n$$`;
    case "divider":
      return "---";
    case "callout":
      return `> [!${b.kind}]${b.folded ? "-" : ""} ${b.text}`.trimEnd();
    case "table":
      return b.text;
    case "image":
      return `![${fileLabel(b.text)}](${fileHref(b.file, b.width)})`;
    case "file":
      return `[${fileLabel(b.text) || "File"}](${fileHref(b.file)})`;
    case "footnote":
      return `[^${b.label}]: ${b.text}`;
  }
}

/**
 * Each block as the Markdown `serializeDoc` writes for it, in order: nested
 * list lines indented, numbered lines with the numbers they show, and with
 * `anchors`, each line's anchor. Reading part of a page (fetch) slices this.
 */
export function docLines(
  blocks: DocBlock[],
  opts: DocMarkdownOptions = {},
): string[] {
  const anchors = !!opts.anchors;
  const layout = listLayout(blocks);
  return blocks.map((b, i) => {
    let line =
      "    ".repeat(layout[i].depth) +
      blockMarkdown(b, layout[i].number, anchors);
    if (!anchors) return line;
    const own = ownLineAnchor(b);
    if (!own) line = line.replace(ANCHOR_LIKE, "$1\\$2");
    if (!b.id || !WRITABLE_ID.test(b.id)) return line;
    return own ? `${line}\n^${b.id}` : `${line} ^${b.id}`;
  });
}

// ---------------------------------------------------------------- files ---

const UUID_SHAPE = UUID_SHAPE_EARLY;
/** `![caption](orbyn://file/<id>?w=60)` on a line of its own. */
const FILE_IMAGE = new RegExp(
  `^!\\[([^\\]\\n]*)\\]\\(orbyn://file/(${UUID_SHAPE})(?:\\?w=(\\d{1,3}))?\\)$`,
);
/** `[name](orbyn://file/<id>)` on a line of its own. */
const FILE_LINE = new RegExp(
  `^\\[([^\\]\\n]+)\\]\\(orbyn://file/(${UUID_SHAPE})\\)$`,
);

/** The address a picture or file in a page is kept at. */
export const fileHref = (id: string, width?: number): string =>
  `orbyn://file/${id.toLowerCase()}${width && width < 100 ? `?w=${Math.round(width)}` : ""}`;

/** A caption or file name made safe to sit inside a link's brackets. */
export const fileLabel = (name: string): string =>
  name
    .replace(/[[\]\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

// ---------------------------------------------------------------- tables ---

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|(\s*:?-{1,}:?\s*\|)+\s*$/;

/** How a column's words sit. */
export type TableAlign = "left" | "center" | "right" | null;

/** A table as cells: the first row is its header. */
export type TableCells = { rows: string[][]; align: TableAlign[] };

/** The most rows and columns a table keeps. */
export const TABLE_MAX = { rows: 200, cols: 20 };

/** One pipe row's cells, with `\|` read as a pipe in the words. */
function tableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && inner[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (inner[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += inner[i];
  }
  cells.push(cell.trim());
  return cells;
}

/** The most characters one table line holds (as the page's schema says). */
export const TABLE_TEXT_MAX = 40000;

/** The most characters a list line holds, for a row too long for a table. */
const TABLE_LINE_MAX = 4000;

/**
 * A table's Markdown read into cells. Every row is made as wide as the
 * widest, so a ragged table from elsewhere still has a place for each word.
 * An editor's table holds at most {@link TABLE_MAX}; `all` reads every row
 * and column (see {@link splitTable}).
 */
export function parseTable(text: string, all = false): TableCells {
  const every = text.split("\n").filter((l) => TABLE_ROW.test(l));
  const lines = all ? every : every.slice(0, TABLE_MAX.rows + 1);
  const cols = all ? Infinity : TABLE_MAX.cols;
  let align: TableAlign[] = [];
  const rows: string[][] = [];
  lines.forEach((line, n) => {
    if (n === 1 && TABLE_RULE.test(line)) {
      align = tableCells(line).map((c) =>
        /^:-+:$/.test(c)
          ? "center"
          : /^-+:$/.test(c)
            ? "right"
            : /^:-+$/.test(c)
              ? "left"
              : null,
      );
      return;
    }
    rows.push(tableCells(line).slice(0, cols));
  });
  if (!rows.length) rows.push([""]);
  const width = Math.max(1, ...rows.map((r) => r.length));
  return {
    rows: rows.map((r) => [...r, ...Array(width - r.length).fill("")]),
    align: Array.from({ length: width }, (_, i) => align[i] ?? null),
  };
}

/** Cells written back as a Markdown table, a pipe in any cell escaped. */
export function tableMarkdown({ rows, align }: TableCells): string {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const cell = (c: string) =>
    (c ?? "").replace(/\n/g, " ").replace(/\|/g, "\\|").trim();
  const line = (r: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? "")).join(" | ")} |`;
  const rule = `| ${Array.from({ length: width }, (_, i) => {
    const a = align[i] ?? null;
    return a === "center"
      ? ":---:"
      : a === "right"
        ? "---:"
        : a === "left"
          ? ":---"
          : "---";
  }).join(" | ")} |`;
  const [head = [""], ...body] = rows.length ? rows : [[""]];
  return [line(head), rule, ...body.map(line)].join("\n");
}

/**
 * A table too big for one table line (more than {@link TABLE_MAX} rows or
 * columns, or {@link TABLE_TEXT_MAX} characters), as several tables in
 * order with the header repeated. Past the widest a table can be, the
 * columns go in groups that each keep the first column, so a row can still
 * be told apart. A row too long for any table (with its header) becomes a
 * line of its own ("Header: cell · …"). Nothing is dropped.
 */
export function splitTable(
  text: string,
): Array<{ table: string } | { line: string }> {
  const { rows, align } = parseTable(text, true);
  const width = rows[0].length;
  const groups: number[][] = [];
  if (width <= TABLE_MAX.cols)
    groups.push(Array.from({ length: width }, (_, i) => i));
  else {
    groups.push(Array.from({ length: TABLE_MAX.cols }, (_, i) => i));
    for (let at = TABLE_MAX.cols; at < width; at += TABLE_MAX.cols - 1)
      groups.push([
        0,
        ...Array.from(
          { length: Math.min(TABLE_MAX.cols - 1, width - at) },
          (_, i) => at + i,
        ),
      ]);
  }
  const out: Array<{ table: string } | { line: string }> = [];
  for (const cols of groups) {
    const pick = (r: string[]) => cols.map((c) => r[c] ?? "");
    const head = pick(rows[0]);
    const aligns = cols.map((c) => align[c] ?? null);
    const md = (body: string[][]) =>
      tableMarkdown({ rows: [head, ...body], align: aligns });
    const base = md([]).length;
    const lineLength = (r: string[]) =>
      tableMarkdown({ rows: [r], align: aligns }).split("\n")[0].length + 1;
    let chunk: string[][] = [];
    let size = base;
    const flush = () => {
      if (chunk.length) out.push({ table: md(chunk) });
      chunk = [];
      size = base;
    };
    const body = rows.slice(1).map(pick);
    if (!body.length) {
      if (base <= TABLE_TEXT_MAX) out.push({ table: md([]) });
      else out.push({ line: head.filter(Boolean).join(" · ") });
      continue;
    }
    for (const r of body) {
      const n = lineLength(r);
      if (base + n > TABLE_TEXT_MAX) {
        // Too long for any table: its words as a line of their own.
        flush();
        const line = r
          .map((cell, i) => (cell && head[i] ? `${head[i]}: ${cell}` : cell))
          .filter(Boolean)
          .join(" · ");
        // In pieces a list line can hold.
        for (let k = 0; k < line.length; k += TABLE_LINE_MAX)
          out.push({ line: line.slice(k, k + TABLE_LINE_MAX) });
        continue;
      }
      if (chunk.length >= TABLE_MAX.rows || size + n > TABLE_TEXT_MAX) flush();
      chunk.push(r);
      size += n;
    }
    flush();
  }
  return out;
}

/** A new empty table: a header and one row, two columns wide. */
export const emptyTable = (): string =>
  tableMarkdown({
    rows: [
      ["", ""],
      ["", ""],
    ],
    align: [null, null],
  });

/** A table's words in reading order, for previews and search. */
export const tableText = (text: string): string =>
  parseTable(text)
    .rows.map((r) => r.filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" · ");

// ------------------------------------------------------------- footnotes ---

/**
 * What number each footnote shows: markers are numbered 1, 2, 3 in the
 * order they are first read, whatever labels they were written with. A
 * note nobody points at is numbered after the rest.
 */
export function footnoteNumbers(blocks: DocBlock[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const b of blocks) {
    if (b.type === "code" || b.type === "math" || b.type === "divider")
      continue;
    if (b.type === "footnote") continue;
    for (const run of parseDocInline(b.text))
      if (run.footnote && !numbers.has(run.footnote))
        numbers.set(run.footnote, numbers.size + 1);
  }
  for (const b of blocks)
    if (b.type === "footnote" && !numbers.has(b.label))
      numbers.set(b.label, numbers.size + 1);
  return numbers;
}

/** A label no footnote on the page uses yet: the next number. */
export function nextFootnoteLabel(blocks: DocBlock[]): string {
  const used = new Set<string>();
  for (const b of blocks) {
    if (b.type === "footnote") used.add(b.label);
    else if (b.type !== "divider")
      for (const run of parseDocInline(b.text))
        if (run.footnote) used.add(run.footnote);
  }
  let n = used.size + 1;
  while (used.has(String(n))) n++;
  return String(n);
}

/** Each footnote's words by its label. */
export const footnoteTexts = (blocks: DocBlock[]): Map<string, string> =>
  new Map(
    blocks.flatMap((b) =>
      b.type === "footnote" ? [[b.label, b.text] as const] : [],
    ),
  );

/**
 * Write a whole document back to Markdown, LaTeX included. Numbered lists
 * are written with the numbers they show, and nested items are indented by
 * four spaces a step, which every Markdown reader takes as nesting under a
 * bullet or a numbered item alike. With `anchors`, the exact form agents
 * read and write (see {@link DocMarkdownOptions}).
 */
export function serializeDoc(
  blocks: DocBlock[],
  opts: DocMarkdownOptions = {},
): string {
  return (
    docLines(blocks, opts)
      .join("\n\n")
      .replace(/^\n+|\n+$/g, "") + "\n"
  );
}

/**
 * The language of a live list block (SRCH-02): a fenced block whose words
 * say what to list, drawn as live rows in the apps (see views.ts). Its
 * words are settings, not writing, so previews and counts leave them out.
 */
export const LIVE_LIST_LANG = "orbyn-list";

/** A live list block, whose text is its settings. */
export const isLiveList = (b: DocBlock) =>
  b.type === "code" && b.lang === LIVE_LIST_LANG;

/**
 * The language of an embed block (LNK-08): a fenced block whose words say
 * what to show, live and read-only — another page's section
 * (`orbyn://doc/<id>#<line>`, or the whole page without a line) or the
 * tasks this page links to (`tasks: linked`). Like a live list, its words
 * are settings, so previews and counts leave them out.
 */
export const EMBED_LANG = "orbyn-embed";

/** An embed block, whose text is what it shows. */
export const isEmbed = (b: DocBlock) =>
  b.type === "code" && b.lang === EMBED_LANG;

/** What an embed block shows, read from its words; null when unreadable. */
export type EmbedSpec =
  { kind: "section"; doc: string; block: string | null } | { kind: "tasks" };

const EMBED_DOC = new RegExp(
  `^orbyn://doc/(${UUID_SHAPE_EARLY})(?:#([A-Za-z0-9_-]{1,64}))?$`,
);

/** Read an embed block's words. */
export function parseEmbed(text: string): EmbedSpec | null {
  const t = text.trim();
  if (/^tasks\s*:\s*linked$/i.test(t)) return { kind: "tasks" };
  const m = EMBED_DOC.exec(t);
  return m
    ? { kind: "section", doc: m[1].toLowerCase(), block: m[2] ?? null }
    : null;
}

/** An embed block's words for a page's section, or the tasks it links to. */
export const embedText = (spec: EmbedSpec): string =>
  spec.kind === "tasks"
    ? "tasks: linked"
    : `orbyn://doc/${spec.doc.toLowerCase()}${spec.block ? `#${spec.block}` : ""}`;

/** A code block drawn as a diagram (EDT-11). */
export const isDiagram = (b: DocBlock) =>
  b.type === "code" && b.lang.toLowerCase() === "mermaid";

/**
 * A line's words as they read in a preview or a search: a table's cells,
 * a picture's caption, a file's name; nothing for a divider or a block
 * whose words are settings (a live list, an embed).
 */
export function blockPlainText(b: DocBlock): string {
  if (b.type === "divider" || isLiveList(b) || isEmbed(b)) return "";
  if (b.type === "math") return mathToText(b.text);
  if (b.type === "table") return plainText(tableText(b.text));
  if (b.type === "code") return b.text;
  return plainText(b.text);
}

/** Plain text of a document, for previews and search. */
export function docPlainText(blocks: DocBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === "divider" || isLiveList(b) || isEmbed(b)) return "";
      if (b.type === "table") return plainText(tableText(b.text));
      // A maths block is LaTeX all the way through, with no fences to find
      // it by, so it is spelled out whole.
      if (b.type === "math") return mathToText(b.text);
      // A preview is read, not rendered, so it should read as words. Maths
      // was already spelled out here; the rest of the markers were not, and
      // every list of documents showed "Pricing stays **unchanged**".
      return plainText(b.text);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The handful of LaTeX names worth spelling out in a one-line preview. Anything
 * else keeps its name without the backslash, which reads better in a list than
 * a wall of markup.
 */
const SYMBOLS: Record<string, string> = {
  alpha: "\u03b1",
  beta: "\u03b2",
  gamma: "\u03b3",
  delta: "\u03b4",
  epsilon: "\u03b5",
  eta: "\u03b7",
  theta: "\u03b8",
  lambda: "\u03bb",
  mu: "\u03bc",
  pi: "\u03c0",
  sigma: "\u03c3",
  phi: "\u03c6",
  omega: "\u03c9",
  Delta: "\u0394",
  Sigma: "\u03a3",
  Omega: "\u03a9",
  infty: "\u221e",
  le: "\u2264",
  ge: "\u2265",
  ne: "\u2260",
  approx: "\u2248",
  times: "\u00d7",
  cdot: "\u00b7",
  pm: "\u00b1",
  to: "\u2192",
  int: "\u222b",
  sum: "\u2211",
  sqrt: "\u221a",
  nabla: "\u2207",
  partial: "\u2202",
  lfloor: "\u230a",
  rfloor: "\u230b",
  lceil: "\u2308",
  rceil: "\u2309",
  langle: "\u27e8",
  rangle: "\u27e9",
  cdots: "\u22ef",
  ldots: "\u2026",
  in: "\u2208",
  forall: "\u2200",
  exists: "\u2203",
  prod: "\u220f",
  neq: "\u2260",
  leq: "\u2264",
  geq: "\u2265",
  Rightarrow: "\u21d2",
  mid: "|",
  // Sizing and delimiter commands carry nothing in plain text.
  left: "",
  right: "",
  big: "",
  Big: "",
  tag: "",
};

/**
 * Turn a line into something that reads as plain text: maths loses its `$`
 * fences and its most common commands become the symbols they stand for, so
 * "$0 < \\eta < 1/\\mu$" reads as "0 < \u03b7 < 1/\u03bc".
 *
 * Used for previews everywhere, and by the mobile app to show formulas, which
 * has no typesetting engine of its own.
 */
export function mathToText(text: string): string {
  return (
    text
      // Drop the fences; the maths itself stays.
      .replace(/\$([^$\n]+?)\$/g, "$1")
      // \mathrm{min} and \mathbb{R} read as their letters; \text{…} as its text.
      .replace(
        /\\(?:mathrm|operatorname|text|mathit|mathbf)\s*\{([^{}]*)\}/g,
        "$1",
      )
      .replace(
        /\\mathbb\s*\{([A-Z])\}/g,
        (_m, l: string) => ({ R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ" })[l] ?? l,
      )
      // \frac{a}{b} reads as a/b.
      .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2")
      // \| is the norm bars; \{ and \} are literal braces.
      .replace(/\\\|/g, "\u2016")
      .replace(/\\([{}])/g, "$1")
      // Keep grouping on sub- and superscripts only where it carries meaning:
      // x_{k+1} stays x_(k+1) rather than collapsing to a misleading x_k+1,
      // while a single character needs no brackets at all.
      .replace(/([_^])\{([^{}])\}/g, "$1$2")
      .replace(/([_^])\{([^{}]{2,})\}/g, "$1($2)")
      // Known commands become symbols; the rest just lose the backslash.
      .replace(/\\([A-Za-z]+)/g, (_m, name: string) => SYMBOLS[name] ?? name)
      // Spacing commands (\, \; \! \quad) carry nothing in plain text.
      .replace(/\\[,;!:> ]/g, " ")
      // Grouping braces carry no meaning once it is plain text.
      .replace(/[{}]/g, "")
      .replace(/\s+/g, " ")
  );
}

/** The first line or so of a document, for a list row. */
export function docPreview(blocks: DocBlock[], max = 120): string {
  const text = docPlainText(blocks);
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

/** Checklist blocks, so a document's open items can become tasks. */
export const docTodos = (blocks: DocBlock[]) =>
  blocks.flatMap((b, index) =>
    b.type === "todo" ? [{ index, text: b.text, done: b.done }] : [],
  );

// ------------------------------------------------------------- merging ---

/** Two versions of a block that changed differently from the same start. */
export type DocConflict = { index: number; mine: DocBlock; theirs: DocBlock };

export type DocMerge = { blocks: DocBlock[]; conflicts: DocConflict[] };

/**
 * Whether two blocks say the same thing. The name is left out: giving a line
 * a name (by commenting on it, say) changes nothing a reader would see, and
 * counting that as an edit would raise a conflict over nothing.
 */
const sameBlock = (a: DocBlock, b: DocBlock) => {
  const strip = ({ id: _id, ...rest }: DocBlock) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
};

/**
 * Bring two people's edits together from the version they both started at.
 *
 * Blocks only one of them touched are taken as they left them. Where both
 * changed the same block, theirs is kept and yours is handed back as a
 * conflict, so the page can offer it rather than dropping it silently — the
 * one thing a shared document must never do.
 *
 * Added and removed blocks are handled at the ends: whichever side is longer
 * contributes its extra blocks, so two people writing in different parts of a
 * page both keep their work.
 */
export function mergeDocs(
  base: DocBlock[],
  mine: DocBlock[],
  theirs: DocBlock[],
): DocMerge {
  const conflicts: DocConflict[] = [];
  const length = Math.max(base.length, mine.length, theirs.length);
  const blocks: DocBlock[] = [];

  for (let i = 0; i < length; i++) {
    const b = base[i];
    const m = mine[i];
    const t = theirs[i];

    // One side ran out: take whatever the other still has.
    if (m === undefined && t === undefined) continue;
    if (m === undefined) {
      blocks.push(t);
      continue;
    }
    if (t === undefined) {
      blocks.push(m);
      continue;
    }

    const iChanged = b === undefined || !sameBlock(b, m);
    const theyChanged = b === undefined || !sameBlock(b, t);

    if (!iChanged) blocks.push(t);
    else if (!theyChanged) blocks.push(m);
    else if (sameBlock(m, t)) blocks.push(m);
    else {
      // Both rewrote the same line. Neither is thrown away: the one already
      // saved stands where the line was, and yours follows it, so whoever
      // reads the page next can see both and decide.
      blocks.push(t, m);
      conflicts.push({ index: i, mine: m, theirs: t });
    }
  }

  return { blocks: blocks.length ? blocks : emptyDoc(), conflicts };
}

/**
 * Take the ticks a save came back with for the lines tied to tasks.
 *
 * The server stores such a line as its task now stands, which isn't always
 * how it was sent: a repeating task that was just ticked has moved on to its
 * next occurrence and reads unticked again, and a tick the task refused
 * reads as the task really is. The page takes that state for every such line
 * whose tick hasn't changed again here since the save went out (`sent` is
 * what was sent, `local` is what is on screen now), so the next save doesn't
 * carry the old tick back. Other lines are left as they are.
 *
 * Returns `local` itself when nothing changes, and the ids of the lines that
 * took a new tick.
 */
export function adoptTaskTicks(
  local: DocBlock[],
  sent: DocBlock[],
  saved: Pick<Doc, "content" | "linked_block_ids">,
): { blocks: DocBlock[]; changed: string[] } {
  const linked = new Set(saved.linked_block_ids ?? []);
  if (!linked.size) return { blocks: local, changed: [] };
  const now = new Map<string, boolean>();
  for (const b of saved.content)
    if (b.type === "todo" && b.id && linked.has(b.id)) now.set(b.id, b.done);
  const was = new Map<string, boolean>();
  for (const b of sent) if (b.type === "todo" && b.id) was.set(b.id, b.done);
  const changed: string[] = [];
  const blocks = local.map((b) => {
    if (b.type !== "todo" || !b.id) return b;
    const server = now.get(b.id);
    if (server === undefined || server === b.done) return b;
    // Ticked or unticked again since the save: that's a new change of its own.
    if (was.get(b.id) !== b.done) return b;
    changed.push(b.id);
    return { ...b, done: server };
  });
  return changed.length ? { blocks, changed } : { blocks: local, changed };
}

/**
 * The version of a page that the ticks on screen were taken from, which an
 * editor sends with each save (`ticksFrom` on updateDoc) so the server can
 * tell a tick the person just made from one it has already counted.
 *
 * An editor keeps this beside the version it saves against, starting from
 * the version it opened. Each time a copy from the server arrives (a save's
 * answer, a fresh read, a copy merged in), it moves to that copy's version
 * only when every line tied to a task shows the tick that copy has for it:
 * then any tick made from here on is made on the lines as they stand. While
 * a tick made here is still unsaved it stays at `held`, the version the
 * tick was made on, even as newer copies are merged around it. Sent as if
 * taken from the newer copy, a tick the server already counted (its answer
 * lost, or another open copy of the page ticking the same line) would count
 * again.
 */
export function ticksTakenFrom(
  held: number,
  server: Pick<Doc, "version" | "content" | "linked_block_ids">,
  screen: DocBlock[],
): number {
  if (server.version <= held) return held;
  // Without the list, every named checklist line might be a task.
  const linked = server.linked_block_ids
    ? new Set(server.linked_block_ids)
    : null;
  const theirs = new Map<string, boolean>();
  for (const b of server.content)
    if (b.type === "todo" && b.id) theirs.set(b.id, b.done);
  for (const b of screen) {
    if (b.type !== "todo" || !b.id || (linked && !linked.has(b.id))) continue;
    if (theirs.get(b.id) !== b.done) return held;
  }
  return server.version;
}

/**
 * Whether a newer copy of a page differs from an older one only in the
 * ticks of lines tied to tasks: a task was finished or reopened, and nobody
 * wrote on the page. An editor then says so rather than that someone else
 * edited it.
 */
export function onlyTaskTicksMoved(
  before: DocBlock[],
  after: Pick<Doc, "content" | "linked_block_ids">,
): boolean {
  if (before.length !== after.content.length) return false;
  const linked = new Set(after.linked_block_ids ?? []);
  return after.content.every((b, i) => {
    const a = before[i];
    if (sameBlock(a, b)) return true;
    return (
      a.type === "todo" &&
      b.type === "todo" &&
      !!b.id &&
      a.id === b.id &&
      linked.has(b.id) &&
      sameBlock({ ...a, done: b.done }, b)
    );
  });
}

/**
 * A checklist line's Markdown with its box set to `done`, for a line open
 * for editing whose tick changed underneath it. Anything that isn't a
 * checklist line comes back as it was.
 */
export function setTodoSource(source: string, done: boolean): string {
  return source.replace(/^(\s*[-*]\s+\[)[ xX](\])/, `$1${done ? "x" : " "}$2`);
}

/**
 * The kinds of block a person can ask for by name — in a slash menu, a
 * "turn into" menu, or a toolbar. One list, so every surface offers the same
 * things in the same order and with the same words. `shorthand` is what you
 * would type at the start of a line to get the same block.
 */
export const BLOCK_KINDS: {
  type: DocBlockType;
  level?: 1 | 2 | 3;
  label: string;
  hint: string;
  shorthand: string;
}[] = [
  { type: "paragraph", label: "Text", hint: "Plain writing", shorthand: "" },
  {
    type: "heading",
    level: 1,
    label: "Heading 1",
    hint: "Big section title",
    shorthand: "# ",
  },
  {
    type: "heading",
    level: 2,
    label: "Heading 2",
    hint: "Section title",
    shorthand: "## ",
  },
  {
    type: "heading",
    level: 3,
    label: "Heading 3",
    hint: "Small title",
    shorthand: "### ",
  },
  {
    type: "bullet",
    label: "Bulleted list",
    hint: "A simple list",
    shorthand: "- ",
  },
  {
    type: "numbered",
    label: "Numbered list",
    hint: "A list in order",
    shorthand: "1. ",
  },
  {
    type: "todo",
    label: "To-do",
    hint: "A checkbox that can become a task",
    shorthand: "- [ ] ",
  },
  {
    type: "quote",
    label: "Quote",
    hint: "Set apart from the text",
    shorthand: "> ",
  },
  {
    type: "callout",
    label: "Callout",
    hint: "A note, tip or warning set apart",
    shorthand: "> [!note] ",
  },
  {
    type: "code",
    label: "Code",
    hint: "Kept exactly as typed",
    shorthand: "```",
  },
  {
    type: "math",
    label: "Maths",
    hint: "A formula on its own line, in LaTeX",
    shorthand: "$$",
  },
  {
    type: "divider",
    label: "Divider",
    hint: "A line across the page",
    shorthand: "---",
  },
];

/** The text a block carries, if it carries any. */
export const blockText = (block: DocBlock): string =>
  block.type === "divider" ? "" : block.text;

/**
 * The same words as a different kind of block — a paragraph made a heading,
 * a bullet made a to-do. The text is kept; what was ticked or which language
 * the code was in is not, because the new kind has no place for it.
 */
export function blockToType(
  block: DocBlock,
  type: DocBlockType,
  level: 1 | 2 | 3 = 2,
): DocBlock {
  const text = blockText(block);
  // A list line turned into another kind of list line stays where it was.
  const nested = (made: DocBlock) => withDepth(made, blockDepth(block));
  switch (type) {
    case "heading":
      return { type, level, text };
    case "todo":
      return nested({
        type,
        text,
        done: block.type === "todo" ? block.done : false,
        ...(block.id ? { id: block.id } : {}),
      });
    case "bullet":
    case "numbered":
      return nested({ type, text });
    case "code":
      return { type, text, lang: block.type === "code" ? block.lang : "" };
    case "divider":
      return { type };
    case "callout":
      return {
        type,
        kind: block.type === "callout" ? block.kind : "note",
        text,
        ...(block.id ? { id: block.id } : {}),
      };
    case "table":
      // A line's words become the table's first cell.
      return block.type === "table"
        ? block
        : {
            type,
            text: tableMarkdown({
              rows: [
                [plainTableCell(text), ""],
                ["", ""],
              ],
              align: [null, null],
            }),
          };
    case "footnote":
      return { type, label: "1", text };
    case "image":
    case "file":
      // Pictures and files come from the file store, never from words.
      return block;
    default:
      return { type, text } as DocBlock;
  }
}

/** A line's words as one table cell: no pipes, no line breaks. */
const plainTableCell = (text: string) =>
  text.replace(/\n/g, " ").replace(/\|/g, "/").trim();

// ----------------------------------------------------------- suggestions ---

export const SUGGESTION_KINDS = ["replace", "insert", "delete"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export const SUGGESTION_STATUSES = ["open", "accepted", "rejected"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/**
 * A change someone proposes to one line, waiting for an editor to take it
 * or leave it. The page itself is untouched until then, so two people can
 * propose changes to the same sentence without fighting over a version.
 */
export type DocSuggestion = {
  id: string;
  doc_id: string;
  block_id: string;
  user_id: string;
  author: string;
  kind: SuggestionKind;
  /** The stretch of the line's source this is about. */
  range_start: number;
  range_end: number;
  /** What it should say instead; empty for a deletion. */
  text: string;
  /** What it said when the change was proposed. */
  quote: string;
  /** A word from the person proposing it, if they left one. */
  note: string;
  status: SuggestionStatus;
  /** True once the words it was about have gone from the page. */
  detached: boolean;
  created_at: string;
};

/** A proposed change, before it has been written down. */
export type Proposed = {
  block_id: string;
  kind: SuggestionKind;
  range_start: number;
  range_end: number;
  text: string;
  quote: string;
};

/**
 * What changed between two versions of one line.
 *
 * The unchanged run at each end is left alone and the difference between
 * them is the change, which is how a person would describe an edit: "this
 * bit became that bit". It gives one change per line rather than a scatter
 * of single characters, so the card beside it reads as a sentence.
 */
export function diffLine(
  before: string,
  after: string,
): { start: number; end: number; text: string } | null {
  if (before === after) return null;
  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  )
    head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  return {
    start: head,
    end: before.length - tail,
    text: after.slice(head, after.length - tail),
  };
}

/** The change one edited line proposes, or null when nothing changed. */
export function proposeEdit(
  blockId: string,
  before: string,
  after: string,
): Proposed | null {
  const change = diffLine(before, after);
  if (!change) return null;
  const removes = change.end > change.start;
  return {
    block_id: blockId,
    kind: removes ? (change.text ? "replace" : "delete") : "insert",
    range_start: change.start,
    range_end: change.end,
    text: change.text,
    quote: before.slice(change.start, change.end),
  };
}

/** A line with one proposed change written into it. */
export const applySuggestion = (
  text: string,
  s: Pick<DocSuggestion, "range_start" | "range_end" | "text">,
): string => text.slice(0, s.range_start) + s.text + text.slice(s.range_end);

/**
 * Two proposals that touch the same characters cannot both be taken: the
 * second would be written against words the first has already replaced.
 */
export const overlaps = (
  a: Pick<DocSuggestion, "block_id" | "range_start" | "range_end">,
  b: Pick<DocSuggestion, "block_id" | "range_start" | "range_end">,
) =>
  a.block_id === b.block_id &&
  a.range_start < b.range_end &&
  b.range_start < a.range_end;

/**
 * Follow proposals as the page is edited, the same way remarks are followed.
 * A proposal whose words have gone cannot be applied to anything, so it
 * comes loose rather than being written somewhere it does not belong.
 */
export function reanchorSuggestions(
  suggestions: DocSuggestion[],
  blocks: DocBlock[],
): { id: string; range_start: number; range_end: number; detached: boolean }[] {
  const source = new Map(
    blocks.flatMap((b) => (b.id ? [[b.id, blockText(b)] as const] : [])),
  );
  const moved = [];
  for (const s of suggestions) {
    const text = source.get(s.block_id);
    if (text === undefined) continue;
    // An insertion has no words of its own; it holds its place by the words
    // it quoted around it, so it only moves when the line still reads alike.
    if (!s.quote) {
      const gone = s.range_start > text.length;
      if (gone !== s.detached)
        moved.push({
          id: s.id,
          range_start: Math.min(s.range_start, text.length),
          range_end: Math.min(s.range_end, text.length),
          detached: gone,
        });
      continue;
    }
    const next = reanchor(
      s.quote,
      { start: s.range_start, end: s.range_end },
      text,
    );
    if (!next) {
      if (!s.detached)
        moved.push({
          id: s.id,
          range_start: s.range_start,
          range_end: s.range_end,
          detached: true,
        });
      continue;
    }
    if (next.start !== s.range_start || next.end !== s.range_end || s.detached)
      moved.push({
        id: s.id,
        range_start: next.start,
        range_end: next.end,
        detached: false,
      });
  }
  return moved;
}

// ---------------------------------------------------------------- search ---

/**
 * One thing found by a search: a page, a task, or a record (a decision,
 * promise or other work record; only in a project's search).
 */
export type SearchHit = {
  id: string;
  type: "doc" | "task" | "record" | "project";
  title: string;
  kind: string;
  team_id: string | null;
  project_id: string | null;
  project_name: string | null;
  updated_at: string;
  /**
   * A line of the thing, with the matched words wrapped in `[[` and `]]`.
   * Markers rather than markup, so a client marks them however it likes and
   * nothing has to trust a string from the database as HTML.
   */
  snippet: string;
  /** The line that matched, so a hit can open where the words are. */
  block_id: string | null;
  rank: number;
};

/** One thing the quick switcher found (GET /find). */
export type FindHit = {
  id: string;
  /** A task, an event, a page or a project. */
  type: "task" | "event" | "doc" | "project";
  title: string;
  /** A little about it: its project, or what kind of page it is. */
  hint: string | null;
  team_id: string | null;
  updated_at: string;
  /** Whether it came from what you opened lately rather than the words. */
  recent: boolean;
};

/**
 * Split a snippet into its plain and matched runs, in order. A snippet with
 * no markers comes back as one plain run, which is what happens when the
 * match was on the title rather than in the body.
 */
export function snippetRuns(snippet: string): { text: string; hit: boolean }[] {
  const runs: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const m of snippet.matchAll(/\[\[(.*?)\]\]/g)) {
    const start = m.index ?? 0;
    if (start > at) runs.push({ text: snippet.slice(at, start), hit: false });
    runs.push({ text: m[1], hit: true });
    at = start + m[0].length;
  }
  if (at < snippet.length) runs.push({ text: snippet.slice(at), hit: false });
  return runs.length ? runs : [{ text: snippet, hit: false }];
}

/** What each in-page AI action is called, and what it asks for. */
export const DOC_AI_LABELS: Record<string, { name: string; asks: string }> = {
  improve: { name: "Improve writing", asks: "Rewrite it more clearly." },
  shorten: { name: "Shorten", asks: "Say the same thing in fewer words." },
  expand: { name: "Expand", asks: "Say more, in the same voice." },
  fix: {
    name: "Fix spelling and grammar",
    asks: "Correct it, changing nothing else.",
  },
  formal: { name: "More formal", asks: "Rewrite it in a formal register." },
  friendly: { name: "Friendlier", asks: "Rewrite it in a warmer register." },
  direct: { name: "More direct", asks: "Rewrite it plainly and directly." },
  summarise: { name: "Summarise", asks: "Replace it with a one-line summary." },
  checklist: {
    name: "Turn into a checklist",
    asks: "Rewrite it as Markdown checklist lines.",
  },
  continue: { name: "Continue writing", asks: "Carry on from where it stops." },
  custom: { name: "Ask for something else", asks: "" },
};

/** An answer about one page, with the lines it was taken from. */
export type DocAnswer = {
  answer: string;
  /** Lines of the page the answer leans on, so it can be checked. */
  sources: { block_id: string; quote: string }[];
};

/**
 * A page the assistant read while answering. These are the pages it
 * actually opened, not the ones it says it used — which is the only kind of
 * citation worth showing someone.
 */
export type DocSource = {
  kind?: "page";
  doc_id: string;
  title: string;
  /** The line that matched, when a search found one. */
  block_id: string | null;
  quote: string;
};

/** A planner fact the assistant actually read and the user can open. */
export type AssistantSource = (
  | DocSource
  | {
      kind: "task" | "decision" | "change";
      id: string;
      project_id?: string;
      title: string;
      quote: string;
    }
) & { used?: boolean; number?: number };

/**
 * A line as it reads, with its Markdown markers taken off.
 *
 * The page itself renders those markers as styling, but a quote of a line
 * shown inside a card — a comment's anchor, a proposed change, a citation —
 * is plain text in a small box, and there `**unchanged**` reads as two stars,
 * a word and two more stars. This is what to show there.
 */
export const plainText = (text: string): string =>
  parseDocInline(text)
    .map((run) =>
      run.footnote ? "" : run.math ? mathToText(run.text) : run.text,
    )
    .join("");

/**
 * A note the assistant has drafted, waiting for someone to keep it.
 *
 * It does not ride on the proposal system the way a task does. A proposal
 * is typed for items the whole way through — the schema, the table, the
 * apply route and the review cards — and a document is a different animal.
 * A draft travels with the reply instead, is shown as itself, and becomes a
 * page only when somebody says so. Nothing is written until then.
 */
export type DraftNote = {
  title: string;
  content: DocBlock[];
  /** The project it should hang off, when the assistant found one. */
  project_id: string | null;
  project_name: string | null;
  /** The task it is about, for a note drafted from one. */
  item_id: string | null;
  team_id: string | null;
  /** Why the assistant thought this was worth writing down. */
  note: string;
};

// ---------------------------------------------------------------- agendas ---

export type AgendaWeek = {
  /** The week's Monday, "2026-09-21". */
  key: string;
  /** "This week", "Last week" or "Week of 7 September". */
  label: string;
  docs: DocSummary[];
};
export type AgendaMonth = {
  /** "2026-09", for filtering. */
  key: string;
  /** "September". */
  label: string;
  weeks: AgendaWeek[];
  docs: DocSummary[];
};
export type AgendaYear = { year: number; months: AgendaMonth[] };

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * When an agenda is filed: the day it is for, at noon in the reader's own
 * zone, or when it was written for a page from before agendas knew their
 * day. A page written today for last Tuesday files under last Tuesday.
 */
export const agendaDay = (doc: {
  created_at: string;
  agenda_date?: string | null;
}) => (doc.agenda_date ? `${doc.agenda_date}T12:00:00` : doc.created_at);

/** "2026-09" for a moment, in the reader's own zone. */
export const agendaMonthKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

/** The Monday of the week a moment falls in, in the reader's own zone. */
const mondayOf = (d: Date) => {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
};

/** "This week", "Last week", or "Week of 7 September". */
export function agendaWeekLabel(monday: Date, now = new Date()) {
  const thisWeek = dayKey(mondayOf(now));
  const last = mondayOf(now);
  last.setDate(last.getDate() - 7);
  const key = dayKey(monday);
  if (key === thisWeek) return "This week";
  if (key === dayKey(last)) return "Last week";
  return `Week of ${monday.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
  })}`;
}

/**
 * Daily agendas filed like a diary — year, month, then week (Monday first),
 * newest first — so a page a day never floods the rest of the library.
 */
export function agendaGroups(
  docs: DocSummary[],
  now = new Date(),
): AgendaYear[] {
  const agendas = docs
    .filter((d) => d.kind === "agenda")
    .sort(
      (a, b) =>
        new Date(agendaDay(b)).getTime() - new Date(agendaDay(a)).getTime(),
    );
  const years: AgendaYear[] = [];
  for (const doc of agendas) {
    const at = new Date(agendaDay(doc));
    const key = agendaMonthKey(agendaDay(doc));
    let year = years.find((y) => y.year === at.getFullYear());
    if (!year) years.push((year = { year: at.getFullYear(), months: [] }));
    let month = year.months.find((m) => m.key === key);
    if (!month)
      year.months.push(
        (month = {
          key,
          label: at.toLocaleDateString("en-GB", { month: "long" }),
          weeks: [],
          docs: [],
        }),
      );
    month.docs.push(doc);
    const monday = mondayOf(at);
    let week = month.weeks.find((w) => w.key === dayKey(monday));
    if (!week)
      month.weeks.push(
        (week = {
          key: dayKey(monday),
          label: agendaWeekLabel(monday, now),
          docs: [],
        }),
      );
    week.docs.push(doc);
  }
  return years;
}

/** The week an agenda falls in: its Monday's key and "This week"-style label. */
export function agendaWeekOf(iso: string, now = new Date()) {
  const monday = mondayOf(new Date(iso));
  return { key: dayKey(monday), label: agendaWeekLabel(monday, now) };
}
