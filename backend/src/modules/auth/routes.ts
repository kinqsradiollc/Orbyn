import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import {
  agreementVersion,
  credentials,
  emailToken,
  fail,
  forgotPassword,
  loginCredentials,
  passkeyAuth,
  passkeyAuthOptions,
  passkeyRegister,
  reauthInput,
  resetPassword,
  REAUTH_WINDOW_MINUTES,
  twoFactorDisable,
  twoFactorEnable,
  type Reauthenticated,
  type TwoFactorEnabled,
  type TwoFactorSetup,
  type TwoFactorStatus,
  type Passkey,
} from "@orbyn/core";
import { adminEmails } from "../../config/env.js";
import { pool, transaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import {
  authenticate,
  bearerToken,
  digest,
  DISABLED_MESSAGE,
  issueSession,
  type UserRow,
} from "../../lib/auth.js";
import { strictRateLimit } from "../../lib/params.js";
import { emailEnabled } from "../../worker/channels/email.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "./mail.js";
import { issueToken, pruneExpiredTokens, spendToken } from "./tokens.js";
import {
  authenticationOptions,
  listPasskeys,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "./webauthn.js";
import { TOTP_REQUIRED, enforceTwoFactor, twoFactorOn } from "./twoFactor.js";
import { revokeConnections } from "../agents/service.js";
import { settings } from "../../lib/settings.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import {
  generateSecret,
  otpauthUri,
  recoveryCode,
  verifyTotp,
} from "../../lib/totp.js";

export async function authRoutes(app: FastifyInstance) {
  // Verified against unknown emails so timing does not reveal whether an account exists.
  const dummyHash = await argon2.hash(randomBytes(32));

  app.post("/auth/register", strictRateLimit, async (r, reply) => {
    const d = credentials.parse(r.body);
    const hash = await argon2.hash(d.password);
    const pending: (() => Promise<void>)[] = [];
    const u = await transaction(async (db) => {
      // Bootstrap: the first account, or any email in ADMIN_EMAILS, is an admin.
      await db.query("SELECT pg_advisory_xact_lock(786241)");
      const noAdmins = !(
        await db.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1")
      ).rowCount;
      const isAdmin = noAdmins || adminEmails.has(d.email);
      const role = isAdmin ? "admin" : "member";
      // Admins are trusted so they can set the workspace up (including mail).
      // Otherwise confirmation is required only when mail can actually be
      // sent; without a mail server there is no way to confirm an address.
      const verified = isAdmin || !(await emailEnabled());
      // Agreeing on the form counts only for the version in force now; an
      // older one is asked for again once signed in.
      const terms =
        d.accept_terms === agreementVersion((await settings()).legal)
          ? d.accept_terms
          : null;
      const row = (
        await db.query<UserRow>(
          `INSERT INTO users(email,name,password_hash,role,email_verified,terms_version,terms_accepted_at)
           VALUES($1,$2,$3,$4,$5,$6::text,CASE WHEN $6::text IS NULL THEN NULL ELSE now() END) RETURNING *`,
          [d.email, d.name, hash, role, verified, terms],
        )
      ).rows[0];
      if (terms)
        await db.query(
          "INSERT INTO consent_log (user_id, kind, version, granted, user_agent) VALUES ($1, 'terms', $2, true, $3)",
          [row.id, terms, String(r.headers["user-agent"] ?? "").slice(0, 400)],
        );
      if (!verified) {
        const token = await issueToken(db, row.id, "verify");
        // Sent after the row is committed, so the link always resolves.
        pending.push(() => sendVerificationEmail(row, token));
      }
      await audit(
        {
          actorId: row.id,
          action: "user.registered",
          targetType: "user",
          targetId: row.id,
          details: { email: row.email, role },
        },
        db,
      );
      return row;
    });
    for (const job of pending) await job();
    reply.code(201);
    return issueSession(u, r.headers["user-agent"] ?? "");
  });

  // Confirm an email address from the link. Works signed in or not, so the
  // link opens in any browser; a spent or expired link says so plainly.
  app.post("/auth/verify-email", strictRateLimit, async (r, reply) => {
    const { token } = emailToken.parse(r.body);
    const userId = await transaction(async (db) => {
      const id = await spendToken(db, token, "verify");
      if (id)
        await db.query("UPDATE users SET email_verified=true WHERE id=$1", [
          id,
        ]);
      return id;
    });
    if (!userId)
      fail(
        410,
        "This link has expired or was already used. Ask for a new one.",
      );
    await audit({
      actorId: userId,
      action: "user.email_verified",
      targetType: "user",
      targetId: userId,
      details: { via: "link" },
    });
    return reply.code(204).send();
  });

  // Re-send the confirmation email to the signed-in user who needs it.
  app.post("/auth/resend-verification", strictRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    if (u.email_verified) return reply.code(204).send();
    await pruneExpiredTokens();
    const token = await transaction((db) => issueToken(db, u.id, "verify"));
    await sendVerificationEmail(u, token);
    return reply.code(204).send();
  });

  // Ask for a password-reset link. Always answered the same way, so it never
  // reveals whether an account exists.
  app.post("/auth/forgot-password", strictRateLimit, async (r, reply) => {
    const { email } = forgotPassword.parse(r.body);
    if (await emailEnabled()) {
      await pruneExpiredTokens();
      const u = (
        await pool.query<UserRow>(
          "SELECT * FROM users WHERE email=$1 AND disabled=false",
          [email],
        )
      ).rows[0];
      if (u) {
        const token = await transaction((db) => issueToken(db, u.id, "reset"));
        await sendPasswordResetEmail(u, token);
      }
    }
    return reply.code(204).send();
  });

  // Set a new password from a reset link. Ends every other session and signs
  // the user straight in. Proving control of the mailbox also confirms it.
  app.post("/auth/reset-password", strictRateLimit, async (r) => {
    const d = resetPassword.parse(r.body);
    const hash = await argon2.hash(d.password);
    const u = await transaction(async (db) => {
      const userId = await spendToken(db, d.token, "reset");
      if (!userId)
        fail(
          410,
          "This link has expired or was already used. Ask for a new one.",
        );
      const row = (
        await db.query<UserRow>(
          `UPDATE users SET password_hash=$2, email_verified=true
             WHERE id=$1 AND disabled=false RETURNING *`,
          [userId, hash],
        )
      ).rows[0];
      if (!row) fail(403, DISABLED_MESSAGE);
      // Old sessions may be on someone else's device: end them all, and
      // every agent connected under the old password with them.
      await db.query("DELETE FROM sessions WHERE user_id=$1", [row.id]);
      await revokeConnections(
        db,
        { userId: row.id },
        "password_reset",
        row.id,
        r.id,
      );
      await audit(
        {
          actorId: row.id,
          action: "user.password_reset",
          targetType: "user",
          targetId: row.id,
          details: { email: row.email },
        },
        db,
      );
      return row;
    });
    return issueSession(u, r.headers["user-agent"] ?? "");
  });

  app.post("/auth/login", strictRateLimit, async (r) => {
    const d = loginCredentials.parse(r.body);
    let u = (
      await pool.query<UserRow>("SELECT * FROM users WHERE email=$1", [d.email])
    ).rows[0];
    const valid = await argon2.verify(
      u?.password_hash || dummyHash,
      d.password,
    );
    if (!u || !valid) fail(401, "Email or password is incorrect");
    // Checked only after the password so disabled status is not probeable.
    if (u.disabled) fail(403, DISABLED_MESSAGE);
    // And two-step, if this account has it on.
    await enforceTwoFactor(u.id, d.code);
    if (adminEmails.has(u.email) && u.role !== "admin") {
      u = (
        await pool.query<UserRow>(
          "UPDATE users SET role='admin' WHERE id=$1 RETURNING *",
          [u.id],
        )
      ).rows[0];
      await audit({
        actorId: null,
        action: "user.role_changed",
        targetType: "user",
        targetId: u.id,
        details: {
          email: u.email,
          from: "member",
          to: "admin",
          via: "ADMIN_EMAILS",
        },
      });
    }
    return issueSession(u, r.headers["user-agent"] ?? "", {
      reauthenticated: true,
    });
  });

  // Confirming it's you again, without a new session: the password (and a
  // two-step code when it's on) or a passkey. Marks this session as just
  // signed in for the next few minutes, which granting an outside agent
  // write access needs. Failures are 403, never 401: a wrong password here
  // mustn't sign the app out.
  app.post("/me/reauth/options", strictRateLimit, async (r) => {
    const u = await authenticate(r);
    return authenticationOptions(u.email);
  });
  app.post(
    "/me/reauth",
    strictRateLimit,
    async (r): Promise<Reauthenticated> => {
      const u = await authenticate(r);
      const d = reauthInput.parse(r.body);
      let how: "password" | "passkey";
      if ("password" in d) {
        const row = (
          await pool.query<UserRow>("SELECT * FROM users WHERE id=$1", [u.id])
        ).rows[0];
        if (!(await argon2.verify(row.password_hash, d.password)))
          fail(403, "That password is incorrect.");
        try {
          await enforceTwoFactor(u.id, d.code || undefined);
        } catch (e) {
          if ((e as Error).message === TOTP_REQUIRED) fail(403, TOTP_REQUIRED);
          fail(403, "That code didn't work. Try again.");
        }
        how = "password";
      } else {
        const who = await verifyAuthentication(d.handle, d.response as never);
        if (who !== u.id)
          fail(
            403,
            "That passkey didn't work. Try again, or use your password.",
          );
        how = "passkey";
      }
      const at = (
        await pool.query<{ reauthenticated_at: Date }>(
          `UPDATE sessions SET reauthenticated_at = now() WHERE token_hash = $1
           RETURNING reauthenticated_at`,
          [digest(bearerToken(r))],
        )
      ).rows[0].reauthenticated_at;
      await audit({
        actorId: u.id,
        action: "user.reauthenticated",
        targetType: "user",
        targetId: u.id,
        details: { how },
        requestId: r.id,
      });
      return {
        reauth_until: new Date(
          at.getTime() + REAUTH_WINDOW_MINUTES * 60_000,
        ).toISOString(),
      };
    },
  );

  // Two-step verification. Setup stores an unconfirmed secret; enable proves a
  // code works and hands back one-time recovery codes; disable needs the
  // password. All are on the signed-in account.
  app.get("/me/2fa", async (r): Promise<TwoFactorStatus> => {
    const u = await authenticate(r);
    return { enabled: await twoFactorOn(pool, u.id) };
  });

  app.post(
    "/me/2fa/setup",
    strictRateLimit,
    async (r): Promise<TwoFactorSetup> => {
      const u = await authenticate(r);
      if (await twoFactorOn(pool, u.id))
        fail(409, "Two-step is already on. Turn it off first to start over.");
      const secret = generateSecret();
      await pool.query(
        `INSERT INTO user_totp (user_id, secret_encrypted, confirmed_at, recovery_hashes)
         VALUES ($1, $2, NULL, '{}')
       ON CONFLICT (user_id) DO UPDATE SET secret_encrypted = $2, confirmed_at = NULL, recovery_hashes = '{}'`,
        [u.id, await encryptSecret(secret)],
      );
      return { secret, otpauth_uri: otpauthUri(secret, u.email) };
    },
  );

  app.post(
    "/me/2fa/enable",
    strictRateLimit,
    async (r): Promise<TwoFactorEnabled> => {
      const u = await authenticate(r);
      const { code } = twoFactorEnable.parse(r.body);
      return transaction(async (db) => {
        const row = (
          await db.query<{
            secret_encrypted: string;
            confirmed_at: Date | null;
          }>(
            "SELECT secret_encrypted, confirmed_at FROM user_totp WHERE user_id=$1 FOR UPDATE",
            [u.id],
          )
        ).rows[0];
        if (!row) fail(409, "Start two-step setup first.");
        if (row.confirmed_at) fail(409, "Two-step is already on.");
        const secret = await decryptSecret(row.secret_encrypted);
        if (!verifyTotp(secret, code))
          fail(
            422,
            "That code didn't work. Check your authenticator and try again.",
          );
        const codes = Array.from({ length: 10 }, () => recoveryCode());
        await db.query(
          "UPDATE user_totp SET confirmed_at = now(), recovery_hashes = $2 WHERE user_id=$1",
          [u.id, codes.map((c) => digest(c))],
        );
        await audit({
          actorId: u.id,
          action: "user.two_factor_enabled",
          targetType: "user",
          targetId: u.id,
        });
        return { recovery_codes: codes };
      });
    },
  );

  app.post("/me/2fa/disable", strictRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    const { password } = twoFactorDisable.parse(r.body);
    const row = (
      await pool.query<UserRow>("SELECT * FROM users WHERE id=$1", [u.id])
    ).rows[0];
    if (!(await argon2.verify(row.password_hash, password)))
      fail(403, "That password is incorrect.");
    await pool.query("DELETE FROM user_totp WHERE user_id=$1", [u.id]);
    await audit({
      actorId: u.id,
      action: "user.two_factor_disabled",
      targetType: "user",
      targetId: u.id,
    });
    return reply.code(204).send();
  });

  // Passkeys (WebAuthn), additive to the password.
  app.get("/me/passkeys", async (r): Promise<Passkey[]> => {
    const u = await authenticate(r);
    return listPasskeys(u.id);
  });
  app.post("/me/passkeys/options", strictRateLimit, async (r) => {
    const u = await authenticate(r);
    return registrationOptions(u.id, u.email);
  });
  app.post("/me/passkeys", strictRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    const d = passkeyRegister.parse(r.body);
    const ok = await verifyRegistration(u.id, d.response as never, d.name);
    if (!ok) fail(400, "That passkey couldn't be verified. Try again.");
    return reply.code(201).send({ ok: true });
  });
  app.delete("/me/passkeys/:id", async (r, reply) => {
    const u = await authenticate(r);
    const gone = await pool.query(
      "DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2",
      [(r.params as { id: string }).id, u.id],
    );
    if (!gone.rowCount) fail(404, "Passkey not found");
    return reply.code(204).send();
  });

  // Sign in with a passkey: fetch options, then send the assertion back.
  app.post("/auth/passkey/options", strictRateLimit, async (r) => {
    const d = passkeyAuthOptions.parse(r.body ?? {});
    return authenticationOptions(d.email);
  });
  app.post("/auth/passkey", strictRateLimit, async (r) => {
    const d = passkeyAuth.parse(r.body);
    const userId = await verifyAuthentication(d.handle, d.response as never);
    if (!userId)
      fail(401, "That passkey didn't work. Try again, or use your password.");
    const u = (
      await pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [userId])
    ).rows[0];
    if (!u || u.disabled) fail(403, DISABLED_MESSAGE);
    return issueSession(u, r.headers["user-agent"] ?? "", {
      reauthenticated: true,
    });
  });

  app.post("/auth/logout", async (r, reply) => {
    await authenticate(r);
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      digest(bearerToken(r)),
    ]);
    return reply.code(204).send();
  });
}
