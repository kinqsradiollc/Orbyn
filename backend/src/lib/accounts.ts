import type { Db } from "../db/pool.js";

export const LAST_ADMIN = "Orbyn needs at least one active admin.";

/** Serialise changes that could remove the last admin, then count the others. */
export async function otherActiveAdmins(userId: string, db: Db) {
  await db.query("SELECT pg_advisory_xact_lock(786241)");
  return (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM users WHERE role='admin' AND NOT disabled AND id<>$1",
      [userId],
    )
  ).rows[0].n;
}

/**
 * Delete an account, keeping the shared work it leaves behind: teams it solely
 * owns pass to the most senior remaining member (a team left with nobody is
 * deleted), and its team items move to an owner. Everything else it owns goes
 * with it. Callers check permissions and the last-admin rule first.
 */
export async function deleteAccount(db: Db, id: string) {
  // Teams they solely own pass to the most senior remaining member;
  // teams left with nobody are deleted. Their team items move to an owner
  // so shared work survives the account.
  await db.query(
    `UPDATE team_members m SET role='owner'
     FROM (
       SELECT DISTINCT ON (x.team_id) x.team_id, x.user_id
       FROM team_members x
       WHERE x.user_id<>$1 AND x.team_id IN (
         SELECT o.team_id FROM team_members o WHERE o.user_id=$1 AND o.role='owner'
         AND NOT EXISTS (SELECT 1 FROM team_members p WHERE p.team_id=o.team_id AND p.role='owner' AND p.user_id<>$1)
       )
       ORDER BY x.team_id, CASE x.role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, x.created_at
     ) heir
     WHERE m.team_id=heir.team_id AND m.user_id=heir.user_id`,
    [id],
  );
  await db.query(
    `DELETE FROM teams t WHERE t.id IN (SELECT team_id FROM team_members WHERE user_id=$1)
     AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.team_id=t.id AND m.user_id<>$1)`,
    [id],
  );
  await db.query(
    `UPDATE items i SET user_id=(
       SELECT m.user_id FROM team_members m WHERE m.team_id=i.team_id AND m.role='owner' AND m.user_id<>$1
       ORDER BY m.created_at LIMIT 1)
     WHERE i.user_id=$1 AND i.team_id IS NOT NULL`,
    [id],
  );
  // Its agent connections go with it (ON DELETE CASCADE); every copy is
  // told at once (orbyn_auth), like any other revocation.
  await db.query("SELECT pg_notify('orbyn_auth', $1)", [
    JSON.stringify({ users: [id], reason: "account_deleted" }),
  ]);
  await db.query("DELETE FROM users WHERE id=$1", [id]);
}
