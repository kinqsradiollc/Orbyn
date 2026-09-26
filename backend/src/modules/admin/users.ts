import type { FastifyInstance } from "fastify";
import {
  adminUserProfileUpdate,
  fail,
  type AdminAgentGrant,
  type AdminUserDetail,
} from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { authorize } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { issueToken } from "../auth/tokens.js";
import { sendPasswordResetEmail } from "../auth/mail.js";
import { appLink } from "../booking/service.js";
import { emailEnabled } from "../../worker/channels/email.js";
import { exportData } from "../organize/portability.js";
import { revokeConnections, revokeGrant } from "../agents/service.js";

/**
 * What an admin can do for one account beyond role, disable and delete:
 * see it in full (never the contents of its items), correct its name and
 * email, sign it out everywhere or end one session, revoke one of its
 * personal API keys, issue a password reset link, clear two-step
 * verification for someone locked out, and export its data. Every action is
 * written to the audit log with who did it.
 */
export async function adminUserPowerRoutes(app: FastifyInstance) {
  const exists = async (id: string) => {
    const row = (
      await pool.query<{ email: string; name: string }>(
        "SELECT email, name FROM users WHERE id = $1",
        [id],
      )
    ).rows[0];
    if (!row) fail(404, "User not found");
    return row;
  };

  app.get("/admin/users/:id", async (r): Promise<AdminUserDetail> => {
    await authorize(r, "users:read");
    const id = idParam(r);
    const db = reader(r.headers);
    const user = (
      await db.query(
        `SELECT id, email, name, role, disabled, email_verified, created_at FROM users WHERE id = $1`,
        [id],
      )
    ).rows[0];
    if (!user) fail(404, "User not found");
    const [sessions, security, teams, counts, activity, trail, keys, agents] =
      await Promise.all([
        db.query(
          `SELECT id::text, user_agent, last_seen_at, expires_at FROM sessions
            WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC LIMIT 20`,
          [id],
        ),
        db.query(
          `SELECT
             EXISTS (SELECT 1 FROM user_totp WHERE user_id = $1) AS two_factor,
             (SELECT count(*) FROM webauthn_credentials WHERE user_id = $1)::int AS passkeys,
             (SELECT count(*) FROM api_keys WHERE user_id = $1)::int AS api_keys,
             (SELECT max(day) FROM daily_activity WHERE user_id = $1) AS last_day,
             (SELECT max(last_seen_at) FROM sessions WHERE user_id = $1) AS last_seen`,
          [id],
        ),
        db.query(
          `SELECT t.id, t.name, m.role FROM team_members m JOIN teams t ON t.id = m.team_id
            WHERE m.user_id = $1 ORDER BY lower(t.name)`,
          [id],
        ),
        db.query(
          `SELECT
             (SELECT count(*) FROM items WHERE user_id = $1)::int AS items,
             (SELECT count(*) FROM items WHERE user_id = $1 AND status NOT IN ('done','cancelled'))::int AS open_items,
             (SELECT count(*) FROM docs WHERE user_id = $1)::int AS docs,
             (SELECT count(*) FROM projects WHERE user_id = $1)::int AS projects,
             (SELECT count(*) FROM bookings b JOIN booking_pages p ON p.id = b.page_id
               WHERE p.owner_id = $1)::int AS bookings`,
          [id],
        ),
        db.query(
          `SELECT day::text, requests FROM daily_activity
            WHERE user_id = $1 AND day > current_date - 30 ORDER BY day`,
          [id],
        ),
        // The account's own entries, and its API keys' (made, deleted, revoked).
        db.query(
          `SELECT a.id::text, a.action, COALESCE(u.email, a.actor_email) AS actor_email, a.created_at
             FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
            WHERE (a.target_type = 'user' AND a.target_id = $1)
               OR (a.target_type = 'api_key' AND a.details->>'user_id' = $1)
            ORDER BY a.created_at DESC LIMIT 15`,
          [id],
        ),
        db.query(
          `SELECT id, name, prefix, created_at, last_used_at FROM api_keys
            WHERE user_id = $1 ORDER BY created_at DESC`,
          [id],
        ),
        // Their outside agents' connections (never the credentials).
        db.query<AdminAgentGrant>(
          `SELECT g.id, g.kind, g.name, g.client_name,
                  (SELECT c.host FROM oauth_clients c
                    WHERE c.id = g.client_id AND g.kind = 'oauth') AS client_host,
                  g.access, g.expires_at, g.last_used_at, g.suspended_at, g.created_at
             FROM agent_grants g
            WHERE g.user_id = $1 AND g.revoked_at IS NULL
              AND (g.kind <> 'oauth' OR g.authorized_at IS NOT NULL)
              AND (g.expires_at IS NULL OR g.expires_at > now())
            ORDER BY g.created_at DESC LIMIT 50`,
          [id],
        ),
      ]);
    const sec = security.rows[0];
    const lastSeen: Date | null = sec.last_seen ?? null;
    return {
      ...user,
      last_active: lastSeen ? lastSeen.toISOString() : (sec.last_day ?? null),
      sessions: sessions.rows,
      two_factor: sec.two_factor,
      passkeys: sec.passkeys,
      api_keys: sec.api_keys,
      keys: keys.rows,
      agents: agents.rows,
      teams: teams.rows,
      counts: counts.rows[0],
      activity: activity.rows,
      audit: trail.rows,
    };
  });

  // Correct a name or email (a typo at sign-up, a changed address). A new
  // email is unverified until its owner confirms it, when mail is set up.
  app.put("/admin/users/:id/profile", async (r) => {
    const actor = await authorize(r, "users:manage");
    const id = idParam(r);
    const d = adminUserProfileUpdate.parse(r.body ?? {});
    const before = await exists(id);
    const verifyAgain =
      d.email !== undefined &&
      d.email !== before.email &&
      (await emailEnabled());
    await transaction(async (db) => {
      if (d.email && d.email !== before.email) {
        const taken = (
          await db.query("SELECT 1 FROM users WHERE email = $1 AND id <> $2", [
            d.email,
            id,
          ])
        ).rowCount;
        if (taken) fail(409, "Another account already uses that email.");
      }
      await db.query(
        `UPDATE users SET name = coalesce($2, name), email = coalesce($3, email),
           email_verified = CASE WHEN $4 THEN false ELSE email_verified END
         WHERE id = $1`,
        [id, d.name ?? null, d.email ?? null, verifyAgain],
      );
      await audit(
        {
          actorId: actor.id,
          action: "user.profile_changed",
          targetType: "user",
          targetId: id,
          details: {
            ...(d.name && d.name !== before.name
              ? { name: { from: before.name, to: d.name } }
              : {}),
            ...(d.email && d.email !== before.email
              ? { email: { from: before.email, to: d.email } }
              : {}),
          },
        },
        db,
      );
    });
    return { ok: true as const, verify_again: verifyAgain };
  });

  // Sign out everywhere: a lost phone, a shared computer, a suspected leak.
  app.post("/admin/users/:id/sign-out", async (r) => {
    const actor = await authorize(r, "users:manage");
    const id = idParam(r);
    if (id === actor.id)
      fail(409, "Sign yourself out from Settings → Account instead.");
    const { email } = await exists(id);
    const ended = await transaction(async (db) => {
      const gone = await db.query("DELETE FROM sessions WHERE user_id = $1", [
        id,
      ]);
      // Everywhere includes the agents connected to the account.
      const agents = await revokeConnections(
        db,
        { userId: id },
        "admin_sign_out",
        actor.id,
        r.id,
      );
      await audit(
        {
          actorId: actor.id,
          action: "user.signed_out",
          targetType: "user",
          targetId: id,
          details: { email, sessions: gone.rowCount ?? 0, agents },
        },
        db,
      );
      return gone.rowCount ?? 0;
    });
    return { ended };
  });

  // End one of the account's agent connections (a key or a sign-in).
  app.delete("/admin/users/:id/agents/:grantId", async (r, reply) => {
    const actor = await authorize(r, "users:manage");
    const id = idParam(r);
    const grantId = idParam(r, "grantId");
    await exists(id);
    await revokeGrant(id, grantId, actor.id, "admin", r.id);
    return reply.code(204).send();
  });

  app.delete("/admin/users/:id/sessions/:sessionId", async (r, reply) => {
    const actor = await authorize(r, "users:manage");
    const id = idParam(r);
    const sessionId = (r.params as { sessionId: string }).sessionId;
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) fail(404, "Session not found");
    const { email } = await exists(id);
    await transaction(async (db) => {
      const gone = await db.query(
        "DELETE FROM sessions WHERE user_id = $1 AND id = $2",
        [id, sessionId],
      );
      if (!gone.rowCount) fail(404, "Session not found");
      await audit(
        {
          actorId: actor.id,
          action: "user.session_ended",
          targetType: "user",
          targetId: id,
          details: { email },
        },
        db,
      );
    });
    return reply.code(204).send();
  });

  // Revoke one personal API key: a leaked key, or a script that misbehaves.
  // Whatever used it stops working at once; the owner can make a new one.
  app.delete("/admin/users/:id/api-keys/:keyId", async (r, reply) => {
    const actor = await authorize(r, "users:manage");
    const id = idParam(r);
    const keyId = (r.params as { keyId: string }).keyId;
    if (!/^[0-9a-f-]{36}$/i.test(keyId)) fail(404, "API key not found");
    const { email } = await exists(id);
    await transaction(async (db) => {
      const gone = (
        await db.query<{ id: string; name: string; prefix: string }>(
          "DELETE FROM api_keys WHERE user_id = $1 AND id = $2 RETURNING id, name, prefix",
          [id, keyId],
        )
      ).rows[0];
      if (!gone) fail(404, "API key not found");
      await audit(
        {
          actorId: actor.id,
          action: "api_key.revoked",
          targetType: "api_key",
          targetId: gone.id,
          details: { user_id: id, email, name: gone.name, prefix: gone.prefix },
        },
        db,
      );
    });
    return reply.code(204).send();
  });

  // A password reset link for someone who can't get the email: it is shown to
  // the admin to pass on, and emailed as well when mail is set up. Good for
  // an hour, once, like the emailed kind.
  app.post("/admin/users/:id/reset-link", async (r) => {
    const actor = await authorize(r, "users:manage");
    const id = idParam(r);
    const user = await exists(id);
    const token = await transaction(async (db) => {
      const t = await issueToken(db, id, "reset");
      await audit(
        {
          actorId: actor.id,
          action: "user.reset_link_issued",
          targetType: "user",
          targetId: id,
          details: { email: user.email },
        },
        db,
      );
      return t;
    });
    let emailed = false;
    if (await emailEnabled()) {
      emailed = await sendPasswordResetEmail(user, token).then(
        () => true,
        () => false,
      );
    }
    return {
      link: appLink(`/reset-password?token=${token}`),
      expires_in_minutes: 60,
      emailed,
    };
  });

  // Someone who lost their authenticator can't sign in: clear two-step
  // verification so their password alone works again. Passkeys are theirs to
  // manage and stay.
  app.post("/admin/users/:id/reset-2fa", async (r) => {
    const actor = await authorize(r, "users:manage");
    const id = idParam(r);
    const { email } = await exists(id);
    const cleared = await transaction(async (db) => {
      const gone = await db.query("DELETE FROM user_totp WHERE user_id = $1", [
        id,
      ]);
      await audit(
        {
          actorId: actor.id,
          action: "user.two_factor_reset",
          targetType: "user",
          targetId: id,
          details: { email, had_two_factor: (gone.rowCount ?? 0) > 0 },
        },
        db,
      );
      return (gone.rowCount ?? 0) > 0;
    });
    return { cleared };
  });

  // Everything the account holds, as the person's own export would give it:
  // for a data request, or before deleting an account.
  app.get("/admin/users/:id/export", async (r, reply) => {
    const actor = await authorize(r, "users:manage");
    const id = idParam(r);
    const { email } = await exists(id);
    const data = await exportData(pool, id);
    await audit({
      actorId: actor.id,
      action: "user.exported",
      targetType: "user",
      targetId: id,
      details: { email },
    });
    reply.header(
      "content-disposition",
      `attachment; filename="orbyn-export-${email.replace(/[^\w.-]/g, "_")}.json"`,
    );
    return data;
  });
}
