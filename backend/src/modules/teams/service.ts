import { fail, type Team, type TeamMember } from "@orbyn/core";
import { query, type Db } from "../../db/pool.js";
/**
 * The teams service: a team as its members see it, its members, and one
 * member locked for a change. The routes, admin, capacity, planning and
 * follow-through read teams through these.
 */
export const ROLE_ORDER = `CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END`;

export const TEAM_COLUMNS = `t.id, t.name, t.created_at,
  (SELECT count(*)::int FROM team_members x WHERE x.team_id=t.id) AS member_count,
  (SELECT count(*)::int FROM items i WHERE i.team_id=t.id) AS item_count`;

export async function teamSummary(
  teamId: string,
  userId: string,
  db?: Db,
): Promise<Team> {
  return (
    await query<Team>(
      `SELECT ${TEAM_COLUMNS}, (SELECT role FROM team_members WHERE team_id=t.id AND user_id=$2) AS role
       FROM teams t WHERE t.id=$1`,
      [teamId, userId],
      db,
    )
  ).rows[0];
}

export async function teamMembers(teamId: string, db?: Db) {
  return (
    await query<TeamMember>(
      `SELECT m.user_id, u.name, u.email, m.role, m.created_at AS joined_at
       FROM team_members m JOIN users u ON u.id=m.user_id
       WHERE m.team_id=$1 ORDER BY ${ROLE_ORDER}, u.name`,
      [teamId],
      db,
    )
  ).rows;
}

export async function member(teamId: string, userId: string, db: Db) {
  const row = (
    await db.query<TeamMember>(
      `SELECT m.user_id, u.name, u.email, m.role, m.created_at AS joined_at
       FROM team_members m JOIN users u ON u.id=m.user_id
       WHERE m.team_id=$1 AND m.user_id=$2 FOR UPDATE OF m`,
      [teamId, userId],
    )
  ).rows[0];
  if (!row) fail(404, "That person isn't in this team.");
  return row;
}

export async function ownerCount(teamId: string, db: Db) {
  return (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM team_members WHERE team_id=$1 AND role='owner'",
      [teamId],
    )
  ).rows[0].n;
}

export const LAST_OWNER =
  "A team needs at least one owner. Make someone else an owner first.";
