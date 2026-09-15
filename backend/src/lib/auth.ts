import { createHash, randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
  fail,
  hasSystemPermission,
  type AuthResponse,
  type SystemPermission,
  type SystemRole,
  type User,
} from "@orbyn/core";
import { pool } from "../db/pool.js";

export type UserRow = User & {
  password_hash: string;
  disabled: boolean;
  created_at: string;
};

export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");

export const publicUser = (u: UserRow | Record<string, unknown>): User => ({
  id: u.id as string,
  email: u.email as string,
  name: u.name as string,
  email_reminders: u.email_reminders as boolean,
  role: u.role as SystemRole,
});

export const DISABLED_MESSAGE =
  "This account has been disabled. Contact your Orbyn administrator.";

/** Resolve the bearer token on a request to its user, or fail with 401/403. */
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
  if (u.disabled) fail(403, DISABLED_MESSAGE);
  return u;
}

/** Authenticate and require a system permission (admin console routes). */
export async function authorize(
  r: FastifyRequest,
  permission: SystemPermission,
): Promise<UserRow> {
  const u = await authenticate(r);
  if (!hasSystemPermission(u.role, permission))
    fail(403, "You don't have permission to do that.");
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
