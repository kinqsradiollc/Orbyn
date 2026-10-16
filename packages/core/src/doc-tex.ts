import { serializeDoc, newBlockId, type DocBlock } from "./docs.js";
import { docContainerBlocks } from "./doc-containers.js";
import type { VersionedDocContent } from "./doc-content-format.js";
import type { DocContentOperation } from "./doc-content-operations.js";

const HEADER = String.raw`\documentclass{article}
\begin{document}`;
const FOOTER = String.raw`\end{document}`;
export type DocSourceDiagnostic = {
  origin: "conversion" | "compiler";
  code: string;
  message: string;
  start: number;
  end: number;
  line: number;
  /** Null when a compiler reports a line without a column. */
  column: number | null;
};
export class DocTexConversionError extends Error {
  readonly diagnostic: DocSourceDiagnostic;
  constructor(
    source: string,
    start: number,
    end: number,
    code: string,
    message: string,
  ) {
    super(`${message} Your draft is retained.`);
    this.name = "DocTexConversionError";
    start = Math.max(0, Math.min(source.length, start));
    end = Math.max(start, Math.min(source.length, end));
    const prefix = source.slice(0, start);
    const line = prefix.split("\n").length;
    const column = start - prefix.lastIndexOf("\n");
    this.diagnostic = {
      origin: "conversion",
      code,
      message,
      start,
      end,
      line,
      column,
    };
  }
}
function fail(
  source: string,
  start: number,
  end: number,
  code: string,
  message: string,
): never {
  throw new DocTexConversionError(source, start, end, code, message);
}
function difference(actual: string, expected: string): number {
  let at = 0;
  while (
    at < actual.length &&
    at < expected.length &&
    actual[at] === expected[at]
  )
    at++;
  return at;
}
/** Read explicit structured compiler positions only; never infer a location
 * from a generic error message or claim to parse arbitrary TeX syntax. */
export function docSourceDiagnostic(
  error: unknown,
  source: string,
): DocSourceDiagnostic | null {
  if (error instanceof DocTexConversionError) return error.diagnostic;
  if (!error || typeof error !== "object") return null;
  const value = error as {
    line?: unknown;
    column?: unknown;
    lineNumber?: unknown;
    location?: { start?: { line?: unknown; column?: unknown } };
    message?: unknown;
    code?: unknown;
  };
  const line = value.location?.start?.line ?? value.line ?? value.lineNumber;
  const column = value.location?.start?.column ?? value.column;
  const lines = source.split("\n");
  if (
    typeof line !== "number" ||
    !Number.isSafeInteger(line) ||
    line < 1 ||
    line > lines.length
  )
    return null;
  if (
    column !== undefined &&
    (typeof column !== "number" ||
      !Number.isSafeInteger(column) ||
      column < 1 ||
      column > lines[line - 1].length + 1)
  )
    return null;
  const start =
    lines
      .slice(0, line - 1)
      .reduce((length, text) => length + text.length + 1, 0) +
    (typeof column === "number" ? column - 1 : 0);
  return {
    origin: "compiler",
    code: typeof value.code === "string" ? value.code : "COMPILER_ERROR",
    message:
      typeof value.message === "string"
        ? value.message.split("\n")[0]
        : "Compiler error",
    start,
    end: Math.min(source.length, start + 1),
    line,
    column: typeof column === "number" ? column : null,
  };
}
const escape = (text: string) =>
  text.replace(
    /[\\{}%$&#_^~]/g,
    (char) =>
      ({
        "\\": String.raw`\textbackslash{}`,
        "~": String.raw`\textasciitilde{}`,
        "^": String.raw`\textasciicircum{}`,
      })[char] ?? `\\${char}`,
  );
function unescape(
  text: string,
  source: string,
  base: number,
  limit: number,
): string {
  let out = "";
  const spans: { start: number; end: number }[] = [];
  const gap = /\n\s*\n/.exec(text);
  if (gap)
    fail(
      source,
      base + gap.index,
      base + gap.index + gap[0].length,
      "BLOCK_STRUCTURE",
      "Use Note or Markdown to add paragraphs.",
    );
  for (let at = 0; at < text.length;) {
    const start = at;
    if (text[at] !== "\\") {
      if (/[{}%$&#_^~]/.test(text[at]))
        fail(
          source,
          base + at,
          base + at + 1,
          "UNESCAPED_CHARACTER",
          `Escape ${text[at]} in text.`,
        );
      out += text[at++];
    } else {
      const match =
        /^\\(?:([{}%$&#_])|textbackslash\{\}|textasciitilde\{\}|textasciicircum\{\})/.exec(
          text.slice(at),
        );
      if (!match) {
        const token = /^\\(?:[A-Za-z]+|.)?/.exec(text.slice(at))![0];
        fail(
          source,
          base + at,
          base + at + token.length,
          "UNSUPPORTED_COMMAND",
          `Unsupported command ${token}.`,
        );
      }
      out +=
        match![1] ??
        (match![0].startsWith("\\textbackslash")
          ? "\\"
          : match![0].startsWith("\\textasciitilde")
            ? "~"
            : "^");
      at += match![0].length;
    }
    spans.push({ start, end: at });
    if (out.length > limit)
      fail(
        source,
        base + start,
        base + at,
        "BLOCK_LENGTH",
        `Text exceeds the ${limit.toLocaleString("en-US")}-character block limit.`,
      );
  }
  const rich = /[*`]|\[[^\]]*\]\(|!\[|\$/.exec(out);
  if (rich) {
    const span = spans[rich.index];
    fail(
      source,
      base + span.start,
      base + spans[rich.index + rich[0].length - 1].end,
      "RICH_TEXT",
      "Use Note or Markdown for formatting.",
    );
  }
  return out;
}
function editable(block: DocBlock): boolean {
  return (
    [
      "paragraph",
      "heading",
      "bullet",
      "numbered",
      "todo",
      "quote",
      "callout",
      "footnote",
    ].includes(block.type) &&
    "text" in block &&
    !/[*`]|\[[^\]]*\]\(|!\[|\$|\n\s*\n/.test(block.text)
  );
}
function body(block: DocBlock): string {
  if (block.type === "math") return `\\[${block.text}\\]`;
  if (!editable(block)) {
    // Rich/embedded blocks remain explicitly preserved. Their complete source
    // is visible in TeX comments, and their Note rendering remains canonical.
    const label =
      block.type === "code" && block.lang === "latex-document"
        ? "Embedded LaTeX document"
        : `Preserved ${block.type}`;
    return `% ${serializeDoc([block], { anchors: true }).replace(/\n/g, "\n% ")}\n\\textit{${escape(label)}}`;
  }
  const text = escape((block as DocBlock & { text: string }).text);
  if (block.type === "heading")
    return `\\${["section", "subsection", "subsubsection", "paragraph", "subparagraph", "textbf"][block.level - 1]}{${text}}`;
  if (block.type === "quote") return `\\begin{quote}\n${text}\n\\end{quote}`;
  if (
    block.type === "bullet" ||
    block.type === "numbered" ||
    block.type === "todo"
  )
    return `\\begin{${block.type === "numbered" ? "enumerate" : "itemize"}}\n\\item ${text}\n\\end{${block.type === "numbered" ? "enumerate" : "itemize"}}`;
  return text;
}
/** Rich placeholders are lossless for editing, but cannot be exported as a faithful PDF. */
export function docWholeLatexCanExport(blocks: readonly DocBlock[]): boolean {
  return (
    docWholeLatex(blocks).length <= 20_000 &&
    blocks.every((block) => editable(block) || block.type === "math")
  );
}
/** Bounded, lossless text projection. Block identity/order and rich content are
 * immutable in TeX; structural/rich edits remain available in Note/Markdown.
 * This is deliberately not a general TeX interpreter. */
export function docWholeLatex(blocks: readonly DocBlock[]): string {
  if (!blocks.length) return docWholeLatex([{ type: "paragraph", text: "" }]);
  return `${HEADER}\n\n${blocks.map((block, i) => `% orbyn-block:${i}\n${body(block)}\n% orbyn-end:${i}`).join("\n\n")}\n\n${FOOTER}\n`;
}
export function editDocWholeLatex(
  blocks: DocBlock[],
  source: string,
): DocBlock[] {
  if (source.length > 20_000)
    fail(
      source,
      20_000,
      20_001,
      "SOURCE_LENGTH",
      "Source exceeds the 20,000-character limit.",
    );
  if (source === docWholeLatex(blocks)) return blocks;
  if (!blocks.length)
    return editDocWholeLatex(
      [{ type: "paragraph", text: "", id: newBlockId() }],
      source,
    );
  const opening = `${HEADER}\n\n`;
  if (!source.startsWith(opening)) {
    const at = difference(source, opening);
    fail(
      source,
      at,
      at + 1,
      "DOCUMENT_PREAMBLE",
      "Keep the document preamble.",
    );
  }
  let cursor = opening.length;
  const next = blocks.map((block, i) => {
    const marker = `% orbyn-block:${i}\n`;
    if (!source.startsWith(marker, cursor)) {
      const at = cursor + difference(source.slice(cursor), marker);
      fail(source, at, at + 1, "BLOCK_MARKER", `Keep block marker ${i}.`);
    }
    const start = cursor + marker.length;
    const closing = `\n% orbyn-end:${i}`;
    const end = source.indexOf(closing, start);
    if (end < 0) {
      const other = /\n% orbyn-end:[^\r\n]*/.exec(source.slice(start));
      const footer = source.indexOf(`\n\n${FOOTER}`, start);
      const at = other
        ? start + other.index + difference(other[0], closing)
        : footer >= 0
          ? footer
          : source.length;
      fail(
        source,
        at,
        at + 1,
        "BLOCK_END",
        `Restore the end marker for block ${i}.`,
      );
    }
    const value = source.slice(start, end);
    cursor = end + closing.length;
    const separator = i < blocks.length - 1 ? "\n\n" : `\n\n${FOOTER}\n`;
    if (!source.startsWith(separator, cursor)) {
      const at = cursor + difference(source.slice(cursor), separator);
      fail(
        source,
        at,
        at + 1,
        "DOCUMENT_STRUCTURE",
        i < blocks.length - 1
          ? "Keep the block separator."
          : "Keep the document ending.",
      );
    }
    cursor += separator.length;
    if (value === body(block)) return block;
    if (block.type === "math") {
      if (!value.startsWith("\\[")) {
        const at = start + difference(value, "\\[");
        fail(source, at, at + 1, "MATH_BOUNDARY", "Keep the equation opening.");
      }
      if (!value.endsWith("\\]"))
        fail(source, end, end, "MATH_BOUNDARY", "Restore the equation ending.");
      const text = value.slice(2, -2);
      const forbidden =
        /\\(?:begin|end|input|include|write|def|newcommand)\b|% orbyn-/.exec(
          text,
        );
      if (forbidden)
        fail(
          source,
          start + 2 + forbidden.index,
          start + 2 + forbidden.index + forbidden[0].length,
          "MATH_COMMAND",
          `Unsupported equation command ${forbidden[0]}.`,
        );
      return { ...block, text, check: undefined };
    }
    if (!editable(block)) {
      const at = start + difference(value, body(block));
      fail(
        source,
        at,
        at + 1,
        "PRESERVED_BLOCK",
        "Edit this rich block in Note or Markdown.",
      );
    }
    const token = "ORB YN TEXT TOKEN",
      template = body({ ...block, text: token } as DocBlock),
      offset = template.indexOf(token);
    const before = template.slice(0, offset),
      after = template.slice(offset + token.length);
    if (offset < 0)
      fail(
        source,
        start,
        end,
        "BLOCK_TYPE",
        "Edit this block in Note or Markdown.",
      );
    if (!value.startsWith(before)) {
      const at = start + difference(value, before);
      fail(
        source,
        at,
        at + 1,
        "BLOCK_WRAPPER",
        "Keep this block's text command.",
      );
    }
    if (!value.endsWith(after))
      fail(
        source,
        end,
        end,
        "BLOCK_WRAPPER",
        "Restore this block's closing command.",
      );
    const raw = value.slice(
      before.length,
      after.length ? -after.length : undefined,
    );
    return {
      ...block,
      text: unescape(
        raw,
        source,
        start + before.length,
        block.type === "paragraph" ? 10000 : 4000,
      ),
    } as DocBlock;
  });
  if (cursor !== source.length)
    fail(
      source,
      cursor,
      source.length,
      "TRAILING_SOURCE",
      "Remove text after the document ending.",
    );
  return next;
}
/** One atomic leaf projection; containers/list owners are never flattened. */
export function docWholeLatexOperation(
  document: VersionedDocContent,
  text: string,
): DocContentOperation {
  const blocks =
    document.format === 2
      ? docContainerBlocks(document.nodes, { projected: true })
      : document.blocks;
  const next = editDocWholeLatex(blocks, text);
  if (!blocks.length && next.length)
    return {
      kind: "insert",
      owner: [],
      index: 0,
      node: { kind: "block", block: next[0] },
    };
  return { kind: "replace-leaves", blocks: next };
}
