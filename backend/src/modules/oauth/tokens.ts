import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  AGENT_TOOLSETS,
  grantedScopes,
  type AgentAccess,
  type AgentToolset,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool, transaction, type Db, type Queryable } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { digest } from "../../lib/auth.js";
import type { LiveSettings } from "../../lib/settings.js";
import { announceAuthChange, noticeAgentEvent } from "../agents/service.js";
import { disallowedHost, OAuthError } from "./clients.js";

/**
 * Codes and tokens for agents that signed in with Orbyn. Everything is
 * opaque and stored only as a sha256 hash, like sessions:
 *
 * - a code (60 seconds, once, spent with DELETE … RETURNING) from the
 *   consent page, bound to the app, its redirect address, the PKCE
 *   challenge and the resource (the MCP address);
 * - access tokens (oat_, OAUTH_ACCESS_TTL, one hour by default), bound to
 *   the MCP address and accepted nowhere else;
 * - refresh tokens (ort_), which rotate on every use: unused for
 *   OAUTH_REFRESH_TTL days (30) they lapse, and a family never outlives 90
 *   days or its connection. Using a spent one again means it was copied:
 *   the whole family is revoked, the connection paused, the person told.
 *   Except just after it was spent (REFRESH_GRACE_SECONDS, a couple of
 *   times at most): a client that lost the answer to a timeout, or two
 *   tabs refreshing at once, gets another pair in the same family instead
 *   of being treated as a thief.
 */

export const ACCESS_PREFIX = "oat_";
export const REFRESH_PREFIX = "ort_";
export const CODE_SECONDS = 60;
/** The most a refresh-token family lasts, however often it rotates. */
export const FAMILY_MAX_DAYS = 90;
/** How long a just-spent refresh token may be presented again (a retry). */
export const REFRESH_GRACE_SECONDS = 60;
/** How many more pairs one spent refresh token may get within the grace. */
export const REFRESH_GRACE_REUSES = 2;

/** A token's secret part: 32 random bytes. */
const secret = () => randomBytes(32).toString("base64url");

/** PKCE S256: base64url(sha256(verifier)) (RFC 7636 §4.2). */
export const s256 = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
export const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** A one-time code for a grant, stored hashed. */
export async function issueCode(
  db: Queryable,
  c: {
    grantId: string;
    clientId: string;
    redirectUri: string;
    challenge: string;
    resource: string;
    scope: string;
  },
): Promise<string> {
  const code = `oac_${secret()}`;
  await db.query(
    `INSERT INTO oauth_codes (code_hash, grant_id, client_id, redirect_uri,
       code_challenge, resource, scope, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))`,
    [
      digest(code),
      c.grantId,
      c.clientId,
      c.redirectUri,
      c.challenge,
      c.resource,
      c.scope,
      CODE_SECONDS,
    ],
  );
  return code;
}

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

type GrantState = {
  id: string;
  user_id: string;
  client_id: string | null;
  client_name: string;
  access: AgentAccess;
  toolsets: AgentToolset[];
  expires_at: Date | null;
  suspended_at: Date | null;
  revoked_at: Date | null;
  disabled: boolean;
  client_blocked: boolean | null;
  client_kind: string | null;
  client_host: string | null;
  client_redirect_uris: string[] | null;
};

const GRANT_STATE = `SELECT g.id, g.user_id, g.client_id, g.client_name, g.access, g.toolsets,
    g.expires_at, g.suspended_at, g.revoked_at, u.disabled, c.blocked AS client_blocked,
    c.kind AS client_kind, c.host AS client_host, c.redirect_uris AS client_redirect_uris
  FROM agent_grants g JOIN users u ON u.id = g.user_id
  LEFT JOIN oauth_clients c ON c.id = g.client_id`;

/** Why a connection can't get tokens now, or null when it can. */
function unusable(g: GrantState | undefined, s: LiveSettings): string | null {
  if (!g || g.revoked_at)
    return "This connection was disconnected. Sign in again.";
  if (g.disabled) return "This account has been disabled.";
  if (g.suspended_at)
    return "This connection is paused. Its owner can restore it in Settings → Connected agents, or sign in again.";
  if (g.expires_at && g.expires_at.getTime() <= Date.now())
    return "This connection has expired. Sign in again.";
  if (
    g.client_blocked ||
    (g.client_id && s.agents.blocked_client_ids.includes(g.client_id))
  )
    return "This app has been blocked by the administrator of this Orbyn.";
  if (
    g.client_id &&
    disallowedHost(
      {
        kind: g.client_kind,
        host: g.client_host ?? "",
        redirect_uris: g.client_redirect_uris,
      },
      s.agents.allowed_client_hosts,
    ) !== null
  )
    return "Apps from this website can't connect to this Orbyn any more.";
  if (!s.agents.agents_enabled)
    return "Outside agents are switched off on this Orbyn for now.";
  return null;
}

/** The scope a grant holds now (its choices may have changed since sign-in). */
const scopeOf = (g: GrantState, offline: boolean) =>
  grantedScopes(g.access, g.toolsets.includes("booking"), offline);

/** Mints an access token and a refresh token in `family`. */
async function mint(
  db: Queryable,
  g: GrantState,
  family: string,
  familyExpires: Date,
  offline: boolean,
): Promise<TokenResponse> {
  const access = `${ACCESS_PREFIX}${secret()}`;
  const refresh = `${REFRESH_PREFIX}${secret()}`;
  const ttl = env.OAUTH_ACCESS_TTL;
  const grantEnd = g.expires_at?.getTime() ?? Infinity;
  const accessEnd = new Date(Math.min(Date.now() + ttl * 1000, grantEnd));
  const refreshEnd = new Date(
    Math.min(
      Date.now() + env.OAUTH_REFRESH_TTL * 86_400_000,
      familyExpires.getTime(),
    ),
  );
  await db.query(
    `INSERT INTO agent_tokens (token_hash, grant_id, kind, prefix, family, resource,
       expires_at, family_expires_at)
     VALUES ($1, $3, 'access', $4, $5, $6, $7, $9),
            ($2, $3, 'refresh', $8, $5, $6, $10, $9)`,
    [
      digest(access),
      digest(refresh),
      g.id,
      access.slice(0, 8),
      family,
      env.MCP_PUBLIC_URL,
      accessEnd,
      refresh.slice(0, 8),
      familyExpires,
      refreshEnd,
    ],
  );
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.max(
      1,
      Math.round((accessEnd.getTime() - Date.now()) / 1000),
    ),
    refresh_token: refresh,
    scope: scopeOf(g, offline),
  };
}

/** The resource a token request names, checked (RFC 8707). */
function checkResource(resource: string | undefined, bound?: string) {
  if (resource === undefined || resource === "") return;
  const canonical = env.MCP_PUBLIC_URL;
  const given =
    resource.replace(/\/$/, "") === canonical.replace(/\/$/, "")
      ? canonical
      : resource;
  if (given !== canonical || (bound && bound !== canonical))
    throw new OAuthError(
      "invalid_target",
      `Tokens here are only for ${canonical}.`,
    );
}

/** grant_type=authorization_code (RFC 6749 §4.1.3, with PKCE). */
export async function exchangeCode(
  p: Record<string, string | undefined>,
  s: LiveSettings,
): Promise<TokenResponse> {
  const { code, redirect_uri, client_id, code_verifier, resource } = p;
  if (!code || !client_id || !code_verifier)
    throw new OAuthError(
      "invalid_request",
      "code, client_id and code_verifier are required.",
    );
  if (!PKCE_VERIFIER.test(code_verifier))
    throw new OAuthError(
      "invalid_grant",
      "The code_verifier must be 43 to 128 letters, digits and -._~ characters.",
    );
  checkResource(resource);
  // Spent at once, outside the transaction: a failed exchange (a wrong
  // verifier, another app) still burns the code, so it can't be retried.
  const row = (
    await pool.query<{
      grant_id: string;
      client_id: string;
      redirect_uri: string;
      code_challenge: string;
      resource: string;
      scope: string;
      expires_at: Date;
    }>(
      `DELETE FROM oauth_codes WHERE code_hash = $1
       RETURNING grant_id, client_id, redirect_uri, code_challenge, resource, scope, expires_at`,
      [digest(code)],
    )
  ).rows[0];
  if (!row || row.expires_at.getTime() <= Date.now())
    throw new OAuthError(
      "invalid_grant",
      "This code has expired or was already used.",
    );
  if (row.client_id !== client_id)
    throw new OAuthError(
      "invalid_grant",
      "This code was issued to another app.",
    );
  if (redirect_uri !== row.redirect_uri)
    throw new OAuthError(
      "invalid_grant",
      "redirect_uri must be the one the sign-in started with.",
    );
  if (!same(s256(code_verifier), row.code_challenge))
    throw new OAuthError("invalid_grant", "The code_verifier doesn't match.");
  checkResource(resource, row.resource);
  return transaction(async (db) => {
    const g = (
      await db.query<GrantState>(
        `${GRANT_STATE} WHERE g.id = $1 FOR UPDATE OF g`,
        [row.grant_id],
      )
    ).rows[0];
    const why = unusable(g, s);
    if (why) throw new OAuthError("invalid_grant", why);
    const familyEnd = new Date(
      Math.min(
        Date.now() + FAMILY_MAX_DAYS * 86_400_000,
        g.expires_at?.getTime() ?? Infinity,
      ),
    );
    const tokens = await mint(
      db,
      g,
      randomUUID(),
      familyEnd,
      row.scope.split(" ").includes("offline_access"),
    );
    await db.query(
      "UPDATE agent_grants SET authorized_at = coalesce(authorized_at, now()) WHERE id = $1",
      [g.id],
    );
    await db.query(
      "UPDATE oauth_clients SET last_used_at = now() WHERE id = $1",
      [client_id],
    );
    return tokens;
  });
}

/**
 * Reuse of a spent refresh token: it was copied. Revoke its whole family,
 * pause the connection, audit it and tell the person.
 */
async function refreshReused(
  db: Db,
  grantId: string,
  family: string,
): Promise<void> {
  await db.query("DELETE FROM agent_tokens WHERE family = $1", [family]);
  const g = (
    await db.query<{
      id: string;
      user_id: string;
      name: string;
      client_name: string;
    }>(
      `UPDATE agent_grants SET suspended_at = coalesce(suspended_at, now())
        WHERE id = $1 RETURNING id, user_id, name, client_name`,
      [grantId],
    )
  ).rows[0];
  if (!g) return;
  await audit(
    {
      actorId: null,
      action: "agent_grant.refresh_reused",
      targetType: "agent_grant",
      targetId: g.id,
      details: { user_id: g.user_id, name: g.name, family },
    },
    db,
  );
  await noticeAgentEvent(db, g.user_id, {
    ref: `grant:${g.id}`,
    title: `${g.client_name || g.name} was paused for your safety`,
    body: "Its sign-in was used twice, which can mean someone copied it. Orbyn signed it out and paused it. If this was you, restore it in Settings → Connected agents; if not, disconnect it.",
    email: true,
  });
  await announceAuthChange(db, { grants: [g.id], reason: "refresh_reused" });
}

/** grant_type=refresh_token (RFC 6749 §6), rotating. */
export async function refreshTokens(
  p: Record<string, string | undefined>,
  s: LiveSettings,
): Promise<TokenResponse> {
  const { refresh_token, client_id, resource, scope } = p;
  if (!refresh_token || !client_id)
    throw new OAuthError(
      "invalid_request",
      "refresh_token and client_id are required.",
    );
  checkResource(resource);
  let reused = false;
  const tokens = await transaction(async (db) => {
    const t = (
      await db.query<{
        grant_id: string;
        family: string;
        expires_at: Date | null;
        family_expires_at: Date | null;
        used_at: Date | null;
      }>(
        `SELECT grant_id, family, expires_at, family_expires_at, used_at
           FROM agent_tokens WHERE token_hash = $1 AND kind = 'refresh' FOR UPDATE`,
        [digest(refresh_token)],
      )
    ).rows[0];
    if (!t)
      throw new OAuthError(
        "invalid_grant",
        "This refresh token isn't valid. Sign in again.",
      );
    if (t.used_at) {
      // A retry right after it rotated (a lost answer, two tabs at once)
      // isn't theft: it gets another pair, a couple of times at most.
      const recent =
        Date.now() - t.used_at.getTime() < REFRESH_GRACE_SECONDS * 1000;
      const since = recent
        ? (
            await db.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM agent_tokens
                WHERE family = $1 AND kind = 'refresh' AND created_at >= $2`,
              [t.family, t.used_at],
            )
          ).rows[0].n
        : Infinity;
      if (since >= 1 + REFRESH_GRACE_REUSES) {
        await refreshReused(db, t.grant_id, t.family);
        reused = true;
        return null;
      }
    }
    if (t.expires_at && t.expires_at.getTime() <= Date.now())
      throw new OAuthError(
        "invalid_grant",
        "This refresh token has expired. Sign in again.",
      );
    const g = (
      await db.query<GrantState>(
        `${GRANT_STATE} WHERE g.id = $1 FOR UPDATE OF g`,
        [t.grant_id],
      )
    ).rows[0];
    if (g && g.client_id !== client_id)
      throw new OAuthError(
        "invalid_grant",
        "This refresh token was issued to another app.",
      );
    const why = unusable(g, s);
    if (why) throw new OAuthError("invalid_grant", why);
    const held = new Set(scopeOf(g, true).split(" "));
    const asked = (scope ?? "").split(/\s+/).filter(Boolean);
    if (asked.some((x) => !held.has(x)))
      throw new OAuthError(
        "invalid_scope",
        "A refresh can't widen what this connection may do. Sign in again to change it.",
      );
    // The first use sets used_at; retries within the grace keep it.
    await db.query(
      "UPDATE agent_tokens SET used_at = coalesce(used_at, now()) WHERE token_hash = $1",
      [digest(refresh_token)],
    );
    const familyEnd =
      t.family_expires_at ??
      new Date(Date.now() + FAMILY_MAX_DAYS * 86_400_000);
    if (familyEnd.getTime() <= Date.now())
      throw new OAuthError(
        "invalid_grant",
        "This sign-in is too old. Sign in again.",
      );
    return mint(db, g, t.family, familyEnd, true);
  });
  if (reused || !tokens)
    throw new OAuthError(
      "invalid_grant",
      "This refresh token was already used. The connection was paused for safety; sign in again.",
    );
  return tokens;
}

/**
 * RFC 7009 revocation. A refresh token takes its whole family with it; an
 * access token only itself. When that leaves the connection with no way
 * in, the app has disconnected itself and the connection ends. Unknown
 * tokens are fine (200), as the RFC asks.
 */
export async function revokeToken(
  token: string | undefined,
  clientId: string | undefined,
): Promise<void> {
  if (!token) throw new OAuthError("invalid_request", "token is required.");
  if (!token.startsWith(ACCESS_PREFIX) && !token.startsWith(REFRESH_PREFIX))
    return;
  await transaction(async (db) => {
    const t = (
      await db.query<{
        grant_id: string;
        kind: string;
        family: string | null;
        client_id: string | null;
      }>(
        `SELECT t.grant_id, t.kind, t.family, g.client_id
           FROM agent_tokens t JOIN agent_grants g ON g.id = t.grant_id
          WHERE t.token_hash = $1`,
        [digest(token)],
      )
    ).rows[0];
    if (!t) return;
    if (clientId && t.client_id !== clientId)
      throw new OAuthError(
        "unauthorized_client",
        "This token was issued to another app.",
      );
    if (t.kind === "refresh" && t.family)
      await db.query("DELETE FROM agent_tokens WHERE family = $1", [t.family]);
    else
      await db.query("DELETE FROM agent_tokens WHERE token_hash = $1", [
        digest(token),
      ]);
    const left = (
      await db.query(
        `SELECT 1 FROM agent_tokens WHERE grant_id = $1
            AND (expires_at IS NULL OR expires_at > now()) AND used_at IS NULL LIMIT 1`,
        [t.grant_id],
      )
    ).rowCount;
    if (!left) {
      const gone = (
        await db.query<{ id: string; user_id: string; name: string }>(
          `UPDATE agent_grants SET revoked_at = now()
            WHERE id = $1 AND revoked_at IS NULL RETURNING id, user_id, name`,
          [t.grant_id],
        )
      ).rows[0];
      if (gone) {
        await db.query("DELETE FROM agent_tokens WHERE grant_id = $1", [
          gone.id,
        ]);
        await audit(
          {
            actorId: null,
            action: "agent_grant.revoked",
            targetType: "agent_grant",
            targetId: gone.id,
            details: {
              user_id: gone.user_id,
              name: gone.name,
              kind: "oauth",
              reason: "app",
            },
          },
          db,
        );
      }
    }
    await announceAuthChange(db, {
      grants: [t.grant_id],
      reason: "token_revoked",
    });
  });
}

/** Toolsets a connection gets from its choices. */
export function toolsetsFor(
  chosen: AgentToolset[],
  bookings: boolean,
): AgentToolset[] {
  const set = new Set<AgentToolset>([
    "core",
    ...chosen.filter((t) => t !== "booking"),
  ]);
  if (bookings) set.add("booking");
  return AGENT_TOOLSETS.filter((t) => set.has(t));
}
