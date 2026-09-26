import {
  MAX_SAVED_VIEWS,
  fail,
  savedViewInput,
  savedViewUpdate,
  viewDefinition,
  type SavedView,
  type SavedViewInput,
  type SavedViewUpdate,
  type ViewLayout,
} from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import {
  Params,
  scopeFor,
  visibleViews,
  type Spaces,
} from "../../lib/visibility.js";
import { announceTo } from "../presence/live.js";

/**
 * Saved views: a person's own, or shared with a team. Anyone who can see a
 * view can run it; the rows it lists are still only what each person can
 * see. Personal views change only by their maker; team views by members
 * who can change team items, and are removed by their maker or the team's
 * owners and admins. The app's views screen, `query` and `save_view` all
 * go through here.
 */

type Row = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  name: string;
  layout: ViewLayout;
  definition: unknown;
  position: number;
  version: number;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `v.id, v.user_id, v.team_id, t.name AS team_name, v.name, v.layout,
  v.definition, v.position, v.version, v.created_at, v.updated_at`;
const JOINS = "LEFT JOIN teams t ON t.id = v.team_id";

/** A stored definition as it reads now (unknown keys dropped, defaults on). */
function definitionOf(raw: unknown) {
  const parsed = viewDefinition.safeParse(raw ?? {});
  return parsed.success ? parsed.data : viewDefinition.parse({});
}

export const toView = (r: Row): SavedView => ({
  id: r.id,
  user_id: r.user_id,
  team_id: r.team_id,
  team_name: r.team_name,
  name: r.name,
  layout: r.layout,
  definition: definitionOf(r.definition),
  position: r.position,
  version: r.version,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
});

/** The views `spaces` can see, personal first, then by team and position. */
export async function listViews(
  db: Queryable,
  spaces: Spaces,
): Promise<SavedView[]> {
  const params = new Params();
  const scope = scopeFor(spaces, params);
  return (
    await db.query<Row>(
      `SELECT ${COLUMNS} FROM saved_views v ${JOINS}
        WHERE ${visibleViews("v", scope)}
        ORDER BY v.team_id NULLS FIRST, v.position, lower(v.name), v.id
        LIMIT 500`,
      params.values,
    )
  ).rows.map(toView);
}

/** One view `spaces` can see, or null. */
export async function findView(
  db: Queryable,
  spaces: Spaces,
  id: string,
  lock = false,
): Promise<SavedView | null> {
  const params = new Params();
  const scope = scopeFor(spaces, params);
  const row = (
    await db.query<Row>(
      `SELECT ${COLUMNS} FROM saved_views v ${JOINS}
        WHERE v.id = ${params.add(id)} AND ${visibleViews("v", scope)}
        ${lock ? "FOR UPDATE OF v" : ""}`,
      params.values,
    )
  ).rows[0];
  return row ? toView(row) : null;
}

const everySpace = (userId: string): Spaces => ({
  userId,
  teamIds: null,
  personal: true,
});

/** Whether `u` may change `view` (and remove it, with `removing`). */
async function mayChange(
  db: Db,
  u: UserRow,
  view: SavedView,
  removing = false,
) {
  if (!view.team_id) {
    if (view.user_id !== u.id) fail(404, "View not found");
    return;
  }
  const { effective } = await requireTeam(view.team_id, u, "items:write", db);
  if (
    removing &&
    view.user_id !== u.id &&
    !["owner", "admin"].includes(effective)
  )
    fail(
      403,
      "Only its maker or the team's owners and admins can remove a team view.",
    );
}

const news = (db: Db, view: { user_id: string; team_id: string | null }) =>
  announceTo(
    db,
    view.team_id ? { team_id: view.team_id } : { user_id: view.user_id },
    "changed",
    { area: "organize" },
  );

/** Save a new view for `u` (their own, or in a team they can change). */
export async function createView(
  db: Db,
  u: UserRow,
  input: SavedViewInput,
): Promise<SavedView> {
  const d = savedViewInput.parse(input);
  if (d.team_id) await requireTeam(d.team_id, u, "items:write", db);
  const count = (
    await db.query<{ n: number }>(
      d.team_id
        ? "SELECT count(*)::int AS n FROM saved_views WHERE team_id = $1"
        : "SELECT count(*)::int AS n FROM saved_views WHERE team_id IS NULL AND user_id = $1",
      [d.team_id ?? u.id],
    )
  ).rows[0].n;
  if (count >= MAX_SAVED_VIEWS)
    fail(
      422,
      `There are already ${MAX_SAVED_VIEWS} saved views here. Remove one first.`,
    );
  const id = (
    await db.query<{ id: string }>(
      `INSERT INTO saved_views (user_id, team_id, name, layout, definition, position)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
      [u.id, d.team_id, d.name, d.layout, JSON.stringify(d.definition), count],
    )
  ).rows[0].id;
  const view = (await findView(db, everySpace(u.id), id))!;
  await news(db, view);
  return view;
}

/** Change a view (version-checked: 409 when it changed meanwhile). */
export async function updateView(
  db: Db,
  u: UserRow,
  id: string,
  input: SavedViewUpdate,
): Promise<SavedView> {
  const d = savedViewUpdate.parse(input);
  const view = await findView(db, everySpace(u.id), id, true);
  if (!view) fail(404, "View not found");
  await mayChange(db, u, view);
  if (view.version !== d.version)
    fail(409, "This view changed since it was opened. Open it again.");
  await db.query(
    `UPDATE saved_views SET
       name = coalesce($2, name),
       layout = coalesce($3, layout),
       definition = coalesce($4::jsonb, definition),
       position = coalesce($5, position),
       version = version + 1,
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      d.name ?? null,
      d.layout ?? null,
      d.definition ? JSON.stringify(d.definition) : null,
      d.position ?? null,
    ],
  );
  const saved = (await findView(db, everySpace(u.id), id))!;
  await news(db, saved);
  return saved;
}

/** Remove a view (and its stars). */
export async function deleteView(db: Db, u: UserRow, id: string) {
  const view = await findView(db, everySpace(u.id), id, true);
  if (!view) fail(404, "View not found");
  await mayChange(db, u, view, true);
  await db.query("DELETE FROM saved_views WHERE id = $1", [id]);
  await news(db, view);
  return view;
}
