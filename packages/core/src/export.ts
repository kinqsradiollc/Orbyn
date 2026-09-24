import {
  blockText,
  listLayout,
  mathToText,
  parseDocInline,
  serializeDoc,
  type DocBlock,
  type DocInline,
} from "./docs.js";

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

/** One line's styled runs as HTML. Maths is written as symbols. */
function inlineHtml(text: string): string {
  return parseDocInline(text)
    .map((run: DocInline) => {
      const body = escapeHtml(run.math ? mathToText(run.text) : run.text);
      if (run.math) return `<span class="m">${body}</span>`;
      if (run.code) return `<code>${body}</code>`;
      if (run.link) return `<a href="${escapeHtml(run.link)}">${body}</a>`;
      if (run.bold) return `<strong>${body}</strong>`;
      if (run.italic) return `<em>${body}</em>`;
      if (run.highlight) return `<mark>${body}</mark>`;
      return body;
    })
    .join("");
}

/**
 * A page as a web page that stands on its own: no stylesheet to fetch, no
 * script, nothing to load. It should read the same in ten years.
 */
export function docToHtml(title: string, blocks: DocBlock[]): string {
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
    switch (block.type) {
      case "heading": {
        closeList();
        const level = block.level + 1;
        body.push(`<h${level}>${inlineHtml(block.text)}</h${level}>`);
        break;
      }
      case "bullet":
        item(index, "ul");
        body.push(`<li>${inlineHtml(block.text)}`);
        break;
      case "numbered":
        item(index, "ol");
        body.push(`<li>${inlineHtml(block.text)}`);
        break;
      case "todo":
        item(index, "ul");
        body.push(
          `<li class="t"><input type="checkbox" disabled${
            block.done ? " checked" : ""
          }> ${inlineHtml(block.text)}`,
        );
        break;
      case "quote":
        closeList();
        body.push(`<blockquote>${inlineHtml(block.text)}</blockquote>`);
        break;
      case "code":
        closeList();
        body.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`);
        break;
      case "math":
        closeList();
        body.push(`<p class="m">${escapeHtml(mathToText(block.text))}</p>`);
        break;
      case "divider":
        closeList();
        body.push("<hr>");
        break;
      default:
        closeList();
        body.push(`<p>${inlineHtml(block.text)}</p>`);
    }
  }
  closeList();
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
  h1, h2, h3, h4 { font-family: system-ui, sans-serif; line-height: 1.25; }
  code, pre { font-family: ui-monospace, Menlo, Consolas, monospace;
              font-size: 0.92em; }
  pre { background: #f4f4f4; padding: 0.9rem 1rem; overflow-x: auto; }
  blockquote { margin: 1rem 0; padding-left: 1rem;
               border-left: 3px solid #c9c9c9; color: #555; }
  .m { font-style: italic; }
  li.t { list-style: none; margin-left: -1.2rem; }
  mark { background: #fbf1dc; color: inherit; padding: 0 0.1em; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }
</style>
<h1>${escapeHtml(title)}</h1>
${body.join("\n")}
</html>
`;
}

/** A page as plain words: the title, a blank line, then each line. */
export function docToText(title: string, blocks: DocBlock[]): string {
  const layout = listLayout(blocks);
  const lines = blocks.map((b, i) => {
    if (b.type === "divider") return "---";
    const text = plainRuns(blockText(b));
    const indent = "    ".repeat(layout[i].depth);
    if (b.type === "heading") return text.toUpperCase();
    if (b.type === "bullet") return `${indent}• ${text}`;
    if (b.type === "numbered") return `${indent}${layout[i].number}. ${text}`;
    if (b.type === "todo") return `${indent}[${b.done ? "x" : " "}] ${text}`;
    if (b.type === "quote") return `> ${text}`;
    return text;
  });
  return `${title}\n\n${lines.join("\n\n")}\n`;
}

/** One line with its Markdown markers taken off, maths read as symbols. */
const plainRuns = (text: string) =>
  parseDocInline(text)
    .map((r) => (r.math ? mathToText(r.text) : r.text))
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
