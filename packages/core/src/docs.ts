/**
 * Documents: notes, briefs and agendas that live beside the planner.
 *
 * A document is a list of blocks. Blocks are stored as JSON so the editor can
 * work on one block at a time, and they round-trip to Markdown — including
 * LaTeX, which is kept as source and rendered at display time — so a document
 * can always be exported and nothing is locked into the editor.
 */

export const DOC_KINDS = ["doc", "agenda", "meeting"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export type DocBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; text: string }
  | { type: "numbered"; text: string }
  /**
   * A checklist line; `done` is the ticked state. `id` is set once the line
   * has become a task, so the two stay tied together as the document changes.
   */
  | { type: "todo"; text: string; done: boolean; id?: string }
  | { type: "quote"; text: string }
  | { type: "code"; text: string; lang: string }
  /** Display maths. `text` is LaTeX without the `$$` fences. */
  | { type: "math"; text: string }
  | { type: "divider" };

export type DocBlockType = DocBlock["type"];

export type Doc = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name?: string | null;
  title: string;
  kind: DocKind;
  content: DocBlock[];
  item_id: string | null;
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
  resolved_at: string | null;
  created_at: string;
};

/** A document in a list: no body, plus a short preview line. */
export type DocSummary = Omit<Doc, "content"> & { preview: string };

const empty = (): DocBlock => ({ type: "paragraph", text: "" });

/** A new document always has one empty paragraph to type into. */
export const emptyDoc = (): DocBlock[] => [empty()];

// ---------------------------------------------------------------- inline ---

/** A run of inline text. `math` holds LaTeX source without its `$` fences. */
export type DocInline = {
  text: string;
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
    if (start > at) out.push({ text: text.slice(at, start) });
    if (m[1] !== undefined) out.push({ text: m[1], math: true });
    else if (m[2] !== undefined) out.push({ text: m[2], code: true });
    else if (m[3] !== undefined) out.push({ text: m[3], link: m[4] });
    else if (m[5] !== undefined) out.push({ text: m[5], bold: true });
    else if (m[6] !== undefined) out.push({ text: m[6], italic: true });
    at = start + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out.length ? out : [{ text: "" }];
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

const sameBlock = (a: DocBlock, b: DocBlock) =>
  JSON.stringify(a) === JSON.stringify(b);

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
 * What a brand new document starts with. It lives here rather than in either
 * app so a page begun on the phone and one begun on the desktop are the same
 * page, and so the example formula stays in step with what the parser can
 * actually read.
 */
export const starterDoc = (): DocBlock[] =>
  parseDoc(
    [
      "## What this is",
      "",
      "Write here. Anything you type is saved as you go.",
      "",
      "- [ ] A checklist item",
      "",
      "Inline maths like $e^{i\\pi} + 1 = 0$ renders as you type, and a formula on",
      "its own line looks like this:",
      "",
      "$$",
      "\\int_{0}^{1} x^2 \\, dx = \\frac{1}{3}",
      "$$",
    ].join("\n"),
  );
