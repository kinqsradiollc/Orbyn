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
 * Users as authenticate() returned them for a signed-in app session (not an
 * API key). Only these carry a system admin's powers outside the admin
 * console, such as acting as owner of any team (requireTeam). A copy of the
 * user, or one resolved from a key, is never in here.
 */
const sessionUsers = new WeakSet<object>();

/** Whether `actor` is a user signed in to the app, rather than a key or a copy. */
export const isSessionPrincipal = (actor: object) => sessionUsers.has(actor);

/** Whether this request was signed with a personal API key. */
export const isApiKeyRequest = (r: FastifyRequest) => viaApiKey.has(r);

export const KEY_BLOCKED_MESSAGE =
  "Personal API keys can't change your account settings, sign-in, webhooks or devices, make or remove other keys, or use the assistant. Sign in to Orbyn to do that.";

/**
 * What a personal API key may never do, although it otherwise acts as its
 * owner: change the account's settings or how it signs in, mint more access,
 * send data somewhere new, agree to anything for its owner, or spend the
 * hosted assistant. A leaked key must not be able to lock its owner out.
 * Keys keep items, pages and the calendar over REST, and CalDAV, and may
 * read the account's settings. Matched on the method and the route pattern.
 * (Deleting a key is refused in its route unless it's the calling key.)
 */
const KEY_BLOCKED: { method?: string; route: RegExp }[] = [
  { method: "POST", route: /^\/me\/api-keys$/ },
  { route: /^\/me\/(?:webhooks|chat|sessions|2fa|passkeys)(?:\/|$)/ },
  { route: /^\/me\/export$/ },
  // Account settings: email reminders, deleting the account, the public
  // profile, privacy choices, the time zone, agreeing to the Terms, the
  // email-to-task address and the calendar feed link. Reading them is fine.
  { method: "PUT", route: /^\/me$/ },
  { method: "DELETE", route: /^\/me$/ },
  { method: "PUT", route: /^\/me\/(?:profile|privacy)$/ },
  { method: "POST", route: /^\/me\/timezone$/ },
  { method: "POST", route: /^\/me\/consent$/ },
  { method: "POST", route: /^\/me\/inbox\/rotate$/ },
  { method: "DELETE", route: /^\/me\/inbox$/ },
  { method: "POST", route: /^\/me\/calendar-feed$/ },
  { method: "PUT", route: /^\/me\/calendar-feed$/ },
  { method: "DELETE", route: /^\/me\/calendar-feed$/ },
  // Push devices: a phone added by a key would keep getting reminders after
  // the key is gone. The apps register theirs signed in.
  { route: /^\/devices$/ },
  // Outside agents: a key can't make agent keys or see and revoke
  // connections; only a signed-in person can.
  { route: /^\/me\/(?:agents|agent-keys)(?:\/|$)/ },
  // The hosted assistant: chat, drafts, study help, and applying proposals.
  { route: /^\/ai\// },
  { route: /^\/docs\/:id\/(?:assist|ask)$/ },
];

/** Whether an API key is refused on this request's route. */
export function keyBlocked(r: FastifyRequest) {
  const route = r.routeOptions?.url ?? "";
  return KEY_BLOCKED.some(
    (b) => (!b.method || b.method === r.method) && b.route.test(route),
  );
}

/**
 * The user and key behind a personal API key, for the MCP service's legacy
 * grant (no route checks: MCP decides what a legacy key may do). null when
 * it isn't a valid key.
 */
export async function apiKeyOwner(
  token: string,
): Promise<{ user: UserRow; key_id: string; key_name: string } | null> {
  const row = (
    await pool.query<UserRow & { key_id: string; key_name: string }>(
      `SELECT u.*, k.id AS key_id, k.name AS key_name
         FROM users u JOIN api_keys k ON k.user_id = u.id
        WHERE k.key_hash = $1`,
      [digest(token)],
    )
  ).rows[0];
  if (!row) return null;
  const { key_id, key_name, ...user } = row;
  return { user: user as UserRow, key_id, key_name };
}

/** The user a personal API key belongs to, or a 401/403. */
async function keyUser(r: FastifyRequest, token: string): Promise<UserRow> {
  const u = (
    await pool.query<UserRow>(
      "SELECT u.* FROM users u JOIN api_keys k ON k.user_id=u.id WHERE k.key_hash=$1",
      [digest(token)],
    )
  ).rows[0];
  if (!u) fail(401, "That API key isn't valid. Create a new one in Settings.");
  if (u.disabled) fail(403, DISABLED_MESSAGE);
  viaApiKey.add(r);
  if (keyBlocked(r)) fail(403, KEY_BLOCKED_MESSAGE);
  // Recorded at most once a minute, so busy scripts don't write on every call.
  await pool.query(
    "UPDATE api_keys SET last_used_at=now() WHERE key_hash=$1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
    [digest(token)],
  );
  requireVerified(r, u);
  requestUser.set(r, u.id);
  if (u.analytics_opt_out) analyticsOptOut.add(r);
  return u;
}

/**
 * Credentials made for outside agents: access tokens (oat_), refresh tokens
 * (ort_) and agent keys (oak_). They belong to the MCP address alone.
 */
export const AGENT_TOKEN = /^(?:oat|ort|oak)_/;

/**
 * What an agent credential's requests count against in the general rate
 * limit: the credential itself (a hash of it), never the address it comes
 * from. null for anything else.
 */
export function agentTokenKey(r: FastifyRequest): string | null {
  const token = r.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  return token && AGENT_TOKEN.test(token)
    ? `agent:${digest(token).slice(0, 32)}`
    : null;
}

export const AGENT_TOKEN_MESSAGE =
  "Agent keys and agent sign-ins work only with Orbyn's MCP address, not the API.";

/**
 * Resolve the bearer token on a request to its user, or fail with 401/403.
 * The token is a session token, or a personal API key (starting "ok_"),
 * which is refused on the routes in KEY_BLOCKED. Agent credentials (oat_,
 * ort_, oak_) are refused everywhere here: their audience is the MCP
 * service, which has its own authenticator.
 */
export async function authenticate(r: FastifyRequest): Promise<UserRow> {
  const token = r.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) fail(401, "Please sign in");
  if (AGENT_TOKEN.test(token)) fail(401, AGENT_TOKEN_MESSAGE);
  if (token.startsWith("ok_")) return keyUser(r, token);
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
  sessionUsers.add(u);
  return u;
}

/** Authenticate and require a system permission (admin console routes). */
export async function authorize(
  r: FastifyRequest,
  permission: SystemPermission,
): Promise<UserRow> {
  // authenticate() already refuses agent credentials; keys are refused here.
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
