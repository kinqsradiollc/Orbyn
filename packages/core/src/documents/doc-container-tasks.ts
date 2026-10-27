import type { DocBlock } from "./docs.js";
import {
  docContainerBlocks,
  visitDocContainers,
  type DocContainerNode,
  type DocContainerItem,
} from "./doc-containers.js";
import { parseVersionedDocContent } from "./doc-content-format.js";
import type { DocContentValidationOptions } from "./doc-content-leaves.js";

function owners(
  nodes: readonly DocContainerNode[],
): Map<DocBlock, DocContainerItem> {
  const result = new Map<DocBlock, DocContainerItem>();
  visitDocContainers(nodes, (node) => {
    if (node.kind !== "list") return;
    for (const item of node.items) {
      const first = item.children[0];
      if (
        typeof item.checked === "boolean" &&
        first?.kind === "block" &&
        (first.block.type === "paragraph" || first.block.type === "todo")
      )
        result.set(first.block, item);
    }
  });
  return result;
}

/** Task view only: a checked item's first paragraph carries its stable task identity. Storage leaves stay paragraphs. */
export function docContainerTaskBlocks(
  nodes: readonly DocContainerNode[],
  options: DocContentValidationOptions = {},
): DocBlock[] {
  const content = parseVersionedDocContent({ format: 2, nodes }, options);
  if (content.format !== 2) throw new Error("Invalid nested document.");
  const leaves = docContainerBlocks(content.nodes, options),
    items = owners(content.nodes);
  return leaves.map((block) =>
    items.has(block) && (block.type === "paragraph" || block.type === "todo")
      ? { ...block, type: "todo", done: items.get(block)!.checked! }
      : block,
  );
}

/** Restore a task view onto its exact owners without storing synthetic todo leaves or changing existing identities. */
export function applyDocContainerTaskBlocks(
  nodes: readonly DocContainerNode[],
  mapped: readonly DocBlock[],
  options: DocContentValidationOptions = {},
): DocContainerNode[] {
  const content = parseVersionedDocContent({ format: 2, nodes }, options);
  if (content.format !== 2) throw new Error("Invalid nested document.");
  const leaves = docContainerBlocks(content.nodes, options),
    items = owners(content.nodes);
  if (leaves.length !== mapped.length)
    throw new Error("Task projection changed document ownership.");
  const replacements = new Map<DocBlock, DocBlock>();
  leaves.forEach((block, index) => {
    const next = mapped[index];
    if (block.id !== undefined && block.id !== next.id)
      throw new Error("Task projection changed an existing identity.");
    const item = items.get(block);
    if (item) {
      if (next.type !== "todo" || typeof next.done !== "boolean")
        throw new Error("Task projection lost checklist state.");
      item.checked = next.done;
      replacements.set(
        block,
        block.type === "todo"
          ? next
          : {
              type: "paragraph",
              text: next.text,
              ...(next.id ? { id: next.id } : {}),
            },
      );
    } else {
      if (block.type !== "todo" && next.id !== block.id)
        throw new Error(
          "Task projection assigned an identity to a non-checklist leaf.",
        );
      if (next.type !== block.type)
        throw new Error("Task projection changed a non-checklist leaf.");
      replacements.set(block, next);
    }
  });
  visitDocContainers(content.nodes, (node) => {
    if (node.kind === "block") node.block = replacements.get(node.block)!;
  });
  const result = parseVersionedDocContent(content, options);
  if (result.format !== 2) throw new Error("Invalid nested document.");
  return result.nodes;
}
