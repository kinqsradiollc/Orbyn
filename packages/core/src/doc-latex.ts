import { newBlockId, type DocBlock } from "./docs.js";
import { visitDocContainers } from "./doc-containers.js";
import type { VersionedDocContent } from "./doc-content-format.js";
import type { DocContentOperation } from "./doc-content-operations.js";

/** Standalone TeX remains an ordinary named source block: history, comments,
 * assistant proposals and legacy clients retain it without a lossy conversion.
 * Other note blocks are never removed when adding or editing this source.
 */
export const DOC_LATEX_LANGUAGE = "latex-document";
export const DOC_LATEX_SOURCE_MAX = 20_000;
export const EMPTY_LATEX_DOCUMENT = String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{amsmath,amssymb}
\begin{document}

\end{document}
`;

export function docLatexBlock(blocks: readonly DocBlock[]) {
  return blocks.find(
    (block): block is Extract<DocBlock, { type: "code" }> =>
      block.type === "code" && block.lang === DOC_LATEX_LANGUAGE,
  );
}

export function withDocLatexSource(
  blocks: DocBlock[],
  text: string,
): DocBlock[] {
  if (text.length > DOC_LATEX_SOURCE_MAX)
    throw new Error(
      "LaTeX source exceeds the 20,000-character limit. Your draft is retained.",
    );
  const current = docLatexBlock(blocks);
  if (current?.text === text) return blocks;
  const next = {
    type: "code" as const,
    lang: DOC_LATEX_LANGUAGE,
    text,
    id: current?.id ?? newBlockId(),
  };
  return current
    ? blocks.map((block) => (block === current ? next : block))
    : [...blocks, next];
}

/** Preserve nested ownership when adding/editing the first standalone source. */
export function docLatexOperation(
  document: VersionedDocContent,
  text: string,
): DocContentOperation {
  if (text.length > DOC_LATEX_SOURCE_MAX)
    throw new Error(
      "LaTeX source exceeds the 20,000-character limit. Your draft is retained.",
    );
  const nodes =
    document.format === 2
      ? document.nodes
      : document.blocks.map((block) => ({ kind: "block" as const, block }));
  let found: { path: number[]; block: DocBlock } | null = null;
  visitDocContainers(nodes, (node, path) => {
    if (
      !found &&
      node.kind === "block" &&
      node.block.type === "code" &&
      node.block.lang === DOC_LATEX_LANGUAGE
    )
      found = { path, block: node.block };
  });
  // Closure assignments are not narrowed by TypeScript's control-flow analysis.
  const current = found as { path: number[]; block: DocBlock } | null;
  const block: DocBlock = {
    type: "code",
    lang: DOC_LATEX_LANGUAGE,
    text,
    id: current?.block.id ?? newBlockId(),
  };
  return current
    ? { kind: "replace-leaf", path: current.path, block }
    : {
        kind: "insert",
        owner: [],
        index: nodes.length,
        node: { kind: "block", block },
      };
}
