import { mergeDocs, type DocBlock } from "./docs.js";
import {
  docContainerBlocks,
  visitDocContainers,
  type DocContainerNode,
} from "./doc-containers.js";
import {
  parseVersionedDocContent,
  versionedDocContentKey,
  type VersionedDocContent,
} from "./doc-content-format.js";

/** A complete local draft must stay available for review when ownership cannot be merged. */
export class DocContentMergeConflict extends Error {
  readonly status = 409;
  readonly statusCode = 409;
}
const conflict = (): never => {
  throw new DocContentMergeConflict(
    "This page changed in both copies. Your edit must be reviewed before it is sent.",
  );
};
const key = (document: VersionedDocContent) =>
  versionedDocContentKey(document, { projected: true });
const blockKey = (block: DocBlock) => key({ format: 1, blocks: [block] });

/**
 * Merge complete ownership, not a flattened projection. Disjoint named leaf edits
 * and checklist ticks merge under unchanged containers. Overlapping or concurrent
 * ownership changes refuse, retaining both revisions instead of inventing parents.
 */
export function mergeVersionedDocContent(
  baseValue: unknown,
  mineValue: unknown,
  remoteValue: unknown,
): VersionedDocContent {
  const base = parseVersionedDocContent(baseValue, { projected: true });
  const mine = parseVersionedDocContent(mineValue, { projected: true });
  const remote = parseVersionedDocContent(remoteValue, { projected: true });
  const original = key(base),
    local = key(mine),
    saved = key(remote);
  if (local === saved || local === original) return remote;
  if (saved === original) return mine;
  if (base.format === 1 && mine.format === 1 && remote.format === 1) {
    return parseVersionedDocContent(
      {
        format: 1,
        blocks: mergeDocs(base.blocks, mine.blocks, remote.blocks).blocks,
      },
      { projected: true },
    );
  }
  if (base.format !== 2 || mine.format !== 2 || remote.format !== 2)
    return conflict();
  const shape = (nodes: readonly DocContainerNode[]): unknown =>
    nodes.map((node) => {
      if (node.kind === "block") {
        if (!node.block.id) return conflict();
        return { kind: "block", id: node.block.id };
      }
      if (node.kind === "quote")
        return { ...node, children: shape(node.children) };
      return {
        ...node,
        items: node.items.map((item) => ({
          // A checkbox value is editable state; adding/removing the checkbox
          // changes the item's kind and still requires conflict review.
          task: item.checked !== undefined,
          // Empty items have no stable leaf identity to distinguish a reorder.
          // Keep their tick in the shape rather than guess which item moved.
          ...(docContainerBlocks(item.children, { projected: true }).length ===
          0
            ? { emptyChecked: item.checked }
            : {}),
          children: shape(item.children),
        })),
      };
    });
  const topology = JSON.stringify(shape(base.nodes));
  if (
    JSON.stringify(shape(mine.nodes)) !== topology ||
    JSON.stringify(shape(remote.nodes)) !== topology
  )
    return conflict();
  const blocks = (document: VersionedDocContent & { format: 2 }) =>
    new Map(
      docContainerBlocks(document.nodes, { projected: true }).map((block) => [
        block.id!,
        block,
      ]),
    );
  const before = blocks(base),
    own = blocks(mine),
    theirs = blocks(remote);
  const walk = (
    nodes: readonly DocContainerNode[],
    localNodes: readonly DocContainerNode[],
    remoteNodes: readonly DocContainerNode[],
  ): DocContainerNode[] =>
    nodes.map((node, index) => {
      const localNode = localNodes[index],
        remoteNode = remoteNodes[index];
      if (node.kind === "quote") {
        if (localNode.kind !== "quote" || remoteNode.kind !== "quote")
          return conflict();
        return {
          ...node,
          children: walk(
            node.children,
            localNode.children,
            remoteNode.children,
          ),
        };
      }
      if (node.kind === "list") {
        if (localNode.kind !== "list" || remoteNode.kind !== "list")
          return conflict();
        return {
          ...node,
          items: node.items.map((item, itemIndex) => {
            const ownItem = localNode.items[itemIndex],
              remoteItem = remoteNode.items[itemIndex];
            return {
              ...item,
              ...(item.checked === undefined
                ? {}
                : {
                    checked:
                      ownItem.checked === item.checked
                        ? remoteItem.checked
                        : ownItem.checked,
                  }),
              children: walk(
                item.children,
                ownItem.children,
                remoteItem.children,
              ),
            };
          }),
        };
      }
      const id = node.block.id!,
        first = before.get(id)!,
        left = own.get(id)!,
        right = theirs.get(id)!;
      const initial = blockKey(first),
        a = blockKey(left),
        b = blockKey(right);
      if (a !== initial && b !== initial && a !== b) return conflict();
      return { kind: "block", block: a === initial ? right : left };
    });
  return parseVersionedDocContent(
    { format: 2, nodes: walk(base.nodes, mine.nodes, remote.nodes) },
    { projected: true },
  );
}

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
  const destination = roots(target),
    incoming = roots(source).filter(
      (node) =>
        !(
          node.kind === "block" &&
          node.block.type === "paragraph" &&
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
  const leaves = docContainerBlocks(incoming);
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
