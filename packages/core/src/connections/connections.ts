/**
 * The Connections map (CNV-02): a page's or a project's neighbours, one or
 * two steps out, drawn in its Info panel. Not a whole-workspace graph: only
 * what is linked to the thing open, from the link index (links, checklist
 * lines that became tasks, waits-on, a page's project and meeting) plus a
 * project's own pages and tasks.
 *
 * The API decides what is on the map (only what the reader can open, with
 * live titles); this file lays it out the same way on the web and phones:
 * the centre in the middle, the first ring around it, the second ring
 * further out beside the node that led to it.
 */
import { z } from "zod";

export const CONNECTION_KINDS = [
  "doc",
  "task",
  "event",
  "project",
  "person",
  "date",
] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export type ConnectionNode = {
  /** `${kind}:${id}`, unique on one map. */
  key: string;
  kind: ConnectionKind;
  id: string;
  title: string;
  /** 0 the centre, 1 or 2 steps out. */
  depth: 0 | 1 | 2;
  /** A finished task, or a project that's done or archived. */
  closed?: boolean;
};

export type ConnectionEdge = {
  from: string;
  to: string;
  /** Why they're joined, in plain words: "Links to", "Waits on"… */
  label: string;
};

export type ConnectionMap = {
  nodes: ConnectionNode[];
  edges: ConnectionEdge[];
  /** More neighbours than a map draws (MAP_LIMIT). */
  truncated: boolean;
};

/** GET /links/map. */
export const connectionMapQuery = z
  .object({
    kind: z.enum(["doc", "project"]),
    id: z.uuid(),
    depth: z.coerce.number().int().min(1).max(2).default(1),
  })
  .strict();
export type ConnectionMapQuery = z.infer<typeof connectionMapQuery>;

/** How many things a map draws, so it stays readable on a phone. */
export const MAP_LIMIT = 36;
/** How many a first-ring node may bring in from the second ring. */
export const MAP_BRANCH = 5;

/** Plain words for why two things are joined. */
export const CONNECTION_LABELS: Record<string, string> = {
  link: "Links to",
  mention: "Mentions",
  task_line: "Has the task",
  dependency: "Waits on",
  project: "In the project",
  meeting: "Notes for",
  task: "Task in the project",
};

export type PlacedConnection = ConnectionNode & { x: number; y: number };

/**
 * Where each node sits on a square of `size`: the centre in the middle, the
 * first ring evenly around it, and each second-ring node near the first-ring
 * node it came through (a small fan outwards). Deterministic, so the map
 * doesn't jump when it's drawn again.
 */
export function layoutConnections(
  map: Pick<ConnectionMap, "nodes" | "edges">,
  size: number,
): PlacedConnection[] {
  const c = size / 2;
  const centre = map.nodes.find((n) => n.depth === 0);
  const first = map.nodes.filter((n) => n.depth === 1);
  const second = map.nodes.filter((n) => n.depth === 2);
  const hasSecond = second.length > 0;
  const r1 = size * (hasSecond ? 0.26 : 0.36);
  const r2 = size * 0.44;
  const placed = new Map<string, PlacedConnection>();
  if (centre) placed.set(centre.key, { ...centre, x: c, y: c });
  const angleOf = new Map<string, number>();
  first.forEach((n, i) => {
    // Start at the top and go round clockwise.
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(first.length, 1);
    angleOf.set(n.key, a);
    placed.set(n.key, {
      ...n,
      x: c + r1 * Math.cos(a),
      y: c + r1 * Math.sin(a),
    });
  });
  // Each second-ring node hangs off the first-ring node that brought it in.
  const parentOf = (key: string) => {
    for (const e of map.edges) {
      if (e.to === key && angleOf.has(e.from)) return e.from;
      if (e.from === key && angleOf.has(e.to)) return e.to;
    }
    return null;
  };
  const children = new Map<string, ConnectionNode[]>();
  const orphans: ConnectionNode[] = [];
  for (const n of second) {
    const p = parentOf(n.key);
    if (p) children.set(p, [...(children.get(p) ?? []), n]);
    else orphans.push(n);
  }
  const slice = (2 * Math.PI) / Math.max(first.length, 1);
  for (const [parent, kids] of children) {
    const base = angleOf.get(parent)!;
    const spread = Math.min(slice * 0.8, 0.9);
    kids.forEach((n, i) => {
      const a =
        kids.length === 1
          ? base
          : base - spread / 2 + (spread * i) / (kids.length - 1);
      placed.set(n.key, {
        ...n,
        x: c + r2 * Math.cos(a),
        y: c + r2 * Math.sin(a),
      });
    });
  }
  orphans.forEach((n, i) => {
    const a = Math.PI / 2 + (2 * Math.PI * i) / Math.max(orphans.length, 1);
    placed.set(n.key, {
      ...n,
      x: c + r2 * Math.cos(a),
      y: c + r2 * Math.sin(a),
    });
  });
  return map.nodes.map((n) => placed.get(n.key)!).filter(Boolean);
}

/** A title short enough for a node's label on the map. */
export const nodeLabel = (title: string, max = 22): string => {
  const t = title.trim() || "Untitled";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
