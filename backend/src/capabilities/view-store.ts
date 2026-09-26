import {
  MAX_SAVED_VIEWS,
  fail,
  hasTeamPermission,
  viewDefinition,
  type TeamRole,
  type ViewDefinition,
  type ViewSource,
} from "@orbyn/core";
import type { Db, Queryable } from "../db/pool.js";
import type { UserRow } from "../lib/auth.js";
import { requireTeam } from "../lib/teams.js";
import {
  Params,
  scopeFor,
  visibleViews,
  type Spaces,
} from "../lib/visibility.js";
import { announceTo } from "../modules/presence/live.js";

/**
 * Saved views as the agents read and write them: the views track's table
 * (saved_views: name, source, definition; D4a) and its rules, so a view an
 * agent saves is the same row the app's Views screen lists.
 *
 * - A view is someone's own (team_id NULL) or shared with a team.
 * - Its maker (while they may still change the team's things) and the
 *   team's owners and admins may change or delete it (canEditView in the
 *   views track).
 * - The table has no version column, so the version an agent sees is the
 *   moment it last changed (milliseconds), which the app's changes move on
 *   too.
 */

export type StoredView = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  name: string;
  source: ViewSource;
  definition: ViewDefinition;
  /** When it last changed, in milliseconds: the version agents check. */
  version: number;
  created_at: string;
  updated_at: string;
};

type Row = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  name: string;
  source: ViewSource;
  definition: unknown;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `v.id, v.user_id, v.team_id, t.name AS team_name, v.name, v.source,
  v.definition, v.created_at, v.updated_at`;
const JOINS = "LEFT JOIN teams t ON t.id = v.team_id";

/** A kept definition with today's defaults filled in. */
export function readDefinition(raw: unknown, source: ViewSource) {
  const parsed = viewDefinition.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Something the app kept that this build doesn't know yet: its source
  // with the defaults, rather than a view that can't be read.
  return viewDefinition.parse({ source });
}

const toView = (r: Row): StoredView => ({
  id: r.id,
  user_id: r.user_id,
  team_id: r.team_id,
  team_name: r.team_name,
  name: r.name,
  source: r.source,
  definition: readDefinition(r.definition, r.source),
  version: r.updated_at.getTime(),
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
});

/** One view `spaces` can see, or null. */
export async function findView(
  db: Queryable,
  spaces: Spaces,
  id: string,
  lock = false,
): Promise<StoredView | null> {
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

export const everySpace = (userId: string): Spaces => ({
  userId,
  teamIds: null,
  personal: true,
});

/** Whether `userId` may change or delete `view` (the views track's rule). */
export async function canEditView(
  db: Queryable,
  userId: string,
  view: Pick<StoredView, "team_id" | "user_id">,
): Promise<boolean> {
  if (!view.team_id) return view.user_id === userId;
  const role = (
    await db.query<{ role: TeamRole }>(
      "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
      [view.team_id, userId],
    )
  ).rows[0]?.role;
  return (
    (view.user_id === userId && hasTeamPermission(role, "items:write")) ||
    hasTeamPermission(role, "team:update")
  );
}

async function mustEdit(db: Queryable, u: UserRow, view: StoredView) {
  if (!(await canEditView(db, u.id, view)))
    fail(
      403,
      "Only whoever made this view, or the team's owners and admins, can change it.",
    );
}

const news = (db: Db, view: { user_id: string; team_id: string | null }) =>
  announceTo(
    db,
    view.team_id ? { team_id: view.team_id } : { user_id: view.user_id },
    "changed",
    { area: "organize" },
  );

/** Save a new view for `u` (their own, or shared with a team). */
export async function createView(
  db: Db,
  u: UserRow,
  input: { name: string; team_id: string | null; definition: ViewDefinition },
): Promise<StoredView> {
  if (input.team_id) await requireTeam(input.team_id, u, "items:write", db);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `views:${u.id}`,
  ]);
  const made = (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM saved_views WHERE user_id = $1",
      [u.id],
    )
  ).rows[0].n;
  if (made >= MAX_SAVED_VIEWS)
    fail(
      409,
      `You can keep ${MAX_SAVED_VIEWS} views. Delete one you no longer use first.`,
    );
  const id = (
    await db.query<{ id: string }>(
      `INSERT INTO saved_views (user_id, team_id, name, source, definition)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
      [
        u.id,
        input.team_id,
        input.name,
        input.definition.source,
        JSON.stringify(input.definition),
      ],
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
  input: { version: number; name?: string; definition?: ViewDefinition },
): Promise<StoredView> {
  const view = await findView(db, everySpace(u.id), id, true);
  if (!view) fail(404, "View not found");
  await mustEdit(db, u, view);
  if (view.version !== input.version)
    fail(409, "This view changed since it was opened. Open it again.");
  if (input.definition && input.definition.source !== view.source)
    fail(400, "A view keeps showing what it was made for.");
  // Moves the version on even within the same millisecond.
  await db.query(
    `UPDATE saved_views SET
       name = coalesce($2, name),
       definition = coalesce($3::jsonb, definition),
       updated_at = greatest(now(), updated_at + interval '1 millisecond')
     WHERE id = $1`,
    [
      id,
      input.name ?? null,
      input.definition ? JSON.stringify(input.definition) : null,
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
  if (!(await canEditView(db, u.id, view)))
    fail(
      403,
      "Only whoever made this view, or the team's owners and admins, can delete it.",
    );
  await db.query("DELETE FROM saved_views WHERE id = $1", [id]);
  await db.query(
    "DELETE FROM favourites WHERE kind = 'view' AND target_id = $1",
    [id],
  );
  await news(db, view);
  return view;
}
