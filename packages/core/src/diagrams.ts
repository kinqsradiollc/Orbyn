/**
 * Diagrams in pages (EDT-11): a code block marked `mermaid` is drawn as a
 * diagram. The web app draws every kind with Mermaid itself; the phone has
 * no browser engine to run it in, so flowcharts — what notes use most — are
 * read and laid out here and drawn natively, and other kinds show their
 * source with a note. A node can link to a page or task:
 * `click A "orbyn://doc/<id>"`.
 */
import { parseObjectHref, type ObjectRef } from "./links.js";

export type FlowShape = "box" | "round" | "stadium" | "circle" | "diamond";

export type FlowNode = {
  id: string;
  label: string;
  shape: FlowShape;
  /** A page, task or project the node opens. */
  link?: ObjectRef;
};

export type FlowEdge = {
  from: string;
  to: string;
  label: string;
  /** Drawn dotted (`-.->`) or thick (`==>`). */
  style: "solid" | "dotted" | "thick";
  /** Drawn with an arrow head (`-->`), or as a plain line (`---`). */
  arrow: boolean;
};

export type Flowchart = {
  direction: "TB" | "LR" | "BT" | "RL";
  nodes: FlowNode[];
  edges: FlowEdge[];
};

/** The kind of Mermaid diagram a source is: "flowchart", "sequence", … */
export function diagramKind(source: string): string {
  const first =
    source
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("%%")) ?? "";
  const word = first.split(/\s+/)[0].toLowerCase();
  if (word === "graph" || word === "flowchart") return "flowchart";
  if (word === "sequencediagram") return "sequence";
  if (word === "gantt") return "gantt";
  if (word === "classdiagram") return "class";
  if (word === "statediagram" || word === "statediagram-v2") return "state";
  if (word === "pie") return "pie";
  if (word === "timeline") return "timeline";
  if (word === "mindmap") return "mindmap";
  if (word === "erdiagram") return "er";
  if (word === "journey") return "journey";
  return word || "unknown";
}

const SHAPES: [RegExp, FlowShape][] = [
  [/^\(\((.*)\)\)$/s, "circle"],
  [/^\(\[(.*)\]\)$/s, "stadium"],
  [/^\[(.*)\]$/s, "box"],
  [/^\((.*)\)$/s, "round"],
  [/^\{(.*)\}$/s, "diamond"],
  [/^>(.*)\]$/s, "box"],
];

/** `A[Label]` read as the node's id, label and shape. */
function readNode(
  raw: string,
): { id: string; label?: string; shape?: FlowShape } | null {
  const m = /^([A-Za-z0-9_][\w-]*)\s*(.*)$/s.exec(raw.trim());
  if (!m) return null;
  const rest = m[2].trim();
  if (!rest) return { id: m[1] };
  for (const [re, shape] of SHAPES) {
    const inner = re.exec(rest);
    if (inner) {
      const label = inner[1].trim().replace(/^"(.*)"$/s, "$1");
      return { id: m[1], label, shape };
    }
  }
  return { id: m[1] };
}

/** An edge between two node texts: `-->`, `---`, `-.->`, `==>`, with labels. */
const EDGE =
  /\s*(-->|---|-\.->|-\.-|==>|===)\s*(?:\|([^|]*)\|)?\s*|\s*--\s+([^-]+?)\s+-->\s*|\s*==\s+([^=]+?)\s+==>\s*/;

/**
 * A Mermaid flowchart read into nodes and edges, or null for anything that
 * isn't one. What isn't understood is skipped rather than failing, so a
 * diagram with a styling line still draws.
 */
export function parseFlowchart(source: string): Flowchart | null {
  if (diagramKind(source) !== "flowchart") return null;
  const lines = source
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("%%"));
  const head = lines.shift() ?? "";
  const dir = /\b(TB|TD|LR|BT|RL)\b/i.exec(head)?.[1].toUpperCase() ?? "TB";
  const direction = (dir === "TD" ? "TB" : dir) as Flowchart["direction"];
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const touch = (raw: string): string | null => {
    const n = readNode(raw);
    if (!n) return null;
    const was = nodes.get(n.id);
    nodes.set(n.id, {
      id: n.id,
      label: n.label ?? was?.label ?? n.id,
      shape: n.shape ?? was?.shape ?? "box",
      ...(was?.link ? { link: was.link } : {}),
    });
    return n.id;
  };
  for (const line of lines.slice(0, 400)) {
    if (/^(style|classDef|class|linkStyle|subgraph|end|direction)\b/.test(line))
      continue;
    const click = /^click\s+([\w-]+)\s+(?:href\s+)?"([^"]+)"/.exec(line);
    if (click) {
      const link = parseObjectHref(click[2]);
      const node = nodes.get(click[1]);
      if (link && node) node.link = link;
      continue;
    }
    // A chain: A --> B -- label --> C.
    const parts: string[] = [];
    const joins: { label: string; style: FlowEdge["style"]; arrow: boolean }[] =
      [];
    let rest = line;
    for (;;) {
      const m = EDGE.exec(rest);
      if (!m || m.index === undefined) break;
      parts.push(rest.slice(0, m.index));
      const op = m[1] ?? (m[3] !== undefined ? "-->" : "==>");
      joins.push({
        label: (m[2] ?? m[3] ?? m[4] ?? "").trim(),
        style: op.startsWith("-.")
          ? "dotted"
          : op.startsWith("==")
            ? "thick"
            : "solid",
        arrow: op.endsWith(">"),
      });
      rest = rest.slice(m.index + m[0].length);
    }
    parts.push(rest);
    // Several nodes at once: A & B --> C.
    const ids = parts.map((p) =>
      p
        .split("&")
        .map((x) => touch(x))
        .filter((x): x is string => !!x),
    );
    joins.forEach((j, n) => {
      for (const from of ids[n])
        for (const to of ids[n + 1] ?? [])
          if (edges.length < 600) edges.push({ from, to, ...j });
    });
  }
  if (!nodes.size) return null;
  return { direction, nodes: [...nodes.values()].slice(0, 200), edges };
}

export type PlacedNode = FlowNode & {
  x: number;
  y: number;
  w: number;
  h: number;
};
export type PlacedEdge = FlowEdge & { points: [number, number][] };
export type FlowLayout = {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
};

/** Room around and between nodes, in points. */
const GAP = { rank: 56, node: 28, margin: 12 };

/**
 * Nodes placed in ranks (a node sits one rank past everything that points
 * at it, cycles broken where they close), in the order they were first
 * written within a rank, with edges as straight lines between node edges.
 * Sizes are in points and assume a 13pt font.
 */
export function layoutFlowchart(chart: Flowchart): FlowLayout {
  const ids = chart.nodes.map((n) => n.id);
  // Edges that close a cycle are left out of the ranking (found by walking
  // from each node in the order written), so a loop back doesn't push
  // everything down.
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of chart.edges) if (e.from !== e.to) out.get(e.from)?.push(e.to);
  const state = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const walk = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id) ?? []) {
      if (state.get(to) === 1) back.add(`${id}>${to}`);
      else if (!state.has(to)) walk(to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.has(id)) walk(id);
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  // Longest path from the sources, over what's left (a DAG).
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const e of chart.edges) {
      if (e.from === e.to || back.has(`${e.from}>${e.to}`)) continue;
      const next = (rank.get(e.from) ?? 0) + 1;
      if (next > (rank.get(e.to) ?? 0)) {
        rank.set(e.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const horizontal = chart.direction === "LR" || chart.direction === "RL";
  const size = (n: FlowNode) => {
    const longest = Math.max(
      ...n.label.split(/<br\s*\/?>|\n/).map((l) => l.length),
      1,
    );
    const lines = n.label.split(/<br\s*\/?>|\n/).length;
    const w = Math.min(
      220,
      Math.max(n.shape === "circle" ? 56 : 72, longest * 7.2 + 28),
    );
    const h = Math.max(n.shape === "diamond" ? 56 : 38, lines * 17 + 18);
    return n.shape === "circle"
      ? { w: Math.max(w, h), h: Math.max(w, h) }
      : { w, h };
  };
  const byRank: FlowNode[][] = [];
  for (const n of chart.nodes) {
    const r = rank.get(n.id) ?? 0;
    (byRank[r] ??= []).push(n);
  }
  // No empty ranks between the ones used.
  const ranks = byRank.filter((row) => row?.length);
  const sized = new Map(chart.nodes.map((n) => [n.id, size(n)]));
  // Each rank's depth (across the flow) and each node's place along it.
  const rankDepth = ranks.map((row) =>
    Math.max(
      0,
      ...(row ?? []).map((n) =>
        horizontal ? sized.get(n.id)!.w : sized.get(n.id)!.h,
      ),
    ),
  );
  const rankSpan = ranks.map((row) =>
    (row ?? []).reduce(
      (sum, n, i) =>
        sum +
        (horizontal ? sized.get(n.id)!.h : sized.get(n.id)!.w) +
        (i ? GAP.node : 0),
      0,
    ),
  );
  const span = Math.max(0, ...rankSpan);
  const placed: PlacedNode[] = [];
  let depthAt = GAP.margin;
  ranks.forEach((row, r) => {
    let along = GAP.margin + (span - rankSpan[r]) / 2;
    for (const n of row ?? []) {
      const s = sized.get(n.id)!;
      const acrossSize = horizontal ? s.w : s.h;
      const offset = (rankDepth[r] - acrossSize) / 2;
      placed.push({
        ...n,
        w: s.w,
        h: s.h,
        x: horizontal ? depthAt + offset : along,
        y: horizontal ? along : depthAt + offset,
      });
      along += (horizontal ? s.h : s.w) + GAP.node;
    }
    depthAt += rankDepth[r] + GAP.rank;
  });
  let width = horizontal
    ? depthAt - GAP.rank + GAP.margin
    : span + GAP.margin * 2;
  let height = horizontal
    ? span + GAP.margin * 2
    : depthAt - GAP.rank + GAP.margin;
  width = Math.max(width, 40);
  height = Math.max(height, 40);
  // Bottom-to-top and right-to-left are the same drawing mirrored.
  if (chart.direction === "BT")
    for (const n of placed) n.y = height - n.y - n.h;
  if (chart.direction === "RL") for (const n of placed) n.x = width - n.x - n.w;
  const at = new Map(placed.map((n) => [n.id, n]));
  /** Where the line from a node's centre towards (tx, ty) leaves its box. */
  const exit = (n: PlacedNode, tx: number, ty: number): [number, number] => {
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const sx = dx ? n.w / 2 / Math.abs(dx) : Infinity;
    const sy = dy ? n.h / 2 / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return [cx + dx * s, cy + dy * s];
  };
  const edges: PlacedEdge[] = chart.edges.flatMap((e) => {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b || a === b) return [];
    const bc: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
    const ac: [number, number] = [a.x + a.w / 2, a.y + a.h / 2];
    return [{ ...e, points: [exit(a, bc[0], bc[1]), exit(b, ac[0], ac[1])] }];
  });
  return { width, height, nodes: placed, edges };
}
