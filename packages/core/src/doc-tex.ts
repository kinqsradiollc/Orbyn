import { serializeDoc, newBlockId, type DocBlock } from "./docs.js";
import { docContainerBlocks } from "./doc-containers.js";
import type { VersionedDocContent } from "./doc-content-format.js";
import type { DocContentOperation } from "./doc-content-operations.js";

const HEADER = String.raw`\documentclass{article}
\begin{document}`;
const FOOTER = String.raw`\end{document}`;
const fail = (): never => {
  throw new Error(
    "This LaTeX edit cannot be converted without losing document content. Keep the block markers and supported text commands, or restore the current document. Your draft is retained.",
  );
};
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
function unescape(text: string): string {
  let out = "";
  for (let at = 0; at < text.length;) {
    if (text[at] !== "\\") {
      if (/[{}%$&#_^~]/.test(text[at])) fail();
      out += text[at++];
      continue;
    }
    const match =
      /^\\(?:([{}%$&#_])|textbackslash\{\}|textasciitilde\{\}|textasciicircum\{\})/.exec(
        text.slice(at),
      );
    if (!match) fail();
    out +=
      match![1] ??
      (match![0].startsWith("\\textbackslash")
        ? "\\"
        : match![0].startsWith("\\textasciitilde")
          ? "~"
          : "^");
    at += match![0].length;
  }
  // Markdown styling has its own stored semantics. Do not introduce it through
  // a plain TeX text edit and then silently reinterpret it on the Note surface.
  if (/[*`]|\[[^\]]*\]\(|!\[|\$/.test(out)) fail();
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
    throw new Error(
      "LaTeX source exceeds the 20,000-character limit. Your draft is retained.",
    );
  if (source === docWholeLatex(blocks)) return blocks;
  if (!blocks.length)
    return editDocWholeLatex(
      [{ type: "paragraph", text: "", id: newBlockId() }],
      source,
    );
  if (
    !source.startsWith(`${HEADER}\n\n`) ||
    !source.endsWith(`\n\n${FOOTER}\n`)
  )
    fail();
  const middle = source.slice(HEADER.length + 2, -(FOOTER.length + 3));
  const pieces = middle ? middle.split("\n\n% orbyn-block:") : [];
  if (pieces.length !== blocks.length) fail();
  return blocks.map((block, i) => {
    const piece = (i ? "% orbyn-block:" : "") + pieces[i];
    const prefix = `% orbyn-block:${i}\n`,
      suffix = `\n% orbyn-end:${i}`;
    if (!piece.startsWith(prefix) || !piece.endsWith(suffix)) fail();
    const value = piece.slice(prefix.length, -suffix.length);
    if (value === body(block)) return block;
    if (block.type === "math") {
      if (!value.startsWith("\\[") || !value.endsWith("\\]")) fail();
      const text = value.slice(2, -2);
      if (
        /\\(?:begin|end|input|include|write|def|newcommand)\b|% orbyn-/.test(
          text,
        )
      )
        fail();
      return { ...block, text, check: undefined };
    }
    if (!editable(block)) fail();
    // Strip only the exact generated wrapper, keeping list depth/task state,
    // heading level, callout state, footnote labels and all IDs unchanged.
    const token = "ORB YN TEXT TOKEN";
    const template = body({ ...block, text: token } as DocBlock);
    const offset = template.indexOf(token);
    const before = template.slice(0, offset),
      after = template.slice(offset + token.length);
    if (offset < 0 || !value.startsWith(before) || !value.endsWith(after))
      fail();
    const text = unescape(
      value.slice(before.length, after.length ? -after.length : undefined),
    );
    if (
      /\n\s*\n/.test(text) ||
      text.length > (block.type === "paragraph" ? 10000 : 4000)
    )
      fail();
    return { ...block, text } as DocBlock;
  });
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
