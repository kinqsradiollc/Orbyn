import {
  GRANT_SELECT,
  principalFor,
  type GrantRow,
} from "../../capabilities/connector-principal.js";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/server";
import {
  AGENT_ACCESS_RANK,
  LEGACY_KEY_CLIENT_ID,
  grantedScopes,
  type AgentGrantKind,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { DISABLED_MESSAGE, apiKeyOwner, digest } from "../../lib/auth.js";
import type { LiveSettings } from "../../lib/settings.js";
import { policy, type Principal } from "../../capabilities/policy.js";
import type { Capability } from "../../capabilities/registry.js";
import { legacyGrant } from "../agents/service.js";
import { disallowedHost } from "../oauth/clients.js";

/**
 * Who is calling the MCP address: an agent key (oak_), an agent access
 * token (oat_, from signing in with Orbyn), or an old personal API key (ok_)
 * for its 90 days. Everything else, an app's own session included, is
 * refused with 401 and a challenge naming where to sign in (RFC 9728).
 * The principal is built from live data on every call, so a revoked key,
 * a changed team role or a team that turned agents off applies at once.
 */

/** A refusal before any JSON-RPC handling: status, message and headers. */
export class McpAuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
    readonly challenge?: string,
  ) {
    super(message);
  }
}

/** Where the protected-resource metadata lives, for the 401 challenge. */
export const resourceMetadataUrl = () =>
  getOAuthProtectedResourceMetadataUrl(new URL(env.MCP_PUBLIC_URL));

/** The scopes an agent can ask for here (RFC 9728 scopes_supported). */
export const SCOPES = [
  "orbyn:read",
  "orbyn:propose",
  "orbyn:write",
  "orbyn:bookings",
];

const challenge = (error?: string) =>
  `Bearer${error ? ` error="${error}",` : ""} resource_metadata="${resourceMetadataUrl()}", scope="orbyn:read"`;

const unauthorized = (message: string, error?: string) =>
  new McpAuthError(401, message, challenge(error));

export type Caller = {
  principal: Principal;
  kind: AgentGrantKind;
  /** The grant's last write, for reading its own changes back. */
  lastWriteAt: Date | null;
  /** For old API keys: when they stop working here. */
  sunset: Date | null;
  /**
   * When the credential stops working (the token's or the connection's
   * end, whichever is first), so a long stream closes then.
   */
  expiresAt: Date | null;
};

/** The earliest of some optional dates. */
const earliest = (...dates: (Date | null | undefined)[]) =>
  dates
    .filter((d): d is Date => !!d)
    .reduce<Date | null>((a, d) => (!a || d < a ? d : a), null);

/** Checks shared by every kind of connection. */
function check(row: GrantRow, s: LiveSettings) {
  if (row.revoked_at)
    throw unauthorized(
      "This connection was revoked. Make a new agent key in Settings → Connected agents.",
      "invalid_token",
    );
  if (row.disabled) throw new McpAuthError(403, DISABLED_MESSAGE);
  if (row.suspended_at)
    throw new McpAuthError(
      403,
      "This connection is suspended. Its owner can restore it in Settings → Connected agents.",
    );
  if (
    row.client_blocked ||
    (row.client_id && s.agents.blocked_client_ids.includes(row.client_id))
  )
    throw new McpAuthError(
      403,
      "This app has been blocked by the administrator of this Orbyn.",
    );
  if (
    row.kind === "oauth" &&
    disallowedHost(
      {
        kind: row.client_kind,
        host: row.client_host ?? "",
        redirect_uris: row.client_redirect_uris,
      },
      s.agents.allowed_client_hosts,
    ) !== null
  )
    throw new McpAuthError(
      403,
      "Apps from this website can't connect to this Orbyn any more.",
    );
}

/**
 * The caller behind a request's bearer token, or McpAuthError. Session
 * tokens, refresh tokens and unknown tokens are 401 with the challenge.
 */
export async function resolveCaller(
  headers: Record<string, string | string[] | undefined>,
  s: LiveSettings,
): Promise<Caller> {
  const header = headers.authorization;
  const token =
    typeof header === "string"
      ? header.match(/^Bearer (\S+)$/)?.[1]
      : undefined;
  if (!token)
    throw unauthorized(
      "Sign in with Orbyn (OAuth), or send an agent key as Authorization: Bearer oak_… (make one in Settings → Connected agents).",
    );

  if (token.startsWith("oak_") || token.startsWith("oat_")) {
    const kind = token.startsWith("oak_") ? "key" : "access";
    const row = (
      await pool.query<GrantRow>(
        `${GRANT_SELECT} WHERE t.token_hash = $1 AND t.kind = $2`,
        [digest(token), kind],
      )
    ).rows[0];
    if (!row)
      throw unauthorized(
        kind === "key"
          ? "That agent key isn't valid. Make a new one in Settings → Connected agents."
          : "That access token isn't valid. Sign in again.",
        "invalid_token",
      );
    if (row.resource_kind !== "mcp")
      throw unauthorized(
        "This connection was issued for another service.",
        "invalid_token",
      );
    check(row, s);
    const expires = [row.expires_at, row.token_expires_at]
      .filter((d): d is Date => !!d)
      .some((d) => d.getTime() <= Date.now());
    if (expires)
      throw unauthorized(
        kind === "key"
          ? "This agent key has expired. Make a new one in Settings → Connected agents."
          : "This access token has expired.",
        "invalid_token",
      );
    if (
      kind === "access" &&
      row.resource &&
      row.resource !== env.MCP_PUBLIC_URL
    )
      throw unauthorized(
        "This token was issued for another address.",
        "invalid_token",
      );
    return {
      principal: await principalFor(
        row,
        kind === "key" ? "agent_key" : "oauth",
        headers,
      ),
      kind: row.kind,
      lastWriteAt: row.last_write_at,
      sunset: null,
      expiresAt: earliest(row.expires_at, row.token_expires_at),
    };
  }

  if (token.startsWith("ort_"))
    throw unauthorized(
      "A refresh token can't be used here; exchange it for an access token first.",
      "invalid_token",
    );

  if (token.startsWith("ok_")) {
    const until = s.legacy_keys_until ? new Date(s.legacy_keys_until) : null;
    if (!until || until.getTime() <= Date.now())
      throw unauthorized(
        "Personal API keys no longer work with MCP. Make an agent key in Settings → Connected agents; the API key still works with the REST API and CalDAV.",
        "invalid_token",
      );
    const owner = await apiKeyOwner(token);
    if (!owner)
      throw unauthorized(
        "That API key isn't valid. Make an agent key in Settings → Connected agents.",
        "invalid_token",
      );
    if (owner.user.disabled) throw new McpAuthError(403, DISABLED_MESSAGE);
    if (s.agents.blocked_client_ids.includes(LEGACY_KEY_CLIENT_ID))
      throw new McpAuthError(
        403,
        "Personal API keys have been turned off for MCP here. Make an agent key in Settings → Connected agents.",
      );
    const grant = await legacyGrant(
      owner.user.id,
      owner.key_id,
      owner.key_name,
    );
    const row = (
      await pool.query<GrantRow>(
        `SELECT g.id AS grant_id, g.kind, g.resource_kind, g.client_id, g.client_name, g.name,
                g.access, g.team_ids, g.personal, g.toolsets, g.flags, g.expires_at,
                g.trust, g.space_trust, g.acts_alone,
                NULL::timestamptz AS token_expires_at, NULL AS resource,
                g.last_write_at, g.suspended_at, g.revoked_at,
                u.id AS user_id, u.name AS user_name, u.disabled,
                NULL::boolean AS client_blocked, NULL AS client_host,
                NULL AS client_kind, NULL::text[] AS client_redirect_uris
           FROM agent_grants g JOIN users u ON u.id = g.user_id
          WHERE g.id = $1`,
        [grant.id],
      )
    ).rows[0];
    if (row.revoked_at)
      throw unauthorized(
        "You disconnected this key from agents in Settings → Connected agents. It still works with the REST API and CalDAV.",
        "invalid_token",
      );
    check(row, s);
    return {
      principal: await principalFor(row, "legacy_key", headers),
      kind: "legacy",
      lastWriteAt: row.last_write_at,
      sunset: until,
      expiresAt: earliest(row.expires_at, until),
    };
  }

  throw unauthorized(
    "This address takes an agent's own sign-in or an agent key, not the app's. Sign in with Orbyn from the agent, or make a key in Settings → Connected agents.",
    "invalid_token",
  );
}

/** Whether a principal signed in with Orbyn (OAuth), so it can be asked for more. */
export const signedIn = (p: Principal) => p.via === "oauth";

/**
 * The scopes a signed-in connection needs to call `cap`, when it can't now
 * only because it was given less (step-up): every scope in one challenge,
 * so the app asks once. Null when more scope wouldn't help (a toolset left
 * out on the consent page, a call narrowed to read only, an old tool), or
 * when it can already call it.
 */
export function stepUpScope(p: Principal, cap: Capability): string | null {
  if (!signedIn(p) || cap.legacyOnly || p.flags.readonly) return null;
  if (policy.allows(p, cap)) return null;
  const bookings = cap.toolset === "booking";
  if (!bookings && !p.toolsets.includes(cap.toolset)) return null;
  const access =
    AGENT_ACCESS_RANK[cap.access] > AGENT_ACCESS_RANK[p.access]
      ? cap.access
      : p.access;
  return grantedScopes(access, bookings || p.toolsets.includes("booking"));
}

/** The 403 challenge asking for more scope (RFC 6750 §3.1, MCP step-up). */
export const insufficientScope = (scope: string) =>
  `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${resourceMetadataUrl()}", error_description="This connection needs more access for that. Sign in again to allow it."`;

/** Hosted by OpenAI (ChatGPT), whose step-up rides on the tool result. */
export function isChatGpt(p: Principal): boolean {
  const id = p.client.id ?? "";
  let host = "";
  try {
    host = new URL(id).hostname;
  } catch {
    host = "";
  }
  return (
    /(^|\.)(openai\.com|chatgpt\.com)$/i.test(host) ||
    /\b(chatgpt|openai)\b/i.test(p.client.name)
  );
}

/** The scope a tool needs, as ChatGPT's securitySchemes list it. */
export function toolScopes(cap: Capability): string[] {
  const scopes = [
    cap.access === "write"
      ? "orbyn:write"
      : cap.access === "suggest"
        ? "orbyn:propose"
        : "orbyn:read",
  ];
  if (cap.toolset === "booking") scopes.push("orbyn:bookings");
  return scopes;
}
