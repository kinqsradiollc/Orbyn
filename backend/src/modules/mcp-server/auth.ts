import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/server";
import {
  AGENT_TOOLSETS,
  LEGACY_KEY_CLIENT_ID,
  type AgentAccess,
  type AgentGrantKind,
  type AgentToolset,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { DISABLED_MESSAGE, apiKeyOwner, digest } from "../../lib/auth.js";
import type { LiveSettings } from "../../lib/settings.js";
import {
  reachableTeams,
  type Principal,
  type Via,
} from "../../capabilities/policy.js";
import { legacyGrant } from "../agents/service.js";

/**
 * Who is calling the MCP address: an agent key (oak_), an agent access
 * token (oat_, from phase A2's sign-in), or an old personal API key (ok_)
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

/** The scopes an agent can ask for (shown to clients, used from phase A2). */
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
};

type GrantRow = {
  grant_id: string;
  kind: AgentGrantKind;
  client_id: string | null;
  client_name: string;
  name: string;
  access: AgentAccess;
  team_ids: string[] | null;
  personal: boolean;
  toolsets: AgentToolset[];
  flags: { notify_teammates?: boolean; hide_outside_content?: boolean };
  expires_at: Date | null;
  token_expires_at: Date | null;
  resource: string | null;
  last_write_at: Date | null;
  suspended_at: Date | null;
  revoked_at: Date | null;
  user_id: string;
  user_name: string;
  disabled: boolean;
};

/** Narrowing a connection for one call with X-MCP-Toolsets / X-MCP-Readonly. */
function narrowed(
  headers: Record<string, string | string[] | undefined>,
  toolsets: AgentToolset[],
) {
  const asked = String(headers["x-mcp-toolsets"] ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const readonly = /^(1|true|yes)$/i.test(
    String(headers["x-mcp-readonly"] ?? ""),
  );
  return {
    // Only ever narrower: a toolset the connection lacks can't be added.
    toolsets: asked.length
      ? toolsets.filter((t) => asked.includes(t))
      : toolsets,
    readonly,
  };
}

async function principalFor(
  row: GrantRow,
  via: Via,
  headers: Record<string, string | string[] | undefined>,
): Promise<Principal> {
  const n = narrowed(
    headers,
    row.toolsets.filter((t) =>
      (AGENT_TOOLSETS as readonly string[]).includes(t),
    ),
  );
  return {
    user: { id: row.user_id, name: row.user_name, role: "member" },
    via,
    grant_id: row.grant_id,
    client: { id: row.client_id, name: row.client_name || row.name },
    access: row.access,
    team_ids: row.team_ids,
    personal: row.personal,
    toolsets: n.toolsets,
    flags: {
      notify_teammates: !!row.flags?.notify_teammates,
      hide_outside_content: !!row.flags?.hide_outside_content,
      readonly: n.readonly,
    },
    teams: await reachableTeams(pool, row.user_id, row.team_ids, via),
  };
}

const GRANT_SELECT = `SELECT g.id AS grant_id, g.kind, g.client_id, g.client_name, g.name,
    g.access, g.team_ids, g.personal, g.toolsets, g.flags, g.expires_at,
    t.expires_at AS token_expires_at, t.resource, g.last_write_at,
    g.suspended_at, g.revoked_at, u.id AS user_id, u.name AS user_name, u.disabled
  FROM agent_tokens t
  JOIN agent_grants g ON g.id = t.grant_id
  JOIN users u ON u.id = g.user_id`;

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
  if (row.client_id && s.agents.blocked_client_ids.includes(row.client_id))
    throw new McpAuthError(
      403,
      "This app has been blocked by the administrator of this Orbyn.",
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
      "Send an agent key as Authorization: Bearer oak_… (make one in Settings → Connected agents).",
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
        `SELECT g.id AS grant_id, g.kind, g.client_id, g.client_name, g.name,
                g.access, g.team_ids, g.personal, g.toolsets, g.flags, g.expires_at,
                NULL::timestamptz AS token_expires_at, NULL AS resource,
                g.last_write_at, g.suspended_at, g.revoked_at,
                u.id AS user_id, u.name AS user_name, u.disabled
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
    };
  }

  throw unauthorized(
    "This address takes an agent key, not an app sign-in. Make one in Settings → Connected agents.",
    "invalid_token",
  );
}
