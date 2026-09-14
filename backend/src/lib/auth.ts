import { createHash, randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { fail, type AuthResponse, type User } from "@orbyn/core";
import { pool } from "../db/pool.js";

export type UserRow = User & { password_hash: string };

export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");

export const publicUser = (u: UserRow | Record<string, unknown>): User => ({
  id: u.id as string,
  email: u.email as string,
  name: u.name as string,
  email_reminders: u.email_reminders as boolean,
});

/** Resolve the bearer token on a request to its user, or fail with 401. */
export async function authenticate(r: FastifyRequest): Promise<UserRow> {
  const token = r.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) fail(401, "Please sign in");
  const u = (
    await pool.query<UserRow>(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [digest(token)],
    )
  ).rows[0];
  if (!u) fail(401, "Session expired. Please sign in again.");
  return u;
}

/** Create a new opaque session token for a user. Only its hash is stored. */
export async function issueSession(u: UserRow): Promise<AuthResponse> {
  const token = randomBytes(48).toString("base64url");
  await pool.query("INSERT INTO sessions(token_hash,user_id) VALUES($1,$2)", [
    digest(token),
    u.id,
  ]);
  return { token, user: publicUser(u) };
}

export const bearerToken = (r: FastifyRequest) =>
  r.headers.authorization!.slice("Bearer ".length);
