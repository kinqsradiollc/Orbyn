import {
  applyView,
  docCover,
  docPreview,
  fail,
  hasTeamPermission,
  VIEW_ROW_LIMIT,
  viewDefinition,
  type CustomField,
  type DocBlock,
  type DocKind,
  type Item,
  type Priority,
  type SavedView,
  type TeamRole,
  type ViewDefinition,
  type ViewResult,
  type ViewRow,
  type ViewSource,
} from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";
import { inSpaces, type Spaces } from "../../lib/visibility.js";
import { ITEM_COLUMNS, ITEM_FROM } from "../items/service.js";
import { loadPrefs } from "../planner/calendar.js";
import { PROJECT_COUNTS } from "../projects/counts.js";
import { fieldValuesFor, visibleFields } from "./fields.js";
import { linkPrivacy } from "../links/privacy.js";

/**
 * Running a view: the rows it shows, for the person looking. Rows are read
 * with the same visibility rule as everywhere else (your own things and your
 * teams'), narrowed in SQL by the filters that are cheap there, then every
 * filter, the order and the limit are applied by the one set of rules in
 * @orbyn/core (applyView), which the apps and the agents' tools share.
 *
 * A shared view is always run as the person looking: sharing a view shares
 * its definition, never anyone else's rows.
 */

/** The most candidate rows read before the core filters run. */
const CANDIDATES = 3000;

const iso = (v: Date | string | null | undefined) =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

const writable = (
  teamId: string | null,
  ownerId: string,
  role: TeamRole | null,
  userId: string,
) =>
  teamId
    ? !!role && hasTeamPermission(role, "items:write")
    : ownerId === userId;

type Narrowing = { where: string[]; values: unknown[] };

/**
 * The spaces a view may read from: an agent's connection may be limited to
 * some of them (`ctx.spaces`); the apps read every space.
 */
export type ViewSpaces = Pick<Spaces, "teamIds" | "personal">;

/** SQL narrowing shared by every source: spaces, team and project. */
function narrow(
  def: ViewDefinition,
  alias: string,
  projectColumn: string,
  spaces?: ViewSpaces,
): Narrowing {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (v: unknown) => {
    values.push(v);
    return `$${values.length + 1}`;
  };
  const f = def.filters;
  if (spaces && !spaces.personal) where.push(`${alias}.team_id IS NOT NULL`);
  if (spaces?.teamIds)
    where.push(
      `(${alias}.team_id IS NULL OR ${alias}.team_id = ANY (${add(spaces.teamIds)}::uuid[]))`,
    );
  if (f.team === "personal") where.push(`${alias}.team_id IS NULL`);
  else if (f.team) where.push(`${alias}.team_id = ${add(f.team)}`);
  if (f.project) where.push(`${projectColumn} = ${add(f.project)}`);
  return { where, values };
}

async function taskRows(
  db: Queryable,
  userId: string,
  def: ViewDefinition,
  spaces?: ViewSpaces,
): Promise<ViewRow[]> {
  const n = narrow(def, "i", "i.project_id", spaces);
  const add = (v: unknown) => {
    n.values.push(v);
    return `$${n.values.length + 1}`;
  };
  const f = def.filters;
  const status = f.status ?? "open";
  if (status === "open") n.where.push("i.status NOT IN ('done', 'cancelled')");
  if (status === "done") n.where.push("i.status = 'done'");
  if (f.list) n.where.push(`i.list_id = ${add(f.list)}`);
  if (f.tag)
    n.where.push(
      `EXISTS (SELECT 1 FROM item_tags x WHERE x.item_id = i.id AND x.tag_id = ${add(f.tag)})`,
    );
  if (f.assignee)
    n.where.push(
      `i.assignee_id = ${f.assignee === "me" ? "$1" : add(f.assignee)}`,
    );
  const rows = (
    await db.query<
      Item & {
        project_name: string | null;
        list_name: string | null;
        tags: ViewRow["tags"];
        role: TeamRole | null;
      }
    >(
      `SELECT ${ITEM_COLUMNS}, pr.name AS project_name, l.name AS list_name,
              coalesce((SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name,
                                                          'color', tg.color)
                                        ORDER BY lower(tg.name))
                          FROM item_tags it JOIN tags tg ON tg.id = it.tag_id
                         WHERE it.item_id = i.id), '[]'::json) AS tags,
              tm.role
         FROM ${ITEM_FROM}
         LEFT JOIN projects pr ON pr.id = i.project_id
         LEFT JOIN lists l ON l.id = i.list_id
         LEFT JOIN team_members tm ON tm.team_id = i.team_id AND tm.user_id = $1
        WHERE ((i.team_id IS NULL AND i.user_id = $1) OR tm.user_id IS NOT NULL)
          AND i.kind = 'task' AND i.parent_id IS NULL
          ${n.where.map((w) => `AND ${w}`).join(" ")}
        ORDER BY i.due_at NULLS LAST, i.updated_at DESC, i.id
        LIMIT ${CANDIDATES}`,
      [userId, ...n.values],
    )
  ).rows;
  return rows.map(({ project_name, list_name, tags, role, ...item }) => ({
    kind: "task" as const,
    id: item.id,
    title: item.title,
    team_id: item.team_id ?? null,
    team_name: item.team_name ?? null,
    project_id: item.project_id ?? null,
    project_name,
    status: item.status,
    due_at: iso(item.due_at),
    end_at: iso(item.end_at),
    all_day: !!item.all_day,
    timezone: item.timezone ?? null,
    priority: item.priority as Priority,
    estimate_minutes: item.estimate_minutes ?? null,
    spent_minutes: item.spent_minutes ?? 0,
    list_id: item.list_id ?? null,
    list_name,
    tag_ids: item.tag_ids ?? [],
    tags,
    assignee_id: item.assignee_id ?? null,
    assignee_name: item.assignee_name ?? null,
    folder_id: null,
    folder_name: null,
    doc_kind: null,
    preview: "",
    cover: null,
    task_count: null,
    done_count: null,
    created_at: iso(item.created_at) ?? "",
    updated_at: iso(item.updated_at) ?? "",
    fields: {},
    item: item as Item,
    version: item.version,
    can_write: writable(item.team_id ?? null, item.user_id ?? "", role, userId),
  }));
}

type PageRow = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  title: string;
  kind: DocKind;
  version: number;
  project_id: string | null;
  project_name: string | null;
  folder_id: string | null;
  folder_name: string | null;
  head: DocBlock[] | null;
  tags: ViewRow["tags"];
  created_at: Date;
  updated_at: Date;
  role: TeamRole | null;
};

async function pageRows(
  db: Queryable,
  userId: string,
  def: ViewDefinition,
  spaces?: ViewSpaces,
): Promise<ViewRow[]> {
  const n = narrow(def, "d", "d.project_id", spaces);
  const add = (v: unknown) => {
    n.values.push(v);
    return `$${n.values.length + 1}`;
  };
  const f = def.filters;
  if (f.folder) n.where.push(`d.folder_id = ${add(f.folder)}`);
  if (f.kind) n.where.push(`d.kind = ${add(f.kind)}`);
  if (f.tag)
    n.where.push(
      `EXISTS (SELECT 1 FROM doc_tags x WHERE x.doc_id = d.id AND x.tag_id = ${add(f.tag)})`,
    );
  const rows = (
    await db.query<PageRow>(
      `SELECT d.id, d.user_id, d.team_id, t.name AS team_name, d.title, d.kind,
              d.version, d.project_id, p.name AS project_name, d.folder_id, fo.name AS folder_name,
              jsonb_path_query_array(d.content, '$[0 to 11]') AS head,
              coalesce((SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name,
                                                          'color', tg.color)
                                        ORDER BY lower(tg.name))
                          FROM doc_tags dt JOIN tags tg ON tg.id = dt.tag_id
                         WHERE dt.doc_id = d.id), '[]'::json) AS tags,
              d.created_at, d.updated_at, tm.role
         FROM docs d
         LEFT JOIN teams t ON t.id = d.team_id
         LEFT JOIN projects p ON p.id = d.project_id
         LEFT JOIN folders fo ON fo.id = d.folder_id
         LEFT JOIN team_members tm ON tm.team_id = d.team_id AND tm.user_id = $1
        WHERE ${docVisibleTo("$1", "d")}
          ${n.where.map((w) => `AND ${w}`).join(" ")}
        ORDER BY d.updated_at DESC, d.id
        LIMIT ${CANDIDATES}`,
      [userId, ...n.values],
    )
  ).rows;
  const values = await fieldValuesFor(
    db,
    "page",
    rows.map((r) => r.id),
  );
  // Previews show only the links this reader may open (D3aF).
  const links = await linkPrivacy(
    db,
    userId,
    rows.map((r) => r.head),
  );
  return rows.map((d) => ({
    kind: "page" as const,
    id: d.id,
    title: d.title,
    team_id: d.team_id,
    team_name: d.team_name,
    project_id: d.project_id,
    project_name: d.project_name,
    status: null,
    due_at: null,
    priority: null,
    estimate_minutes: null,
    spent_minutes: null,
    list_id: null,
    list_name: null,
    tag_ids: d.tags.map((t) => t.id),
    tags: d.tags,
    assignee_id: null,
    assignee_name: null,
    folder_id: d.folder_id,
    folder_name: d.folder_name,
    doc_kind: d.kind,
    preview: docPreview(links.value(d.head ?? []), 160),
    cover: docCover((d.head ?? []) as { type: string; text?: string }[]),
    task_count: null,
    done_count: null,
    created_at: d.created_at.toISOString(),
    updated_at: d.updated_at.toISOString(),
    fields: values.get(d.id) ?? {},
    version: d.version,
    can_write: writable(d.team_id, d.user_id, d.role, userId),
  }));
}

type ProjectRow = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  name: string;
  summary: string;
  status: string;
  deadline: Date | null;
  task_count: number;
  done_count: number;
  created_at: Date;
  updated_at: Date;
  role: TeamRole | null;
};

async function projectRows(
  db: Queryable,
  userId: string,
  def: ViewDefinition,
  spaces?: ViewSpaces,
): Promise<ViewRow[]> {
  const n = narrow(def, "p", "p.id", spaces);
  const status = def.filters.status ?? "open";
  if (status === "open") n.where.push("p.status = 'active'");
  if (status === "done") n.where.push("p.status = 'done'");
  const rows = (
    await db.query<ProjectRow>(
      `SELECT p.id, p.user_id, p.team_id, t.name AS team_name, p.name, p.summary,
              p.status, p.deadline, ${PROJECT_COUNTS}, p.created_at, p.updated_at, tm.role
         FROM projects p
         LEFT JOIN teams t ON t.id = p.team_id
         LEFT JOIN team_members tm ON tm.team_id = p.team_id AND tm.user_id = $1
        WHERE ((p.team_id IS NULL AND p.user_id = $1) OR tm.user_id IS NOT NULL)
          ${n.where.map((w) => `AND ${w}`).join(" ")}
        ORDER BY p.updated_at DESC, p.id
        LIMIT ${CANDIDATES}`,
      [userId, ...n.values],
    )
  ).rows;
  const values = await fieldValuesFor(
    db,
    "project",
    rows.map((r) => r.id),
  );
  return rows.map((p) => ({
    kind: "project" as const,
    id: p.id,
    title: p.name,
    team_id: p.team_id,
    team_name: p.team_name,
    project_id: p.id,
    project_name: p.name,
    status: p.status,
    due_at: iso(p.deadline),
    priority: null,
    estimate_minutes: null,
    spent_minutes: null,
    list_id: null,
    list_name: null,
    tag_ids: [],
    tags: [],
    assignee_id: null,
    assignee_name: null,
    folder_id: null,
    folder_name: null,
    doc_kind: null,
    preview: p.summary.slice(0, 160),
    cover: null,
    task_count: p.task_count,
    done_count: p.done_count,
    created_at: p.created_at.toISOString(),
    updated_at: p.updated_at.toISOString(),
    fields: values.get(p.id) ?? {},
    version: null,
    can_write: writable(p.team_id, p.user_id, p.role, userId),
  }));
}

const LOADERS: Record<
  ViewSource,
  (
    db: Queryable,
    userId: string,
    def: ViewDefinition,
    spaces?: ViewSpaces,
  ) => Promise<ViewRow[]>
> = { tasks: taskRows, pages: pageRows, projects: projectRows };

/** The names of the people rows and Person fields name. */
async function peopleOf(
  db: Queryable,
  rows: ViewRow[],
  fields: CustomField[],
): Promise<{ id: string; name: string }[]> {
  const ids = new Set<string>();
  const personFields = fields.filter((f) => f.type === "person");
  for (const r of rows) {
    if (r.assignee_id) ids.add(r.assignee_id);
    for (const f of personFields) {
      const v = r.fields[f.id];
      if (typeof v === "string") ids.add(v);
    }
  }
  if (!ids.size) return [];
  return (
    await db.query<{ id: string; name: string }>(
      "SELECT id, name FROM users WHERE id = ANY ($1::uuid[]) ORDER BY lower(name)",
      [[...ids]],
    )
  ).rows;
}

/**
 * The rows `userId` sees in a view: filtered, ordered and cut at `limit`,
 * with the fields their columns can show and the people they name. An
 * agent's connection passes its `spaces` (A4's query and save_view), so a
 * connection limited to some teams never reads rows from the others.
 */
export async function runView(
  db: Queryable,
  userId: string,
  def: ViewDefinition,
  options: {
    limit?: number;
    now?: Date;
    timeZone?: string;
    spaces?: ViewSpaces;
  } = {},
): Promise<ViewResult> {
  const timeZone =
    options.timeZone ?? (await loadPrefs(db as unknown as Db, userId)).timezone;
  const fields =
    def.source === "tasks"
      ? []
      : await visibleFields(
          db,
          userId,
          def.source === "pages" ? "page" : "project",
        );
  const candidates = (
    await LOADERS[def.source](db, userId, def, options.spaces)
  ).filter((r) => !options.spaces || inSpaces(options.spaces, r.team_id));
  const { rows, truncated } = applyView(
    candidates,
    def,
    { userId, now: options.now ?? new Date(), timeZone },
    fields,
    Math.min(options.limit ?? VIEW_ROW_LIMIT, VIEW_ROW_LIMIT),
  );
  return {
    source: def.source,
    rows,
    truncated: truncated || candidates.length >= CANDIDATES,
    fields,
    people: await peopleOf(db, rows, fields),
    time_zone: timeZone,
  };
}

type ViewRowDb = Omit<SavedView, "created_at" | "updated_at" | "can_edit"> & {
  created_at: Date;
  updated_at: Date;
  role: TeamRole | null;
};

export const VIEW_SELECT = `SELECT v.id, v.user_id, v.team_id, t.name AS team_name,
    o.name AS owner_name, v.name, v.source, v.definition, v.created_at, v.updated_at,
    tm.role, EXISTS (SELECT 1 FROM saved_view_pins pn
                      WHERE pn.view_id = v.id AND pn.user_id = $1) AS pinned
  FROM saved_views v
  JOIN users o ON o.id = v.user_id
  LEFT JOIN teams t ON t.id = v.team_id
  LEFT JOIN team_members tm ON tm.team_id = v.team_id AND tm.user_id = $1`;

/** Views `$1` can see: their own, and those shared with their teams. */
export const VIEW_VISIBLE = `((v.team_id IS NULL AND v.user_id = $1) OR tm.user_id IS NOT NULL)`;

/**
 * Who may change a saved view: its maker (while they may still change the
 * team's things), and a team's owners and admins.
 */
export const canEditView = (
  row: Pick<ViewRowDb, "team_id" | "user_id" | "role">,
  userId: string,
) =>
  row.team_id
    ? (row.user_id === userId &&
        !!row.role &&
        hasTeamPermission(row.role, "items:write")) ||
      (!!row.role && hasTeamPermission(row.role, "team:update"))
    : row.user_id === userId;

/** A kept definition with today's defaults filled in. */
const readDefinition = (raw: unknown): ViewDefinition => {
  const parsed = viewDefinition.safeParse(raw);
  return parsed.success ? parsed.data : (raw as ViewDefinition);
};

export const toSavedView = (row: ViewRowDb, userId: string): SavedView => ({
  id: row.id,
  user_id: row.user_id,
  team_id: row.team_id,
  team_name: row.team_name ?? null,
  owner_name: row.owner_name ?? null,
  name: row.name,
  source: row.source,
  definition: readDefinition(row.definition),
  pinned: row.pinned,
  can_edit: canEditView(row, userId),
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});

/** A saved view `userId` can see (404 otherwise, as for one that never existed). */
export async function loadView(
  db: Queryable,
  userId: string,
  id: string,
): Promise<SavedView> {
  const row = (
    await db.query<ViewRowDb>(
      `${VIEW_SELECT} WHERE v.id = $2 AND ${VIEW_VISIBLE}`,
      [userId, id],
    )
  ).rows[0];
  if (!row) fail(404, "View not found");
  return toSavedView(row, userId);
}

/** Every saved view `userId` can see: your own first, then each team's, by name. */
export async function listViews(
  db: Queryable,
  userId: string,
): Promise<SavedView[]> {
  return (
    await db.query<ViewRowDb>(
      `${VIEW_SELECT} WHERE ${VIEW_VISIBLE}
        ORDER BY v.team_id NULLS FIRST, lower(v.name), v.id`,
      [userId],
    )
  ).rows.map((r) => toSavedView(r, userId));
}
