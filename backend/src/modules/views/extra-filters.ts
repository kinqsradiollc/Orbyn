import { fail, type ViewSource } from "@orbyn/core";
import type { TaskNarrowing } from "./task-filters.js";

/** Trusted transient agent query constraints, never accepted as SQL or persisted. */
export type ViewExtraFilters = {
  stage?: string;
  kind?: string;
  text?: string;
  overdueBefore?: Date;
  links_to?: { kind: "doc" | "task" | "project"; id: string };
  starred?: boolean;
  due_after?: Date;
  due_before?: Date;
  updated_after?: Date;
};
export function narrowViewExtra(
  n: TaskNarrowing,
  alias: "i" | "d" | "p",
  source: ViewSource,
  f?: ViewExtraFilters,
) {
  if (!f) return;
  const add = (value: unknown) => {
    n.values.push(value);
    return `$${n.values.length + 1}`;
  };
  if (f.kind) {
    if (source !== "tasks")
      fail(400, "Transient item kind only applies to tasks.");
    n.where.push(`${alias}.kind = ${add(f.kind)}`);
  }
  if (f.text) {
    const text = add(f.text);
    n.where.push(
      source === "projects"
        ? `(p.name || ' ' || p.summary) ILIKE '%' || ${text} || '%'`
        : `(${alias}.search @@ websearch_to_tsquery('english',${text}) OR ${alias}.title ILIKE '%' || ${text} || '%')`,
    );
  }
  if (f.overdueBefore) {
    if (source === "pages") fail(400, "Pages have no due date.");
    n.where.push(
      `${alias}.${source === "tasks" ? "due_at" : "deadline"} < ${add(f.overdueBefore)}`,
    );
    n.where.push(
      source === "tasks"
        ? "i.status NOT IN ('done','cancelled')"
        : "p.status <> 'archived'",
    );
  }
  if (f.stage) {
    if (source !== "tasks") fail(400, "stage only applies to tasks.");
    n.where.push(`${alias}.stage_id = ${add(f.stage)}`);
  }
  if (f.updated_after)
    n.where.push(`${alias}.updated_at >= ${add(f.updated_after)}`);
  for (const [key, op] of [
    ["due_after", ">="],
    ["due_before", "<"],
  ] as const) {
    if (!f[key]) continue;
    if (source === "pages") fail(400, "Pages have no due date.");
    n.where.push(
      `${alias}.${source === "tasks" ? "due_at" : "deadline"} ${op} ${add(f[key])}`,
    );
  }
  if (f.starred) {
    if (source === "tasks")
      fail(400, "starred only applies to pages and projects.");
    n.where.push(
      `EXISTS (SELECT 1 FROM favourites fv WHERE fv.user_id = $1 AND fv.kind = '${source === "pages" ? "doc" : "project"}' AND fv.target_id = ${alias}.id)`,
    );
  }
  if (f.links_to) {
    if (source === "projects")
      fail(400, "links_to only applies to tasks and pages.");
    const kind = add(f.links_to.kind),
      id = add(f.links_to.id),
      ownKind = source === "tasks" ? "task" : "doc";
    n.where
      .push(`(EXISTS (SELECT 1 FROM object_links ol WHERE ol.source_kind = '${ownKind}' AND ol.source_id = ${alias}.id AND ol.target_kind = ${kind} AND ol.target_id = ${id})
      OR EXISTS (SELECT 1 FROM object_links ol WHERE ol.link_kind = 'related' AND ol.target_kind = '${ownKind}' AND ol.target_id = ${alias}.id::text AND ol.source_kind = ${kind} AND ol.source_id::text = ${id}))`);
  }
}
