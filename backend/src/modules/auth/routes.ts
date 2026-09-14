import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { credentials, fail } from "@orbyn/core";
import { pool } from "../../db/pool.js";
import {
  authenticate,
  bearerToken,
  digest,
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
    const u = (
      await pool.query<UserRow>(
        "INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) RETURNING *",
        [d.email, d.name, hash],
      )
    ).rows[0];
    reply.code(201);
    return issueSession(u);
  });

  app.post("/auth/login", strictRateLimit, async (r) => {
    const d = credentials.parse(r.body);
    const u = (
      await pool.query<UserRow>("SELECT * FROM users WHERE email=$1", [d.email])
    ).rows[0];
    const valid = await argon2.verify(
      u?.password_hash || dummyHash,
      d.password,
    );
    if (!u || !valid) fail(401, "Email or password is incorrect");
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
