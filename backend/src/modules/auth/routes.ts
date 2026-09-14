import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { credentials, fail } from "@orbyn/core";
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

export async function authRoutes(app: FastifyInstance) {
  // Verified against unknown emails so timing does not reveal whether an account exists.
  const dummyHash = await argon2.hash(randomBytes(32));

  app.post("/auth/register", strictRateLimit, async (r, reply) => {
    const d = credentials.parse(r.body);
    const hash = await argon2.hash(d.password);
    const u = await transaction(async (db) => {
      // Bootstrap: the first account, or any email in ADMIN_EMAILS, is an admin.
      await db.query("SELECT pg_advisory_xact_lock(786241)");
      const noAdmins = !(
        await db.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1")
      ).rowCount;
      const role = noAdmins || adminEmails.has(d.email) ? "admin" : "member";
      const row = (
        await db.query<UserRow>(
          "INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING *",
          [d.email, d.name, hash, role],
        )
      ).rows[0];
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
    reply.code(201);
    return issueSession(u);
  });

  app.post("/auth/login", strictRateLimit, async (r) => {
    const d = credentials.parse(r.body);
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
    return issueSession(u);
  });

  app.post("/auth/logout", async (r, reply) => {
    await authenticate(r);
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      digest(bearerToken(r)),
    ]);
    return reply.code(204).send();
  });
}
