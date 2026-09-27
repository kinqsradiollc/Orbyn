import { z } from "zod";
import {
  VIEW_LAYOUTS,
  VIEW_SOURCES,
  viewColumns,
  viewFileName,
  viewTable,
  viewDefinition,
  viewFilters,
  type ViewDefinition,
} from "@orbyn/core";
import { setFavourite } from "../modules/organize/service.js";
import { announceTo } from "../modules/presence/live.js";
import { teamFilter } from "./common.js";
import { cleanTitle } from "./format.js";
import { parseRef, refs } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import type { UndoOp } from "./undo.js";
import {
  createView,
  findView,
  readDefinition,
  updateView,
} from "./view-store.js";
import { runView as runSavedView } from "../modules/views/service.js";
import {
  ADDS,
  actorOf,
  clientRefInput,
  dbOf,
  cantWait,
  destination,
  finishWrite,
  writeOutput,
} from "./write.js";

/**
 * save_view: an agent makes or changes a saved view, the same row and the
 * same definition the app's Views screen shows (packages/core/src/views.ts)
 * and query runs. Personal views are the person's own; team views are
 * shared with the team.
 */

/** The definition's words, checked the way the app checks them. */
function checked(raw: Record<string, unknown>): ViewDefinition {
  const parsed = viewDefinition.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new CapabilityError(
    "INVALID",
    `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
    "The view language is in orbyn://spec/views.",
  );
}

export const saveView = defineCapability({
  name: "save_view",
  title: "Save a view",
  description:
    'Creates a saved view, or changes one (view + version): a name, what it lists (source: tasks, pages or projects), filters, sort ({by, dir}), group_by, columns and layout (list, board, table, calendar; gallery for pages). The same definition the app\'s Views screen uses, so the view opens there too. space: "personal" (default) or a team id to share it with the team. star puts it in the person\'s favourites; pin in their sidebar. export: "csv" returns a saved view\'s rows as CSV text (csv), changing nothing. Run it with query(view). The definition language is in orbyn://spec/views.',
  input: z
    .object({
      view: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .optional()
        .describe("To change a saved view: view:<id>. Leave out to make one."),
      version: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("The view's version, when changing it."),
      name: z.string().trim().min(1).max(80).optional(),
      space: z
        .string()
        .trim()
        .max(100)
        .optional()
        .describe(
          'Where a new view is kept: "personal" (the default), or a team id to share it with the team.',
        ),
      source: z
        .enum(VIEW_SOURCES)
        .optional()
        .describe("What a new view lists (default tasks). A view keeps it."),
      filters: viewFilters
        .optional()
        .describe(
          "The filters (they replace the view's own when changing it). Days are YYYY-MM-DD; due_within_days and updated_within_days count from today.",
        ),
      sort: z
        .object({
          by: z.string().trim().min(1).max(60),
          dir: z.enum(["asc", "desc"]).optional(),
        })
        .strict()
        .optional()
        .describe(
          "by: due, updated, created, priority, title, estimate, days_left or field:<id>.",
        ),
      group_by: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .optional()
        .describe(
          "none, or what the source groups by (tasks: status, list, tag, size, priority, project, due_week, assignee).",
        ),
      layout: z.enum(VIEW_LAYOUTS).optional(),
      columns: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
      star: z.boolean().optional(),
      pin: z.boolean().optional(),
      export: z.enum(["csv"]).optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput.extend({ csv: z.string().optional() }),
  annotations: ADDS,
  access: "write",
  toolset: "workspace",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    if (a.export) return exportView(ctx, a.view);
    const asked: Record<string, unknown> = {};
    for (const k of [
      "filters",
      "sort",
      "group_by",
      "layout",
      "columns",
    ] as const)
      if (a[k] !== undefined) asked[k] = a[k];
    const undo: UndoOp[] = [];
    let saved;
    let change: string;
    if (a.view) {
      const ref = parseRef(a.view);
      if (ref.type === "title" || (ref.type !== "view" && ref.type !== "any"))
        throw new CapabilityError("INVALID", "view must be view:<id>.");
      const view = await findView(db, ctx.spaces, ref.id, true);
      if (!view)
        throw new CapabilityError(
          "NOT_FOUND",
          "No saved view with that id is reachable from this connection.",
        );
      if (destination(ctx, view.team_id, "W2") === "review")
        throw cantWait(ctx, view.team_id);
      if (a.source && a.source !== view.source)
        throw new CapabilityError(
          "INVALID",
          "A view keeps showing what it was made for.",
          "Save a new view for the other source.",
        );
      if (a.version === undefined)
        throw new CapabilityError(
          "INVALID",
          "Changing a view needs its version.",
          "Fetch the view (fetch view:<id>) for its version.",
        );
      const definition = checked({ ...view.definition, ...asked });
      saved = await updateView(db, actor, view.id, {
        version: a.version,
        name: a.name,
        definition,
      });
      undo.push({
        op: "view.restore",
        id: saved.id,
        version: saved.version,
        fields: { name: view.name, definition: view.definition },
      });
      change = "Changed";
    } else {
      if (!a.name)
        throw new CapabilityError("INVALID", "A new view needs a name.");
      const team = teamFilter(a.space ?? "personal");
      const teamId = team && "team" in team ? team.team : null;
      if (destination(ctx, teamId, teamId ? "W2" : "W1") === "review")
        throw cantWait(ctx, teamId);
      saved = await createView(db, actor, {
        name: a.name,
        team_id: teamId,
        definition: checked({ source: a.source ?? "tasks", ...asked }),
      });
      undo.push({ op: "view.delete", id: saved.id, version: saved.version });
      change = "Saved";
    }
    if (a.pin !== undefined) {
      const was = !!(
        await db.query(
          "SELECT 1 FROM saved_view_pins WHERE user_id = $1 AND view_id = $2",
          [ctx.principal.user.id, saved.id],
        )
      ).rowCount;
      await db.query(
        a.pin
          ? `INSERT INTO saved_view_pins (user_id, view_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`
          : "DELETE FROM saved_view_pins WHERE user_id = $1 AND view_id = $2",
        [ctx.principal.user.id, saved.id],
      );
      undo.push({ op: "view.pin", id: saved.id, pinned: was });
      change += a.pin ? ", pinned" : ", unpinned";
    }
    if (a.star !== undefined) {
      await setFavourite(db, ctx.principal.user.id, "view", saved.id, a.star);
      await announceTo(db, { user_id: ctx.principal.user.id }, "changed", {
        area: "organize",
      });
    }
    const r = refs({ type: "view", id: saved.id });
    return finishWrite(ctx, "Saving a view", {
      done: [
        {
          id: r.id,
          title: cleanTitle(saved.name) || "Untitled view",
          url: r.url,
          version: saved.version,
          change: a.star ? `${change} and starred` : change,
        },
      ],
      undo,
      teamId: saved.team_id,
    });
  },
});

/**
 * A saved view's rows as CSV text (H6b), with the columns it shows: the
 * app's "Export CSV", returned in the answer rather than as a download.
 * Only rows this connection reaches (its spaces, no kept-out projects).
 */
async function exportView(ctx: CapabilityContext, input: string | undefined) {
  const ref = parseRef(input ?? "");
  if (
    !input ||
    ref.type === "title" ||
    (ref.type !== "view" && ref.type !== "any")
  )
    throw new CapabilityError("INVALID", "export needs view: view:<id>.");
  const view = await findView(ctx.db, ctx.spaces, ref.id);
  if (!view)
    throw new CapabilityError(
      "NOT_FOUND",
      "No saved view with that id is reachable from this connection.",
    );
  const def = readDefinition(view.definition, view.source);
  const result = await runSavedView(ctx.db, ctx.principal.user.id, def, {
    timeZone: ctx.timezone,
    now: ctx.now,
    spaces: {
      teamIds: ctx.spaces.teamIds,
      personal: ctx.spaces.personal,
      ai: true,
    },
  });
  const csv = viewTable(
    result.rows,
    viewColumns(def),
    { now: ctx.now, timeZone: ctx.timezone },
    { fields: result.fields, people: result.people },
  );
  if (csv.length > 200_000)
    throw new CapabilityError(
      "INVALID",
      "That view is too big to return as text (over 200 KB).",
      "Narrow its filters, or ask the person to export it in Orbyn.",
    );
  const r = refs({ type: "view", id: view.id });
  const name = cleanTitle(view.name) || "Untitled view";
  return {
    structured: {
      status: "done" as const,
      done: [
        {
          id: r.id,
          title: name,
          url: r.url,
          version: view.version,
          change: `Exported ${result.rows.length} rows as CSV (${viewFileName(view.name)})`,
        },
      ],
      pending: null,
      skipped: [],
      csv,
    },
    markdown: `${name}: ${result.rows.length} rows as CSV (${viewFileName(view.name)}).\n\n\`\`\`csv\n${csv}\n\`\`\``,
    targets: [r.id],
    write: { outcome: "ok" as const, team_id: view.team_id },
  };
}
