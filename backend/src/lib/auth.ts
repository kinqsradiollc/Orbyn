import { createHash, randomBytes } from "node:crypto";
import { analyticsOptOut, requestUser } from "./request-log.js";
import { onAuthChange } from "./auth-events.js";
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
  /** When the first run was finished or skipped (DSN-02). */
  first_run_at?: string | null;
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
  first_run_done: (u as { first_run_at?: unknown }).first_run_at !== null,
  purpose: (u.purpose as User["purpose"] | undefined) ?? null,
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
  "Personal API keys can't change your account settings, sign-in, webhooks or devices, make or remove other keys, change what outside agents can reach, publish to the web, or use the assistant. Sign in to Orbyn to do that.";

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
  // The account export, as JSON or as the .zip with every page in it.
  { route: /^\/me\/export(?:\.zip)?$/ },
  // Account settings: email reminders, deleting the account, the public
  // profile, privacy choices, keeping uploaded originals, the time zone, agreeing to the Terms, the
  // email-to-task address and the calendar feed link. Reading them is fine.
  { method: "PUT", route: /^\/me$/ },
  { method: "DELETE", route: /^\/me$/ },
  { method: "PUT", route: /^\/me\/(?:profile|privacy|originals)$/ },
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
  // connections, or reopen a team to agents (a team's agent policy); only a
  // signed-in person can.
  { route: /^\/me\/(?:agents|agent-keys)(?:\/|$)/ },
  // The Review inbox: approving, declining or undoing an agent's changes is
  // for the person signed in, never a key.
  { route: /^\/proposals(?:\/|$)/ },
  { method: "PUT", route: /^\/teams\/:id\/agent-access$/ },
  // Letting a project kept out of the assistant back in widens what agents
  // (and the assistant) can read, so it is a signed-in person's call too.
  { method: "PUT", route: /^\/projects\/:id\/assistant$/ },
  // Connecting an agent (the consent page) and confirming it's you before
  // granting one write access: a signed-in person only.
  { route: /^\/oauth\// },
  { route: /^\/me\/reauth(?:\/|$)/ },
  // Publishing to the public web is people only: a key can't make a page
  // or folder public, change its password, description or noindex, or turn
  // a team's publishing switch. Reading how it is published, and taking a
  // page off the web, stay open.
  { method: "PUT", route: /^\/(?:docs|folders)\/:id\/publish$/ },
  { method: "PUT", route: /^\/docs\/:id\/web-description$/ },
  { method: "PUT", route: /^\/teams\/:id\/publishing$/ },
  // The guided first run, and skipping it: the person's own start.
  { method: "POST", route: /^\/me\/first-run(?:\/skip)?$/ },
  // The hosted assistant: chat, drafts, study help, and applying proposals.
  { route: /^\/ai\// },
  // Choices that follow the account, Clipper keys (more access), and a
  // team's switches: people only.
  { method: "PUT", route: /^\/me\/prefs$/ },
  { method: "DELETE", route: /^\/me\/prefs$/ },
  { route: /^\/me\/clip-keys(?:\/|$)/ },
  { method: "PUT", route: /^\/teams\/:id\/policies$/ },
  { route: /^\/docs\/:id\/(?:assist|ask)$/ },
];

/** Whether an API key is refused on `method` + route pattern (`/teams/:id`). */
export const keyBlockedRoute = (method: string, route: string) =>
  KEY_BLOCKED.some(
    (b) => (!b.method || b.method === method) && b.route.test(route),
  );

/** Whether an API key is refused on this request's route. */
export const keyBlocked = (r: FastifyRequest) =>
  keyBlockedRoute(r.method, r.routeOptions?.url ?? "");

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

/** The MCP address and its protected-resource metadata: where agent credentials belong. */
export function isMcpPath(url: string | undefined): boolean {
  const path = (url ?? "").split("?")[0];
  return (
    path === "/mcp" || path.startsWith("/.well-known/oauth-protected-resource")
  );
}

/**
 * The OAuth endpoints apps call themselves (metadata, token, revoke,
 * register), which answer any origin.
 */
export function isOAuthOpenPath(url: string | undefined): boolean {
  const path = (url ?? "").split("?")[0];
  return (
    path === "/.well-known/oauth-authorization-server" ||
    path === "/oauth/token" ||
    path === "/oauth/revoke" ||
    path === "/oauth/register"
  );
}

/** Live connections by credential hash (null: not a live one), for rate limiting. */
const grantIds = new Map<string, { id: string | null; at: number }>();

// A revoked connection, a blocked app or a person signed out everywhere
// (on any copy) stops counting as live here at once.
onAuthChange(() => {
  grantIds.clear();
  keyIds.clear();
});

/**
 * What an agent's requests count against in the general rate limit: its
 * connection, never the address it comes from. Only on the MCP address, and
 * only once the credential is known to belong to a live connection, so a
 * made-up oak_… (a fresh one per request) counts against its address like
 * any other request and can't slip past per-address limits such as the
 * sign-in one. null otherwise.
 */
export async function agentLimitKey(r: FastifyRequest): Promise<string | null> {
  if (!isMcpPath(r.url)) return null;
  const token = r.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!token || !AGENT_TOKEN.test(token)) return null;
  const hash = digest(token);
  const hit = grantIds.get(hash);
  if (hit && Date.now() - hit.at < KEY_CACHE_MS)
    return hit.id ? `agent:${hit.id}` : null;
  const id =
    (
      await pool.query<{ grant_id: string }>(
        `SELECT t.grant_id FROM agent_tokens t
           JOIN agent_grants g ON g.id = t.grant_id
          WHERE t.token_hash = $1 AND t.kind <> 'refresh' AND g.revoked_at IS NULL
            AND (t.expires_at IS NULL OR t.expires_at > now())`,
        [hash],
      )
    ).rows[0]?.grant_id ?? null;
  if (grantIds.size > 5000) grantIds.clear();
  grantIds.set(hash, { id, at: Date.now() });
  return id ? `agent:${id}` : null;
}

export const CLIP_KEY_MESSAGE =
  "A Clipper key only saves clips from your browser. Sign in to Orbyn to do anything else.";

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
  // A Clipper key saves clips and nothing else (see modules/clip).
  if (token.startsWith("ocl_")) fail(401, CLIP_KEY_MESSAGE);
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

/**
 * Create a new opaque session token for a user. Only its hash is stored.
 * `reauthenticated`: the person just proved their password (and two-step)
 * or a passkey, which counts as confirming it's them for the next few
 * minutes (granting an agent write access needs that).
 */
export async function issueSession(
  u: UserRow,
  userAgent = "",
  options: { reauthenticated?: boolean } = {},
): Promise<AuthResponse> {
  const token = randomBytes(48).toString("base64url");
  await pool.query(
    `INSERT INTO sessions(token_hash,user_id,user_agent,reauthenticated_at)
     VALUES($1,$2,$3,CASE WHEN $4 THEN now() END)`,
    [digest(token), u.id, userAgent.slice(0, 400), !!options.reauthenticated],
  );
  return { token, user: publicUser(u) };
}

export const bearerToken = (r: FastifyRequest) =>
  r.headers.authorization!.slice("Bearer ".length);
