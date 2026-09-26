import { z } from "zod";
import { VIEW_LAYOUTS, addDays, dayTime, localDateKey } from "@orbyn/core";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
  visibleRecords,
} from "../lib/visibility.js";
import {
  QUERY_GROUPS,
  QUERY_OVER,
  QUERY_SORTS,
  fromSavedView,
  queryDate,
  resolveQueryDate,
  type QueryDef,
  type QueryGroup,
} from "./query-def.js";
import { findView } from "./view-store.js";
import {
  READ,
  cursorInput,
  projectId,
  projectInput,
  spaceName,
  teamFilter,
  teamInput,
} from "./common.js";
import {
  both,
  cleanTitle,
  lineTitle,
  provenanceOf,
  titleFor,
} from "./format.js";
import { parseRef, refs, type RefType } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import { docEditorsSql, itemSourceSql } from "./sources.js";

/**
 * Lists with filters, as a saved view shows them: tasks, events, pages,
 * projects or work records, filtered by words, status, project, stage,
 * team, list, tag, assignee, due range, overdue, folder, links and when
 * changed, sorted, grouped and paged with a cursor (25 by default, 100 at
 * most). It runs a saved view (`view`), an ad-hoc one, or a saved view with
 * some filters changed. A saved view is the app's (packages/core/src/views.ts,
 * made in the app or by save_view), read in these words (query-def.ts).
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const row = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  type: z.enum(["task", "event", "doc", "project", "record"]),
  status: z.string().nullable(),
  due: z.object({ at: z.string(), local: z.string() }).nullable(),
  priority: z.string().nullable(),
  team: z.string(),
  project_id: z.string().nullable(),
  assignee: z.string().nullable(),
  updated_at: z.string(),
  provenance: z
    .string()
    .describe(
      'Who wrote it: "you", "teammate:<name>", or where it came from (booking_guest, inbound_email, import).',
    ),
  group: z.string().nullable(),
});
export type ViewRow = z.output<typeof row>;

export const viewInfo = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  source: z.enum(["tasks", "pages", "projects"]),
  layout: z.enum(VIEW_LAYOUTS),
  group_by: z.string().nullable(),
  columns: z.array(z.string()),
  not_applied: z
    .array(z.string())
    .describe("Parts of the view only the app applies (your own fields)."),
});

export const queryOutput = z.object({
  over: z.enum(QUERY_OVER),
  view: viewInfo.nullable(),
  rows: z.array(row),
  groups: z.array(
    z.object({ key: z.string(), label: z.string(), count: z.number() }),
  ),
  next_cursor: z.string().nullable(),
});

/** The filters the query tool takes: a view definition with typed ids allowed. */
export const filterFields = {
  over: z.enum(QUERY_OVER).optional().describe("Default tasks."),
  text: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["open", "done", "any"]).optional().describe("Default open."),
  project: projectInput,
  stage: z.uuid().optional(),
  team: teamInput,
  list: z.uuid().optional(),
  tag: z.uuid().optional(),
  assignee: z.union([z.literal("me"), z.uuid()]).optional(),
  due_after: queryDate.optional(),
  due_before: queryDate.optional(),
  overdue: z.boolean().optional(),
  updated_after: queryDate.optional(),
  folder: z.uuid().optional(),
  kind: z.string().trim().min(1).max(40).optional(),
  links_to: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .optional()
    .describe("Rows linking to doc:, task: or project:."),
  starred: z.boolean().optional(),
  sort: z.enum(QUERY_SORTS).optional(),
  group_by: z.enum(QUERY_GROUPS).optional(),
};

/** A definition from the query tool's arguments (ids normalised). */
export function definitionFrom(
  a: Partial<Record<keyof typeof filterFields, unknown>>,
): Partial<QueryDef> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a))
    if (k in filterFields && v !== undefined) out[k] = v;
  if (typeof a.project === "string") out.project = projectId(a.project);
  if (typeof a.team === "string") {
    const t = teamFilter(a.team);
    out.team = t && "team" in t ? t.team : "personal";
  }
  if (typeof a.links_to === "string") {
    const ref = parseRef(a.links_to);
    if (ref.type === "title" || ref.type === "any")
      throw new CapabilityError(
        "INVALID",
        "links_to must be a typed id, like doc:<id> or project:<id>.",
      );
    out.links_to = `${ref.type === "event" ? "task" : ref.type}:${ref.id}`;
  }
  return out as Partial<QueryDef>;
}

const LINK_TARGETS = new Set(["doc", "task", "project"]);

type Found = {
  id: string;
  type: string;
  title: string;
  status: string | null;
  due_at: Date | null;
  priority: string | null;
  team_id: string | null;
  project_id: string | null;
  project_name: string | null;
  stage_name: string | null;
  assignee: string | null;
  updated_at: Date;
  source: string | null;
  user_id: string | null;
  author_name: string | null;
  imported?: boolean;
  editors?: string[] | null;
};

/** The label of the group a row falls in. */
function groupOf(
  by: QueryGroup | undefined,
  r: Found,
  type: string,
  ctx: CapabilityContext,
): string | null {
  if (!by) return null;
  switch (by) {
    case "status":
      return r.status ?? "none";
    case "priority":
      return r.priority ?? "none";
    case "project":
      return r.project_name ? cleanTitle(r.project_name) : "No project";
    case "stage":
      return r.stage_name ? cleanTitle(r.stage_name) : "No stage";
    case "assignee":
      return r.assignee ? cleanTitle(r.assignee) : "Unassigned";
    case "team":
      return spaceName(r.team_id, ctx.principal.teams);
    case "kind":
      return type;
    case "due": {
      if (!r.due_at) return "No date";
      const today = localDateKey(ctx.now, ctx.timezone);
      const day = localDateKey(r.due_at, ctx.timezone);
      if (day < today) return "Overdue";
      if (day === today) return "Today";
      if (day <= addDays(today, 7)) return "This week";
      return "Later";
    }
  }
}

/**
 * Run a view definition for the context's principal: one page of rows,
 * starting at `offset`, plus whether there are more.
 */
export async function runView(
  ctx: CapabilityContext,
  d: QueryDef,
  limit: number,
  offset: number,
): Promise<{ rows: ViewRow[]; more: boolean }> {
  const tz = ctx.timezone;
  const today = localDateKey(ctx.now, tz);
  const at = (raw: string, end = false) => {
    const v = resolveQueryDate(raw, today);
    return DAY.test(v) ? dayTime(end ? addDays(v, 1) : v, 0, tz) : new Date(v);
  };
  const p = new Params();
  const scope = scopeFor(ctx.spaces, p);
  const where: string[] = [];
  const over = d.over;
  const itemLike = over === "tasks" || over === "events";
  const x = itemLike
    ? "i"
    : over === "docs"
      ? "d"
      : over === "projects"
        ? "p"
        : "w";

  const unsupported = (filter: string) => {
    throw new CapabilityError(
      "INVALID",
      `${filter} doesn't apply to ${over}.`,
      "Leave it out, or query tasks.",
    );
  };
  if (d.team === "personal") where.push(`${x}.team_id IS NULL`);
  else if (d.team) where.push(`${x}.team_id = ${p.add(d.team)}`);
  if (d.updated_after)
    where.push(`${x}.updated_at >= ${p.add(at(d.updated_after))}`);
  if (d.project) {
    if (over === "projects") where.push(`p.id = ${p.add(d.project)}`);
    else where.push(`${x}.project_id = ${p.add(d.project)}`);
  }
  if (d.links_to) {
    const [kind, id] = d.links_to.split(":");
    if (!LINK_TARGETS.has(kind) || !id) unsupported("links_to");
    if (!itemLike && over !== "docs") unsupported("links_to");
    const source = itemLike ? "task" : "doc";
    const k = p.add(kind);
    const t = p.add(id);
    where.push(`(EXISTS (SELECT 1 FROM object_links l
        WHERE l.source_kind = '${source}' AND l.source_id = ${x}.id
          AND l.target_kind = ${k} AND l.target_id = ${t})
      OR EXISTS (SELECT 1 FROM object_links l
        WHERE l.link_kind = 'related' AND l.target_kind = '${source}'
          AND l.target_id = ${x}.id::text
          AND l.source_kind = ${k} AND l.source_id::text = ${t}))`);
  }
  if (d.starred) {
    if (over !== "docs" && over !== "projects") unsupported("starred");
    where.push(`EXISTS (SELECT 1 FROM favourites f WHERE f.user_id = ${scope.user}
      AND f.kind = '${over === "docs" ? "doc" : "project"}' AND f.target_id = ${x}.id)`);
  }
  const projectName = (col: string) => {
    const ps = scopeFor(ctx.spaces, p);
    return `(SELECT pp.name FROM projects pp WHERE pp.id = ${col}
      AND ${visibleProjects("pp", ps)})`;
  };

  let select: string;
  let from: string;
  let order: string;
  if (itemLike) {
    where.unshift(visibleItems("i", scope));
    where.push(over === "events" ? "i.kind = 'event'" : "i.kind <> 'event'");
    where.push("i.parent_id IS NULL OR i.kind = 'event'");
    if (d.status === "open")
      where.push("i.status NOT IN ('done', 'cancelled')");
    if (d.status === "done") where.push("i.status = 'done'");
    if (d.text)
      where.push(
        `(i.search @@ websearch_to_tsquery('english', ${p.add(d.text)}) OR i.title ILIKE '%' || ${p.add(d.text)} || '%')`,
      );
    if (d.stage) where.push(`i.stage_id = ${p.add(d.stage)}`);
    if (d.list) where.push(`i.list_id = ${p.add(d.list)}`);
    if (d.tag)
      where.push(
        `EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag_id = ${p.add(d.tag)})`,
      );
    if (d.assignee)
      where.push(
        `i.assignee_id = ${d.assignee === "me" ? scope.user : p.add(d.assignee)}`,
      );
    if (d.due_after) where.push(`i.due_at >= ${p.add(at(d.due_after))}`);
    if (d.due_before) where.push(`i.due_at < ${p.add(at(d.due_before, true))}`);
    if (d.no_due) where.push("i.due_at IS NULL");
    if (d.overdue)
      where.push(
        `i.due_at < ${p.add(ctx.now)} AND i.status NOT IN ('done', 'cancelled')`,
      );
    if (d.kind) where.push(`i.kind = ${p.add(d.kind)}`);
    if (d.folder) unsupported("folder");
    select = `i.id, i.kind AS type, i.title, i.status, i.due_at, i.priority, i.team_id,
      i.project_id, ${projectName("i.project_id")} AS project_name,
      (SELECT s.name FROM project_stages s WHERE s.id = i.stage_id) AS stage_name,
      a.name AS assignee, i.updated_at, ${itemSourceSql("i")} AS source,
      i.user_id, au.name AS author_name`;
    from = `items i LEFT JOIN users a ON a.id = i.assignee_id
      JOIN users au ON au.id = i.user_id`;
    order = {
      due: "i.due_at NULLS LAST, i.id",
      updated: "i.updated_at DESC, i.id",
      created: "i.created_at DESC, i.id",
      priority:
        "CASE i.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, i.due_at NULLS LAST, i.id",
      title: "lower(i.title), i.id",
    }[d.sort ?? "due"];
  } else if (over === "docs") {
    where.unshift(visibleDocs("d", scope));
    if (d.text)
      where.push(
        `(d.search @@ websearch_to_tsquery('english', ${p.add(d.text)}) OR d.title ILIKE '%' || ${p.add(d.text)} || '%')`,
      );
    if (d.folder) where.push(`d.folder_id = ${p.add(d.folder)}`);
    if (d.kind) where.push(`d.kind = ${p.add(d.kind)}`);
    if (d.tag)
      where.push(
        `EXISTS (SELECT 1 FROM doc_tags t WHERE t.doc_id = d.id AND t.tag_id = ${p.add(d.tag)})`,
      );
    for (const [k, v] of Object.entries({
      stage: d.stage,
      list: d.list,
      assignee: d.assignee,
      due_after: d.due_after,
      due_before: d.due_before,
      overdue: d.overdue,
      no_due: d.no_due,
    }))
      if (v !== undefined) unsupported(k);
    select = `d.id, 'doc' AS type, d.title, d.kind AS status, NULL::timestamptz AS due_at,
      NULL AS priority, d.team_id, d.project_id, ${projectName("d.project_id")} AS project_name,
      NULL AS stage_name, NULL AS assignee, d.updated_at,
      NULL AS source, d.user_id, au.name AS author_name,
      d.imported_from IS NOT NULL AS imported, ${docEditorsSql("d", scope.user)} AS editors`;
    from = "docs d JOIN users au ON au.id = d.user_id";
    order = {
      due: "d.updated_at DESC, d.id",
      updated: "d.updated_at DESC, d.id",
      created: "d.created_at DESC, d.id",
      priority: "d.updated_at DESC, d.id",
      title: "lower(d.title), d.id",
    }[d.sort ?? "updated"];
  } else if (over === "projects") {
    where.unshift(visibleProjects("p", scope));
    if (d.status === "open") where.push("p.status <> 'archived'");
    if (d.status === "done") where.push("p.status = 'archived'");
    if (d.text)
      where.push(
        `(p.name || ' ' || p.summary) ILIKE '%' || ${p.add(d.text)} || '%'`,
      );
    if (d.due_after) where.push(`p.deadline >= ${p.add(at(d.due_after))}`);
    if (d.due_before)
      where.push(`p.deadline < ${p.add(at(d.due_before, true))}`);
    if (d.overdue)
      where.push(`p.deadline < ${p.add(ctx.now)} AND p.status <> 'archived'`);
    if (d.no_due) where.push("p.deadline IS NULL");
    for (const [k, v] of Object.entries({
      stage: d.stage,
      list: d.list,
      tag: d.tag,
      assignee: d.assignee,
      folder: d.folder,
      kind: d.kind,
    }))
      if (v !== undefined) unsupported(k);
    select = `p.id, 'project' AS type, p.name AS title, p.status, p.deadline AS due_at,
      NULL AS priority, p.team_id, p.id AS project_id, p.name AS project_name,
      NULL AS stage_name, NULL AS assignee, p.updated_at,
      NULL AS source, p.user_id, au.name AS author_name`;
    from = "projects p JOIN users au ON au.id = p.user_id";
    order = {
      due: "p.deadline NULLS LAST, p.id",
      updated: "p.updated_at DESC, p.id",
      created: "p.created_at DESC, p.id",
      priority: "p.deadline NULLS LAST, p.id",
      title: "lower(p.name), p.id",
    }[d.sort ?? "due"];
  } else {
    where.unshift(visibleRecords("w", scope));
    if (d.status === "open") where.push("w.status IN ('proposed', 'open')");
    if (d.status === "done") where.push("w.status NOT IN ('proposed', 'open')");
    if (d.text)
      where.push(
        `(w.title || ' ' || w.details) ILIKE '%' || ${p.add(d.text)} || '%'`,
      );
    if (d.kind) where.push(`w.kind = ${p.add(d.kind)}`);
    if (d.assignee)
      where.push(
        `w.owner_id = ${d.assignee === "me" ? scope.user : p.add(d.assignee)}`,
      );
    if (d.due_after) where.push(`w.due_at >= ${p.add(at(d.due_after))}`);
    if (d.due_before) where.push(`w.due_at < ${p.add(at(d.due_before, true))}`);
    if (d.no_due) where.push("w.due_at IS NULL");
    if (d.overdue)
      where.push(
        `w.due_at < ${p.add(ctx.now)} AND w.status IN ('proposed', 'open')`,
      );
    for (const [k, v] of Object.entries({
      stage: d.stage,
      list: d.list,
      tag: d.tag,
      folder: d.folder,
    }))
      if (v !== undefined) unsupported(k);
    select = `w.id, 'record' AS type, w.title, w.status, w.due_at, NULL AS priority,
      w.team_id, w.project_id, ${projectName("w.project_id")} AS project_name,
      NULL AS stage_name, o.name AS assignee, w.updated_at, NULL AS source,
      w.created_by AS user_id, au.name AS author_name`;
    from = `work_records w LEFT JOIN users o ON o.id = w.owner_id
      LEFT JOIN users au ON au.id = w.created_by`;
    order = {
      due: "w.due_at NULLS LAST, w.id",
      updated: "w.updated_at DESC, w.id",
      created: "w.created_at DESC, w.id",
      priority: "w.due_at NULLS LAST, w.id",
      title: "lower(w.title), w.id",
    }[d.sort ?? "due"];
  }

  if (d.desc) order = reversed(order);

  const found = await ctx.db.query<Found>(
    `SELECT ${select} FROM ${from}
      WHERE ${where.map((w) => `(${w})`).join(" AND ")}
      ORDER BY ${order}
      LIMIT ${limit + 1} OFFSET ${offset}`,
    p.values,
  );
  const rows = found.rows.slice(0, limit).map((r): ViewRow => {
    const type = (
      itemLike ? (r.type === "event" ? "event" : "task") : r.type
    ) as ViewRow["type"];
    const at2 = refs({ type: type as RefType, id: r.id }, r.project_id);
    const provenance = provenanceOf(ctx.principal.user.id, r);
    return {
      id: at2.id,
      // A booking's event never shows its guest's email address, and is
      // only "Booking" when the connection hides outside content.
      title:
        titleFor(
          r.title,
          provenance,
          ctx.principal.flags.hide_outside_content,
          type,
        ) || "Untitled",
      url: at2.url,
      type,
      status: r.status,
      due: both(r.due_at, tz),
      priority: r.priority,
      team: spaceName(r.team_id, ctx.principal.teams),
      project_id: r.project_id,
      assignee: r.assignee ? cleanTitle(r.assignee) : null,
      updated_at: r.updated_at.toISOString(),
      provenance,
      group: groupOf(d.group_by, r, type, ctx),
    };
  });
  return { rows, more: found.rows.length > limit };
}

/**
 * An ORDER BY with its first term the other way round (things without a
 * value stay last, as in the app); the tie-breakers keep their order.
 */
function reversed(order: string): string {
  const [first, ...rest] = order.split(", ");
  const flipped = first.endsWith(" DESC")
    ? first.slice(0, -5)
    : first.endsWith(" NULLS LAST")
      ? `${first.slice(0, -11)} DESC NULLS LAST`
      : `${first} DESC`;
  return [flipped, ...rest].join(", ");
}

/** The groups on a page of rows, in the order they first appear. */
export function groupsOf(rows: ViewRow[]) {
  const counts = new Map<string, number>();
  for (const r of rows)
    if (r.group !== null) counts.set(r.group, (counts.get(r.group) ?? 0) + 1);
  return [...counts].map(([key, count]) => ({ key, label: key, count }));
}

export const query = defineCapability({
  name: "query",
  title: "List with filters",
  description:
    "Runs a saved view (view:<id>) or an ad-hoc one over tasks, events, pages, projects or work records (over), with filters, sort and group_by; filters given with a view replace its own. Dates: YYYY-MM-DD, an instant, or relative (today, +7d, -3d). 25 rows by default, 100 at most, paged with next_cursor. The language is in orbyn://spec/views.",
  input: z
    .object({
      view: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .optional()
        .describe("A saved view: view:<id>, its id or its link."),
      ...filterFields,
      limit: z.number().int().min(1).max(100).default(25),
      cursor: cursorInput,
    })
    .strict(),
  output: queryOutput,
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const offset = await ctx.cursor.open(a.cursor);
    let saved: Awaited<ReturnType<typeof findView>> = null;
    if (a.view) {
      const ref = parseRef(a.view);
      if (ref.type === "title" || (ref.type !== "view" && ref.type !== "any"))
        throw new CapabilityError(
          "INVALID",
          "view must be a saved view's id, like view:<id>.",
          "Saved views are listed by search (types: view) or resources/list.",
        );
      saved = await findView(ctx.db, ctx.spaces, ref.id);
      if (!saved)
        throw new CapabilityError(
          "NOT_FOUND",
          "No saved view with that id is reachable from this connection.",
          'Search for it with types: ["view"].',
        );
    }
    const asked = definitionFrom(a);
    const base = saved ? fromSavedView(saved.definition) : null;
    if (base && asked.over && asked.over !== base.query.over)
      throw new CapabilityError(
        "INVALID",
        `This view lists ${saved!.source}; over can't change that.`,
        "Leave over out, or query without the view.",
      );
    const d: QueryDef = {
      ...(base?.query ?? {}),
      ...asked,
      over: asked.over ?? base?.query.over ?? "tasks",
      status: asked.status ?? base?.query.status ?? "open",
    };
    // A sort given here reads the usual way round.
    if (asked.sort) delete d.desc;
    const { rows, more } = await runView(ctx, d, a.limit, offset);
    const next = more ? await ctx.cursor.seal(offset + a.limit) : null;
    const what = d.over === "docs" ? "pages" : d.over;
    const head = saved
      ? `${saved.name} (${saved.definition.layout}): ${rows.length} ${what}`
      : `${rows.length} ${what}`;
    const markdown = rows.length
      ? [
          `${head}${next ? " (more with next_cursor)" : ""}:`,
          ...rows.map(
            (r) =>
              `- ${r.group ? `[${r.group}] ` : ""}${lineTitle(r.title, r.url, r.provenance, r.type)}${r.status ? ` (${r.status}${r.due ? `, due ${r.due.local}` : ""})` : ""} · ${r.team} · ${r.id}`,
          ),
          ...(base?.notes.length
            ? [`(In the app, also: ${base.notes.join("; ")}.)`]
            : []),
        ].join("\n")
      : saved
        ? `${saved.name}: nothing matches right now.`
        : `No ${what} match.`;
    const viewRef = saved ? refs({ type: "view", id: saved.id }) : null;
    return {
      structured: {
        over: d.over,
        view:
          saved && viewRef
            ? {
                id: viewRef.id,
                name: cleanTitle(saved.name),
                url: viewRef.url,
                source: saved.source,
                layout: saved.definition.layout,
                group_by: d.group_by ?? null,
                columns: saved.definition.columns ?? [],
                not_applied: base?.notes ?? [],
              }
            : null,
        rows,
        groups: groupsOf(rows),
        next_cursor: next,
      },
      markdown,
      targets: rows.map((r) => r.id),
    };
  },
});
