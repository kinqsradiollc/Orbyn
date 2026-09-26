import { z } from "zod";
import {
  VIEW_LAYOUT_LABELS,
  VIEW_SOURCE_LABELS,
  fieldKeyId,
  type ViewDefinition,
} from "@orbyn/core";

/**
 * The query tool's filter words (tasks, events, pages, projects or work
 * records), and how a saved view (packages/core/src/views.ts, the views
 * track's definition) reads in them. A saved view lists tasks, pages or
 * projects; query runs it with the same filters, sort and grouping, as the
 * connection sees things.
 *
 * Dates in query can be relative ("today", "+7d", "-1d"), read in the
 * person's time zone, so "due before +7d" is always the coming week.
 */

/** What query lists. */
export const QUERY_OVER = [
  "tasks",
  "events",
  "docs",
  "projects",
  "records",
] as const;
export type QueryOver = (typeof QUERY_OVER)[number];

export const QUERY_SORTS = [
  "due",
  "updated",
  "created",
  "priority",
  "title",
] as const;
export type QuerySort = (typeof QUERY_SORTS)[number];

/** What query groups rows by. */
export const QUERY_GROUPS = [
  "status",
  "priority",
  "project",
  "stage",
  "assignee",
  "team",
  "kind",
  "due",
] as const;
export type QueryGroup = (typeof QUERY_GROUPS)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RELATIVE = /^(today|tomorrow|yesterday|[+-]\d{1,3}d)$/;

/** A date in a filter: YYYY-MM-DD, an ISO instant, or relative to today. */
export const queryDate = z
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

/**
 * The day a relative date names, as YYYY-MM-DD, given today's date in the
 * person's time zone. Other values come back unchanged.
 */
export function resolveQueryDate(v: string, today: string): string {
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

/** An ad-hoc query, or a saved view read as one. */
export type QueryDef = {
  over: QueryOver;
  status: "open" | "done" | "any";
  text?: string;
  project?: string;
  stage?: string;
  team?: string;
  list?: string;
  tag?: string;
  assignee?: string;
  due_after?: string;
  due_before?: string;
  overdue?: boolean;
  no_due?: boolean;
  updated_after?: string;
  folder?: string;
  kind?: string;
  links_to?: string;
  starred?: boolean;
  sort?: QuerySort;
  /** Reverse the sort's usual order. */
  desc?: boolean;
  group_by?: QueryGroup;
};

const OVER_OF = {
  tasks: "tasks",
  pages: "docs",
  projects: "projects",
} as const satisfies Record<ViewDefinition["source"], QueryOver>;

const GROUP_OF: Record<string, QueryGroup | undefined> = {
  status: "status",
  priority: "priority",
  project: "project",
  assignee: "assignee",
  team: "team",
  kind: "kind",
  due_week: "due",
};

const SORT_OF: Record<string, QuerySort | undefined> = {
  due: "due",
  days_left: "due",
  updated: "updated",
  created: "created",
  priority: "priority",
  title: "title",
};

/**
 * A saved view as query runs it, plus what query can't apply here (your
 * own fields, some groupings) so the answer can say the app shows more.
 */
export function fromSavedView(def: ViewDefinition): {
  query: QueryDef;
  notes: string[];
} {
  const f = def.filters;
  const notes: string[] = [];
  const q: QueryDef = {
    over: OVER_OF[def.source],
    status: f.status ?? (def.source === "pages" ? "any" : "open"),
  };
  for (const k of [
    "text",
    "team",
    "project",
    "list",
    "tag",
    "assignee",
    "due_after",
    "due_before",
    "overdue",
    "no_due",
    "folder",
    "kind",
  ] as const)
    if (f[k] !== undefined) (q as Record<string, unknown>)[k] = f[k];
  if (f.due_within_days !== undefined) {
    // Due from today through that many days ahead.
    q.due_after = "today";
    q.due_before = `+${f.due_within_days}d`;
  }
  if (f.updated_within_days !== undefined)
    q.updated_after = `-${f.updated_within_days}d`;
  if (f.fields?.length)
    notes.push("filters on your own fields apply in the app only");
  const sort = SORT_OF[def.sort.by];
  if (sort) {
    q.sort = sort;
    // Newest first is the usual order for "updated" and "created".
    q.desc = def.sort.dir === "desc";
  } else notes.push(`sorted by ${def.sort.by} in the app`);
  if (def.group_by !== "none") {
    const g = GROUP_OF[def.group_by];
    if (g) q.group_by = g;
    else notes.push(`grouped by ${def.group_by} in the app`);
  }
  return { query: q, notes };
}

/** A saved view's filters in words ("Open tasks · due within 7 days"). */
export function describeSavedView(def: ViewDefinition): string {
  const f = def.filters;
  const status = f.status ?? (def.source === "pages" ? "any" : "open");
  const parts = [
    `${status === "any" ? "All" : status === "done" ? "Done" : "Open"} ${VIEW_SOURCE_LABELS[def.source].toLowerCase()}`,
  ];
  if (f.text) parts.push(`matching “${f.text}”`);
  if (f.overdue) parts.push("overdue");
  if (f.no_due) parts.push("without a deadline");
  if (f.due_after) parts.push(`due from ${f.due_after}`);
  if (f.due_before) parts.push(`due by ${f.due_before}`);
  if (f.due_within_days !== undefined)
    parts.push(`due within ${f.due_within_days} days`);
  if (f.updated_within_days !== undefined)
    parts.push(`changed in the last ${f.updated_within_days} days`);
  if (f.assignee === "me") parts.push("assigned to me");
  if (f.team === "personal") parts.push("Personal");
  if (f.fields?.length)
    parts.push(
      `${f.fields.length} field filter${f.fields.length === 1 ? "" : "s"}`,
    );
  if (def.group_by !== "none")
    parts.push(
      `grouped by ${fieldKeyId(def.group_by) ? "a field" : def.group_by}`,
    );
  parts.push(
    `sorted by ${fieldKeyId(def.sort.by) ? "a field" : def.sort.by}${def.sort.dir === "desc" ? " (reversed)" : ""}`,
  );
  parts.push(VIEW_LAYOUT_LABELS[def.layout]);
  return parts.join(" · ");
}
