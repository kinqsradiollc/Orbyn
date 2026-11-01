import {
  addDays,
  dayTime,
  groupRows,
  localDateKey,
  viewDefinition,
  type ViewDefinition,
  type ViewNames,
} from "@orbyn/core";
import { runView } from "../modules/views/service.js";
import type { ViewExtraFilters } from "../modules/views/extra-filters.js";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
} from "../lib/visibility.js";
import { spaceName } from "./common.js";
import { both, cleanTitle, provenanceOf, titleFor } from "./format.js";
import { resolveQueryDate, type QueryDef } from "./query-def.js";
import { refs } from "./refs.js";
import { CapabilityError, type CapabilityContext } from "./registry.js";
import { docEditorsSql, itemSourceSql } from "./sources.js";
import type { StoredView } from "./view-store.js";
import type { ViewRow } from "./query.js";

export function effectiveSavedView(
  ctx: CapabilityContext,
  saved: StoredView,
  asked: Partial<QueryDef>,
): { definition: ViewDefinition; extra: ViewExtraFilters } {
  const def = structuredClone(saved.definition),
    f = def.filters;
  const over = def.source === "pages" ? "docs" : def.source;
  const bad = (key: string): never => {
    throw new CapabilityError(
      "INVALID",
      `${key} does not apply to this saved ${def.source} view.`,
    );
  };
  if (asked.over && asked.over !== over) bad("over");
  const extra: ViewExtraFilters = {};
  for (const key of [
    "text",
    "team",
    "project",
    "list",
    "tag",
    "assignee",
    "folder",
    "kind",
  ] as const)
    if (asked[key] !== undefined) {
      if (key === "text") {
        delete f.text;
        extra.text = asked.text;
        continue;
      }
      if (def.source === "tasks" && key === "kind") {
        extra.kind = asked.kind;
        continue;
      }
      if (def.source === "tasks" && key === "folder") bad(key);
      if (def.source === "pages" && ["list", "assignee"].includes(key))
        bad(key);
      if (
        def.source === "projects" &&
        ["list", "tag", "assignee", "folder", "kind"].includes(key)
      )
        bad(key);
      (f as Record<string, unknown>)[key] = asked[key];
    }
  if (asked.status !== undefined) {
    f.status = asked.status;
    delete f.task_status;
  }
  const today = localDateKey(ctx.now, ctx.timezone);
  const at = (value: string, end = false) => {
    const raw = resolveQueryDate(value, today);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? dayTime(end ? addDays(raw, 1) : raw, 0, ctx.timezone)
      : new Date(raw);
  };
  if (
    [asked.due_after, asked.due_before, asked.overdue, asked.no_due].some(
      (v) => v !== undefined,
    )
  ) {
    if (def.source === "pages") bad("due");
    for (const key of [
      "due_after",
      "due_before",
      "due_within_days",
      "due_bucket",
      "overdue",
      "no_due",
    ] as const)
      delete f[key];
    if (asked.due_after) extra.due_after = at(asked.due_after);
    if (asked.due_before) extra.due_before = at(asked.due_before, true);
    if (asked.overdue) extra.overdueBefore = ctx.now;
    if (asked.no_due !== undefined) f.no_due = asked.no_due;
  }
  if (asked.updated_after) {
    delete f.updated_within_days;
    extra.updated_after = at(asked.updated_after);
  }
  if (asked.stage) {
    if (def.source !== "tasks") bad("stage");
    extra.stage = asked.stage;
  }
  if (asked.starred) {
    if (def.source === "tasks") bad("starred");
    extra.starred = true;
  }
  if (asked.links_to) {
    if (def.source === "projects") bad("links_to");
    const [kind, id] = asked.links_to.split(":");
    if (!(kind === "doc" || kind === "task" || kind === "project") || !id)
      bad("links_to");
    extra.links_to = { kind: kind as "doc" | "task" | "project", id };
  }
  if (asked.sort)
    def.sort = {
      by: asked.sort,
      dir: "asc",
    };
  if (asked.group_by) {
    // A grouping label is presentation; stage is handled below without changing membership.
    const by = asked.group_by === "due" ? "due_week" : asked.group_by;
    if (by !== "stage") def.group_by = by;
  }
  const parsed = viewDefinition.safeParse(def);
  if (!parsed.success)
    throw new CapabilityError(
      "INVALID",
      "Those overrides do not apply to this saved view.",
    );
  return { definition: parsed.data, extra };
}

type ProvenanceRow = {
  id: string;
  user_id: string;
  author_name: string | null;
  source?: string | null;
  imported?: boolean;
  editors?: string[] | null;
  stage_name?: string | null;
};

/** Shared saved-view selector; agents format its already-authorized result, never rerun a different query. */
export async function runSavedViewPage(
  ctx: CapabilityContext,
  saved: StoredView,
  asked: Partial<QueryDef>,
  limit: number,
  offset: number,
) {
  const { definition, extra } = effectiveSavedView(ctx, saved, asked);
  const result = await runView(ctx.db, ctx.principal.user.id, definition, {
    now: ctx.now,
    timeZone: ctx.timezone,
    spaces: {
      personal: ctx.spaces.personal,
      teamIds: ctx.spaces.teamIds,
      ai: true,
    },
    extra,
  });
  const source = definition.source;
  const p = new Params(),
    scope = scopeFor(ctx.spaces, p),
    ids = p.add(result.rows.map((r) => r.id));
  const metadata = result.rows.length
    ? (
        await ctx.db.query<ProvenanceRow>(
          source === "tasks"
            ? `SELECT i.id,i.user_id,au.name AS author_name,${itemSourceSql("i")} AS source,st.name AS stage_name FROM items i JOIN users au ON au.id=i.user_id LEFT JOIN project_stages st ON st.id=i.stage_id WHERE i.id=ANY(${ids}::uuid[]) AND ${visibleItems("i", scope)}`
            : source === "pages"
              ? `SELECT d.id,d.user_id,au.name AS author_name,d.imported_from IS NOT NULL AS imported,${docEditorsSql("d", scope.user)} AS editors FROM docs d JOIN users au ON au.id=d.user_id WHERE d.id=ANY(${ids}::uuid[]) AND ${visibleDocs("d", scope)}`
              : `SELECT p.id,p.user_id,au.name AS author_name FROM projects p JOIN users au ON au.id=p.user_id WHERE p.id=ANY(${ids}::uuid[]) AND ${visibleProjects("p", scope)}`,
          p.values,
        )
      ).rows
    : [];
  const byId = new Map(metadata.map((r) => [r.id, r]));
  // Metadata permission loss cannot broaden content or masquerade as personal provenance.
  if (result.rows.some((r) => !byId.has(r.id)))
    throw new CapabilityError(
      "STALE",
      "View access changed while it was read. Start again.",
    );
  // GroupNames is also used by board mutations, which need the real tag
  // owner. Row tags intentionally carry display fields only; never infer that
  // owner from the task's team (personal tags can label a team task).
  const tagIds = [
    ...new Set(result.rows.flatMap((r) => r.tags.map((tag) => tag.id))),
  ];
  let groupingTags: NonNullable<ViewNames["tags"]> = [];
  if (source === "tasks" && definition.group_by === "tag" && tagIds.length) {
    const tagParams = new Params(),
      tagScope = scopeFor(ctx.spaces, tagParams);
    const rowsParam = tagParams.add(result.rows.map((r) => r.id)),
      tagsParam = tagParams.add(tagIds);
    const owners = (
      await ctx.db.query<{ id: string; team_id: string | null }>(
        `SELECT DISTINCT tg.id,tg.team_id FROM tags tg
        JOIN item_tags it ON it.tag_id=tg.id JOIN items i ON i.id=it.item_id
        WHERE i.id=ANY(${rowsParam}::uuid[]) AND tg.id=ANY(${tagsParam}::uuid[])
          AND ${visibleItems("i", tagScope)}`,
        tagParams.values,
      )
    ).rows;
    const tagById = new Map(owners.map((tag) => [tag.id, tag]));
    const displays = new Map(
      result.rows.flatMap((r) => r.tags.map((tag) => [tag.id, tag] as const)),
    );
    groupingTags = [...displays.values()].map((tag) => {
      const owner = tagById.get(tag.id);
      if (!owner)
        throw new CapabilityError(
          "STALE",
          "View tag access changed while it was read. Start again.",
        );
      return { ...tag, team_id: owner.team_id };
    });
  }
  const labels = new Map(
    groupRows(result.rows, definition, {
      fields: result.fields,
      people: result.people,
      userId: ctx.principal.user.id,
      now: ctx.now,
      lists: result.rows.flatMap((r) =>
        r.list_id
          ? [
              {
                id: r.list_id,
                name: r.list_name ?? "Untitled list",
                color: "",
                team_id: r.team_id,
                team_name: r.team_name,
              },
            ]
          : [],
      ),
      tags: groupingTags,
      projects: result.rows.flatMap((r) =>
        r.project_id
          ? [{ id: r.project_id, name: r.project_name ?? "Untitled project" }]
          : [],
      ),
      teams: result.rows.flatMap((r) =>
        r.team_id ? [{ id: r.team_id, name: r.team_name ?? "Team" }] : [],
      ),
    }).flatMap((g) => g.rows.map((r) => [r.id, g.title] as const)),
  );
  const rows = result.rows.slice(offset, offset + limit).map((r): ViewRow => {
    const type = r.kind === "page" ? "doc" : r.kind;
    const at = refs({ type, id: r.id }, r.project_id),
      m = byId.get(r.id)!;
    const provenance = provenanceOf(ctx.principal.user.id, m);
    return {
      id: at.id,
      title:
        titleFor(
          r.title,
          provenance,
          ctx.principal.flags.hide_outside_content,
          type,
        ) || "Untitled",
      url: at.url,
      type,
      status: r.kind === "page" ? r.doc_kind : r.status,
      due: both(r.due_at ? new Date(r.due_at) : null, ctx.timezone),
      priority: r.priority,
      team: spaceName(r.team_id, ctx.principal.teams),
      project_id: r.project_id,
      assignee: r.assignee_name ? cleanTitle(r.assignee_name) : null,
      updated_at: r.updated_at,
      provenance,
      group:
        asked.group_by === "stage"
          ? m.stage_name
            ? cleanTitle(m.stage_name)
            : "No stage"
          : definition.group_by === "none"
            ? null
            : definition.group_by === "priority"
              ? (r.priority ?? "none")
              : definition.group_by === "status"
                ? (r.status ?? "none")
                : (labels.get(r.id) ?? null),
    };
  });
  return {
    rows,
    more: offset + limit < result.rows.length,
    truncated: result.truncated,
    definition,
  };
}
