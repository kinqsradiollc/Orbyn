import type { FastifyInstance } from "fastify";
import {
  adminUserUpdate,
  adminUsersQuery,
  auditQuery,
  fail,
  type AdminOverview,
  type AdminUser,
  type AuditEntry,
  type Team,
} from "@orbyn/core";
import { query, reader, transaction, type Db } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { authorize } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { TEAM_COLUMNS } from "../teams/routes.js";
import { adminDatabaseRoutes } from "./database.js";
import { adminInsightRoutes } from "./insights.js";
import { adminUserPowerRoutes } from "./users.js";
import { adminSweepRoutes } from "./sweep.js";

const USER_COLUMNS = `u.id, u.email, u.name, u.email_reminders, u.role, u.disabled, u.email_verified, u.created_at,
  (SELECT count(*)::int FROM team_members m WHERE m.user_id=u.id) AS team_count,
  (SELECT count(*)::int FROM items i WHERE i.user_id=u.id) AS item_count`;

const LAST_ADMIN = "Orbyn needs at least one active admin.";

async function adminUser(id: string, db?: Db) {
  const row = (
    await query<AdminUser>(
      `SELECT ${USER_COLUMNS} FROM users u WHERE u.id=$1`,
      [id],
      db,
    )
  ).rows[0];
  if (!row) fail(404, "User not found");
  return row;
}

/** Serialise changes that could remove the last admin, then count the others. */
async function otherActiveAdmins(userId: string, db: Db) {
  await db.query("SELECT pg_advisory_xact_lock(786241)");
  return (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM users WHERE role='admin' AND NOT disabled AND id<>$1",
      [userId],
    )
  ).rows[0].n;
}

/**
 * The admin console API. Every route requires a system permission. Admins see
 * accounts, teams, membership and counts, but never the contents of personal
 * items.
 */
export async function adminRoutes(app: FastifyInstance) {
  adminDatabaseRoutes(app);
  await adminInsightRoutes(app);
  await adminUserPowerRoutes(app);
  await adminSweepRoutes(app);
  app.get("/admin/overview", async (r): Promise<AdminOverview> => {
    await authorize(r, "admin:access");
    return (
      await reader(r.headers).query<AdminOverview>(`SELECT
        (SELECT count(*) FROM users)::int AS users,
        (SELECT count(*) FROM users WHERE role='admin')::int AS admins,
        (SELECT count(*) FROM users WHERE disabled)::int AS disabled_users,
        (SELECT count(*) FROM teams)::int AS teams,
        (SELECT count(*) FROM items)::int AS items,
        (SELECT count(*) FROM items WHERE status NOT IN ('done', 'cancelled'))::int AS open_items,
        (SELECT count(*) FROM notifications WHERE state IN ('pending','receipt'))::int AS notifications_pending,
        (SELECT count(*) FROM notifications WHERE state='failed')::int AS notifications_failed`)
    ).rows[0];
  });

  app.get("/admin/users", async (r) => {
    await authorize(r, "users:read");
    const q = adminUsersQuery.parse(r.query);
    const pattern = `%${q.search.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    const where = "($1 = '%%' OR u.email ILIKE $1 OR u.name ILIKE $1)";
    const [rows, total] = await Promise.all([
      reader(r.headers).query<AdminUser>(
        `SELECT ${USER_COLUMNS} FROM users u WHERE ${where}
         ORDER BY u.created_at, u.email LIMIT $2 OFFSET $3`,
        [pattern, q.limit, q.offset],
      ),
      reader(r.headers).query<{ n: number }>(
        `SELECT count(*)::int AS n FROM users u WHERE ${where}`,
        [pattern],
      ),
    ]);
    return { rows: rows.rows, total: total.rows[0].n };
  });

  app.put("/admin/users/:id", async (r) => {
    const actor = await authorize(r, "users:manage");
    const id = idParam(r);
    const d = adminUserUpdate.parse(r.body);
    return transaction(async (db) => {
      const target = (
        await db.query<{
          role: string;
          disabled: boolean;
          email: string;
          email_verified: boolean;
        }>(
          "SELECT role, disabled, email, email_verified FROM users WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!target) fail(404, "User not found");
      const role = d.role ?? target.role;
      const disabled = d.disabled ?? target.disabled;
      const emailVerified = d.email_verified ?? target.email_verified;
      const losesAdmin =
        target.role === "admin" &&
        !target.disabled &&
        (role !== "admin" || disabled);
      if (losesAdmin && (await otherActiveAdmins(id, db)) === 0)
        fail(409, LAST_ADMIN);
      await db.query(
        "UPDATE users SET role=$1, disabled=$2, email_verified=$3 WHERE id=$4",
        [role, disabled, emailVerified, id],
      );
      if (disabled && !target.disabled)
        await db.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      if (role !== target.role)
        await audit(
          {
            actorId: actor.id,
            action: "user.role_changed",
            targetType: "user",
            targetId: id,
            details: { email: target.email, from: target.role, to: role },
          },
          db,
        );
      if (disabled !== target.disabled)
        await audit(
          {
            actorId: actor.id,
            action: disabled ? "user.disabled" : "user.enabled",
            targetType: "user",
            targetId: id,
            details: { email: target.email },
          },
          db,
        );
      if (emailVerified !== target.email_verified)
        await audit(
          {
            actorId: actor.id,
            action: emailVerified
              ? "user.email_verified"
              : "user.email_unverified",
            targetType: "user",
            targetId: id,
            details: { email: target.email, via: "admin" },
          },
          db,
        );
      return adminUser(id, db);
    });
  });

  app.delete("/admin/users/:id", async (r, reply) => {
    const actor = await authorize(r, "users:manage");
    const id = idParam(r);
    if (id === actor.id)
      fail(409, "You can't delete your own account from the admin console.");
    await transaction(async (db) => {
      const target = (
        await db.query<{ role: string; disabled: boolean; email: string }>(
          "SELECT role, disabled, email FROM users WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!target) fail(404, "User not found");
      if (
        target.role === "admin" &&
        !target.disabled &&
        (await otherActiveAdmins(id, db)) === 0
      )
        fail(409, LAST_ADMIN);
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
      await db.query("DELETE FROM users WHERE id=$1", [id]);
      await audit(
        {
          actorId: actor.id,
          action: "user.deleted",
          targetType: "user",
          targetId: id,
          details: { email: target.email },
        },
        db,
      );
    });
    return reply.code(204).send();
  });

  app.get("/admin/teams", async (r) => {
    const actor = await authorize(r, "teams:read_all");
    return (
      await reader(r.headers).query<Team>(
        `SELECT ${TEAM_COLUMNS}, (SELECT role FROM team_members WHERE team_id=t.id AND user_id=$1) AS role
         FROM teams t ORDER BY lower(t.name), t.id`,
        [actor.id],
      )
    ).rows;
  });

  app.get("/admin/audit", async (r) => {
    await authorize(r, "audit:read");
    const q = auditQuery.parse(r.query);
    const [rows, total] = await Promise.all([
      reader(r.headers).query<AuditEntry>(
        `SELECT a.id::text, a.actor_id, COALESCE(u.email, a.actor_email) AS actor_email, a.action, a.target_type,
                a.target_id, a.details, a.created_at
         FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id
         ORDER BY a.created_at DESC, a.id DESC LIMIT $1 OFFSET $2`,
        [q.limit, q.offset],
      ),
      reader(r.headers).query<{ n: number }>(
        "SELECT count(*)::int AS n FROM audit_log",
      ),
    ]);
    return { rows: rows.rows, total: total.rows[0].n };
  });
}
