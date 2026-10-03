/**
 * Saved views (DATA-01): a named filter, sort, grouping and layout over
 * tasks, pages or projects, kept on the account and optionally shared with
 * a team. One definition serves the apps' Views screen, the live list block
 * in a page (SRCH-02) and the agents' query and save_view tools, and one set
 * of rules here decides which rows it shows, in what order, in which groups,
 * with which totals, so every place that shows a view shows the same rows.
 *
 * The filter words are the agents' `query` words (text, status, project,
 * team, list, tag, assignee, due_after, due_before, overdue, folder, kind),
 * plus days relative to today (so "Exam week" stays this week) and your own
 * fields (ORG-02). There is no formula language: the computed columns are
 * ready-made (Days left, Overdue, Spent vs estimate).
 */
import { z } from "zod";
import { DOC_KINDS, type DocKind } from "./docs.js";
import {
  fieldValueText,
  type CustomField,
  type FieldValue,
  type FieldValues,
} from "./fields.js";
import { PROJECT_STATUSES } from "./projects.js";
import { isClosed, STATUSES } from "./schemas.js";
import {
  durationText,
  groupTasks,
  TASK_GROUPS,
  type GroupNames,
} from "./task-groups.js";
import { allDayRange } from "./planner.js";
import { dueDayAt } from "./deadlines.js";
import { addDays, dayTime, localDateKey, zonedParts } from "./time.js";
import type { Item, Priority } from "./types.js";

export const VIEW_SOURCES = ["tasks", "pages", "projects"] as const;
export type ViewSource = (typeof VIEW_SOURCES)[number];

export const VIEW_SOURCE_LABELS: Record<ViewSource, string> = {
  tasks: "Tasks",
  pages: "Pages",
  projects: "Projects",
};

export const VIEW_LAYOUTS = [
  "list",
  "board",
  "table",
  "calendar",
  "gallery",
] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

export const VIEW_LAYOUT_LABELS: Record<ViewLayout, string> = {
  list: "List",
  board: "Board",
  table: "Table",
  calendar: "Calendar",
  gallery: "Gallery",
};

/** The layouts a source can be shown in: Gallery is for pages (DATA-05). */
export const layoutsFor = (source: ViewSource): ViewLayout[] =>
  source === "pages"
    ? [...VIEW_LAYOUTS]
    : VIEW_LAYOUTS.filter((l) => l !== "gallery");

/** The most saved views one person may keep (their own and their teams'). */
export const MAX_SAVED_VIEWS = 200;
/** The most rows a view returns; a view past it says it was cut short. */
export const VIEW_ROW_LIMIT = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_KEY = /^field:([0-9a-f-]{36})$/i;

/** "field:<id>" as the field's id, or null for anything else. */
export const fieldKeyId = (key: string): string | null => {
  const m = FIELD_KEY.exec(key);
  return m && UUID.test(m[1]) ? m[1].toLowerCase() : null;
};
export const fieldKey = (id: string) => `field:${id}`;

const fieldRef = z
  .string()
  .regex(FIELD_KEY, "Use field:<id>.")
  .transform((v) => v.toLowerCase());
const day = z.string().regex(DAY, "Use YYYY-MM-DD.");

export const FIELD_FILTER_OPS = [
  "is",
  "is_not",
  "empty",
  "not_empty",
  "before",
  "after",
  "contains",
] as const;
export type FieldFilterOp = (typeof FIELD_FILTER_OPS)[number];

export const FIELD_FILTER_LABELS: Record<FieldFilterOp, string> = {
  is: "is",
  is_not: "is not",
  empty: "is empty",
  not_empty: "is set",
  before: "is before",
  after: "is after",
  contains: "contains",
};

const fieldFilter = z
  .object({
    field: z.uuid(),
    op: z.enum(FIELD_FILTER_OPS),
    value: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
  })
  .strict();
export type FieldFilter = z.output<typeof fieldFilter>;

export const viewFilters = z
  .object({
    /** Words in the title (and a task's notes or a page's opening). */
    text: z.string().trim().min(1).max(200).optional(),
    /** Open (the default for tasks and projects), done, or any. */
    status: z.enum(["open", "done", "any"]).optional(),
    /** "personal" for your own things only, or a team's id. */
    team: z.union([z.literal("personal"), z.uuid()]).optional(),
    project: z.uuid().optional(),
    list: z.uuid().optional(),
    tag: z.uuid().optional(),
    /** "me" or a person's id (tasks). */
    assignee: z.union([z.literal("me"), z.uuid()]).optional(),
    due_after: day.optional(),
    due_before: day.optional(),
    /** Due from today through this many days ahead. */
    due_within_days: z.number().int().min(0).max(365).optional(),
    overdue: z.boolean().optional(),
    /** Only things without a deadline. */
    no_due: z.boolean().optional(),
    folder: z.uuid().optional(),
    kind: z.enum(DOC_KINDS).optional(),
    /** Changed in the last this-many days. */
    updated_within_days: z.number().int().min(1).max(365).optional(),
    fields: z.array(fieldFilter).max(10).optional(),
  })
  .strict();
export type ViewFilters = z.output<typeof viewFilters>;

export const VIEW_SORTS = [
  "due",
  "updated",
  "created",
  "priority",
  "title",
  "estimate",
  "days_left",
] as const;
export type ViewSortBy = (typeof VIEW_SORTS)[number] | `field:${string}`;

export const VIEW_SORT_LABELS: Record<(typeof VIEW_SORTS)[number], string> = {
  due: "Deadline",
  updated: "Last changed",
  created: "Newest",
  priority: "Priority",
  title: "Name",
  estimate: "Estimate",
  days_left: "Days left",
};

/** What each source can be grouped by. */
export const VIEW_GROUPS: Record<ViewSource, readonly string[]> = {
  tasks: TASK_GROUPS,
  pages: ["none", "kind", "folder", "project", "team", "tag"],
  projects: ["none", "status", "team"],
};

export const VIEW_GROUP_LABELS: Record<string, string> = {
  none: "No grouping",
  status: "Status",
  list: "List",
  tag: "Tag",
  size: "Size",
  priority: "Priority",
  project: "Project",
  due_week: "Due week",
  assignee: "Assignee",
  owner: "Who's on it",
  kind: "Kind",
  folder: "Folder",
  team: "Team",
};

/** Built-in columns, by source. Your own fields are `field:<id>`. */
export const VIEW_COLUMNS: Record<ViewSource, readonly string[]> = {
  tasks: [
    "done",
    "title",
    "status",
    "due",
    "estimate",
    "spent",
    "priority",
    "project",
    "list",
    "tags",
    "assignee",
    "team",
    "days_left",
    "overdue",
    "spent_vs_estimate",
    "subtasks_done",
    "last_touched",
  ],
  pages: [
    "title",
    "kind",
    "folder",
    "project",
    "tags",
    "team",
    "updated",
    "last_touched",
  ],
  projects: [
    "title",
    "status",
    "due",
    "progress",
    "team",
    "updated",
    "days_left",
    "overdue",
    "last_touched",
  ],
};

/**
 * The ready-made computed columns (DATA-06; no formula language): days
 * left, overdue, time spent against the estimate, how much of a task's
 * subtasks and checklist is done, and how long since it was last touched.
 */
export const COMPUTED_COLUMNS = [
  "days_left",
  "overdue",
  "spent_vs_estimate",
  "subtasks_done",
  "last_touched",
] as const;

export const COLUMN_LABELS: Record<string, string> = {
  done: "Done",
  title: "Name",
  status: "Status",
  due: "Due",
  estimate: "Estimate",
  spent: "Spent",
  priority: "Priority",
  project: "Project",
  list: "List",
  tags: "Tags",
  assignee: "Assignee",
  team: "Team",
  kind: "Kind",
  folder: "Folder",
  updated: "Last changed",
  progress: "Progress",
  days_left: "Days left",
  overdue: "Overdue",
  spent_vs_estimate: "Spent vs estimate",
  subtasks_done: "Subtasks done",
  last_touched: "Last touched",
};

/** The columns a new view starts with (the mockup's tick, Task, Due, Estimate, Spent, Tags). */
export const DEFAULT_COLUMNS: Record<ViewSource, string[]> = {
  tasks: ["done", "title", "due", "estimate", "spent", "tags"],
  pages: ["title", "kind", "folder", "tags", "updated"],
  projects: ["title", "status", "due", "progress", "days_left"],
};

/** Columns edited in place in the table (DATA-02); fields always are. */
export const EDITABLE_COLUMNS: Record<ViewSource, readonly string[]> = {
  tasks: ["done", "title", "status", "due", "estimate", "priority"],
  pages: ["title"],
  projects: ["title", "status", "due"],
};

/**
 * Whether a column is changed in place: for `row`, when given. A repeating
 * task's date is changed from the task, which asks which of its dates the
 * change is for; a view has no such question to ask.
 */
export const isEditableColumn = (
  source: ViewSource,
  column: string,
  row?: Pick<ViewRow, "kind" | "item">,
) =>
  (EDITABLE_COLUMNS[source].includes(column) ||
    (source !== "tasks" && fieldKeyId(column) !== null)) &&
  !(column === "due" && row && isRepeatingTask(row));

/** A repeating task's row. */
export const isRepeatingTask = (row: Pick<ViewRow, "kind" | "item">) =>
  row.kind === "task" && !!row.item?.rrule;

/** Why a view doesn't move a repeating task's date. */
export const REPEATING_DATE_NOTE = "Open a repeating task to change its date.";

const columnKey = z
  .string()
  .max(60)
  .refine(
    (c) =>
      fieldKeyId(c) !== null ||
      Object.values(VIEW_COLUMNS).some((cols) => cols.includes(c)),
    "Not a column.",
  );

export const viewDefinition = z
  .object({
    source: z.enum(VIEW_SOURCES),
    filters: viewFilters.default({}),
    sort: z
      .object({
        by: z.union([z.enum(VIEW_SORTS), fieldRef]).default("due"),
        dir: z.enum(["asc", "desc"]).default("asc"),
      })
      .strict()
      .default({ by: "due", dir: "asc" }),
    group_by: z
      .union([
        z.enum([
          ...new Set([
            ...VIEW_GROUPS.tasks,
            ...VIEW_GROUPS.pages,
            ...VIEW_GROUPS.projects,
          ]),
        ] as [string, ...string[]]),
        fieldRef,
      ])
      .default("none"),
    layout: z.enum(VIEW_LAYOUTS).default("table"),
    columns: z.array(columnKey).max(20).optional(),
    /** Which date a calendar puts things on: the deadline or a date field. */
    date_by: z.union([z.literal("due"), fieldRef]).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const group = v.group_by;
    if (fieldKeyId(group) === null && !VIEW_GROUPS[v.source].includes(group))
      ctx.addIssue({
        code: "custom",
        path: ["group_by"],
        message: `${VIEW_SOURCE_LABELS[v.source]} can't be grouped by ${group}.`,
      });
    if (!layoutsFor(v.source).includes(v.layout))
      ctx.addIssue({
        code: "custom",
        path: ["layout"],
        message: "Only pages can be shown as a gallery.",
      });
    if (v.source === "tasks" && fieldKeyId(group) !== null)
      ctx.addIssue({
        code: "custom",
        path: ["group_by"],
        message: "Tasks don't have your own fields.",
      });
    for (const c of v.columns ?? [])
      if (fieldKeyId(c) === null && !VIEW_COLUMNS[v.source].includes(c))
        ctx.addIssue({
          code: "custom",
          path: ["columns"],
          message: `${VIEW_SOURCE_LABELS[v.source]} have no ${c} column.`,
        });
  });
export type ViewDefinition = z.output<typeof viewDefinition>;
export type ViewDefinitionInput = z.input<typeof viewDefinition>;

export type SavedView = {
  id: string;
  user_id: string;
  /** The team it is shared with; null when it is only yours. */
  team_id: string | null;
  team_name?: string | null;
  owner_name?: string | null;
  name: string;
  source: ViewSource;
  definition: ViewDefinition;
  /** Pinned to your sidebar (each person pins their own). */
  pinned: boolean;
  /** Whether you may rename, change, share or delete it. */
  can_edit: boolean;
  created_at: string;
  updated_at: string;
};

/** Search the saved-view library without changing the selected view or its row filters. */
export function searchSavedViews(
  views: readonly SavedView[],
  query: string,
): SavedView[] {
  const normalize = (text: string) =>
    text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return views.filter((view) => {
    const text = normalize(
      [
        view.name,
        view.team_name ?? "",
        VIEW_SOURCE_LABELS[view.source],
        VIEW_LAYOUT_LABELS[view.definition.layout],
      ].join(" "),
    );
    return words.every((word) => text.includes(word));
  });
}

const viewName = z.string().trim().min(1).max(80);

export const savedViewInput = z
  .object({
    name: viewName,
    team_id: z.uuid().nullable().default(null),
    definition: viewDefinition,
  })
  .strict();
export type SavedViewInput = z.input<typeof savedViewInput>;

export const savedViewUpdate = z
  .object({
    name: viewName.optional(),
    team_id: z.uuid().nullable().optional(),
    definition: viewDefinition.optional(),
  })
  .strict();
export type SavedViewUpdate = z.input<typeof savedViewUpdate>;

export const viewPinInput = z.object({ pinned: z.boolean() }).strict();

/** Run a saved view by id, or a definition that isn't saved (a live list). */
export const viewRunInput = z.union([
  z
    .object({
      id: z.uuid(),
      limit: z.number().int().min(1).max(500).optional(),
    })
    .strict(),
  z
    .object({
      definition: viewDefinition,
      limit: z.number().int().min(1).max(500).optional(),
    })
    .strict(),
]);
export type ViewRunInput = z.input<typeof viewRunInput>;

/**
 * One row of a view, the same shape for tasks, pages and projects: what the
 * table, board, calendar and gallery draw. A task's row carries the task
 * itself, so ticking and editing go through the usual task changes.
 */
export type ViewRow = {
  kind: "task" | "page" | "project";
  id: string;
  title: string;
  team_id: string | null;
  team_name: string | null;
  project_id: string | null;
  project_name: string | null;
  /** A task's or project's status; null for a page. */
  status: string | null;
  /** A task's deadline (an instant) or a project's (a day); null otherwise. */
  due_at: string | null;
  /** A task's end time, when it runs over a span (it is due when it ends). */
  end_at?: string | null;
  /** A task due all day: due by the end of its day, not the midnight it starts. */
  all_day?: boolean;
  /** The zone an all-day task's date is kept in. */
  timezone?: string | null;
  priority: Priority | null;
  estimate_minutes: number | null;
  spent_minutes: number | null;
  list_id: string | null;
  list_name: string | null;
  tag_ids: string[];
  /** Its tags, named. */
  tags: { id: string; name: string; color: string }[];
  assignee_id: string | null;
  assignee_name: string | null;
  folder_id: string | null;
  folder_name: string | null;
  doc_kind: DocKind | null;
  /** A page's first lines, for the gallery. */
  preview: string;
  /** A page's first image, when it is one of Orbyn's own files. */
  cover: string | null;
  /** A project's tasks, and how many are finished. */
  task_count: number | null;
  done_count: number | null;
  created_at: string;
  updated_at: string;
  fields: FieldValues;
  /** The task itself, for a task's row. */
  item?: Item;
  /** Whether you may change it in place. */
  can_write: boolean;
  /** A page's version, to rename it in place; null for anything else. */
  version: number | null;
};

export type ViewResult = {
  source: ViewSource;
  rows: ViewRow[];
  /** More matched than a view shows (VIEW_ROW_LIMIT). */
  truncated: boolean;
  /** The fields its rows can have, for columns, filters and editing. */
  fields: CustomField[];
  /** The people named by Person fields and assignees. */
  people: { id: string; name: string }[];
  /**
   * The zone its days were read in (the account's time zone): the apps draw
   * and edit in it too, so "due today" means the same day everywhere.
   */
  time_zone?: string;
  /** The saved view, when one was run. */
  view?: SavedView;
};

/** What rows are compared against: who is looking, and when and where. */
export type ViewContext = {
  userId: string;
  now: Date;
  timeZone: string;
};

/**
 * What a row's deadline is worked out from. A task's row carries its times
 * (or the task itself), so a view reads "due" and "overdue" by the same rule
 * as the task list (`deadlineOf`, `dueDayAt`, `dueBeforeToday`): an all-day
 * task is due by the end of its day, one with an end time when it ends.
 */
export type DueRow = Pick<ViewRow, "due_at"> &
  Partial<Pick<ViewRow, "kind" | "end_at" | "all_day" | "timezone" | "item">>;

/** The day a row is due by, in the viewer's zone ("YYYY-MM-DD"), or null. */
export function dueDay(row: DueRow, timeZone: string): string | null {
  if (!row.due_at) return null;
  if (DAY.test(row.due_at)) return row.due_at;
  if (Number.isNaN(new Date(row.due_at).getTime())) return null;
  const at =
    row.kind === "task" || row.item
      ? dueDayAt({
          due_at: row.due_at,
          end_at: row.end_at ?? row.item?.end_at ?? null,
          all_day: row.all_day ?? row.item?.all_day ?? false,
          timezone: row.timezone ?? row.item?.timezone ?? null,
        })
      : new Date(row.due_at);
  return at ? localDateKey(at, timeZone) : null;
}

const isOpen = (row: Pick<ViewRow, "kind" | "status">) =>
  row.kind === "task"
    ? !isClosed(row.status ?? "todo")
    : row.kind === "project"
      ? row.status === "active"
      : true;

/** Days until the day a row is due by (0 today, negative once past), or null. */
export function daysLeft(
  row: DueRow,
  ctx: Pick<ViewContext, "now" | "timeZone">,
): number | null {
  const due = dueDay(row, ctx.timeZone);
  if (!due) return null;
  const today = localDateKey(ctx.now, ctx.timeZone);
  return Math.round(
    (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
}

/**
 * An open row whose deadline fell on a day before today, as on task lists
 * (`dueBeforeToday`): a task due earlier today isn't overdue yet, and an
 * all-day task becomes overdue the day after its date.
 */
export function isOverdue(
  row: DueRow & Pick<ViewRow, "kind" | "status">,
  ctx: Pick<ViewContext, "now" | "timeZone">,
): boolean {
  if (!row.due_at || !isOpen(row)) return false;
  const left = daysLeft(row, ctx);
  return left !== null && left < 0;
}

const lower = (s: string) => s.toLocaleLowerCase();

function matchesField(
  f: FieldFilter,
  value: FieldValue | undefined,
  field: CustomField | undefined,
): boolean {
  const empty = value === null || value === undefined || value === "";
  if (f.op === "empty") return empty;
  if (f.op === "not_empty") return !empty;
  if (empty) return f.op === "is_not";
  const want = f.value;
  if (want === undefined) return true;
  switch (f.op) {
    case "is":
    case "is_not": {
      const same =
        typeof value === "string" && typeof want === "string"
          ? lower(value) === lower(want)
          : field?.type === "number"
            ? Number(value) === Number(want)
            : value === want;
      return f.op === "is" ? same : !same;
    }
    case "contains":
      return lower(String(value)).includes(lower(String(want)));
    case "before":
    case "after": {
      if (typeof value === "number" || field?.type === "number") {
        const a = Number(value);
        const b = Number(want);
        return f.op === "before" ? a < b : a > b;
      }
      return f.op === "before"
        ? String(value) < String(want)
        : String(value) > String(want);
    }
  }
  return true;
}

/** Whether a row belongs in a view. */
export function matchesView(
  row: ViewRow,
  def: Pick<ViewDefinition, "filters" | "source">,
  ctx: ViewContext,
  fields: CustomField[] = [],
): boolean {
  const f = def.filters;
  const status = f.status ?? (def.source === "pages" ? "any" : "open");
  if (status === "open" && !isOpen(row)) return false;
  if (status === "done" && row.kind !== "page") {
    const done = row.status === "done";
    if (!done) return false;
  }
  if (f.text) {
    const words = lower(f.text).split(/\s+/).filter(Boolean);
    const hay = lower(`${row.title} ${row.preview} ${row.item?.notes ?? ""}`);
    if (!words.every((w) => hay.includes(w))) return false;
  }
  if (f.team === "personal" && row.team_id) return false;
  if (f.team && f.team !== "personal" && row.team_id !== f.team) return false;
  if (f.project) {
    const project = row.kind === "project" ? row.id : row.project_id;
    if (project !== f.project) return false;
  }
  if (f.list && row.list_id !== f.list) return false;
  if (f.tag && !row.tag_ids.includes(f.tag)) return false;
  if (f.assignee) {
    const who = f.assignee === "me" ? ctx.userId : f.assignee;
    if (row.assignee_id !== who) return false;
  }
  if (f.folder && row.folder_id !== f.folder) return false;
  if (f.kind && row.doc_kind !== f.kind) return false;
  const due = dueDay(row, ctx.timeZone);
  if (f.no_due && due) return false;
  if (f.due_after && (!due || due < f.due_after)) return false;
  if (f.due_before && (!due || due > f.due_before)) return false;
  if (f.due_within_days !== undefined) {
    const today = localDateKey(ctx.now, ctx.timeZone);
    if (!due || due < today || due > addDays(today, f.due_within_days))
      return false;
  }
  if (f.overdue && !isOverdue(row, ctx)) return false;
  if (f.updated_within_days !== undefined) {
    const since = ctx.now.getTime() - f.updated_within_days * 86_400_000;
    if (new Date(row.updated_at).getTime() < since) return false;
  }
  for (const ff of f.fields ?? []) {
    const field = fields.find((x) => x.id === ff.field);
    if (!matchesField(ff, row.fields[ff.field], field)) return false;
  }
  return true;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

const compareValues = (a: unknown, b: unknown): number => {
  const none = (v: unknown) => v === null || v === undefined || v === "";
  if (none(a) && none(b)) return 0;
  // Things without a value sit last whichever way the view is sorted.
  if (none(a)) return Number.POSITIVE_INFINITY;
  if (none(b)) return Number.NEGATIVE_INFINITY;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean")
    return Number(b) - Number(a);
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

/** A row's value for sorting by `by`. */
function sortValue(row: ViewRow, by: ViewSortBy, ctx: ViewContext): unknown {
  const field = fieldKeyId(by);
  if (field) return row.fields[field] ?? null;
  switch (by) {
    case "due":
      return row.due_at
        ? DAY.test(row.due_at)
          ? Date.parse(`${row.due_at}T23:59:59Z`)
          : Date.parse(row.due_at)
        : null;
    case "updated":
      return Date.parse(row.updated_at);
    case "created":
      return Date.parse(row.created_at);
    case "priority":
      return row.priority ? PRIORITY_RANK[row.priority] : null;
    case "title":
      return row.title;
    case "estimate":
      return row.estimate_minutes;
    case "days_left":
      return daysLeft(row, ctx);
    default:
      return null;
  }
}

/** Rows in a view's order; ties keep a stable order by name, then id. */
export function sortRows(
  rows: ViewRow[],
  def: Pick<ViewDefinition, "sort">,
  ctx: ViewContext,
): ViewRow[] {
  const { by, dir } = def.sort;
  // Newest first reads naturally for "Last changed" and "Newest".
  const flip =
    (by === "updated" || by === "created" ? -1 : 1) * (dir === "desc" ? -1 : 1);
  return rows
    .map((row) => ({ row, v: sortValue(row, by as ViewSortBy, ctx) }))
    .sort((a, b) => {
      const c = compareValues(a.v, b.v);
      if (c === Number.POSITIVE_INFINITY || c === Number.NEGATIVE_INFINITY)
        return c > 0 ? 1 : -1;
      return (
        c * flip ||
        a.row.title.localeCompare(b.row.title) ||
        a.row.id.localeCompare(b.row.id)
      );
    })
    .map((x) => x.row);
}

/** Filter and order rows as a view does, keeping at most `limit`. */
export function applyView(
  rows: ViewRow[],
  def: ViewDefinition,
  ctx: ViewContext,
  fields: CustomField[] = [],
  limit = VIEW_ROW_LIMIT,
): { rows: ViewRow[]; truncated: boolean } {
  const kept = sortRows(
    rows.filter((r) => matchesView(r, def, ctx, fields)),
    def,
    ctx,
  );
  return { rows: kept.slice(0, limit), truncated: kept.length > limit };
}

export type ViewGroup = {
  key: string;
  title: string;
  color?: string;
  rows: ViewRow[];
  /** Estimated minutes of the open tasks in it. */
  minutes: number;
};

/** What pages' and projects' groups are named from. */
export type ViewNames = GroupNames & {
  folders?: { id: string; name: string }[];
  teams?: { id: string; name: string }[];
  fields?: CustomField[];
  people?: { id: string; name: string }[];
};

const KIND_TITLES: Record<DocKind, string> = {
  doc: "Pages",
  note: "Notes",
  agenda: "Agendas",
  meeting: "Meeting notes",
  memory: "Memory",
  agent: "Agent notes",
};
const PROJECT_STATUS_TITLES: Record<string, string> = {
  active: "Active",
  done: "Finished",
  archived: "Archived",
};

const rowMinutes = (rows: ViewRow[]) =>
  rows.reduce(
    (sum, r) =>
      sum +
      (r.kind === "task" && !isClosed(r.status ?? "todo")
        ? Math.max(0, r.estimate_minutes ?? 0)
        : 0),
    0,
  );

/**
 * A view's rows in titled groups ("Physics · 5 · 3 h 20 min"), in order,
 * empty groups left out. Tasks group as the task list and board do.
 */
export function groupRows(
  rows: ViewRow[],
  def: Pick<ViewDefinition, "group_by" | "source">,
  names: ViewNames = {},
): ViewGroup[] {
  const by = def.group_by;
  if (by === "none")
    return [{ key: "all", title: "", rows, minutes: rowMinutes(rows) }];
  if (
    def.source === "tasks" &&
    (TASK_GROUPS as readonly string[]).includes(by)
  ) {
    const byItem = new Map(rows.map((r) => [r.id, r]));
    const items = rows.flatMap((r) => (r.item ? [r.item] : []));
    return groupTasks(items, by as (typeof TASK_GROUPS)[number], names).map(
      (g) => ({
        key: g.key,
        title: g.title,
        ...(g.color ? { color: g.color } : {}),
        rows: g.items.flatMap((i) => byItem.get(i.id) ?? []),
        minutes: g.minutes,
      }),
    );
  }
  const fieldId = fieldKeyId(by);
  const field = fieldId
    ? names.fields?.find((f) => f.id === fieldId)
    : undefined;
  const groups = new Map<string, ViewGroup>();
  const put = (key: string, title: string, row: ViewRow, color?: string) => {
    const g = groups.get(key) ?? {
      key,
      title,
      ...(color ? { color } : {}),
      rows: [],
      minutes: 0,
    };
    g.rows.push(row);
    groups.set(key, g);
  };
  for (const row of rows) {
    if (fieldId) {
      const value = row.fields[fieldId];
      if (value === null || value === undefined || value === "")
        put("~none", `No ${field?.name ?? "value"}`, row);
      else
        put(
          `v:${String(value)}`,
          field ? fieldValueText(field, value, names.people) : String(value),
          row,
        );
      continue;
    }
    switch (by) {
      case "kind":
        put(row.doc_kind ?? "doc", KIND_TITLES[row.doc_kind ?? "doc"], row);
        break;
      case "folder":
        if (row.folder_id)
          put(row.folder_id, row.folder_name ?? "A folder", row);
        else put("~none", "No folder", row);
        break;
      case "project":
        if (row.project_id)
          put(row.project_id, row.project_name ?? "A project", row);
        else put("~none", "No project", row);
        break;
      case "team":
        if (row.team_id) put(row.team_id, row.team_name ?? "A team", row);
        else put("~none", "Only you", row);
        break;
      case "tag":
        if (!row.tags.length) put("~none", "No tag", row);
        for (const t of row.tags) put(t.id, t.name, row, t.color);
        break;
      case "status":
        put(
          row.status ?? "~none",
          PROJECT_STATUS_TITLES[row.status ?? ""] ?? "No status",
          row,
        );
        break;
      default:
        put("all", "", row);
    }
  }
  const list = [...groups.values()];
  for (const g of list) g.minutes = rowMinutes(g.rows);
  const order =
    by === "status"
      ? (PROJECT_STATUSES as readonly string[])
      : by === "kind"
        ? (DOC_KINDS as readonly string[])
        : field?.type === "select"
          ? field.options.map((o) => `v:${o}`)
          : null;
  return list.sort(
    (a, b) =>
      Number(a.key === "~none") - Number(b.key === "~none") ||
      (order ? order.indexOf(a.key) - order.indexOf(b.key) : 0) ||
      (field?.type === "date" || field?.type === "number"
        ? compareValues(a.key.slice(2), b.key.slice(2))
        : a.title.localeCompare(b.title)),
  );
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The line under a table or group: "14 tasks · 11 h estimated · 3 overdue",
 * "8 pages", "5 projects · 1 overdue".
 */
export function viewTotals(
  rows: ViewRow[],
  source: ViewSource,
  ctx: Pick<ViewContext, "now" | "timeZone">,
): string {
  if (source === "pages") return plural(rows.length, "page");
  const overdue = rows.filter((r) => isOverdue(r, ctx)).length;
  const parts = [plural(rows.length, source === "tasks" ? "task" : "project")];
  if (source === "tasks") {
    const minutes = rowMinutes(rows);
    if (minutes > 0) parts.push(`${durationText(minutes)} estimated`);
  }
  if (overdue) parts.push(`${overdue} overdue`);
  return parts.join(" · ");
}

/**
 * A column's summary for a group or the whole table: time added up, how
 * many are done or ticked, a number field's total. Empty when a column has
 * nothing worth adding up.
 */
export function columnTotal(
  rows: ViewRow[],
  column: string,
  fields: CustomField[] = [],
  ctx?: Pick<ViewContext, "now" | "timeZone">,
): string {
  const fieldId = fieldKeyId(column);
  if (fieldId) {
    const field = fields.find((f) => f.id === fieldId);
    if (field?.type === "number") {
      const values = rows
        .map((r) => r.fields[fieldId])
        .filter((v): v is number => typeof v === "number");
      if (!values.length) return "";
      const sum = values.reduce((a, b) => a + b, 0);
      return `Sum ${Math.round(sum * 1000) / 1000}`;
    }
    if (field?.type === "checkbox") {
      const ticked = rows.filter((r) => r.fields[fieldId] === true).length;
      return `${ticked} of ${rows.length}`;
    }
    return "";
  }
  switch (column) {
    case "done": {
      const done = rows.filter((r) => r.status === "done").length;
      return `${done} of ${rows.length} done`;
    }
    case "estimate": {
      const m = rows.reduce((s, r) => s + (r.estimate_minutes ?? 0), 0);
      return m ? durationText(m) : "";
    }
    case "spent": {
      const m = rows.reduce((s, r) => s + (r.spent_minutes ?? 0), 0);
      return m ? durationText(m) : "";
    }
    case "overdue": {
      if (!ctx) return "";
      const n = rows.filter((r) => isOverdue(r, ctx)).length;
      return n ? `${n} overdue` : "";
    }
    case "progress": {
      const tasks = rows.reduce((s, r) => s + (r.task_count ?? 0), 0);
      const done = rows.reduce((s, r) => s + (r.done_count ?? 0), 0);
      return tasks ? `${done} of ${tasks} tasks` : "";
    }
    default:
      return "";
  }
}

const STATUS_TEXT: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
  active: "Active",
  archived: "Archived",
};
export const statusText = (status: string | null) =>
  status ? (STATUS_TEXT[status] ?? status) : "";

/** The statuses a row's status can be changed to in place. */
export const statusChoices = (kind: ViewRow["kind"]): string[] =>
  kind === "project" ? [...PROJECT_STATUSES] : [...STATUSES];

/** "2 days left", "Due today", "3 days late". */
export function daysLeftText(n: number | null): string {
  if (n === null) return "";
  if (n === 0) return "Due today";
  if (n === 1) return "1 day left";
  if (n > 1) return `${n} days left`;
  return n === -1 ? "1 day late" : `${-n} days late`;
}

/** "1 h 10 min of 2 h", or "40 min spent" without an estimate. */
export function spentVsEstimateText(
  row: Pick<ViewRow, "spent_minutes" | "estimate_minutes">,
): string {
  const spent = row.spent_minutes ?? 0;
  if (row.estimate_minutes)
    return `${durationText(spent)} of ${durationText(row.estimate_minutes)}`;
  return spent ? `${durationText(spent)} spent` : "";
}

/** What names a view's cells: your lists and tags, fields, people. */
export type CellNames = {
  lists?: { id: string; name: string }[];
  tags?: { id: string; name: string }[];
  fields?: CustomField[];
  people?: { id: string; name: string }[];
};

const dueText = (row: ViewRow, timeZone: string) => {
  const day = dueDay(row, timeZone);
  if (!day) return "";
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

/** A cell as words: what a table shows and a CSV file keeps. */
export function cellText(
  row: ViewRow,
  column: string,
  ctx: Pick<ViewContext, "now" | "timeZone">,
  names: CellNames = {},
): string {
  const fieldId = fieldKeyId(column);
  if (fieldId) {
    const field = names.fields?.find((f) => f.id === fieldId);
    return field
      ? fieldValueText(field, row.fields[fieldId], names.people)
      : "";
  }
  switch (column) {
    case "done":
      return row.status === "done" ? "Yes" : "No";
    case "title":
      return row.title;
    case "status":
      return statusText(row.status);
    case "due":
      return dueText(row, ctx.timeZone);
    case "estimate":
      return row.estimate_minutes ? durationText(row.estimate_minutes) : "";
    case "spent":
      return row.spent_minutes ? durationText(row.spent_minutes) : "";
    case "priority":
      return row.priority
        ? row.priority[0].toUpperCase() + row.priority.slice(1)
        : "";
    case "project":
      return row.project_name ?? "";
    case "list":
      return (
        row.list_name ??
        ((row.list_id &&
          names.lists?.find((l) => l.id === row.list_id)?.name) ||
          "")
      );
    case "tags":
      return (
        row.tags.length
          ? row.tags.map((t) => t.name)
          : row.tag_ids.flatMap(
              (id) => names.tags?.find((t) => t.id === id)?.name ?? [],
            )
      ).join(", ");
    case "assignee":
      return row.assignee_name ?? "";
    case "team":
      return row.team_name ?? "";
    case "kind":
      return row.doc_kind ? KIND_TITLES[row.doc_kind].replace(/s$/, "") : "";
    case "folder":
      return row.folder_name ?? "";
    case "updated":
      return new Date(row.updated_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: ctx.timeZone,
      });
    case "progress":
      return row.task_count
        ? `${row.done_count ?? 0} of ${row.task_count}`
        : "";
    case "days_left":
      return isOpen(row) ? daysLeftText(daysLeft(row, ctx)) : "";
    case "overdue":
      return isOverdue(row, ctx) ? "Overdue" : "";
    case "spent_vs_estimate":
      return spentVsEstimateText(row);
    case "subtasks_done":
      return subtasksDoneText(row);
    case "last_touched":
      return lastTouchedText(row.updated_at, ctx.now);
    default:
      return "";
  }
}

/**
 * How much of a task's subtasks and checklist is done ("3 of 4 · 75%"), or
 * "" for a task with neither.
 */
export function subtasksDone(
  row: Pick<ViewRow, "item">,
): { done: number; total: number } | null {
  const i = row.item;
  if (!i) return null;
  const total = (i.child_count ?? 0) + (i.steps_total ?? 0);
  if (!total) return null;
  return { done: (i.children_done ?? 0) + (i.steps_done ?? 0), total };
}

export function subtasksDoneText(row: Pick<ViewRow, "item">): string {
  const s = subtasksDone(row);
  if (!s) return "";
  return `${s.done} of ${s.total} · ${Math.round((s.done / s.total) * 100)}%`;
}

/** "Today", "Yesterday", "3 days ago", "5 weeks ago", "4 months ago". */
export function lastTouchedText(updatedAt: string, now: Date): string {
  const at = Date.parse(updatedAt);
  if (Number.isNaN(at)) return "";
  const days = Math.floor((now.getTime() - at) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/** A column's heading. */
export function columnLabel(column: string, fields: CustomField[] = []) {
  const id = fieldKeyId(column);
  if (id) return fields.find((f) => f.id === id)?.name ?? "Field";
  return COLUMN_LABELS[column] ?? column;
}

/** The columns a view shows: its own, or the source's defaults. */
export const viewColumns = (def: Pick<ViewDefinition, "columns" | "source">) =>
  def.columns?.length ? def.columns : DEFAULT_COLUMNS[def.source];

/**
 * A cell safe for a spreadsheet: quoted when it must be, and text that
 * would start a formula (=, +, -, @) kept as text.
 */
function csvCell(value: string, sep: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return v.includes('"') || v.includes(sep) || /[\r\n]/.test(v)
    ? `"${v.replace(/"/g, '""')}"`
    : v;
}

/**
 * A view as a table of text: CSV for a file (DATA-01), or tab-separated to
 * paste into a spreadsheet. The first line holds the column headings.
 */
export function viewTable(
  rows: ViewRow[],
  columns: string[],
  ctx: Pick<ViewContext, "now" | "timeZone">,
  names: CellNames = {},
  sep: "," | "\t" = ",",
): string {
  const cols = columns.filter((c) => c !== "done" || sep === ",");
  const lines = [
    cols.map((c) => csvCell(columnLabel(c, names.fields), sep)).join(sep),
    ...rows.map((r) =>
      cols.map((c) => csvCell(cellText(r, c, ctx, names), sep)).join(sep),
    ),
  ];
  return lines.join("\r\n") + "\r\n";
}

/** A file name for a view's CSV: "Exam week.csv". */
export const viewFileName = (name: string) =>
  `${
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "View"
  }.csv`;

/** The day a row sits on in a view's calendar: its deadline or a date field. */
export function calendarDay(
  row: ViewRow,
  def: Pick<ViewDefinition, "date_by">,
  timeZone: string,
): string | null {
  const field = def.date_by ? fieldKeyId(def.date_by) : null;
  if (field) {
    const v = row.fields[field];
    return typeof v === "string" && DAY.test(v) ? v : null;
  }
  return dueDay(row, timeZone);
}

const IMAGE = /!\[[^\]]*\]\(([^\s)]+)\)/;

/**
 * Where Orbyn's own file store serves files: the only images a gallery card
 * may show. EDT-01's page images are kept under it too.
 */
export const OWN_FILES_PREFIX = "/files/";

/**
 * An image address as a path in Orbyn's own file store, or null when it
 * could reach anywhere else. It is read the way a browser reads it (so
 * "/\\host/x.png", which browsers treat as "//host/x.png", is refused), and
 * it must stay on this site and under {@link OWN_FILES_PREFIX}.
 */
export function ownFilePath(address: string): string | null {
  if (!address.startsWith("/") || /[\\\u0000-\u001f]/.test(address))
    return null;
  const base = "https://orbyn.invalid";
  let url: URL;
  try {
    url = new URL(address, base);
  } catch {
    return null;
  }
  if (url.origin !== base || !url.pathname.startsWith(OWN_FILES_PREFIX))
    return null;
  return url.pathname + url.search;
}

/**
 * A page's cover for the gallery: its first image, only when it is one of
 * Orbyn's own files (`ownFilePath`), so a gallery never fetches anything
 * from elsewhere. Null otherwise: the card stays plain.
 */
export function docCover(
  blocks: { type: string; text?: string }[],
): string | null {
  for (const b of blocks) {
    const m = typeof b.text === "string" ? IMAGE.exec(b.text) : null;
    if (!m) continue;
    const own = ownFilePath(m[1]);
    if (own) return own;
  }
  return null;
}

/** Ready-made starting points for a new view. */
export const VIEW_PRESETS: {
  name: string;
  blurb: string;
  definition: ViewDefinitionInput;
}[] = [
  {
    name: "Due this week",
    blurb: "Open tasks due in the next 7 days, by project.",
    definition: {
      source: "tasks",
      filters: { due_within_days: 7 },
      group_by: "project",
      layout: "table",
    },
  },
  {
    name: "Overdue",
    blurb: "Open tasks past their deadline, oldest first.",
    definition: {
      source: "tasks",
      filters: { overdue: true },
      group_by: "status",
      layout: "list",
    },
  },
  {
    name: "Pages this month",
    blurb: "Pages changed in the last 30 days, as cards.",
    definition: {
      source: "pages",
      filters: { updated_within_days: 30 },
      sort: { by: "updated", dir: "asc" },
      layout: "gallery",
    },
  },
  {
    name: "Projects by deadline",
    blurb: "Active projects with days left.",
    definition: {
      source: "projects",
      filters: {},
      layout: "table",
    },
  },
];

/** A definition with every default filled in (for a new or loaded view). */
export const fullDefinition = (def: ViewDefinitionInput): ViewDefinition =>
  viewDefinition.parse(def);

/**
 * The words a live list block in a page keeps: a saved view's id, or a
 * definition of its own. Stored as a code block with this language, so the
 * page stays plain Markdown and every exporter keeps it.
 */

export type LiveListSpec =
  | { id: string; limit: number }
  | { definition: ViewDefinition; limit: number; title?: string };

/** The rows a live list shows before "Open as a view". */
export const LIVE_LIST_ROWS = 10;

/** A live list block's text, read; null when it can't be read. */
export function parseLiveList(text: string): LiveListSpec | null {
  const t = text.trim();
  const byId = /^view:\s*([0-9a-f-]{36})$/i.exec(t);
  if (byId && UUID.test(byId[1]))
    return { id: byId[1].toLowerCase(), limit: LIVE_LIST_ROWS };
  try {
    const raw = JSON.parse(t) as { title?: unknown; limit?: unknown };
    const { title, limit, ...rest } = raw as Record<string, unknown>;
    const def = viewDefinition.safeParse(rest);
    if (!def.success) return null;
    return {
      definition: def.data,
      limit:
        typeof limit === "number" && limit >= 1 && limit <= 50
          ? Math.round(limit)
          : LIVE_LIST_ROWS,
      ...(typeof title === "string" && title.trim()
        ? { title: title.trim().slice(0, 80) }
        : {}),
    };
  } catch {
    return null;
  }
}

/** A live list block's text for a saved view, or a definition of its own. */
export function liveListText(
  spec: { id: string } | { definition: ViewDefinitionInput; title?: string },
): string {
  if ("id" in spec) return `view:${spec.id}`;
  const def = fullDefinition(spec.definition);
  // Only what differs from the defaults is written, so it reads easily.
  const out: Record<string, unknown> = { source: def.source };
  if (spec.title) out.title = spec.title;
  if (Object.keys(def.filters).length) out.filters = def.filters;
  if (def.sort.by !== "due" || def.sort.dir !== "asc") out.sort = def.sort;
  if (def.group_by !== "none") out.group_by = def.group_by;
  return JSON.stringify(out);
}

/**
 * A task's new deadline from a day picked in a table or calendar: a task
 * with a time keeps its time on the new day; otherwise it is due all that
 * day. No day clears the deadline. Only the deadline changes, never its
 * sessions.
 */
export function taskDueChange(
  item: Pick<Item, "due_at" | "end_at" | "all_day">,
  day: string | null,
  timeZone: string,
): Pick<Item, "due_at" | "end_at" | "all_day"> & { timezone?: string } {
  if (!day) return { due_at: null, end_at: null, all_day: false };
  if (item.due_at && !item.all_day && !item.end_at) {
    const p = zonedParts(new Date(item.due_at), timeZone);
    return {
      due_at: dayTime(day, p.hour * 60 + p.minute, timeZone).toISOString(),
      end_at: null,
      all_day: false,
    };
  }
  return {
    ...allDayRange(day, day, timeZone),
    all_day: true,
    timezone: timeZone,
  };
}

/**
 * A task's date change from a view (a table cell, a calendar drop), or why
 * not: a repeating task isn't moved, since moving its date without asking
 * "this one or all" would start the whole series again from the new day.
 */
export function viewDueChange(
  item: Pick<Item, "due_at" | "end_at" | "all_day" | "rrule">,
  day: string | null,
  timeZone: string,
):
  | { ok: true; change: ReturnType<typeof taskDueChange> }
  | { ok: false; reason: string } {
  if (item.rrule) return { ok: false, reason: REPEATING_DATE_NOTE };
  return { ok: true, change: taskDueChange(item, day, timeZone) };
}

/**
 * Minutes from what someone typed for an estimate: "90", "45m", "2h",
 * "1h 30", "1:30", "1.5h". Null for nothing or nonsense.
 */
export function parseMinutes(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+):(\d{1,2})$/.exec(t)))
    return Number(m[1]) * 60 + Number(m[2]);
  if (
    (m =
      /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\s*(?:(\d+)\s*(?:m|min|mins|minutes?)?)?$/.exec(
        t,
      ))
  )
    return Math.round(Number(m[1]) * 60 + Number(m[2] ?? 0));
  if ((m = /^(\d+)\s*(?:m|min|mins|minutes?)?$/.exec(t))) return Number(m[1]);
  return null;
}
