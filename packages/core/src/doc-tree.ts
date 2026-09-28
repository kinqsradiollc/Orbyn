/**
 * Pages inside pages (W5): the library's tree, shared by the web and phone
 * apps so both nest, order and offer moves the same way the server checks
 * them (backend/src/modules/docs/tree.ts).
 */

/** What the tree needs of a page. */
export type TreeDoc = {
  id: string;
  title: string;
  kind: string;
  user_id: string;
  team_id: string | null;
  parent_id?: string | null;
  sort_order?: number | null;
};

/** One page in the tree, with the pages inside it in order. */
export type DocTreeNode<T extends TreeDoc> = {
  doc: T;
  children: DocTreeNode<T>[];
  /** Pages inside it at any depth. */
  count: number;
};

/**
 * Which library a kind of page lives in: Memory and Agent notes keep to
 * their own, so a page only ever nests beside pages of its own library.
 */
export const docLibrary = (kind: string): "memory" | "agent" | "library" =>
  kind === "memory" ? "memory" : kind === "agent" ? "agent" : "library";

/** Ordered pages first (by the order given), then the rest by title. */
export function treeOrder(a: TreeDoc, b: TreeDoc): number {
  const x = a.sort_order ?? null;
  const y = b.sort_order ?? null;
  if (x !== null && y !== null && x !== y) return x - y;
  if (x !== null && y === null) return -1;
  if (x === null && y !== null) return 1;
  return (
    (a.title || "Untitled").localeCompare(b.title || "Untitled") ||
    a.id.localeCompare(b.id)
  );
}

/**
 * The pages as a tree. A page whose parent isn't in the list (in Trash, out
 * of reach, or not loaded) is shown at the top level, so nothing is lost.
 */
export function docTree<T extends TreeDoc>(docs: T[]): DocTreeNode<T>[] {
  const byId = new Map(docs.map((d) => [d.id, d] as const));
  const kids = new Map<string, T[]>();
  const roots: T[] = [];
  for (const d of docs) {
    const parent = d.parent_id ? byId.get(d.parent_id) : undefined;
    if (!parent) roots.push(d);
    else kids.set(parent.id, [...(kids.get(parent.id) ?? []), d]);
  }
  const seen = new Set<string>();
  const grow = (d: T): DocTreeNode<T> => {
    seen.add(d.id);
    const children = (kids.get(d.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .sort(treeOrder)
      .map(grow);
    return {
      doc: d,
      children,
      count: children.reduce((n, c) => n + 1 + c.count, 0),
    };
  };
  const out = roots.sort(treeOrder).map(grow);
  // A loop (never made by the server, but never trusted either): each page
  // on it shows at the top level.
  for (const d of docs) if (!seen.has(d.id)) out.push(grow(d));
  return out;
}

/** One row of the tree as a list shows it: the page, how deep, and state. */
export type DocTreeRow<T extends TreeDoc> = {
  doc: T;
  depth: number;
  /** Pages directly inside it. */
  children: number;
  open: boolean;
};

/** The rows a list shows, with only open pages' children. */
export function treeRows<T extends TreeDoc>(
  nodes: DocTreeNode<T>[],
  isOpen: (id: string) => boolean,
  depth = 0,
): DocTreeRow<T>[] {
  return nodes.flatMap((n) => {
    const open = n.children.length > 0 && isOpen(n.doc.id);
    return [
      { doc: n.doc, depth, children: n.children.length, open },
      ...(open ? treeRows(n.children, isOpen, depth + 1) : []),
    ];
  });
}

/** The ids of every page inside `id`, at any depth. */
export function descendantIds(docs: TreeDoc[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (at: string) => {
    for (const d of docs)
      if (d.parent_id === at && !out.has(d.id) && d.id !== id) {
        out.add(d.id);
        walk(d.id);
      }
  };
  walk(id);
  return out;
}

/**
 * Whether `page` may go inside `parent`, as the server will judge it: the
 * same space (your own pages, or one team's), the same library, and not
 * itself or a page inside it.
 */
export function canNest(docs: TreeDoc[], page: TreeDoc, parent: TreeDoc) {
  if (page.id === parent.id) return false;
  if ((page.team_id ?? null) !== (parent.team_id ?? null)) return false;
  if (!page.team_id && page.user_id !== parent.user_id) return false;
  if (docLibrary(page.kind) !== docLibrary(parent.kind)) return false;
  return !descendantIds(docs, page.id).has(parent.id);
}

/** Pages `page` could be moved inside, by title. */
export function nestTargets<T extends TreeDoc>(docs: T[], page: TreeDoc): T[] {
  return docs
    .filter((d) => canNest(docs, page, d))
    .sort(
      (a, b) =>
        (a.title || "Untitled").localeCompare(b.title || "Untitled") ||
        a.id.localeCompare(b.id),
    );
}

/** The pages above `id`, nearest last ("Course › Week 1"). */
export function treePath<T extends TreeDoc>(docs: T[], id: string): T[] {
  const byId = new Map(docs.map((d) => [d.id, d] as const));
  const out: T[] = [];
  const seen = new Set<string>([id]);
  let at = byId.get(id)?.parent_id;
  while (at && !seen.has(at) && byId.has(at)) {
    seen.add(at);
    out.unshift(byId.get(at)!);
    at = byId.get(at)!.parent_id;
  }
  return out;
}
