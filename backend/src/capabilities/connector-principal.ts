import {
  AGENT_TOOLSETS,
  type AgentAccess,
  type AgentAskFirst,
  type AgentGrantKind,
  type AgentSpaceTrust,
  type AgentToolset,
  type AgentTrust,
} from "@orbyn/core";
import { pool, type Queryable } from "../db/pool.js";
import { reachableTeams, type Principal, type Via } from "./policy.js";

/** Live connector grant data shared by protocol-specific authentication boundaries. */
export type GrantRow = {
  resource_kind: "mcp" | "plugin";
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
  trust: AgentTrust;
  space_trust: AgentSpaceTrust | null;
  acts_alone: AgentAskFirst[] | null;
  client_blocked: boolean | null;
  client_host: string | null;
  client_kind: string | null;
  client_redirect_uris: string[] | null;
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

export async function principalFor(
  row: GrantRow,
  via: Via,
  headers: Record<string, string | string[] | undefined>,
  db: Queryable = pool,
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
    trust: {
      level: row.trust ?? "full",
      spaces: row.space_trust ?? {},
      acts_alone: row.acts_alone ?? [],
    },
    teams: await reachableTeams(db, row.user_id, row.team_ids, via),
  };
}

export const GRANT_SELECT = `SELECT g.id AS grant_id, g.kind, g.resource_kind, g.client_id, g.client_name, g.name,
    g.access, g.team_ids, g.personal, g.toolsets, g.flags, g.expires_at,
    g.trust, g.space_trust, g.acts_alone,
    t.expires_at AS token_expires_at, t.resource, g.last_write_at,
    g.suspended_at, g.revoked_at, u.id AS user_id, u.name AS user_name, u.disabled,
    c.blocked AS client_blocked, c.host AS client_host,
    c.kind AS client_kind, c.redirect_uris AS client_redirect_uris
  FROM agent_tokens t
  JOIN agent_grants g ON g.id = t.grant_id
  JOIN users u ON u.id = g.user_id
  LEFT JOIN oauth_clients c ON c.id = g.client_id`;
