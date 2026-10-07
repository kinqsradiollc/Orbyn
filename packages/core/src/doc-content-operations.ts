import type { DocBlock } from "./docs.js";
import {
  DOC_CONTAINER_LIMITS,
  visitDocContainers,
  type DocContainerNode,
} from "./doc-containers.js";
import {
  DocContentFormatError,
  parseVersionedDocContent,
  versionedDocContentKey,
  type VersionedDocContent,
} from "./doc-content-format.js";
import type { DocContentValidationOptions } from "./doc-content-leaves.js";

/** Child-owner paths use the same node/item indexes as visitDocContainers. */
export type DocContentOperation =
  | { kind: "insert"; owner: number[]; index: number; node: DocContainerNode }
  | { kind: "replace-leaf"; path: number[]; block: DocBlock }
  | { kind: "splice-leaf"; path: number[]; nodes: DocContainerNode[] }
  | { kind: "remove"; path: number[] }
  | { kind: "move"; path: number[]; owner: number[]; index: number }
  | { kind: "split-item"; list: number[]; item: number; at: number }
  | { kind: "check-item"; list: number[]; item: number; checked: boolean };

function refuse(message: string): never {
  throw new DocContentFormatError(message);
}
function path(value: number[]): void {
  if (
    !Array.isArray(value) ||
    value.length > DOC_CONTAINER_LIMITS.depth * 2 + 1 ||
    value.some((index) => !Number.isSafeInteger(index) || index < 0)
  )
    refuse("Invalid document ownership path.");
}
function index(value: number, length: number, end = false): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= length + (end ? 1 : 0)
  )
    refuse("Document position is out of bounds.");
}

/**
 * Apply one explicit structural edit against the exact accepted document.
 * Move indexes refer to the destination after removal. No flat-array ownership
 * inference, identity generation, empty-owner pruning or source reparse occurs.
 */
export function applyDocContentOperation(
  value: unknown,
  expected: unknown,
  operation: DocContentOperation,
  options: DocContentValidationOptions = {},
): VersionedDocContent {
  if (
    versionedDocContentKey(value, options) !==
    versionedDocContentKey(expected, options)
  )
    refuse(
      "The document changed while the structural edit was being prepared.",
    );
  const content = parseVersionedDocContent(value, options);
  // A detached, validated tree keeps failed edits from mutating the caller.
  const roots: DocContainerNode[] =
    content.format === 2
      ? content.nodes
      : content.blocks.map((block) => ({ kind: "block", block }));
  const children = (owner: number[]): DocContainerNode[] => {
    path(owner);
    let nodes = roots;
    let at = 0;
    while (at < owner.length) {
      const position = owner[at++];
      index(position, nodes.length);
      const node = nodes[position];
      if (node.kind === "quote") nodes = node.children;
      else if (node.kind === "list") {
        if (at === owner.length) refuse("A list child owner requires an item.");
        const item = owner[at++];
        index(item, node.items.length);
        nodes = node.items[item].children;
      } else refuse("A document leaf cannot own children.");
    }
    return nodes;
  };
  const located = (where: number[]) => {
    path(where);
    if (!where.length) refuse("The document root is not a node.");
    const nodes = children(where.slice(0, -1));
    const at = where.at(-1)!;
    index(at, nodes.length);
    return { nodes, at, node: nodes[at] };
  };
  if (operation.kind === "insert") {
    const nodes = children(operation.owner);
    index(operation.index, nodes.length, true);
    nodes.splice(operation.index, 0, operation.node);
  } else if (
    operation.kind === "replace-leaf" ||
    operation.kind === "splice-leaf"
  ) {
    const target = located(operation.path);
    if (target.node.kind !== "block")
      refuse("A leaf edit cannot replace its owning container.");
    const replacement: DocContainerNode[] =
      operation.kind === "replace-leaf"
        ? [{ kind: "block", block: operation.block }]
        : operation.nodes;
    let first: DocBlock | undefined;
    visitDocContainers(replacement, (node) => {
      if (node.kind === "block" && !first) first = node.block;
    });
    if (!first)
      refuse("Deleting a leaf requires an explicit remove operation.");
    if (target.node.block.id && first.id !== target.node.block.id)
      refuse("The first edited leaf must retain its existing identity.");
    // Parsed multiline input replaces this exact leaf within its existing
    // child owner; unrelated wrappers, list markers and task states survive.
    target.nodes.splice(target.at, 1, ...replacement);
  } else if (operation.kind === "remove") {
    const target = located(operation.path);
    target.nodes.splice(target.at, 1);
  } else if (operation.kind === "move") {
    const target = located(operation.path);
    // Resolve both owners before removal shifts any path indexes.
    const destination = children(operation.owner);
    if (
      operation.owner.length >= operation.path.length &&
      operation.path.every((part, i) => operation.owner[i] === part)
    )
      refuse("A container cannot be moved into its descendants.");
    const length = destination.length - (destination === target.nodes ? 1 : 0);
    index(operation.index, length, true);
    target.nodes.splice(target.at, 1);
    destination.splice(operation.index, 0, target.node);
  } else if (
    operation.kind === "split-item" ||
    operation.kind === "check-item"
  ) {
    const { node } = located(operation.list);
    if (node.kind !== "list") refuse("The selected owner is not a list.");
    index(operation.item, node.items.length);
    const item = node.items[operation.item];
    if (operation.kind === "check-item") {
      if (
        typeof item.checked !== "boolean" ||
        typeof operation.checked !== "boolean"
      )
        refuse("The selected item is not a task.");
      item.checked = operation.checked;
    } else {
      index(operation.at, item.children.length, true);
      const tail = item.children.splice(operation.at);
      node.items.splice(operation.item + 1, 0, {
        ...(item.checked === undefined ? {} : { checked: false }),
        children: tail,
      });
    }
  } else refuse("Unsupported document operation.");
  if (content.format === 1) {
    if (roots.some((node) => node.kind !== "block"))
      refuse("Nested content requires an explicit format upgrade.");
    return parseVersionedDocContent(
      {
        format: 1,
        blocks: roots.map(
          (node) => (node as { kind: "block"; block: DocBlock }).block,
        ),
      },
      options,
    );
  }
  return parseVersionedDocContent({ format: 2, nodes: roots }, options);
}
