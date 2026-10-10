import type { DocBlock } from "./docs.js";
import {
  docContainerBlocks,
  visitDocContainers,
  type DocContainerNode,
} from "./doc-containers.js";
import { parseVersionedDocContent } from "./doc-content-format.js";

function checked(
  nodes: readonly DocContainerNode[],
  projected = false,
): DocContainerNode[] {
  const value = parseVersionedDocContent({ format: 2, nodes }, { projected });
  if (value.format !== 2) throw new Error("Invalid nested document.");
  return value.nodes;
}
const blank = (node: DocContainerNode) =>
  node.kind === "block" &&
  node.block.type === "paragraph" &&
  !node.block.text.trim();

/** Append at the explicit page root; nested empty leaves retain their owners. */
export function appendDocContainerBlocks(
  nodes: readonly DocContainerNode[],
  added: readonly DocBlock[],
): DocContainerNode[] {
  const roots = checked(nodes);
  return checked([
    ...(roots.length === 1 && blank(roots[0]) ? [] : roots),
    ...added.map((block): DocContainerNode => ({ kind: "block", block })),
  ]);
}

/** Append within a root heading's section without interpreting nested headings as page sections. */
export function appendDocContainerSection(
  nodes: readonly DocContainerNode[],
  heading: Extract<DocBlock, { type: "heading" }>,
  added: readonly DocBlock[],
  options: { last?: boolean; stopAtAnyHeading?: boolean } = {},
): DocContainerNode[] {
  const roots = checked(nodes);
  const matches = roots.flatMap((node, index) =>
    node.kind === "block" &&
    node.block.type === "heading" &&
    node.block.text.trim().toLowerCase() === heading.text.trim().toLowerCase()
      ? [index]
      : [],
  );
  const named = heading.id
    ? roots.findIndex(
        (node) =>
          node.kind === "block" &&
          node.block.type === "heading" &&
          node.block.id === heading.id,
      )
    : -1;
  const at =
    named >= 0 ? named : ((options.last ? matches.at(-1) : matches[0]) ?? -1);
  const additions = added.map((block): DocContainerNode => ({
    kind: "block",
    block,
  }));
  if (at < 0) {
    if (roots.length && blank(roots.at(-1)!)) roots.pop();
    let occupied = false;
    if (heading.id)
      visitDocContainers(roots, (node) => {
        if ((node.kind === "block" ? node.block.id : node.id) === heading.id)
          occupied = true;
      });
    // Existing identities retain their owners, even when a reserved section ID moved inside a container.
    const section = { ...heading };
    if (occupied) delete section.id;
    return checked([...roots, { kind: "block", block: section }, ...additions]);
  }
  const found = roots[at];
  if (found.kind !== "block" || found.block.type !== "heading")
    throw new Error("Invalid section heading.");
  let end = at + 1;
  while (end < roots.length) {
    const node = roots[end];
    if (
      node.kind === "block" &&
      node.block.type === "heading" &&
      (options.stopAtAnyHeading || node.block.level <= found.block.level)
    )
      break;
    end++;
  }
  while (end > at + 1 && blank(roots[end - 1])) end--;
  return checked([...roots.slice(0, end), ...additions, ...roots.slice(end)]);
}

/** Read a root section; nested headings cannot select or terminate that section. */
export function docContainerSectionBlocks(
  nodes: readonly DocContainerNode[],
  title: string,
): DocBlock[] {
  const roots = checked(nodes, true);
  const at = roots.findIndex(
    (node) =>
      node.kind === "block" &&
      node.block.type === "heading" &&
      node.block.text.trim().toLowerCase() === title.trim().toLowerCase(),
  );
  if (at < 0) return [];
  const heading = roots[at];
  if (heading.kind !== "block" || heading.block.type !== "heading") return [];
  let end = at + 1;
  while (end < roots.length) {
    const node = roots[end];
    if (
      node.kind === "block" &&
      node.block.type === "heading" &&
      node.block.level <= heading.block.level
    )
      break;
    end++;
  }
  return docContainerBlocks(roots.slice(at + 1, end), { projected: true });
}
