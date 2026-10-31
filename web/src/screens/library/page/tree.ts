import {
  carryBlockIds,
  docContainerBlocks,
  newBlockId,
  parseDoc,
  parseDocContainers,
  serializeBlock,
  visitDocContainers,
  type DocBlock,
  type DocContainerNode,
  type DocContentOperation,
  type VersionedDocContent,
} from "@orbyn/core";

export const rootsOf = (document: VersionedDocContent): DocContainerNode[] =>
  document.format === 2
    ? document.nodes
    : document.blocks.map((block) => ({ kind: "block", block }));

export const leavesOf = (document: VersionedDocContent): DocBlock[] =>
  document.format === 2
    ? docContainerBlocks(document.nodes, { projected: true })
    : document.blocks;

export type Leaf = { block: DocBlock; path: number[]; index: number };

export function leafList(document: VersionedDocContent): Leaf[] {
  const out: Leaf[] = [];
  visitDocContainers(rootsOf(document), (node, path) => {
    if (node.kind === "block")
      out.push({ block: node.block, path, index: out.length });
  });
  return out;
}

export const pathKey = (path: readonly number[]) => path.join("/");

export function findLeaf(document: VersionedDocContent, id: string) {
  return leafList(document).find((leaf) => leaf.block.id === id) ?? null;
}

/** The list and item a leaf sits directly in, if any. */
export function listOwner(path: number[], roots: DocContainerNode[]) {
  if (path.length < 3) return null;
  const list = path.slice(0, -2);
  const item = path[path.length - 2];
  const child = path[path.length - 1];
  const node = nodeAt(roots, list);
  return node?.kind === "list" ? { list, item, child, node } : null;
}

export function nodeAt(
  roots: DocContainerNode[],
  path: number[],
): DocContainerNode | null {
  let nodes = roots;
  let at = 0;
  let found: DocContainerNode | null = null;
  while (at < path.length) {
    const node: DocContainerNode | undefined = nodes[path[at++]];
    if (!node) return null;
    found = node;
    if (at === path.length) break;
    if (node.kind === "quote") nodes = node.children;
    else if (node.kind === "list") {
      const item = node.items[path[at++]];
      if (!item) return null;
      nodes = item.children;
    } else return null;
  }
  return found;
}

/** What the line's own editor shows. Lists inside containers show only words. */
export function lineSource(block: DocBlock, number?: number | null): string {
  if (block.type === "code" || block.type === "math") return block.text;
  return serializeBlock(block, number);
}

export const isCodeLike = (block: DocBlock) =>
  block.type === "code" || block.type === "math";
export const isTextLeaf = (block: DocBlock) =>
  block.type !== "divider" &&
  block.type !== "table" &&
  block.type !== "image" &&
  block.type !== "file";

/** Fresh nodes for typed source, keeping the line's identity on the first leaf. */
export function nodesFromSource(
  document: VersionedDocContent,
  block: DocBlock,
  text: string,
): DocContainerNode[] {
  if (document.format === 2) {
    const nodes = parseDocContainers(text, { projected: true });
    if (!nodes.length)
      return [
        {
          kind: "block",
          block: {
            type: "paragraph",
            text: "",
            ...(block.id ? { id: block.id } : {}),
          },
        },
      ];
    let first = true;
    const stamp = (list: DocContainerNode[]) => {
      for (const node of list) {
        if (node.kind === "block") {
          if (first) {
            first = false;
            if (block.id) node.block = { ...node.block, id: block.id };
            else delete node.block.id;
          }
        } else if (node.kind === "quote") stamp(node.children);
        else node.items.forEach((item) => stamp(item.children));
      }
    };
    stamp(nodes);
    return nodes;
  }
  const parsed = parseDoc(text);
  const blocks = parsed.length
    ? parsed
    : [{ type: "paragraph" as const, text: "" }];
  return carryBlockIds(block, blocks).map((one) => ({
    kind: "block",
    block: one,
  }));
}

/** The numbers shown beside a line must not become the line's own start. */
export function keepNumbering(old: DocBlock, next: DocBlock): DocBlock {
  if (old.type !== "numbered" || next.type !== "numbered") return next;
  const { start: _dropped, ...rest } = next;
  return old.start === undefined ? rest : { ...rest, start: old.start };
}

/** While typing, a line stays one leaf; structure settles when the line is left. */
export function liveEdit(
  document: VersionedDocContent,
  block: DocBlock,
  text: string,
): DocBlock {
  if (block.type === "code" || block.type === "math") {
    const { check: _cleared, ...rest } = block as Extract<
      DocBlock,
      { type: "math" }
    >;
    return { ...rest, text } as DocBlock;
  }
  const nodes = nodesFromSource(document, block, text);
  const only = nodes.length === 1 ? nodes[0] : null;
  if (only?.kind === "block") return keepNumbering(block, only.block);
  return {
    type: "paragraph",
    text,
    ...(block.id ? { id: block.id } : {}),
  };
}

export function settledOperation(
  document: VersionedDocContent,
  leaf: Leaf,
  text: string,
): DocContentOperation | null {
  if (isCodeLike(leaf.block)) return null;
  const nodes = nodesFromSource(document, leaf.block, text);
  if (nodes.length === 1 && nodes[0].kind === "block") return null;
  return { kind: "splice-leaf", path: leaf.path, nodes };
}

export const paragraph = (text = ""): DocBlock => ({
  type: "paragraph",
  text,
  id: newBlockId(),
});

/** Typing one of these at the start of an empty line makes a container. */
export function shortcutNode(
  text: string,
  id?: string,
): {
  node: DocContainerNode;
  into: number[];
} | null {
  const leaf = (): DocContainerNode => ({
    kind: "block",
    block: { type: "paragraph", text: "", ...(id ? { id } : {}) },
  });
  if (/^[-*+] $/.test(text))
    return {
      node: {
        kind: "list",
        ordered: false,
        start: 1,
        delimiter: text[0],
        loose: false,
        items: [{ children: [leaf()] }],
      },
      into: [0, 0],
    };
  const numbered = /^(\d{1,9})([.)]) $/.exec(text);
  if (numbered)
    return {
      node: {
        kind: "list",
        ordered: true,
        start: Number(numbered[1]),
        delimiter: numbered[2],
        loose: false,
        items: [{ children: [leaf()] }],
      },
      into: [0, 0],
    };
  if (/^(?:[-*+] )?\[[ xX]?\] $/.test(text))
    return {
      node: {
        kind: "list",
        ordered: false,
        start: 1,
        delimiter: "-",
        loose: false,
        items: [{ checked: /x/i.test(text), children: [leaf()] }],
      },
      into: [0, 0],
    };
  if (text === "> ")
    return { node: { kind: "quote", children: [leaf()] }, into: [0] };
  return null;
}
