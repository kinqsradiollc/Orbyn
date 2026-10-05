import type { Principal } from "../../capabilities/policy.js";
import { CapabilityError } from "../../capabilities/registry.js";
import { transaction, type Queryable } from "../../db/pool.js";
import { actAs } from "../../lib/actor.js";
import { digest } from "../../lib/auth.js";
import type { LiveSettings } from "../../lib/settings.js";
import type { ConnectorResources } from "../oauth/resources.js";
import { PluginAuthError, resolvePluginCaller } from "./auth.js";

/** Recheck and hold connector authority for the shared domain write transaction. */
export async function pluginWrite<T>(
  principal: Principal,
  headers: Record<string, string | string[] | undefined>,
  settings: LiveSettings,
  resources: ConnectorResources,
  run: (db: Queryable) => Promise<T>,
): Promise<T> {
  return pluginTransaction(principal, headers, settings, resources, run, true);
}

/** Hold fresh connector authority while reading private plugin jobs and results. */
export async function pluginRead<T>(
  principal: Principal,
  headers: Record<string, string | string[] | undefined>,
  settings: LiveSettings,
  resources: ConnectorResources,
  run: (db: Queryable) => Promise<T>,
): Promise<T> {
  return pluginTransaction(principal, headers, settings, resources, run, false);
}

async function pluginTransaction<T>(
  principal: Principal,
  headers: Record<string, string | string[] | undefined>,
  settings: LiveSettings,
  resources: ConnectorResources,
  run: (db: Queryable) => Promise<T>,
  write: boolean,
): Promise<T> {
  return transaction(async (db) => {
    const token = String(headers.authorization ?? "").match(
      /^Bearer (oat_\S+)$/,
    )?.[1];
    if (!token)
      throw new CapabilityError(
        "FORBIDDEN",
        "This connection is no longer valid.",
      );
    // Keep the same grant -> token -> owner order as consent, revocation and
    // managed inference. Locking a token first can cycle with grant updates.
    await db.query(
      `SELECT id FROM agent_grants WHERE id=$1 ${write ? "FOR UPDATE" : "FOR SHARE"}`,
      [principal.grant_id],
    );
    await db.query(
      `SELECT token_hash FROM agent_tokens WHERE token_hash=$1 AND grant_id=$2 ${write ? "FOR UPDATE" : "FOR SHARE"}`,
      [digest(token), principal.grant_id],
    );
    await db.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [
      principal.user.id,
    ]);
    // Hold both app policy and membership rows against revocation during a write.
    await db.query("SELECT id FROM oauth_clients WHERE id=$1 FOR SHARE", [
      principal.client.id,
    ]);
    await db.query(
      `SELECT m.team_id FROM team_members m JOIN teams t ON t.id=m.team_id
      WHERE m.user_id=$1 AND ($2::uuid[] IS NULL OR m.team_id=ANY($2::uuid[]))
      FOR SHARE OF m,t`,
      [principal.user.id, principal.team_ids],
    );
    let fresh: Principal;
    try {
      fresh = (await resolvePluginCaller(headers, settings, resources, db))
        .principal;
    } catch (error) {
      if (!(error instanceof PluginAuthError)) throw error;
      throw new CapabilityError(
        "FORBIDDEN",
        "This connection is no longer permitted.",
      );
    }
    if (JSON.stringify(fresh) !== JSON.stringify(principal))
      throw new CapabilityError(
        "STALE",
        "Connection permissions changed. Read the current connection and retry.",
      );
    if (write) await actAs(db, principal.user.id, principal.grant_id);
    const result = await run(db);
    if (write)
      await db.query(
        "UPDATE agent_grants SET last_write_at=now() WHERE id=$1",
        [principal.grant_id],
      );
    return result;
  });
}
