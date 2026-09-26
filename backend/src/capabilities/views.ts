import { z } from "zod";
import {
  VIEW_COLUMNS,
  VIEW_LAYOUTS,
  viewDefinition,
  type ViewDefinition,
} from "@orbyn/core";
import { createView, findView, updateView } from "../modules/views/service.js";
import { setFavourite } from "../modules/organize/service.js";
import { announceTo } from "../modules/presence/live.js";
import { teamFilter } from "./common.js";
import { cleanTitle } from "./format.js";
import { definitionFrom, filterFields } from "./query.js";
import { parseRef, refs } from "./refs.js";
import { CapabilityError, defineCapability } from "./registry.js";
import type { UndoOp } from "./undo.js";
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
 * save_view: an agent makes or changes a saved view, the same thing the
 * app's views screen shows (and query runs). Personal views are the
 * person's own; team views are shared with the team.
 */

export const saveView = defineCapability({
  name: "save_view",
  title: "Save a view",
  description:
    'Creates a saved view, or changes one (view + version): a name, what it lists and its filters (as query takes them; dates may be relative like "+7d"), sort, group_by, columns and layout (table, list, board or calendar). space: "personal" (default) or a team id to share it with the team. star pins it in the person\'s favourites. Run it with query(view). The definition language is in orbyn://spec/views.',
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
      name: z.string().trim().min(1).max(120).optional(),
      space: z
        .string()
        .trim()
        .max(100)
        .optional()
        .describe(
          'Where a new view is kept: "personal" (the default), or a team id to share it with the team.',
        ),
      layout: z.enum(VIEW_LAYOUTS).optional(),
      ...filterFields,
      columns: z
        .array(z.enum(VIEW_COLUMNS))
        .max(VIEW_COLUMNS.length)
        .optional(),
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
    const asked = {
      ...definitionFrom(a),
      ...(a.columns ? { columns: a.columns } : {}),
    };
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
      if (a.version === undefined)
        throw new CapabilityError(
          "INVALID",
          "Changing a view needs its version.",
          "Fetch the view (fetch view:<id>) for its version.",
        );
      const definition: ViewDefinition = viewDefinition.parse({
        ...view.definition,
        ...asked,
      });
      saved = await updateView(db, actor, view.id, {
        version: a.version,
        name: a.name,
        layout: a.layout,
        definition,
      });
      undo.push({
        op: "view.restore",
        id: saved.id,
        version: saved.version,
        fields: {
          name: view.name,
          layout: view.layout,
          definition: view.definition,
        },
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
        layout: a.layout ?? "table",
        definition: viewDefinition.parse(asked),
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
