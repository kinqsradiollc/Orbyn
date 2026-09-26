import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
  visibleRecords,
  visibleTemplates,
  visibleViews,
} from "../lib/visibility.js";
import { cleanTitle } from "./format.js";
import type { CapabilityContext } from "./registry.js";
import { itemSourceSql } from "./sources.js";

/**
 * Completions (completion/complete): ids and names filled in as the person
 * types, from titles this connection can see and nothing else, so a
 * completion never reveals something a search wouldn't. At most 20 values.
 * Tasks and events whose titles came from outside Orbyn (an email, a
 * booking guest) are never offered.
 */

export const COMPLETE_SOURCES = [
  "doc",
  "task",
  "event",
  "project",
  "view",
  "record",
  "template",
  "team",
  "exam",
] as const;
export type CompleteSource = (typeof COMPLETE_SOURCES)[number];

/** The most values one completion returns. */
export const MAX_COMPLETIONS = 20;

const TABLES: Record<
  Exclude<CompleteSource, "team">,
  { table: string; alias: string; name: string; where: string }
> = {
  doc: { table: "docs", alias: "d", name: "d.title", where: "" },
  task: {
    table: "items",
    alias: "i",
    name: "i.title",
    where: `i.kind <> 'event' AND i.status NOT IN ('done', 'cancelled') AND ${itemSourceSql("i")} IS NULL`,
  },
  event: {
    table: "items",
    alias: "i",
    name: "i.title",
    where: `i.kind = 'event' AND ${itemSourceSql("i")} IS NULL`,
  },
  exam: {
    table: "items",
    alias: "i",
    name: "i.title",
    where: `i.kind = 'event' AND i.due_at > now() - interval '1 day' AND ${itemSourceSql("i")} IS NULL
      AND i.title ~* '\\m(exams?|midterms?|finals?|tests?|quiz(zes)?|assessments?)\\M'`,
  },
  project: {
    table: "projects",
    alias: "p",
    name: "p.name",
    where: "p.status <> 'archived'",
  },
  view: { table: "saved_views", alias: "v", name: "v.name", where: "" },
  record: { table: "work_records", alias: "w", name: "w.title", where: "" },
  template: {
    table: "project_templates",
    alias: "t",
    name: "t.name",
    where: "",
  },
};

const VISIBLE = {
  d: visibleDocs,
  i: visibleItems,
  p: visibleProjects,
  v: visibleViews,
  w: visibleRecords,
  t: visibleTemplates,
} as const;

/**
 * Up to 20 matches for `value` in `source`: titles (`as: "title"`) for a
 * prompt's arguments, or ids (`as: "id"`) for a resource address.
 */
export async function completeValues(
  ctx: CapabilityContext,
  source: CompleteSource,
  value: string,
  as: "title" | "id",
): Promise<string[]> {
  const text = value.trim().slice(0, 100);
  if (source === "team")
    return ctx.principal.teams
      .filter((t) => t.name.toLowerCase().includes(text.toLowerCase()))
      .slice(0, MAX_COMPLETIONS)
      .map((t) => (as === "id" ? t.id : cleanTitle(t.name)));
  const t = TABLES[source];
  const p = new Params();
  const scope = scopeFor(ctx.spaces, p);
  const q = text ? p.add(text) : "";
  // What was typed is matched as written: % and _ are not wildcards.
  const like = text ? p.add(`%${text.replace(/[\\%_]/g, "\\$&")}%`) : "";
  const where = [
    VISIBLE[t.alias as keyof typeof VISIBLE](t.alias, scope),
    ...(t.where ? [t.where] : []),
    ...(text
      ? [
          `(${t.name} ILIKE ${like} ESCAPE '\\' OR similarity(${t.name}, ${q}) > 0.3)`,
        ]
      : []),
  ];
  const rows = (
    await ctx.db.query<{ id: string; title: string }>(
      `SELECT ${t.alias}.id, ${t.name} AS title FROM ${t.table} ${t.alias}
        WHERE ${where.map((w) => `(${w})`).join(" AND ")}
        ORDER BY ${text ? `similarity(${t.name}, ${q}) DESC,` : ""} ${t.alias}.updated_at DESC
        LIMIT ${MAX_COMPLETIONS}`,
      p.values,
    )
  ).rows;
  const values = rows.map((r) =>
    as === "id" ? r.id : cleanTitle(r.title) || "Untitled",
  );
  return [...new Set(values)];
}
