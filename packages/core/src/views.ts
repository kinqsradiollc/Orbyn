import { z } from "zod";

/**
 * Saved views: a named filter, sort, grouping and layout over tasks,
 * events, pages, projects or work records, like an Obsidian Base. One
 * definition serves the app's views screen, the agents' `query` (which runs
 * a saved view or an ad-hoc one) and `save_view`, so a view an agent saves
 * opens the same in the app, and the other way round.
 *
 * Dates in a view can be relative ("today", "+7d", "-1d"), so "Due this
 * week" stays this week. They are read in the person's time zone.
 */

/** What a view lists. */
export const VIEW_SOURCES = [
  "tasks",
  "events",
  "docs",
  "projects",
  "records",
] as const;
export type ViewSource = (typeof VIEW_SOURCES)[number];

/** How a view is laid out. */
export const VIEW_LAYOUTS = ["table", "list", "board", "calendar"] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

export const VIEW_SORTS = [
  "due",
  "updated",
  "created",
  "priority",
  "title",
] as const;
export type ViewSort = (typeof VIEW_SORTS)[number];

/** What a board or grouped table groups rows by. */
export const VIEW_GROUPS = [
  "status",
  "priority",
  "project",
  "stage",
  "assignee",
  "team",
  "kind",
  "due",
] as const;
export type ViewGroup = (typeof VIEW_GROUPS)[number];

/** Columns a table can show (title is always first). */
export const VIEW_COLUMNS = [
  "status",
  "due",
  "priority",
  "project",
  "assignee",
  "team",
  "updated",
  "provenance",
] as const;
export type ViewColumn = (typeof VIEW_COLUMNS)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RELATIVE = /^(today|tomorrow|yesterday|[+-]\d{1,3}d)$/;

/** A date in a filter: YYYY-MM-DD, an ISO instant, or relative to today. */
export const viewDate = z
  .string()
  .trim()
  .max(40)
  .refine(
    (v) => DAY.test(v) || RELATIVE.test(v) || !Number.isNaN(Date.parse(v)),
    {
      message:
        'Use YYYY-MM-DD, an ISO 8601 instant, or "today", "tomorrow", "yesterday", "+7d", "-3d".',
    },
  );

/** Whether a filter date is relative to today (and so moves with it). */
export const isRelativeDate = (v: string) => RELATIVE.test(v);

/**
 * The day a relative date names, as YYYY-MM-DD, given today's date in the
 * person's time zone. Other values come back unchanged.
 */
export function resolveViewDate(v: string, today: string): string {
  if (!RELATIVE.test(v)) return v;
  const shift =
    v === "today"
      ? 0
      : v === "tomorrow"
        ? 1
        : v === "yesterday"
          ? -1
          : Number(v.slice(0, -1));
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + shift);
  return d.toISOString().slice(0, 10);
}

/**
 * The filters: the same words the agents' query tool takes. Ids are plain
 * ids here (the tool also accepts typed ids and links).
 */
export const viewFilters = z
  .object({
    over: z.enum(VIEW_SOURCES).default("tasks"),
    text: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["open", "done", "any"]).default("open"),
    project: z.uuid().optional(),
    stage: z.uuid().optional(),
    /** "personal", or a team id. */
    team: z.union([z.literal("personal"), z.uuid()]).optional(),
    list: z.uuid().optional(),
    tag: z.uuid().optional(),
    /** "me", or a person's id. */
    assignee: z.union([z.literal("me"), z.uuid()]).optional(),
    due_after: viewDate.optional(),
    due_before: viewDate.optional(),
    overdue: z.boolean().optional(),
    updated_after: viewDate.optional(),
    folder: z.uuid().optional(),
    kind: z.string().trim().min(1).max(40).optional(),
    /** Only rows that link to this (a typed id: doc:, task:, project:). */
    links_to: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(VIEW_SORTS).optional(),
  })
  .strict();
export type ViewFilters = z.output<typeof viewFilters>;

/** A whole view definition: its filters plus how it is shown. */
export const viewDefinition = viewFilters
  .extend({
    group_by: z.enum(VIEW_GROUPS).optional(),
    columns: z.array(z.enum(VIEW_COLUMNS)).max(VIEW_COLUMNS.length).optional(),
  })
  .strict();
export type ViewDefinition = z.output<typeof viewDefinition>;

/** Making or changing a saved view. */
export const savedViewInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** Null or left out: the person's own. A team id: shared with the team. */
    team_id: z.uuid().nullable().default(null),
    layout: z.enum(VIEW_LAYOUTS).default("table"),
    definition: viewDefinition,
  })
  .strict();
export type SavedViewInput = z.input<typeof savedViewInput>;

export const savedViewUpdate = z
  .object({
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    layout: z.enum(VIEW_LAYOUTS).optional(),
    definition: viewDefinition.optional(),
    position: z.number().int().min(0).max(9999).optional(),
  })
  .strict();
export type SavedViewUpdate = z.input<typeof savedViewUpdate>;

export type SavedView = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  name: string;
  layout: ViewLayout;
  definition: ViewDefinition;
  position: number;
  version: number;
  created_at: string;
  updated_at: string;
};

/** The most saved views one person keeps of their own (teams too, each). */
export const MAX_SAVED_VIEWS = 200;

/**
 * The filters in words, for a view's subtitle ("Open tasks · due before
 * +7d · sorted by due").
 */
export function describeView(d: ViewDefinition): string {
  const what: Record<ViewSource, string> = {
    tasks: "tasks",
    events: "events",
    docs: "pages",
    projects: "projects",
    records: "work records",
  };
  const parts = [
    `${d.status === "any" ? "All" : d.status === "done" ? "Done" : "Open"} ${what[d.over]}`,
  ];
  if (d.text) parts.push(`matching “${d.text}”`);
  if (d.overdue) parts.push("overdue");
  if (d.due_after) parts.push(`due from ${d.due_after}`);
  if (d.due_before) parts.push(`due before ${d.due_before}`);
  if (d.assignee === "me") parts.push("assigned to me");
  if (d.team === "personal") parts.push("Personal");
  if (d.links_to) parts.push(`linking to ${d.links_to}`);
  if (d.group_by) parts.push(`grouped by ${d.group_by}`);
  if (d.sort) parts.push(`sorted by ${d.sort}`);
  return parts.join(" · ");
}

/** One row of a view, as GET /views/:id/rows and the query tool give it. */
export type SavedViewRow = {
  /** A typed id: task:, event:, doc:, project: or record:. */
  id: string;
  title: string;
  url: string;
  type: "task" | "event" | "doc" | "project" | "record";
  status: string | null;
  due: { at: string; local: string } | null;
  priority: string | null;
  team: string;
  project_id: string | null;
  assignee: string | null;
  updated_at: string;
  provenance: string;
  group: string | null;
};

export type SavedViewRows = {
  view: SavedView;
  rows: SavedViewRow[];
  groups: { key: string; label: string; count: number }[];
  next_offset: number | null;
};
