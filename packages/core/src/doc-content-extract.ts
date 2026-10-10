import type { DocBlock } from "./docs.js";
import { docContainerBlocks, type DocContainerNode } from "./doc-containers.js";
import {
  parseVersionedDocContent,
  type VersionedDocContent,
} from "./doc-content-format.js";

/** Move selected named leaves with their owning wrappers; leave one link at the first selected leaf. */
export function extractDocContent(
  value: VersionedDocContent,
  ids: readonly string[],
  link: DocBlock,
): {
  source: VersionedDocContent;
  extracted: VersionedDocContent;
} {
  const document = parseVersionedDocContent(value);
  const wanted = new Set(ids);
  const leaves =
    document.format === 1
      ? document.blocks
      : docContainerBlocks(document.nodes);
  const found = new Set(
    leaves.flatMap((block) =>
      block.id && wanted.has(block.id) ? [block.id] : [],
    ),
  );
  if (!found.size || found.size !== wanted.size)
    throw new Error("Selected document lines changed.");
  let linked = false;
  const walk = (
    nodes: readonly DocContainerNode[],
  ): { kept: DocContainerNode[]; moved: DocContainerNode[] } => {
    const kept: DocContainerNode[] = [],
      moved: DocContainerNode[] = [];
    for (const node of nodes) {
      if (node.kind === "block") {
        if (node.block.id && wanted.has(node.block.id)) {
          moved.push(node);
          if (!linked) {
            kept.push({ kind: "block", block: link });
            linked = true;
          }
        } else kept.push(node);
      } else if (node.kind === "quote") {
        const children = walk(node.children);
        if (children.kept.length || !node.children.length)
          kept.push({ ...node, children: children.kept });
        if (children.moved.length)
          moved.push({ ...node, children: children.moved });
      } else {
        const keptItems: typeof node.items = [],
          movedItems: typeof node.items = [];
        let firstKept = -1,
          firstMoved = -1;
        node.items.forEach((item, index) => {
          const children = walk(item.children);
          const first = item.children[0];
          const taskMoved =
            first?.kind === "block" &&
            !!first.block.id &&
            wanted.has(first.block.id);
          if (children.kept.length || !item.children.length) {
            if (firstKept < 0) firstKept = index;
            keptItems.push({
              ...(item.checked !== undefined && !taskMoved
                ? { checked: item.checked }
                : {}),
              children: children.kept,
            });
          }
          if (children.moved.length) {
            if (firstMoved < 0) firstMoved = index;
            movedItems.push({
              ...(item.checked !== undefined && taskMoved
                ? { checked: item.checked }
                : {}),
              children: children.moved,
            });
          }
        });
        if (keptItems.length || !node.items.length)
          kept.push({
            ...node,
            start: node.ordered
              ? node.start + Math.max(0, firstKept)
              : node.start,
            items: keptItems,
          });
        if (movedItems.length)
          moved.push({
            ...node,
            start: node.ordered ? node.start + firstMoved : node.start,
            items: movedItems,
          });
      }
    }
    return { kept, moved };
  };
  const result = walk(
    document.format === 2
      ? document.nodes
      : document.blocks.map((block) => ({ kind: "block", block })),
  );
  const content = (nodes: DocContainerNode[]) =>
    parseVersionedDocContent(
      document.format === 2
        ? { format: 2, nodes }
        : { format: 1, blocks: docContainerBlocks(nodes) },
    );
  return { source: content(result.kept), extracted: content(result.moved) };
}
