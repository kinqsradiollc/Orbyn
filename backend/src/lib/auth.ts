import { createHash, randomBytes } from "node:crypto";
import { analyticsOptOut, requestUser } from "./request-log.js";
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
  /** Whether teammates may see when they are active (presence). */
  share_presence?: boolean;
};

export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");

export const publicUser = (u: UserRow | Record<string, unknown>): User => ({
  id: u.id as string,
  email: u.email as string,
  name: u.name as string,
  email_reminders: u.email_reminders as boolean,
  email_verified: u.email_verified as boolean,
  role: u.role as SystemRole,
  handle: (u.handle as string | null | undefined) ?? null,
  bio: (u.bio as string | undefined) ?? "",
  terms_version: (u.terms_version as string | null | undefined) ?? null,
  analytics_opt_out: !!u.analytics_opt_out,
});

/** API key ids by key hash, so rate limiting needn't ask the database each time. */
const keyIds = new Map<string, { id: string | null; at: number }>();
const KEY_CACHE_MS = 60_000;

/**
 * The id of the personal API key a request is signed with, or null (no key,
 * or not a valid one). Rate limits count API-key requests per key.
 */
export async function apiKeyId(r: FastifyRequest): Promise<string | null> {
  const token = r.headers.authorization?.match(/^Bearer (ok_\S+)$/)?.[1];
  if (!token) return null;
  const hash = digest(token);
  const hit = keyIds.get(hash);
  if (hit && Date.now() - hit.at < KEY_CACHE_MS) return hit.id;
  const id =
    (
      await pool.query<{ id: string }>(
        "SELECT id FROM api_keys WHERE key_hash = $1",
        [hash],
      )
    ).rows[0]?.id ?? null;
  if (keyIds.size > 5000) keyIds.clear();
  keyIds.set(hash, { id, at: Date.now() });
  return id;
}

export const DISABLED_MESSAGE =
  "This account has been disabled. Contact your Orbyn administrator.";

export const UNVERIFIED_MESSAGE =
  "Please confirm your email address to continue. Check your inbox for the link, or ask for a new one.";

/**
 * Routes an unverified user may still reach: reading who they are, signing
 * out, and confirming or re-sending their verification email. Everything else
 * is blocked until the address is confirmed. Matched against the route
 * pattern (`request.routeOptions.url`), not the raw path.
 */
const VERIFICATION_EXEMPT = new Set([
  "/me",
  "/auth/logout",
  "/auth/verify-email",
  "/auth/resend-verification",
]);

/** Fail when `u` hasn't confirmed their email and this route requires it. */
function requireVerified(r: FastifyRequest, u: UserRow) {
  if (u.email_verified) return;
  if (VERIFICATION_EXEMPT.has(r.routeOptions?.url ?? "")) return;
  fail(403, UNVERIFIED_MESSAGE);
}

/** Requests signed in with a personal API key rather than a session. */
const viaApiKey = new WeakSet<FastifyRequest>();

/**
 * Resolve the bearer token on a request to its user, or fail with 401/403.
 * The token is a session token, or a personal API key (starting "ok_").
 */
export async function authenticate(r: FastifyRequest): Promise<UserRow> {
  const token = r.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) fail(401, "Please sign in");
  if (token.startsWith("ok_")) {
    const u = (
      await pool.query<UserRow>(
        "SELECT u.* FROM users u JOIN api_keys k ON k.user_id=u.id WHERE k.key_hash=$1",
        [digest(token)],
      )
    ).rows[0];
    if (!u)
      fail(401, "That API key isn't valid. Create a new one in Settings.");
    if (u.disabled) fail(403, DISABLED_MESSAGE);
    // Recorded at most once a minute, so busy scripts don't write on every call.
    await pool.query(
      "UPDATE api_keys SET last_used_at=now() WHERE key_hash=$1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
      [digest(token)],
    );
    viaApiKey.add(r);
    requireVerified(r, u);
    requestUser.set(r, u.id);
    if (u.analytics_opt_out) analyticsOptOut.add(r);
    return u;
  }
  const u = (
    await pool.query<UserRow>(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [digest(token)],
    )
  ).rows[0];
  if (!u) fail(401, "Session expired. Please sign in again.");
  if (u.disabled) fail(403, DISABLED_MESSAGE);
  requireVerified(r, u);
  // Recorded at most once a minute, so it doesn't write on every request.
  // Using the app keeps you signed in: a session expires after 30 days
  // without use, not 30 days after signing in.
  await pool.query(
    `UPDATE sessions SET last_seen_at=now(), expires_at=greatest(expires_at, now() + interval '30 days')
      WHERE token_hash=$1 AND last_seen_at < now() - interval '1 minute'`,
    [digest(token)],
  );
  requestUser.set(r, u.id);
  if (u.analytics_opt_out) analyticsOptOut.add(r);
  return u;
}

/** Authenticate and require a system permission (admin console routes). */
export async function authorize(
  r: FastifyRequest,
  permission: SystemPermission,
): Promise<UserRow> {
  const u = await authenticate(r);
  if (viaApiKey.has(r))
    fail(
      403,
      "API keys can't use the admin console. Sign in to the app instead.",
    );
  if (!hasSystemPermission(u.role, permission))
    fail(403, "You don't have permission to do that.");
  return u;
}

/** Create a new opaque session token for a user. Only its hash is stored. */
export async function issueSession(
  u: UserRow,
  userAgent = "",
): Promise<AuthResponse> {
  const token = randomBytes(48).toString("base64url");
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,user_agent) VALUES($1,$2,$3)",
    [digest(token), u.id, userAgent.slice(0, 400)],
  );
  return { token, user: publicUser(u) };
}

export const bearerToken = (r: FastifyRequest) =>
  r.headers.authorization!.slice("Bearer ".length);
