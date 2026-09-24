import {
  fail,
  hasSystemPermission,
  hasTeamPermission,
  type SystemRole,
  type TeamPermission,
  type TeamRole,
} from "@orbyn/core";
import { query, type Db } from "../db/pool.js";
import { isSessionPrincipal } from "./auth.js";

type Actor = { id: string; role: SystemRole };

/** Item permissions are never granted by the admin override: personal data stays private. */
const ITEM_PERMISSIONS: TeamPermission[] = ["items:read", "items:write"];

export async function membershipRole(
  teamId: string,
  userId: string,
  db?: Db,
): Promise<TeamRole | null> {
  const row = (
    await query<{ role: TeamRole }>(
      "SELECT role FROM team_members WHERE team_id=$1 AND user_id=$2",
      [teamId, userId],
      db,
    )
  ).rows[0];
  return row?.role ?? null;
}

/**
 * Require `permission` in a team. Non-members get 404 so team existence does
 * not leak. System admins act as owners for team management, but not for
 * reading or writing team items, and only when signed in to the app: an
 * admin's API key (and so any tool or agent holding it) is an ordinary
 * member, like everyone else's.
 *
 * Returns the caller's real membership role (null for an admin override) and
 * the effective role used for the check.
 */
export async function requireTeam(
  teamId: string,
  actor: Actor,
  permission: TeamPermission,
  db?: Db,
): Promise<{ name: string; role: TeamRole | null; effective: TeamRole }> {
  const team = (
    await query<{ name: string }>(
      "SELECT name FROM teams WHERE id=$1",
      [teamId],
      db,
    )
  ).rows[0];
  const role = team ? await membershipRole(teamId, actor.id, db) : null;
  const override =
    isSessionPrincipal(actor) &&
    hasSystemPermission(actor.role, "teams:manage_all") &&
    !ITEM_PERMISSIONS.includes(permission);
  if (!team || (!role && !override)) fail(404, "Team not found");
  const effective: TeamRole = override ? "owner" : role!;
  if (!hasTeamPermission(effective, permission))
    fail(
      403,
      permission === "items:write"
        ? "Viewers can't change team items."
        : "You don't have permission to do that in this team.",
    );
  return { name: team.name, role, effective };
}

/** SQL predicate (on alias `i`) for items `$1` can see: their own personal items and their teams' items. */
export const VISIBLE_ITEMS = `((i.team_id IS NULL AND i.user_id=$1) OR i.team_id IN (SELECT team_id FROM team_members WHERE user_id=$1))`;
