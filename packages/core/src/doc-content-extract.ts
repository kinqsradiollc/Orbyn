import { docFragmentIndex, docLinkDestination } from "./doc-navigation.js";
import { linkHref, parseObjectHref } from "./links.js";
import { rewriteDocBlockLinks } from "./doc-link-rewrite.js";
import type { DocBlock } from "./docs.js";
import {
  docContainerBlocks,
  visitDocContainers,
  type DocContainerNode,
} from "./doc-containers.js";
import {
  parseVersionedDocContent,
  type VersionedDocContent,
} from "./doc-content-format.js";

/** Move selected named leaves with their owning wrappers; leave one link at the first selected leaf. */
export function extractDocContent(
  value: VersionedDocContent,
  ids: readonly string[],
  link: DocBlock,
  context: { sourceId: string; destinationId: string; freshId: () => string },
): {
  source: VersionedDocContent;
  extracted: VersionedDocContent;
} {
  const sourceId = context.sourceId.toLowerCase(),
    destinationId = context.destinationId.toLowerCase();
  if (
    sourceId === destinationId ||
    !parseObjectHref(linkHref({ kind: "doc", id: sourceId })) ||
    !parseObjectHref(linkHref({ kind: "doc", id: destinationId }))
  )
    throw new Error("Invalid extraction page identity.");
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
  const originalAnchors = leaves.map((block) => ({ ...block }));
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
  const occupied = new Set<string>(link.id ? [link.id] : []);
  visitDocContainers(
    document.format === 2
      ? document.nodes
      : document.blocks.map((block) => ({ kind: "block", block })),
    (node) => {
      const id = node.kind === "block" ? node.block.id : node.id;
      if (id) occupied.add(id);
    },
  );
  const fresh = () => {
    const id = context.freshId();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || occupied.has(id))
      throw new Error(
        "Generated extraction anchor is invalid or already used.",
      );
    occupied.add(id);
    return id;
  };
  const relocate = (nodes: DocContainerNode[], pageId: string) => {
    const replacements = new Map<DocBlock, DocBlock>();
    visitDocContainers(nodes, (node) => {
      if (node.kind !== "block" || node.block === link) return;
      replacements.set(
        node.block,
        rewriteDocBlockLinks(node.block, (href) => {
          const local = docLinkDestination(href, null);
          const explicit = parseObjectHref(href);
          const fragment =
            local?.kind === "fragment"
              ? local.fragment
              : explicit?.kind === "doc" &&
                  explicit.id.toLowerCase() === sourceId
                ? explicit.block
                : undefined;
          if (!fragment) return href;
          const index = docFragmentIndex(originalAnchors, fragment);
          if (index === null) return href;
          const target = leaves[index];
          const targetPage =
            target.id && wanted.has(target.id) ? destinationId : sourceId;
          if (!target.id) target.id = fresh();
          return local?.kind === "fragment" && targetPage === pageId
            ? `#${target.id}`
            : linkHref({ kind: "doc", id: targetPage, block: target.id });
        }),
      );
    });
    return replacements;
  };
  // Plan both sides before replacing leaves: a moved link can name a later
  // anonymous heading retained on the source page.
  const keptLinks = relocate(result.kept, sourceId),
    movedLinks = relocate(result.moved, destinationId);
  for (const [nodes, replacements] of [
    [result.kept, keptLinks],
    [result.moved, movedLinks],
  ] as const) {
    visitDocContainers(nodes, (node) => {
      if (node.kind !== "block" || !replacements.has(node.block)) return;
      const original = node.block;
      node.block = {
        ...replacements.get(original)!,
        ...(original.id ? { id: original.id } : {}),
      };
    });
  }
  const content = (nodes: DocContainerNode[]) =>
    parseVersionedDocContent(
      document.format === 2
        ? { format: 2, nodes }
        : { format: 1, blocks: docContainerBlocks(nodes) },
    );
  return { source: content(result.kept), extracted: content(result.moved) };
}
