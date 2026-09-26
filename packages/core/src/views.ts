/**
 * Saved views (DATA-01): a named filter, sort, grouping and layout over
 * tasks, pages or projects, kept on the account and optionally shared with
 * a team. One definition serves the apps' Views screen, the live list block
 * in a page (SRCH-02) and the agents' query and save_view tools.
 *
 * This is the contract the views track (D4a, track/pages) defines, and the
 * parts of it the agents use: the same table (saved_views), the same JSON
 * definition and the same names, so a view an agent saves opens in the app
 * and the other way round. The views track's copy of this file adds the
 * rules for rows, groups and totals; when the tracks meet, keep that copy
 * (it is a superset of this one).
 *
 * The filter words are the agents' `query` words (text, status, project,
 * team, list, tag, assignee, due_after, due_before, overdue, folder, kind),
 * plus days relative to today and your own fields (ORG-02).
 */
import { z } from "zod";
import { DOC_KINDS } from "./docs.js";

/** How a task list can be grouped (the views track's task-groups.ts). */
const TASK_GROUPS = [
  "none",
  "status",
  "list",
  "tag",
  "size",
  "priority",
  "project",
  "due_week",
  "assignee",
] as const;

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
  ],
  pages: ["title", "kind", "folder", "project", "tags", "team", "updated"],
  projects: [
    "title",
    "status",
    "due",
    "progress",
    "team",
    "updated",
    "days_left",
    "overdue",
  ],
};

/** The ready-made computed columns (no formula language). */
export const COMPUTED_COLUMNS = [
  "days_left",
  "overdue",
  "spent_vs_estimate",
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

export const isEditableColumn = (source: ViewSource, column: string) =>
  EDITABLE_COLUMNS[source].includes(column) ||
  (source !== "tasks" && fieldKeyId(column) !== null);

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
