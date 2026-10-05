import {
  AI_PROVIDERS,
  fail,
  pluginAiPermissionInput,
  pluginAiPermissionView,
  type PluginAiPermissionView,
} from "@orbyn/core";
import { transaction, type Queryable } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { settings, type LiveSettings } from "../../lib/settings.js";
import { announceAuthChange } from "../agents/service.js";
import { disallowedHost } from "../oauth/clients.js";

type Grant = {
  id: string;
  kind: string;
  resource_kind: string;
  client_id: string;
  authorized_at: Date | null;
  revoked_at: Date | null;
  suspended_at: Date | null;
  expires_at: Date | null;
};
type Permission = {
  enabled: boolean;
  version: number;
  provider_id: string | null;
  provider_revision: string | null;
  provider_name: string | null;
  model: string | null;
  max_output_tokens: number;
  daily_call_limit: number;
};
async function ownedGrant(
  db: Queryable,
  owner: string,
  id: string,
): Promise<Grant> {
  const row = (
    await db.query<Grant>(
      "SELECT id,kind,resource_kind,client_id,authorized_at,revoked_at,suspended_at,expires_at FROM agent_grants WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [id, owner],
    )
  ).rows[0];
  if (!row || row.revoked_at) fail(404, "Connection not found");
  if (row.kind !== "oauth" || row.resource_kind !== "plugin")
    fail(
      403,
      "Workspace AI permission is only available to plugin connections.",
    );
  return row;
}
async function allowedClient(db: Queryable, grant: Grant, live: LiveSettings) {
  const client = (
    await db.query<{
      blocked: boolean;
      kind: string;
      host: string;
      redirect_uris: string[];
    }>(
      "SELECT blocked,kind,host,redirect_uris FROM oauth_clients WHERE id=$1 FOR SHARE",
      [grant.client_id],
    )
  ).rows[0];
  return !!(
    live.agents.agents_enabled &&
    grant.authorized_at &&
    !grant.suspended_at &&
    (!grant.expires_at || grant.expires_at.getTime() > Date.now()) &&
    client &&
    !client.blocked &&
    !live.agents.blocked_client_ids.includes(grant.client_id) &&
    !disallowedHost(client, live.agents.allowed_client_hosts)
  );
}
async function availableProvider(db: Queryable) {
  const row = (
    await db.query<{
      id: string;
      revision: string;
      name: string;
      kind: string;
      model: string;
    }>(
      "SELECT p.id,extract(epoch from p.updated_at)::text AS revision,p.name,p.kind,s.model FROM ai_settings s JOIN ai_providers p ON p.id=s.provider_id WHERE s.id AND p.enabled AND s.model<>'' FOR SHARE OF p,s",
    )
  ).rows[0];
  if (!row || !Object.hasOwn(AI_PROVIDERS, row.kind)) return null;
  return {
    id: row.id,
    revision: row.revision,
    name: row.name,
    model: row.model,
  };
}
async function view(
  db: Queryable,
  grant: Grant,
  live: LiveSettings,
): Promise<PluginAiPermissionView> {
  const row = (
    await db.query<Permission>(
      "SELECT * FROM plugin_ai_permissions WHERE grant_id=$1",
      [grant.id],
    )
  ).rows[0];
  const available = await availableProvider(db);
  const provider =
    row?.provider_id && row.provider_revision && row.provider_name && row.model
      ? {
          id: row.provider_id,
          revision: row.provider_revision,
          name: row.provider_name,
          model: row.model,
        }
      : null;
  const permitted = await allowedClient(db, grant, live);
  return pluginAiPermissionView.parse({
    grant_id: grant.id,
    enabled: row?.enabled ?? false,
    active: !!(
      row?.enabled &&
      permitted &&
      provider &&
      available &&
      provider.id === available.id &&
      provider.revision === available.revision &&
      provider.model === available.model
    ),
    version: row?.version ?? 0,
    provider,
    available_provider: permitted ? available : null,
    max_output_tokens: row?.max_output_tokens ?? 512,
    daily_call_limit: row?.daily_call_limit ?? 10,
  });
}

/** Session-owned review of one plugin grant; never accepts plugin or plan credentials. */
export async function readPluginAiPermission(owner: string, id: string) {
  const live = await settings();
  return transaction(async (db) =>
    view(db, await ownedGrant(db, owner, id), live),
  );
}

/** Explicit provider-bound CAS consent; only the first-party owner route calls this. */
export async function setPluginAiPermission(
  owner: string,
  id: string,
  input: unknown,
  requestId?: string,
) {
  const value = pluginAiPermissionInput.parse(input);
  const live = await settings();
  return transaction(async (db) => {
    const grant = await ownedGrant(db, owner, id);
    const previous = await view(db, grant, live);
    if (previous.version !== value.expected_version)
      fail(409, "Plugin AI permission changed. Review it before saving again.");
    if (value.enabled) {
      const provider = previous.available_provider;
      if (
        !provider ||
        provider.id !== value.provider!.id ||
        provider.revision !== value.provider!.revision ||
        provider.model !== value.provider!.model
      )
        fail(
          409,
          "The workspace provider changed or is unavailable. Review it before allowing AI.",
        );
      await db.query(
        `INSERT INTO plugin_ai_permissions(grant_id,enabled,version,provider_id,provider_revision,provider_name,model,max_output_tokens,daily_call_limit)
        VALUES($1,true,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(grant_id) DO UPDATE SET enabled=true,version=EXCLUDED.version,provider_id=EXCLUDED.provider_id,provider_revision=EXCLUDED.provider_revision,provider_name=EXCLUDED.provider_name,model=EXCLUDED.model,max_output_tokens=EXCLUDED.max_output_tokens,daily_call_limit=EXCLUDED.daily_call_limit,updated_at=clock_timestamp()`,
        [
          id,
          previous.version + 1,
          provider.id,
          provider.revision,
          provider.name,
          provider.model,
          value.max_output_tokens,
          value.daily_call_limit,
        ],
      );
    } else {
      await db.query(
        `INSERT INTO plugin_ai_permissions(grant_id,enabled,version) VALUES($1,false,$2)
        ON CONFLICT(grant_id) DO UPDATE SET enabled=false,version=EXCLUDED.version,updated_at=clock_timestamp()`,
        [id, previous.version + 1],
      );
    }
    // Undispatched work can safely stop. Running/unknown calls retain their
    // charged reservation and receipt; acceptance rechecks the new version.
    await db.query(
      "UPDATE plugin_ai_runs SET state='failed',failure='Permission changed before dispatch.',updated_at=clock_timestamp() WHERE grant_id=$1 AND state='queued'",
      [id],
    );
    await announceAuthChange(db, {
      grants: [id],
      reason: "plugin_ai_permission",
    });
    await audit(
      {
        actorId: owner,
        action: "plugin.ai_permission",
        targetType: "agent_grant",
        targetId: id,
        details: {
          enabled: value.enabled,
          version: previous.version + 1,
          provider_id: value.provider?.id ?? null,
          max_output_tokens:
            value.max_output_tokens ?? previous.max_output_tokens,
          daily_call_limit: value.daily_call_limit ?? previous.daily_call_limit,
        },
        requestId,
      },
      db,
    );
    return view(db, grant, live);
  });
}
