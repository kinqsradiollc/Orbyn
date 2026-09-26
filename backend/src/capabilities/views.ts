import { z } from "zod";
import {
  VIEW_LAYOUTS,
  VIEW_SOURCES,
  viewDefinition,
  viewFilters,
  type ViewDefinition,
} from "@orbyn/core";
import { setFavourite } from "../modules/organize/service.js";
import { announceTo } from "../modules/presence/live.js";
import { teamFilter } from "./common.js";
import { cleanTitle } from "./format.js";
import { parseRef, refs } from "./refs.js";
import { CapabilityError, defineCapability } from "./registry.js";
import type { UndoOp } from "./undo.js";
import { createView, findView, updateView } from "./view-store.js";
import {
  ADDS,
  actorOf,
  clientRefInput,
  dbOf,
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
    "Creates a saved view, or changes one (view + version): a name, what it lists (source: tasks, pages or projects), filters, sort ({by, dir}), group_by, columns and layout (list, board, table, calendar; gallery for pages). The same definition the app's Views screen uses, so the view opens there too. space: \"personal\" (default) or a team id to share it with the team. star pins it in the person's favourites. Run it with query(view). The definition language is in orbyn://spec/views.",
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
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: ADDS,
  access: "write",
  toolset: "workspace",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
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
        throw new CapabilityError(
          "FORBIDDEN",
          "This connection can only suggest changes there, and saved views don't go through review.",
          "Ask the person to change the view in Orbyn.",
        );
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
        throw new CapabilityError(
          "FORBIDDEN",
          "This connection can only suggest changes there, and saved views don't go through review.",
          "Ask the person to save the view in Orbyn.",
        );
      saved = await createView(db, actor, {
        name: a.name,
        team_id: teamId,
        definition: checked({ source: a.source ?? "tasks", ...asked }),
      });
      undo.push({ op: "view.delete", id: saved.id, version: saved.version });
      change = "Saved";
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
