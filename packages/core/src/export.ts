import {
  blockText,
  CALLOUT_LABELS,
  footnoteNumbers,
  isEmbed,
  isDiagram,
  isLiveList,
  listLayout,
  mathToText,
  parseDocInline,
  docReferenceLinks,
  docReferenceDefinition,
  parseTable,
  serializeDoc,
  type DocBlock,
  type DocInline,
} from "./docs.js";
import { docFragmentIndex, docLinkDestination } from "./doc-navigation.js";

/**
 * Turning a page into something to keep.
 *
 * A page is blocks of Markdown, and the shapes below are the ways people
 * actually want to take one away: as the Markdown it already is, as plain
 * words, as a web page, as a Word document, or as a PDF. Everything here is
 * pure — the file each format needs is built from the blocks and nothing
 * else — so each one can be checked without a browser or a printer.
 */

export const EXPORT_FORMATS = ["md", "txt", "html", "docx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** What each format is called, and the file it produces. */
export const EXPORT_LABELS: Record<
  ExportFormat,
  { name: string; extension: string; type: string }
> = {
  md: { name: "Markdown", extension: "md", type: "text/markdown" },
  txt: { name: "Plain text", extension: "txt", type: "text/plain" },
  html: { name: "Web page", extension: "html", type: "text/html" },
  docx: {
    name: "Word",
    extension: "docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  pdf: { name: "PDF", extension: "pdf", type: "application/pdf" },
};

/** A file name that every operating system will accept. */
export function exportName(title: string, format: ExportFormat): string {
  const clean =
    title
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "document";
  return `${clean}.${EXPORT_LABELS[format].extension}`;
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** How HTML is written for a page's lines. */
export type HtmlOptions = {
  /** Mark diagram source only for local rendering of an authorized export snapshot. */
  diagramSources?: boolean;
  /** Safe page-scoped reference definitions. */
  references?: ReadonlyMap<string, string>;
  /** Where a picture in the page can be fetched from, when it can. */
  fileUrl?: (id: string) => string | null;
  /** The number each footnote shows (`footnoteNumbers`). */
  notes?: Map<string, number>;
  /**
   * Colours written onto the tags themselves, for pasting into another app
   * (which has none of this file's stylesheet).
   */
  inline?: boolean;
  /**
   * Where a link goes, for pages read somewhere else (a published page):
   * null keeps the words and drops the link (a page that isn't published).
   */
  linkUrl?: (href: string) => string | null;
  /** Give each heading an id (`h-<n>`, by line), for a contents list. */
  anchors?: boolean;
  /**
   * Typeset maths as HTML (a published page writes MathML). Left out, maths
   * is written as its plain reading. Returning null retains escaped LaTeX
   * source, labelled as a fallback, rather than losing unsupported notation.
   */
  math?: (tex: string, display: boolean) => string | null;
};

/** The highlighter colours as another app draws them (the light theme's tints). */
const TINT_HEX = { amber: "#fbf1dc", green: "#e7f0ea", rose: "#fbefea" };

/** One line's styled runs as HTML. Maths is written as symbols. */
function inlineHtml(text: string, o: HtmlOptions = {}): string {
  return parseDocInline(text, o.references)
    .map((run: DocInline) => {
      const body = escapeHtml(run.math ? mathToText(run.text) : run.text);
      if (run.math)
        return o.math
          ? (o.math(run.text, false) ??
              `<code class="math-source" title="Math source (rendering unavailable)">${escapeHtml(run.text)}</code>`)
          : `<span class="m">${body}</span>`;
      if (run.code) return `<code>${body}</code>`;
      if (run.footnote) {
        const n = o.notes?.get(run.footnote) ?? run.footnote;
        return `<sup><a href="#fn-${escapeHtml(String(n))}">${escapeHtml(String(n))}</a></sup>`;
      }
      if (run.source) return `<small class="src">[${body}]</small>`;
      if (run.link) {
        const href = o.linkUrl ? o.linkUrl(run.link) : run.link;
        return href ? `<a href="${escapeHtml(href)}">${body}</a>` : body;
      }
      if (run.bold) return `<strong>${body}</strong>`;
      if (run.italic) return `<em>${body}</em>`;
      if (run.strike) return `<s>${body}</s>`;
      if (run.highlight) {
        const tint = run.tint ?? "amber";
        return o.inline
          ? `<mark style="background:${TINT_HEX[tint]}">${body}</mark>`
          : `<mark${run.tint ? ` class="${run.tint}"` : ""}>${body}</mark>`;
      }
      return body;
    })
    .join("");
}

/** A table's cells as an HTML table, the first row as its header. */
function tableHtml(text: string, o: HtmlOptions): string {
  const { rows, align } = parseTable(text);
  const cell = (tag: "th" | "td", c: string, i: number) => {
    const a = align[i];
    const style = [
      a ? `text-align:${a}` : "",
      o.inline ? "border:1px solid #ddd;padding:4px 8px" : "",
    ]
      .filter(Boolean)
      .join(";");
    return `<${tag}${style ? ` style="${style}"` : ""}>${inlineHtml(c, o)}</${tag}>`;
  };
  const [head, ...body] = rows;
  return (
    `<table${o.inline ? ' style="border-collapse:collapse"' : ""}>` +
    `<thead><tr>${head.map((c, i) => cell("th", c, i)).join("")}</tr></thead>` +
    `<tbody>${body
      .map((r) => `<tr>${r.map((c, i) => cell("td", c, i)).join("")}</tr>`)
      .join("")}</tbody></table>`
  );
}

/**
 * A page's lines as HTML, without a document around them: what a web page
 * export holds, and what rich copy (EDT-15) puts on the clipboard so
 * another app keeps headings, lists, tables and links.
 */
export function blocksHtml(blocks: DocBlock[], o: HtmlOptions = {}): string {
  const notes = o.notes ?? footnoteNumbers(blocks);
  const opts = {
    ...o,
    notes,
    references: o.references ?? docReferenceLinks(blocks),
    linkUrl: (href: string) => {
      // Local heading links refer only to the already authorized exported page.
      // Keep legacy h-N targets used by published contents lists.
      if (o.anchors && href.startsWith("#")) {
        const destination = docLinkDestination(href, null);
        const index =
          destination?.kind === "fragment"
            ? docFragmentIndex(blocks, destination.fragment)
            : null;
        return index !== null && blocks[index].type === "heading"
          ? `#h-${index}`
          : null;
      }
      return o.linkUrl ? o.linkUrl(href) : href;
    },
  };
  const body: string[] = [];
  const layout = listLayout(blocks);
  // The lists open around the current line, outermost first. A list item is
  // left open until the next line, so a nested list can go inside it.
  const open: ("ul" | "ol")[] = [];
  const endItem = () => (body[body.length - 1] += "</li>");
  const closeTo = (depth: number) => {
    while (open.length > depth) {
      endItem();
      body.push(`</${open.pop()}>`);
    }
  };
  const closeList = () => closeTo(0);
  const item = (index: number, kind: "ul" | "ol") => {
    const { depth, number } = layout[index];
    closeTo(depth + 1);
    if (open.length === depth + 1 && open[depth] !== kind) closeTo(depth);
    if (open.length === depth + 1) endItem();
    else {
      body.push(
        kind === "ol" && number !== null && number !== 1
          ? `<ol start="${number}">`
          : `<${kind}>`,
      );
      open.push(kind);
    }
  };
  for (const [index, block] of blocks.entries()) {
    // Definitions remain editable Markdown, but do not render as page text.
    if (block.type === "paragraph" && docReferenceDefinition(block.text)) {
      closeList();
      continue;
    }
    switch (block.type) {
      case "heading": {
        closeList();
        const level = block.level;
        const id = o.anchors ? ` id="h-${index}"` : "";
        body.push(
          `<h${level}${id}>${inlineHtml(block.text, opts)}</h${level}>`,
        );
        break;
      }
      case "bullet":
        item(index, "ul");
        body.push(`<li>${inlineHtml(block.text, opts)}`);
        break;
      case "numbered":
        item(index, "ol");
        body.push(`<li>${inlineHtml(block.text, opts)}`);
        break;
      case "todo":
        item(index, "ul");
        body.push(
          `<li class="t"><input type="checkbox" disabled${
            block.done ? " checked" : ""
          }> ${inlineHtml(block.text, opts)}`,
        );
        break;
      case "quote":
        closeList();
        body.push(`<blockquote>${inlineHtml(block.text, opts)}</blockquote>`);
        break;
      case "callout":
        closeList();
        body.push(
          `<blockquote class="c ${block.kind}"><strong>${CALLOUT_LABELS[block.kind]}</strong> ${inlineHtml(block.text, opts)}</blockquote>`,
        );
        break;
      case "table":
        closeList();
        body.push(tableHtml(block.text, opts));
        break;
      case "image": {
        closeList();
        const src = o.fileUrl?.(block.file);
        body.push(
          src
            ? `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(block.text)}"${
                block.width ? ` style="width:${block.width}%"` : ""
              }>${block.text ? `<figcaption>${escapeHtml(block.text)}</figcaption>` : ""}</figure>`
            : `<p><em>Picture${block.text ? `: ${escapeHtml(block.text)}` : ""}</em></p>`,
        );
        break;
      }
      case "file": {
        closeList();
        const href = o.fileUrl?.(block.file);
        body.push(
          href
            ? `<p><a href="${escapeHtml(href)}">${escapeHtml(block.text)}</a></p>`
            : `<p><em>File: ${escapeHtml(block.text)}</em></p>`,
        );
        break;
      }
      case "footnote":
        // Footnotes are listed together at the end.
        break;
      case "code":
        closeList();
        // A live list or an embed is settings, not something to read.
        if (isLiveList(block) || isEmbed(block)) break;
        body.push(
          isDiagram(block) && o.diagramSources
            ? `<pre class="diagram-source" data-orbyn-diagram="mermaid"><code>${escapeHtml(block.text)}</code></pre>`
            : `<pre><code>${escapeHtml(block.text)}</code></pre>`,
        );
        break;
      case "math":
        closeList();
        body.push(
          o.math
            ? (o.math(block.text, true) ??
                `<pre class="math-source" title="Math source (rendering unavailable)"><code>${escapeHtml(block.text)}</code></pre>`)
            : `<p class="m">${escapeHtml(mathToText(block.text))}</p>`,
        );
        break;
      case "divider":
        closeList();
        body.push("<hr>");
        break;
      default:
        closeList();
        body.push(`<p>${inlineHtml(block.text, opts)}</p>`);
    }
  }
  closeList();
  const footnotes = blocks
    .filter(
      (b): b is Extract<DocBlock, { type: "footnote" }> =>
        b.type === "footnote",
    )
    .sort((a, b) => (notes.get(a.label) ?? 0) - (notes.get(b.label) ?? 0));
  if (footnotes.length)
    body.push(
      `<hr><ol class="fn">${footnotes
        .map(
          (f) =>
            `<li id="fn-${escapeHtml(String(notes.get(f.label) ?? f.label))}" value="${notes.get(f.label) ?? ""}">${inlineHtml(f.text, opts)}</li>`,
        )
        .join("")}</ol>`,
    );
  return body.join("\n");
}

/**
 * A selection of lines for the clipboard (EDT-15): HTML another app keeps
 * the headings, lists, tables and links of, with its colours written on the
 * tags, and the same lines as Markdown for anywhere that takes only text.
 */
export function blocksToClipboard(
  blocks: DocBlock[],
  o: Omit<HtmlOptions, "inline"> = {},
): { html: string; text: string } {
  return {
    html: `<meta charset="utf-8">${blocksHtml(blocks, { ...o, inline: true })}`,
    text: serializeDoc(blocks),
  };
}

/**
 * A page as a web page that stands on its own: no stylesheet to fetch, no
 * script, nothing to load. It should read the same in ten years.
 */
export function docToHtml(
  title: string,
  blocks: DocBlock[],
  o: HtmlOptions = {},
): string {
  const body = blocksHtml(blocks, { anchors: true, ...o });
  // The colours below are written out, not theme tokens: the file is opened
  // on its own, far from the app's stylesheet, so it has no variables to
  // read. They match the light theme (the highlight is its warnSoft tint),
  // and the file prints on white either way.
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: 42rem; margin: 3rem auto; padding: 0 1.25rem;
         font: 16px/1.65 Georgia, "Times New Roman", serif; color: #1a1a1a; }
  h1, h2, h3, h4, h5, h6 { font-family: system-ui, sans-serif; line-height: 1.25; }
  h4, h5, h6 { font-size: 1em; }
  code, pre { font-family: ui-monospace, Menlo, Consolas, monospace;
              font-size: 0.92em; }
  pre { background: #f4f4f4; padding: 0.9rem 1rem; overflow-x: auto; }
  blockquote { margin: 1rem 0; padding-left: 1rem;
               border-left: 3px solid #c9c9c9; color: #555; }
  .m { font-style: italic; }
  li.t { list-style: none; margin-left: -1.2rem; }
  mark { background: #fbf1dc; color: inherit; padding: 0 0.1em; }
  mark.green { background: #e7f0ea; }
  mark.rose { background: #fbefea; }
  blockquote.c { border-left-color: #376c51; color: inherit;
                 background: #f3f5f2; padding: 0.6rem 1rem; }
  table { border-collapse: collapse; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 0.3rem 0.6rem; }
  figure { margin: 1rem 0; } img { max-width: 100%; }
  ol.fn { font-size: 0.9em; color: #555; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }
</style>
<h1>${escapeHtml(title)}</h1>
${body}
</html>
`;
}

/** A page as plain words: the title, a blank line, then each line. */
export function docToText(title: string, blocks: DocBlock[]): string {
  const layout = listLayout(blocks);
  const notes = footnoteNumbers(blocks);
  const lines = blocks.map((b, i) => {
    if (b.type === "divider") return "---";
    const text = plainRuns(blockText(b));
    const indent = "    ".repeat(layout[i].depth);
    if (b.type === "heading") return text.toUpperCase();
    if (b.type === "bullet") return `${indent}• ${text}`;
    if (b.type === "numbered") return `${indent}${layout[i].number}. ${text}`;
    if (b.type === "todo") return `${indent}[${b.done ? "x" : " "}] ${text}`;
    if (b.type === "quote") return `> ${text}`;
    if (b.type === "callout") return `${CALLOUT_LABELS[b.kind]}: ${text}`;
    if (b.type === "table")
      return parseTable(b.text)
        .rows.map((r) => r.map(plainRuns).join(" | "))
        .join("\n");
    if (b.type === "image") return `[Picture${text ? `: ${text}` : ""}]`;
    if (b.type === "file") return `[File: ${text}]`;
    if (b.type === "footnote")
      return `[${notes.get(b.label) ?? b.label}] ${text}`;
    if (isLiveList(b) || isEmbed(b)) return "";
    return text;
  });
  return `${title}\n\n${lines.join("\n\n")}\n`;
}

/** One line with its Markdown markers taken off, maths read as symbols. */
const plainRuns = (text: string) =>
  parseDocInline(text)
    .map((r) =>
      r.footnote
        ? `[${r.footnote}]`
        : r.source
          ? `[${r.text}]`
          : r.math
            ? mathToText(r.text)
            : r.text,
    )
    .join("");

/** A page as the Markdown it already is, with its title as a heading. */
export const docToMarkdown = (title: string, blocks: DocBlock[]): string =>
  `# ${title}\n\n${serializeDoc(blocks)}`;

/**
 * A name that is safe as a file or folder name on every operating system:
 * no slashes or reserved characters, no leading dots, not too long.
 */
export function safeFileName(name: string, fallback = "Untitled"): string {
  const clean = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return clean || fallback;
}

/** What the front matter of an exported page says about it. */
export type PageFacts = {
  title: string;
  kind: string;
  created_at: string;
  updated_at: string;
  /** The day an agenda is for. */
  agenda_date?: string | null;
  folder?: string | null;
  project?: string | null;
  tags?: string[];
  /** The file an imported page was read from; the file itself isn't kept. */
  imported_from?: { file_name: string } | null;
  in_trash?: boolean;
};

const KIND_WORDS: Record<string, string> = {
  doc: "page",
  note: "note",
  agenda: "agenda",
  meeting: "meeting note",
};

/**
 * A page as a Markdown file to keep: YAML front matter with where it lived
 * and when, then the page itself. Strings are written double-quoted, which
 * every YAML reader takes as they are.
 */
export function pageFile(facts: PageFacts, blocks: DocBlock[]): string {
  const q = (s: string) => JSON.stringify(s);
  const lines = [
    "---",
    `title: ${q(facts.title || "Untitled")}`,
    `kind: ${q(KIND_WORDS[facts.kind] ?? facts.kind)}`,
    `created: ${q(facts.created_at)}`,
    `updated: ${q(facts.updated_at)}`,
  ];
  if (facts.agenda_date) lines.push(`date: ${q(facts.agenda_date)}`);
  if (facts.folder) lines.push(`folder: ${q(facts.folder)}`);
  if (facts.project) lines.push(`project: ${q(facts.project)}`);
  if (facts.tags?.length) lines.push(`tags: [${facts.tags.map(q).join(", ")}]`);
  if (facts.imported_from)
    lines.push(`imported_from: ${q(facts.imported_from.file_name)}`);
  if (facts.in_trash) lines.push("in_trash: true");
  lines.push("---", "");
  return lines.join("\n") + docToMarkdown(facts.title || "Untitled", blocks);
}
