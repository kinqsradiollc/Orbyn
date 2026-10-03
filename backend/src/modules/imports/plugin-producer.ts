import type { Queryable } from "../../db/pool.js";
import {
  GRANT_SELECT,
  type GrantRow,
} from "../../capabilities/connector-principal.js";
import { policy } from "../../capabilities/policy.js";
import { Params, scopeFor, visibleProjects } from "../../lib/visibility.js";
import type { LiveSettings } from "../../lib/settings.js";
import { pluginPrincipalFromGrant, PluginAuthError } from "../plugin/auth.js";

export type PluginImportOrigin = {
  plugin_owned: boolean;
  plugin_grant_id: string | null;
  plugin_client_id: string | null;
  plugin_resource: string | null;
};

/** Permission refusal can be shown without connector identifiers or source details. */
export class PluginImportAuthorityError extends Error {
  constructor() {
    super(
      "The plugin connection or its access changed while the file was being read. Nothing was shared. Reconnect and start the import again.",
    );
  }
}

/**
 * Called in the converter's document transaction. A grant/client deletion retains
 * the origin flag and fails closed. No bearer or user-controlled plan tokens are
 * stored or recovered: current OAuth metadata is read under database locks.
 */
export async function pluginImportProducer(
  db: Queryable,
  userId: string,
  origin: PluginImportOrigin,
  projectId: string | null,
  projectTeamId: string | null,
  live: LiveSettings,
) {
  if (!origin.plugin_owned) return null;
  if (
    !origin.plugin_grant_id ||
    !origin.plugin_client_id ||
    !origin.plugin_resource ||
    !live.agents.agents_enabled ||
    !live.agents.agents_writes_enabled ||
    live.maintenance.enabled
  )
    throw new PluginImportAuthorityError();
  const values = [origin.plugin_grant_id, userId, origin.plugin_resource];
  const query = `${GRANT_SELECT} WHERE g.id=$1 AND g.user_id=$2
    AND t.kind='access' AND t.resource=$3 AND t.expires_at > now()
    ORDER BY t.expires_at DESC LIMIT 1`;
  const locked = (
    await db.query<GrantRow>(`${query} FOR SHARE OF t,g,u`, values)
  ).rows[0];
  if (!locked || locked.client_id !== origin.plugin_client_id)
    throw new PluginImportAuthorityError();
  await db.query("SELECT id FROM oauth_clients WHERE id=$1 FOR SHARE", [
    origin.plugin_client_id,
  ]);
  await db.query(
    `SELECT m.team_id FROM team_members m JOIN teams t ON t.id=m.team_id
     WHERE m.user_id=$1 AND ($2::uuid[] IS NULL OR m.team_id=ANY($2::uuid[]))
     ORDER BY m.team_id FOR SHARE OF m,t`,
    [userId, locked.team_ids],
  );
  // Client/membership changes that committed before their locks must be observed.
  const row = (await db.query<GrantRow>(query, values)).rows[0];
  if (!row || row.client_id !== origin.plugin_client_id)
    throw new PluginImportAuthorityError();
  let authority;
  try {
    authority = await pluginPrincipalFromGrant(
      row,
      live,
      origin.plugin_resource,
      db,
    );
  } catch (error) {
    if (error instanceof PluginAuthError)
      throw new PluginImportAuthorityError();
    throw error;
  }
  const p = authority.principal;
  if (!policy.allows(p, { access: "write", toolset: "files" }))
    throw new PluginImportAuthorityError();
  if (projectId) {
    const params = new Params(projectId, projectTeamId);
    const scope = scopeFor(policy.spaces(p), params);
    const project = (
      await db.query(
        `SELECT p.id FROM projects p WHERE p.id=$1
       AND p.team_id IS NOT DISTINCT FROM $2::uuid
       AND ${visibleProjects("p", scope)} FOR SHARE OF p`,
        params.values,
      )
    ).rows[0];
    if (!project) throw new PluginImportAuthorityError();
  } else if (projectTeamId !== null) throw new PluginImportAuthorityError();
  if (
    !policy.can(p, "write", { team_id: projectTeamId }).ok ||
    policy.trustIn(p, projectTeamId) !== "full"
  )
    throw new PluginImportAuthorityError();
  return authority;
}
