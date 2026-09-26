import {
  CONNECTION_LABELS,
  dateTitle,
  fail,
  MAP_BRANCH,
  MAP_LIMIT,
  type ConnectionEdge,
  type ConnectionKind,
  type ConnectionMap,
  type ConnectionMapQuery,
  type ConnectionNode,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";
import { visibleItems, visibleProjects } from "../../lib/visibility.js";

/**
 * The Connections map (CNV-02): a page's or project's neighbours, one or two
 * steps out, from the link index (object_links) and a project's own tasks.
 *
 * The same rule as "Linked here": a thing is on the map only when the
 * reader may open it, and one they can't is left out without a trace (not
 * drawn, not counted, no title). People are shown only when the reader
 * shares a team with them. People and dates are ends: the map doesn't go
 * on through them, or one busy person would pull in half the workspace.
 */

type Ref = { kind: ConnectionKind; id: string };
type Link = { from: Ref; to: Ref; link_kind: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyOf = (r: Ref) =>
  `${r.kind === "event" ? "task" : r.kind}:${r.id.toLowerCase()}`;

/** The links touching these pages, tasks and projects, either way round. */
async function linksOf(db: Queryable, refs: Ref[]): Promise<Link[]> {
  const ids = (kind: string) =>
    refs
      .filter((r) => (r.kind === "event" ? "task" : r.kind) === kind)
      .map((r) => r.id)
      .filter((id) => UUID.test(id));
  const docIds = ids("doc");
  const taskIds = ids("task");
  const projectIds = ids("project");
  const rows = (
    await db.query<{
      source_kind: "doc" | "task";
      source_id: string;
      target_kind: ConnectionKind;
      target_id: string;
      link_kind: string;
    }>(
      `SELECT DISTINCT source_kind, source_id::text AS source_id, target_kind,
              target_id, link_kind
         FROM object_links
        WHERE (source_kind = 'doc' AND source_id = ANY($1::uuid[]))
           OR (source_kind = 'task' AND source_id = ANY($2::uuid[]))
           OR (target_kind = 'doc' AND target_id = ANY($3::text[]))
           OR (target_kind = 'task' AND target_id = ANY($4::text[]))
           OR (target_kind = 'project' AND target_id = ANY($5::text[]))
        LIMIT 2000`,
      [docIds, taskIds, docIds, taskIds, projectIds],
    )
  ).rows;
  const links: Link[] = rows.map((r) => ({
    from: { kind: r.source_kind, id: r.source_id },
    to: { kind: r.target_kind, id: r.target_id },
    link_kind: r.link_kind,
  }));
  // A project's own tasks are its neighbours too.
  if (projectIds.length) {
    const tasks = (
      await db.query<{ id: string; project_id: string }>(
        `SELECT i.id::text, i.project_id::text FROM items i
          WHERE i.project_id = ANY($1::uuid[])
          ORDER BY (i.status IN ('done', 'cancelled')), i.updated_at DESC
          LIMIT 200`,
        [projectIds],
      )
    ).rows;
    for (const t of tasks)
      links.push({
        from: { kind: "project", id: t.project_id },
        to: { kind: "task", id: t.id },
        link_kind: "task",
      });
  }
  return links;
}

/** Titles for the things the reader may open; the rest are left out. */
async function titles(
  db: Queryable,
  userId: string,
  refs: Ref[],
): Promise<Map<string, ConnectionNode>> {
  const out = new Map<string, ConnectionNode>();
  const ids = (kind: string) => [
    ...new Set(
      refs
        .filter((r) => (r.kind === "event" ? "task" : r.kind) === kind)
        .map((r) => r.id.toLowerCase())
        .filter((id) => UUID.test(id)),
    ),
  ];
  const [docs, tasks, projects, people] = await Promise.all([
    db.query<{ id: string; title: string }>(
      `SELECT d.id::text, d.title FROM docs d
        WHERE d.id = ANY($2::uuid[]) AND ${docVisibleTo("$1")}`,
      [userId, ids("doc")],
    ),
    db.query<{ id: string; title: string; kind: string; closed: boolean }>(
      `SELECT i.id::text, i.title, i.kind,
              i.status IN ('done', 'cancelled') AS closed
         FROM items i
        WHERE i.id = ANY($2::uuid[])
          AND ${visibleItems("i")}`,
      [userId, ids("task")],
    ),
    db.query<{ id: string; name: string; closed: boolean }>(
      `SELECT p.id::text, p.name, p.status IN ('done', 'archived') AS closed
         FROM projects p
        WHERE p.id = ANY($2::uuid[]) AND ${visibleProjects("p")}`,
      [userId, ids("project")],
    ),
    db.query<{ id: string; name: string }>(
      `SELECT u.id::text, u.name FROM users u
        WHERE u.id = ANY($2::uuid[])
          AND (u.id = $1 OR EXISTS (
            SELECT 1 FROM team_members a JOIN team_members b ON b.team_id = a.team_id
             WHERE a.user_id = $1 AND b.user_id = u.id))`,
      [userId, ids("person")],
    ),
  ]);
  const put = (n: Omit<ConnectionNode, "key" | "depth">) =>
    out.set(keyOf(n), { ...n, key: keyOf(n), depth: 1 });
  for (const d of docs.rows)
    put({ kind: "doc", id: d.id, title: d.title || "Untitled" });
  for (const t of tasks.rows)
    put({
      kind: t.kind === "event" ? "event" : "task",
      id: t.id,
      title: t.title || "Untitled",
      closed: t.closed,
    });
  for (const p of projects.rows)
    put({ kind: "project", id: p.id, title: p.name, closed: p.closed });
  for (const p of people.rows) put({ kind: "person", id: p.id, title: p.name });
  for (const r of refs)
    if (r.kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(r.id))
      put({ kind: "date", id: r.id, title: dateTitle(r.id) });
  return out;
}

/** The map around one page or project, for its Info panel. */
export async function connectionMap(
  db: Queryable,
  userId: string,
  q: ConnectionMapQuery,
): Promise<ConnectionMap> {
  const centreRef: Ref = { kind: q.kind, id: q.id.toLowerCase() };
  const known = await titles(db, userId, [centreRef]);
  const centre = known.get(keyOf(centreRef));
  if (!centre) fail(404, "Not found");
  const nodes = new Map<string, ConnectionNode>([
    [centre.key, { ...centre, depth: 0 }],
  ]);
  const edges = new Map<string, ConnectionEdge>();
  let truncated = false;

  /** Neighbours of `ring`, added at `depth`; at most `branch` per node. */
  const grow = async (ring: Ref[], depth: 1 | 2, branch: number) => {
    const links = await linksOf(db, ring);
    const ringKeys = new Set(ring.map(keyOf));
    // Each link from a ring node to something new, in the index's order.
    const found: { from: string; other: Ref; label: string }[] = [];
    for (const l of links) {
      const fromKey = keyOf(l.from);
      const toKey = keyOf(l.to);
      const label = CONNECTION_LABELS[l.link_kind] ?? "Linked";
      if (ringKeys.has(fromKey) && toKey !== fromKey)
        found.push({ from: fromKey, other: l.to, label });
      if (ringKeys.has(toKey) && toKey !== fromKey)
        found.push({ from: toKey, other: l.from, label });
    }
    const named = await titles(
      db,
      userId,
      found.map((f) => f.other),
    );
    const perNode = new Map<string, number>();
    const next: Ref[] = [];
    for (const f of found) {
      const node = named.get(keyOf(f.other));
      if (!node) continue; // Not theirs to open: not drawn, not counted.
      const edgeKey = [f.from, node.key].sort().join("|");
      if (nodes.has(node.key)) {
        if (!edges.has(edgeKey))
          edges.set(edgeKey, { from: f.from, to: node.key, label: f.label });
        continue;
      }
      const n = perNode.get(f.from) ?? 0;
      if (n >= branch || nodes.size >= MAP_LIMIT) {
        truncated = true;
        continue;
      }
      perNode.set(f.from, n + 1);
      nodes.set(node.key, { ...node, depth });
      edges.set(edgeKey, { from: f.from, to: node.key, label: f.label });
      if (node.kind !== "person" && node.kind !== "date")
        next.push({ kind: node.kind, id: node.id });
    }
    return next;
  };

  const first = await grow([centreRef], 1, MAP_LIMIT);
  if (q.depth === 2 && first.length) await grow(first, 2, MAP_BRANCH);
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    truncated,
  };
}
