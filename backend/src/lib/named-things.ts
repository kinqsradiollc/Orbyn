import type { Queryable } from "../db/pool.js";
import { visibleDocs, visibleItems, visibleProjects } from "./visibility.js";

/** A task, page or project, by kind and id. */
export type ThingRef = { kind: "task" | "doc" | "project"; id: string };

/**
 * Titles of the tasks, pages and projects asked for that `userId` can still
 * see (pages in the Trash left out), keyed "kind:id". One query per kind,
 * for the lists that name what an agent touched (Connected agents, the
 * morning digest; H7).
 */
export async function namedThings(
  db: Queryable,
  userId: string,
  wanted: ThingRef[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!wanted.length) return out;
  const ids = (kind: ThingRef["kind"]) => [
    ...new Set(wanted.filter((w) => w.kind === kind).map((w) => w.id)),
  ];
  const [tasks, docs, projects] = await Promise.all([
    db.query<{ id: string; title: string }>(
      `SELECT x.id::text, x.title FROM items x
        WHERE x.id = ANY($2::uuid[]) AND ${visibleItems("x")}`,
      [userId, ids("task")],
    ),
    db.query<{ id: string; title: string }>(
      `SELECT x.id::text, x.title FROM docs x
        WHERE x.id = ANY($2::uuid[]) AND ${visibleDocs("x")}`,
      [userId, ids("doc")],
    ),
    db.query<{ id: string; title: string }>(
      `SELECT x.id::text, x.name AS title FROM projects x
        WHERE x.id = ANY($2::uuid[]) AND ${visibleProjects("x")}`,
      [userId, ids("project")],
    ),
  ]);
  for (const [kind, res] of [
    ["task", tasks],
    ["doc", docs],
    ["project", projects],
  ] as const)
    for (const r of res.rows)
      out.set(`${kind}:${r.id}`, r.title.trim() || "Untitled");
  return out;
}
