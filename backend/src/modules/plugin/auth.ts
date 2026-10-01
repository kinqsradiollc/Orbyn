import type { Principal } from "../../capabilities/policy.js";
import {
  GRANT_SELECT,
  principalFor,
  type GrantRow,
} from "../../capabilities/connector-principal.js";
import { pool } from "../../db/pool.js";
import { digest } from "../../lib/auth.js";
import type { LiveSettings } from "../../lib/settings.js";
import { disallowedHost } from "../oauth/clients.js";
import {
  connectorResources,
  type ConnectorResources,
} from "../oauth/resources.js";

/** Plugin refusals use their own boundary, without MCP challenges or session fallback. */
export class PluginAuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

/** Resolve only OAuth credentials issued for the enabled plugin recipient. */
export async function resolvePluginCaller(
  headers: Record<string, string | string[] | undefined>,
  settings: LiveSettings,
  resources: ConnectorResources,
): Promise<{ principal: Principal; expiresAt: Date }> {
  const recipient = connectorResources(resources).find(
    (item) => item.kind === "plugin",
  );
  if (!recipient || !settings.agents.agents_enabled)
    throw new PluginAuthError(403, "Plugin connections are disabled.");
  const header = headers.authorization;
  const token =
    typeof header === "string"
      ? header.match(/^Bearer (oat_\S+)$/)?.[1]
      : undefined;
  if (!token)
    throw new PluginAuthError(401, "A plugin access token is required.");
  const row = (
    await pool.query<GrantRow>(
      `${GRANT_SELECT} WHERE t.token_hash = $1 AND t.kind = 'access'`,
      [digest(token)],
    )
  ).rows[0];
  if (
    !row ||
    row.kind !== "oauth" ||
    row.resource_kind !== "plugin" ||
    !row.client_id ||
    row.resource !== resources.plugin ||
    !row.token_expires_at ||
    row.revoked_at ||
    row.token_expires_at.getTime() <= Date.now() ||
    (row.expires_at && row.expires_at.getTime() <= Date.now())
  )
    throw new PluginAuthError(401, "This plugin access token is not valid.");
  if (
    row.disabled ||
    row.suspended_at ||
    row.client_blocked ||
    settings.agents.blocked_client_ids.includes(row.client_id) ||
    !row.client_kind ||
    disallowedHost(
      {
        kind: row.client_kind,
        host: row.client_host ?? "",
        redirect_uris: row.client_redirect_uris,
      },
      settings.agents.allowed_client_hosts,
    ) !== null
  )
    throw new PluginAuthError(403, "This plugin connection is not permitted.");
  // Host-supplied MCP headers cannot expand or select plugin permissions.
  const principal = await principalFor(row, "plugin", {});
  const expiresAt =
    row.expires_at && row.expires_at < row.token_expires_at
      ? row.expires_at
      : row.token_expires_at;
  return { principal, expiresAt };
}
