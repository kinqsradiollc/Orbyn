import { z } from "zod";
import { addDays, dayTime } from "@orbyn/core";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
  visibleRecords,
} from "../lib/visibility.js";
import {
  READ,
  cursorInput,
  projectId,
  projectInput,
  spaceName,
  teamFilter,
  teamInput,
} from "./common.js";
import { both, cleanTitle, mdLink } from "./format.js";
import { refs, type RefType } from "./refs.js";
import { CapabilityError, defineCapability } from "./registry.js";

/**
 * Lists with filters, as a saved view would show them (saved views arrive
 * in a later phase; this is the ad-hoc form). Tasks, events, pages,
 * projects or work records, filtered by words, status, project, stage,
 * team, list, tag, assignee, due range, overdue, folder and when changed,
 * sorted, and paged with a cursor (25 by default, 100 at most).
 */

const OVER = ["tasks", "events", "docs", "projects", "records"] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const instant = z
  .string()
  .trim()
  .refine((v) => DAY.test(v) || !Number.isNaN(Date.parse(v)), {
    message: "Use YYYY-MM-DD or an ISO 8601 instant.",
  });

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
});

export const query = defineCapability({
  name: "query",
  title: "List with filters",
  description:
    'Lists tasks, events, pages, projects or work records (over) with filters: text, status (open, done, any), project, stage, team ("personal" or an id), list, tag, assignee ("me" or an id), due_after/due_before (YYYY-MM-DD in the person\'s zone, or an instant), overdue, folder (pages), kind (a page or record kind) and updated_after. Sort by due, updated, created, priority or title. 25 rows by default, 100 at most, paged with next_cursor.',
  input: z
    .object({
      over: z.enum(OVER).default("tasks"),
      text: z.string().trim().min(1).max(200).optional(),
      status: z.enum(["open", "done", "any"]).default("open"),
      project: projectInput,
      stage: z.uuid().optional(),
      team: teamInput,
      list: z.uuid().optional(),
      tag: z.uuid().optional(),
      assignee: z.union([z.literal("me"), z.uuid()]).optional(),
      due_after: instant.optional(),
      due_before: instant.optional(),
      overdue: z.boolean().optional(),
      updated_after: instant.optional(),
      folder: z.uuid().optional(),
      kind: z.string().trim().min(1).max(40).optional(),
      sort: z
        .enum(["due", "updated", "created", "priority", "title"])
        .optional(),
      limit: z.number().int().min(1).max(100).default(25),
      cursor: cursorInput,
    })
    .strict(),
  output: z.object({
    over: z.enum(OVER),
    rows: z.array(row),
    next_cursor: z.string().nullable(),
  }),
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const tz = ctx.timezone;
    const offset = await ctx.cursor.open(a.cursor);
    const at = (v: string, end = false) =>
      DAY.test(v) ? dayTime(end ? addDays(v, 1) : v, 0, tz) : new Date(v);
    const p = new Params();
    const scope = scopeFor(ctx.spaces, p);
    const project = projectId(a.project);
    const team = teamFilter(a.team);
    const where: string[] = [];
    const itemLike = a.over === "tasks" || a.over === "events";
    const alias = itemLike
      ? "i"
      : a.over === "docs"
        ? "d"
        : a.over === "projects"
          ? "p"
          : "w";
    const x = alias;

    const unsupported = (filter: string) => {
      throw new CapabilityError(
        "INVALID",
        `${filter} doesn't apply to ${a.over}.`,
        "Leave it out, or query tasks.",
      );
    };
    if (team && "personal" in team) where.push(`${x}.team_id IS NULL`);
    if (team && "team" in team)
      where.push(`${x}.team_id = ${p.add(team.team)}`);
    if (a.updated_after)
      where.push(`${x}.updated_at >= ${p.add(at(a.updated_after))}`);
    if (project) {
      if (a.over === "projects") where.push(`p.id = ${p.add(project)}`);
      else where.push(`${x}.project_id = ${p.add(project)}`);
    }

    let select: string;
    let from: string;
    let order: string;
    if (itemLike) {
      where.unshift(visibleItems("i", scope));
      where.push(
        a.over === "events" ? "i.kind = 'event'" : "i.kind <> 'event'",
      );
      where.push("i.parent_id IS NULL OR i.kind = 'event'");
      if (a.status === "open")
        where.push("i.status NOT IN ('done', 'cancelled')");
      if (a.status === "done") where.push("i.status = 'done'");
      if (a.text)
        where.push(
          `(i.search @@ websearch_to_tsquery('english', ${p.add(a.text)}) OR i.title ILIKE '%' || ${p.add(a.text)} || '%')`,
        );
      if (a.stage) where.push(`i.stage_id = ${p.add(a.stage)}`);
      if (a.list) where.push(`i.list_id = ${p.add(a.list)}`);
      if (a.tag)
        where.push(
          `EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = i.id AND t.tag_id = ${p.add(a.tag)})`,
        );
      if (a.assignee)
        where.push(
          `i.assignee_id = ${a.assignee === "me" ? scope.user : p.add(a.assignee)}`,
        );
      if (a.due_after) where.push(`i.due_at >= ${p.add(at(a.due_after))}`);
      if (a.due_before)
        where.push(`i.due_at < ${p.add(at(a.due_before, true))}`);
      if (a.overdue)
        where.push(
          `i.due_at < ${p.add(ctx.now)} AND i.status NOT IN ('done', 'cancelled')`,
        );
      if (a.kind) where.push(`i.kind = ${p.add(a.kind)}`);
      if (a.folder) unsupported("folder");
      select = `i.id, i.kind AS type, i.title, i.status, i.due_at, i.priority, i.team_id,
        i.project_id, a.name AS assignee, i.updated_at`;
      from = "items i LEFT JOIN users a ON a.id = i.assignee_id";
      order = {
        due: "i.due_at NULLS LAST, i.id",
        updated: "i.updated_at DESC, i.id",
        created: "i.created_at DESC, i.id",
        priority:
          "CASE i.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, i.due_at NULLS LAST, i.id",
        title: "lower(i.title), i.id",
      }[a.sort ?? "due"];
    } else if (a.over === "docs") {
      where.unshift(visibleDocs("d", scope));
      if (a.text)
        where.push(
          `(d.search @@ websearch_to_tsquery('english', ${p.add(a.text)}) OR d.title ILIKE '%' || ${p.add(a.text)} || '%')`,
        );
      if (a.folder) where.push(`d.folder_id = ${p.add(a.folder)}`);
      if (a.kind) where.push(`d.kind = ${p.add(a.kind)}`);
      if (a.tag)
        where.push(
          `EXISTS (SELECT 1 FROM doc_tags t WHERE t.doc_id = d.id AND t.tag_id = ${p.add(a.tag)})`,
        );
      for (const [k, v] of Object.entries({
        stage: a.stage,
        list: a.list,
        assignee: a.assignee,
        due_after: a.due_after,
        due_before: a.due_before,
        overdue: a.overdue,
      }))
        if (v !== undefined) unsupported(k);
      select = `d.id, 'doc' AS type, d.title, d.kind AS status, NULL::timestamptz AS due_at,
        NULL AS priority, d.team_id, d.project_id, NULL AS assignee, d.updated_at`;
      from = "docs d";
      order = {
        due: "d.updated_at DESC, d.id",
        updated: "d.updated_at DESC, d.id",
        created: "d.created_at DESC, d.id",
        priority: "d.updated_at DESC, d.id",
        title: "lower(d.title), d.id",
      }[a.sort ?? "updated"];
    } else if (a.over === "projects") {
      where.unshift(visibleProjects("p", scope));
      if (a.status === "open") where.push("p.status <> 'archived'");
      if (a.status === "done") where.push("p.status = 'archived'");
      if (a.text)
        where.push(
          `(p.name || ' ' || p.summary) ILIKE '%' || ${p.add(a.text)} || '%'`,
        );
      if (a.due_after) where.push(`p.deadline >= ${p.add(at(a.due_after))}`);
      if (a.due_before)
        where.push(`p.deadline < ${p.add(at(a.due_before, true))}`);
      if (a.overdue)
        where.push(`p.deadline < ${p.add(ctx.now)} AND p.status <> 'archived'`);
      for (const [k, v] of Object.entries({
        stage: a.stage,
        list: a.list,
        tag: a.tag,
        assignee: a.assignee,
        folder: a.folder,
        kind: a.kind,
      }))
        if (v !== undefined) unsupported(k);
      select = `p.id, 'project' AS type, p.name AS title, p.status, p.deadline AS due_at,
        NULL AS priority, p.team_id, p.id AS project_id, NULL AS assignee, p.updated_at`;
      from = "projects p";
      order = {
        due: "p.deadline NULLS LAST, p.id",
        updated: "p.updated_at DESC, p.id",
        created: "p.created_at DESC, p.id",
        priority: "p.deadline NULLS LAST, p.id",
        title: "lower(p.name), p.id",
      }[a.sort ?? "due"];
    } else {
      where.unshift(visibleRecords("w", scope));
      if (a.status === "open") where.push("w.status IN ('proposed', 'open')");
      if (a.status === "done")
        where.push("w.status NOT IN ('proposed', 'open')");
      if (a.text)
        where.push(
          `(w.title || ' ' || w.details) ILIKE '%' || ${p.add(a.text)} || '%'`,
        );
      if (a.kind) where.push(`w.kind = ${p.add(a.kind)}`);
      if (a.assignee)
        where.push(
          `w.owner_id = ${a.assignee === "me" ? scope.user : p.add(a.assignee)}`,
        );
      if (a.due_after) where.push(`w.due_at >= ${p.add(at(a.due_after))}`);
      if (a.due_before)
        where.push(`w.due_at < ${p.add(at(a.due_before, true))}`);
      if (a.overdue)
        where.push(
          `w.due_at < ${p.add(ctx.now)} AND w.status IN ('proposed', 'open')`,
        );
      for (const [k, v] of Object.entries({
        stage: a.stage,
        list: a.list,
        tag: a.tag,
        folder: a.folder,
      }))
        if (v !== undefined) unsupported(k);
      select = `w.id, 'record' AS type, w.title, w.status, w.due_at, NULL AS priority,
        w.team_id, w.project_id, o.name AS assignee, w.updated_at`;
      from = "work_records w LEFT JOIN users o ON o.id = w.owner_id";
      order = {
        due: "w.due_at NULLS LAST, w.id",
        updated: "w.updated_at DESC, w.id",
        created: "w.created_at DESC, w.id",
        priority: "w.due_at NULLS LAST, w.id",
        title: "lower(w.title), w.id",
      }[a.sort ?? "due"];
    }

    const found = await ctx.db.query<{
      id: string;
      type: string;
      title: string;
      status: string | null;
      due_at: Date | null;
      priority: string | null;
      team_id: string | null;
      project_id: string | null;
      assignee: string | null;
      updated_at: Date;
    }>(
      `SELECT ${select} FROM ${from}
        WHERE ${where.map((w) => `(${w})`).join(" AND ")}
        ORDER BY ${order}
        LIMIT ${a.limit + 1} OFFSET ${offset}`,
      p.values,
    );
    const rows = found.rows.slice(0, a.limit).map((r) => {
      const type = (
        itemLike ? (r.type === "event" ? "event" : "task") : r.type
      ) as z.output<typeof row>["type"];
      const at2 = refs({ type: type as RefType, id: r.id }, r.project_id);
      return {
        id: at2.id,
        title: cleanTitle(r.title) || "Untitled",
        url: at2.url,
        type,
        status: r.status,
        due: both(r.due_at, tz),
        priority: r.priority,
        team: spaceName(r.team_id, ctx.principal.teams),
        project_id: r.project_id,
        assignee: r.assignee ? cleanTitle(r.assignee) : null,
        updated_at: r.updated_at.toISOString(),
      };
    });
    const next =
      found.rows.length > a.limit
        ? await ctx.cursor.seal(offset + a.limit)
        : null;
    const markdown = rows.length
      ? [
          `${rows.length} ${a.over}${next ? " (more with next_cursor)" : ""}:`,
          ...rows.map(
            (r) =>
              `- ${mdLink(r.title, r.url)}${r.status ? ` (${r.status}${r.due ? `, due ${r.due.local}` : ""})` : ""} · ${r.team} · ${r.id}`,
          ),
        ].join("\n")
      : `No ${a.over} match.`;
    return {
      structured: { over: a.over, rows, next_cursor: next },
      markdown,
      targets: rows.map((r) => r.id),
    };
  },
});
