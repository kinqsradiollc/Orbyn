import { mergeDocReferences } from "./doc-merge-references.js";
import { docFragmentIndex, docLinkDestination } from "./doc-navigation.js";
import { rewriteDocBlockLinks } from "./doc-link-rewrite.js";
import type { DocBlock } from "./docs.js";
import {
  visitDocContainers,
  docContainerBlocks,
  type DocContainerNode,
} from "./doc-containers.js";
import {
  parseVersionedDocContent,
  type VersionedDocContent,
} from "./doc-content-format.js";

/** Merge complete pages without lifting nested leaves or reusing destination identities. */
export function mergeDocContents(
  targetValue: VersionedDocContent,
  sourceValue: VersionedDocContent,
  title: string,
  freshId: () => string,
): { document: VersionedDocContent; renamed: Map<string, string> } {
  const target = parseVersionedDocContent(targetValue);
  const source = parseVersionedDocContent(sourceValue);
  const roots = (document: VersionedDocContent): DocContainerNode[] =>
    document.format === 2
      ? document.nodes
      : document.blocks.map((block) => ({ kind: "block", block }));
  const originalLeaves = docContainerBlocks(roots(source));
  const originalAnchors = originalLeaves.map((block) => ({ ...block }));
  const destination = roots(target),
    incoming = roots(source).filter(
      (node) =>
        !(
          node.kind === "block" &&
          node.block.type === "paragraph" &&
          !node.block.id &&
          !node.block.text.trim()
        ),
    );
  const occupied = new Set<string>();
  const remember = (nodes: DocContainerNode[]) =>
    visitDocContainers(nodes, (node) => {
      const id = node.kind === "block" ? node.block.id : node.id;
      if (id) occupied.add(id);
    });
  remember(destination);
  // Reserve source IDs too so generated names cannot collide with a later source node.
  const reserved = new Set(occupied);
  visitDocContainers(incoming, (node) => {
    const id = node.kind === "block" ? node.block.id : node.id;
    if (id) reserved.add(id);
  });
  const renamed = new Map<string, string>();
  const fresh = () => {
    const id = freshId();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || reserved.has(id))
      throw new Error(
        "Generated document identity is invalid or already used.",
      );
    reserved.add(id);
    return id;
  };
  visitDocContainers(incoming, (node) => {
    const original = node.kind === "block" ? node.block.id : node.id;
    if (!original || !occupied.has(original)) return;
    const id = fresh();
    renamed.set(original, id);
    if (node.kind === "block") node.block.id = id;
    else node.id = id;
  });
  const rewriteFragment = (href: string): string => {
    const destination = docLinkDestination(href, null);
    if (destination?.kind !== "fragment") return href;
    const index = docFragmentIndex(originalAnchors, destination.fragment);
    if (index === null) return href;
    const block = originalLeaves[index];
    // Heading slugs and exported h-N anchors change after concatenation. Give
    // their actual source target an explicit identity before moving the link.
    if (!block.id) block.id = fresh();
    return `#${block.id}`;
  };
  // Resolve all targets before replacing blocks so newly assigned identities
  // are retained even when a preceding link points to a later leaf.
  const replacements = new Map<DocBlock, DocBlock>();
  visitDocContainers(incoming, (node) => {
    if (node.kind === "block")
      replacements.set(
        node.block,
        rewriteDocBlockLinks(node.block, rewriteFragment),
      );
  });
  visitDocContainers(incoming, (node) => {
    if (node.kind === "block") {
      const original = node.block;
      node.block = {
        ...replacements.get(original)!,
        ...(original.id ? { id: original.id } : {}),
      };
    }
  });
  const leaves = docContainerBlocks(incoming);
  const bound = mergeDocReferences(docContainerBlocks(destination), leaves);
  let leafIndex = 0;
  visitDocContainers(incoming, (node) => {
    if (node.kind === "block") node.block = bound[leafIndex++];
  });
  const heading: DocBlock | null =
    title.trim() && leaves[0]?.type !== "heading"
      ? { type: "heading", level: 2, id: fresh(), text: title.trim() }
      : null;
  const merged = [
    ...destination,
    ...(heading ? [{ kind: "block" as const, block: heading }] : []),
    ...incoming,
  ];
  const document =
    target.format === 2 || source.format === 2
      ? parseVersionedDocContent({ format: 2, nodes: merged })
      : parseVersionedDocContent({
          format: 1,
          blocks: docContainerBlocks(merged),
        });
  return { document, renamed };
}
