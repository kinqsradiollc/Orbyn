import { parseDoc } from "./docs.js";
import {
  parseDocContainers,
  visitDocContainers,
  type DocContainerNode,
} from "./doc-containers.js";
import {
  DocContentFormatError,
  parseVersionedDocContent,
  parseVersionedDocSource,
  versionedDocContentKey,
  versionedDocSource,
  type VersionedDocContent,
} from "./doc-content-format.js";
import type { DocContentValidationOptions } from "./doc-content-leaves.js";

export type VersionedDocSourceRange = {
  path: number[];
  kind: DocContainerNode["kind"];
  id?: string;
  blockIndex?: number;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
};
export type VersionedDocSourceMap = {
  source: string;
  ranges: VersionedDocSourceRange[];
};

/** Map exact full ownership to source; mismatched source never maps onto another preview. */
export function versionedDocSourceMap(
  value: unknown,
  rawSource?: string,
  options: DocContentValidationOptions = {},
): VersionedDocSourceMap {
  const content = parseVersionedDocContent(value, options);
  const source = rawSource ?? versionedDocSource(content, options);
  const parsed = parseVersionedDocSource(source, content.format, options);
  if (
    versionedDocContentKey(parsed, options) !==
    versionedDocContentKey(content, options)
  )
    throw new DocContentFormatError("Source and preview content do not match.");
  const starts = [0];
  for (const match of source.matchAll(/\r\n?|\n/g))
    starts.push(match.index! + match[0].length);
  const lines = source.split(/\r\n?|\n/);
  const range = (
    path: number[],
    kind: VersionedDocSourceRange["kind"],
    startLine: number,
    endLine: number,
    id?: string,
    blockIndex?: number,
  ): VersionedDocSourceRange => ({
    path: [...path],
    kind,
    ...(id === undefined ? {} : { id }),
    ...(blockIndex === undefined ? {} : { blockIndex }),
    startLine,
    endLine,
    start: starts[startLine - 1] ?? source.length,
    end:
      (starts[endLine - 1] ?? source.length) +
      (lines[endLine - 1]?.length ?? 0),
  });
  const ranges: VersionedDocSourceRange[] = [];
  if (content.format === 1) {
    parseDoc(source, {
      anchors: true,
      onSourceRange: (index, start, end) =>
        ranges.push(
          range([index], "block", start, end, content.blocks[index]?.id, index),
        ),
    });
  } else {
    const positions = new Map<
      string,
      {
        kind: VersionedDocSourceRange["kind"];
        id?: string;
        blockIndex?: number;
      }
    >();
    let index = 0;
    visitDocContainers(content.nodes, (node, path) =>
      positions.set(path.join("/"), {
        kind: node.kind,
        id: node.kind === "block" ? node.block.id : node.id,
        ...(node.kind === "block" ? { blockIndex: index++ } : {}),
      }),
    );
    parseDocContainers(source, {
      ...options,
      anchors: true,
      onSourceRange: (path, start, end) => {
        const node = positions.get(path.join("/"));
        if (!node) throw new DocContentFormatError("Source ownership changed.");
        ranges.push(
          range(path, node.kind, start, end, node.id, node.blockIndex),
        );
      },
    });
  }
  return { source, ranges };
}

/** A caret selects the deepest enclosing owner; separators outside containers select the preceding leaf. */
export function versionedDocSourceAt(
  map: VersionedDocSourceMap,
  offset: number,
): VersionedDocSourceRange | null {
  const at = Number.isFinite(offset)
    ? Math.max(0, Math.min(map.source.length, offset))
    : 0;
  const containing = map.ranges
    .filter((range) => at >= range.start && at <= range.end)
    .sort(
      (a, b) =>
        b.path.length - a.path.length || a.end - a.start - (b.end - b.start),
    );
  if (containing.length) return containing[0];
  const leaves = map.ranges.filter((range) => range.kind === "block");
  return (
    leaves.filter((range) => range.start <= at).at(-1) ?? leaves[0] ?? null
  );
}

/** Apply source against the exact accepted owner, never a later reconciled document. */
export function applyVersionedDocSource(
  current: unknown,
  expected: unknown,
  source: string,
  options: DocContentValidationOptions = {},
): VersionedDocContent {
  if (
    versionedDocContentKey(current, options) !==
    versionedDocContentKey(expected, options)
  )
    throw new DocContentFormatError(
      "The document changed while source was being edited.",
    );
  const owner = parseVersionedDocContent(current, options);
  return parseVersionedDocSource(source, owner.format, options);
}

/** Replace one stable leaf while retaining every container/item and refusing ambiguous identity. */
export function replaceVersionedDocLeaf(
  value: unknown,
  id: string,
  replacement: import("./docs.js").DocBlock,
  options: DocContentValidationOptions = {},
): VersionedDocContent {
  const current = parseVersionedDocContent(value, options);
  if (!id || replacement.id !== id)
    throw new DocContentFormatError(
      "Leaf identity cannot change during an edit.",
    );
  let matches = 0;
  const update = (block: import("./docs.js").DocBlock) => {
    if (block.id !== id) return block;
    matches++;
    return replacement;
  };
  const walk = (nodes: readonly DocContainerNode[]): DocContainerNode[] =>
    nodes.map((node) => {
      if (node.kind === "block") return { ...node, block: update(node.block) };
      if (node.kind === "quote")
        return { ...node, children: walk(node.children) };
      return {
        ...node,
        items: node.items.map((item) => ({
          ...item,
          children: walk(item.children),
        })),
      };
    });
  const next =
    current.format === 1
      ? { format: 1, blocks: current.blocks.map(update) }
      : { format: 2, nodes: walk(current.nodes) };
  if (matches !== 1)
    throw new DocContentFormatError("Leaf identity is missing or ambiguous.");
  return parseVersionedDocContent(next, options);
}
