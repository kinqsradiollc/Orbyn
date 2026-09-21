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

export type DocBlock = Named &
  (
    | { type: "heading"; level: 1 | 2 | 3; text: string }
    | { type: "paragraph"; text: string }
    | { type: "bullet"; text: string }
    | { type: "numbered"; text: string }
    /** A checklist line; `done` is the ticked state. */
    | { type: "todo"; text: string; done: boolean }
    | { type: "quote"; text: string }
    | { type: "code"; text: string; lang: string }
    /** Display maths. `text` is LaTeX without the `$$` fences. */
    | { type: "math"; text: string }
    | { type: "divider" }
  );

export type DocBlockType = DocBlock["type"];

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
  if (!previous?.id || !fresh.length || fresh[0].id) return fresh;
  return [{ ...fresh[0], id: previous.id }, ...fresh.slice(1)];
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
  for (const c of comments) {
    if (c.block_id && order.has(c.block_id) && !c.detached) {
      const list = anchored.get(c.block_id) ?? [];
      list.push(c);
      anchored.set(c.block_id, list);
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
};

// Inline maths first so `$x_1$` isn't mistaken for emphasis, then code (which
// is literal), then links, then emphasis.
const INLINE_RE =
  /\$([^$\n]+?)\$|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;

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
    // Each branch's offset skips the opening marker, so the run's `start`
    // points at the first character its `text` actually holds.
    const inner = (group: number) => start + m[0].indexOf(m[group], 1);
    if (m[1] !== undefined)
      out.push({ text: m[1], start: inner(1), math: true });
    else if (m[2] !== undefined)
      out.push({ text: m[2], start: inner(2), code: true });
    else if (m[3] !== undefined)
      out.push({ text: m[3], start: inner(3), link: m[4] });
    else if (m[5] !== undefined)
      out.push({ text: m[5], start: inner(5), bold: true });
    else if (m[6] !== undefined)
      out.push({ text: m[6], start: inner(6), italic: true });
    at = start + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), start: at });
  return out.length ? out : [{ text: "", start: 0 }];
}

// ----------------------------------------------------------------- parse ---

/** Read Markdown into blocks. Unknown syntax becomes a paragraph, never an error. */
export function parseDoc(markdown: string): DocBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: DocBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code: ```lang … ```
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]))
        body.push(lines[i++]);
      i++; // closing fence (or end of input)
      out.push({ type: "code", text: body.join("\n"), lang });
      continue;
    }

    // Display maths: $$ … $$ on its own lines, or all on one line.
    if (/^\$\$/.test(line.trim())) {
      const single = /^\$\$(.+)\$\$$/.exec(line.trim());
      if (single) {
        out.push({ type: "math", text: single[1].trim() });
        i++;
        continue;
      }
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\$\$\s*$/.test(lines[i].trim()))
        body.push(lines[i++]);
      i++;
      out.push({ type: "math", text: body.join("\n").trim() });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    if (/^(---|\*\*\*|___)\s*$/.test(line.trim())) {
      out.push({ type: "divider" });
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      out.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      i++;
      continue;
    }

    const todo = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (todo) {
      out.push({
        type: "todo",
        done: todo[1].toLowerCase() === "x",
        text: todo[2].trim(),
      });
      i++;
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      out.push({ type: "bullet", text: bullet[1].trim() });
      i++;
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      out.push({ type: "numbered", text: numbered[1].trim() });
      i++;
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      out.push({ type: "quote", text: quote[1].trim() });
      i++;
      continue;
    }

    out.push({ type: "paragraph", text: line.trim() });
    i++;
  }

  return out.length ? out : emptyDoc();
}

// ------------------------------------------------------------- serialize ---

/** Write one block back to Markdown. */
export function serializeBlock(b: DocBlock): string {
  switch (b.type) {
    case "heading":
      return `${"#".repeat(b.level)} ${b.text}`;
    case "bullet":
      return `- ${b.text}`;
    case "numbered":
      return `1. ${b.text}`;
    case "todo":
      return `- [${b.done ? "x" : " "}] ${b.text}`;
    case "quote":
      return `> ${b.text}`;
    case "code":
      return `\`\`\`${b.lang}\n${b.text}\n\`\`\``;
    case "math":
      return `$$\n${b.text}\n$$`;
    case "divider":
      return "---";
    default:
      return b.text;
  }
}

/** Write a whole document back to Markdown, LaTeX included. */
export function serializeDoc(blocks: DocBlock[]): string {
  return blocks.map(serializeBlock).join("\n\n").trim() + "\n";
}

/** Plain text of a document, for previews and search. */
export function docPlainText(blocks: DocBlock[]): string {
  return blocks
    .map((b) => (b.type === "divider" ? "" : mathToText(b.text)))
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
  switch (type) {
    case "heading":
      return { type, level, text };
    case "todo":
      return {
        type,
        text,
        done: block.type === "todo" ? block.done : false,
        ...(block.id ? { id: block.id } : {}),
      };
    case "code":
      return { type, text, lang: block.type === "code" ? block.lang : "" };
    case "divider":
      return { type };
    default:
      return { type, text };
  }
}

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

/** One thing found by a search: a page, or a task. */
export type SearchHit = {
  id: string;
  type: "doc" | "task";
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
  doc_id: string;
  title: string;
  /** The line that matched, when a search found one. */
  block_id: string | null;
  quote: string;
};

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
    .map((run) => (run.math ? mathToText(run.text) : run.text))
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
