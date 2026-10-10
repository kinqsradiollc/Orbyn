import { mergeDocs, type DocBlock } from "./docs.js";
import { docContainerBlocks, type DocContainerNode } from "./doc-containers.js";
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
 * merge under unchanged containers. Overlapping or concurrent ownership changes
 * refuse, retaining both revisions instead of inventing a parent for copied text.
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
          ...item,
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
  const walk = (nodes: readonly DocContainerNode[]): DocContainerNode[] =>
    nodes.map((node) => {
      if (node.kind === "quote")
        return { ...node, children: walk(node.children) };
      if (node.kind === "list")
        return {
          ...node,
          items: node.items.map((item) => ({
            ...item,
            children: walk(item.children),
          })),
        };
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
    { format: 2, nodes: walk(base.nodes) },
    { projected: true },
  );
}
