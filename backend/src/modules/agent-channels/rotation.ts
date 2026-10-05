import { pool, transaction, type Db } from "../../db/pool.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import {
  slackInstallation,
  slackOAuthConfigDigest,
  type SlackInstallation,
  type SlackOAuthConfig,
} from "./slack-oauth.js";
import { refreshSlackToken } from "./slack-refresh.js";
type Claim = {
  id: string;
  credentials_encrypted: string;
  refresh_claim: string;
  refresh_attempts: number;
};
const busy = (error: unknown) =>
  ["55P03", "40P01"].includes((error as { code?: string })?.code ?? "");
async function owners(db: Db, id: string, nowait = true) {
  // Lock every current, scope-reviewed recipient before the shared bot. A busy
  // owner is deferred before redemption, never retried after token consumption.
  const rows = await db.query(
    `SELECT c.id FROM agent_channel_installations c
 JOIN agent_channel_bot_vaults v ON v.id=c.bot_vault_id JOIN users u ON u.id=c.user_id
 WHERE v.id=$1 AND c.disconnected_at IS NULL AND c.app_id=v.app_id AND c.workspace_id=v.workspace_id
 AND c.bot_user_id=v.bot_user_id AND c.scopes=v.scopes AND NOT u.disabled AND u.email_verified
 ORDER BY c.user_id FOR SHARE OF u,c ${nowait ? "NOWAIT" : ""}`,
    [id],
  );
  return rows.rowCount;
}
async function terminal(claim: Claim, state: "unknown" | "reconnect") {
  // Mapping -> vault is also the unlink lock order. A busy local writer cannot
  // make a consumed token ready again; the committed claim remains recoverable.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await transaction(async (db) => {
        await db.query(
          "SELECT id FROM agent_channel_installations WHERE bot_vault_id=$1 ORDER BY id FOR UPDATE NOWAIT",
          [claim.id],
        );
        const changed = await db.query(
          `UPDATE agent_channel_bot_vaults SET refresh_state=$3,refresh_claim=NULL,refresh_lease_until=NULL,refresh_config_hash=NULL,
     credentials_encrypted=NULL,token_expires_at=NULL,updated_at=now()
     WHERE id=$1 AND refresh_claim=$2 AND refresh_state='refreshing' RETURNING id`,
          [claim.id, claim.refresh_claim, state],
        );
        if (changed.rowCount)
          await db.query(
            `UPDATE agent_channel_installations SET dm_enabled=false,version=version+1,updated_at=now()
     WHERE bot_vault_id=$1 AND disconnected_at IS NULL`,
            [claim.id],
          );
      });
      return;
    } catch (error) {
      if (!busy(error)) throw error;
    }
  }
}
/** Rotate one workspace bot pair. Owner mappings/consent never share refresh tokens. */
export async function rotateSlackOne(
  config: SlackOAuthConfig,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const digest = slackOAuthConfigDigest(config);
  const abandoned = await pool.query<Claim>(
    `SELECT id,refresh_claim FROM agent_channel_bot_vaults WHERE refresh_state='refreshing' AND refresh_lease_until<clock_timestamp()`,
  );
  for (const claim of abandoned.rows) await terminal(claim, "unknown");
  const claim = await transaction(
    async (db) =>
      (
        await db.query<Claim>(
          `WITH candidate AS (
  SELECT v.id FROM agent_channel_bot_vaults v WHERE v.provider='slack' AND v.app_id=$1 AND v.credentials_encrypted IS NOT NULL
  AND v.refresh_state='ready' AND v.refresh_attempts<3 AND v.refresh_available_at<=clock_timestamp()
  AND v.token_expires_at<=clock_timestamp()+interval '5 minutes'
  AND EXISTS(SELECT 1 FROM agent_channel_installations c JOIN users u ON u.id=c.user_id
   WHERE c.bot_vault_id=v.id AND c.disconnected_at IS NULL AND c.app_id=v.app_id AND c.workspace_id=v.workspace_id
   AND c.bot_user_id=v.bot_user_id AND c.scopes=v.scopes AND NOT u.disabled AND u.email_verified)
  ORDER BY v.token_expires_at,v.id FOR UPDATE OF v SKIP LOCKED LIMIT 1)
 UPDATE agent_channel_bot_vaults v SET refresh_state='refreshing',refresh_claim=gen_random_uuid(),
 refresh_lease_until=clock_timestamp()+interval '60 seconds',refresh_config_hash=$2,refresh_attempts=refresh_attempts+1,updated_at=now()
 FROM candidate WHERE v.id=candidate.id RETURNING v.*`,
          [config.appId, digest],
        )
      ).rows[0],
  );
  if (!claim) return false;
  let previous: SlackInstallation | undefined;
  try {
    previous = slackInstallation.parse(
      JSON.parse(await decryptSecret(claim.credentials_encrypted)),
    );
  } catch {
    /* No credential parse errors escape. */
  }
  let dispatched = false;
  try {
    const result = await transaction(async (db) => {
      if (!(await owners(db, claim.id))) return { state: "reconnect" } as const;
      const row = (
        await db.query<{
          workspace_id: string;
          installer_external_user_id: string;
          bot_user_id: string;
          scopes: string[];
        }>(
          `SELECT workspace_id,installer_external_user_id,bot_user_id,scopes FROM agent_channel_bot_vaults
     WHERE id=$1 AND refresh_claim=$2 AND refresh_state='refreshing' AND refresh_lease_until>clock_timestamp()
     AND refresh_config_hash=$3 AND credentials_encrypted=$4 AND app_id=$5 FOR UPDATE NOWAIT`,
          [
            claim.id,
            claim.refresh_claim,
            digest,
            claim.credentials_encrypted,
            config.appId,
          ],
        )
      ).rows[0];
      if (!row) return null;
      if (
        !previous ||
        previous.appId !== config.appId ||
        previous.workspaceId !== row.workspace_id ||
        previous.userId !== row.installer_external_user_id ||
        previous.botUserId !== row.bot_user_id ||
        JSON.stringify(previous.scopes) !== JSON.stringify(row.scopes) ||
        !previous.refreshToken
      )
        return { state: "reconnect" } as const;
      dispatched = true;
      return refreshSlackToken(config, previous, request);
    });
    if (!result) {
      await terminal(claim, "unknown");
      return true;
    }
    if (result.state === "limited" && claim.refresh_attempts < 3) {
      await pool.query(
        `UPDATE agent_channel_bot_vaults SET refresh_state='ready',refresh_claim=NULL,refresh_lease_until=NULL,refresh_config_hash=NULL,
    refresh_available_at=clock_timestamp()+make_interval(secs=>$3),updated_at=now() WHERE id=$1 AND refresh_claim=$2 AND refresh_state='refreshing'`,
        [claim.id, claim.refresh_claim, result.retryAfter],
      );
      return true;
    }
    if (result.state !== "ready") {
      await terminal(
        claim,
        result.state === "unknown" ? "unknown" : "reconnect",
      );
      return true;
    }
    // Key initialization may require the pool: crypto stays outside transactions.
    const encrypted = await encryptSecret(JSON.stringify(result.installation));
    const published = await transaction(async (db) => {
      await db.query("SET LOCAL lock_timeout = '5s'");
      if (!(await owners(db, claim.id, false))) return false;
      const updated = await db.query(
        `UPDATE agent_channel_bot_vaults SET credentials_encrypted=$3,token_expires_at=$4,
    refresh_state='ready',refresh_claim=NULL,refresh_lease_until=NULL,refresh_config_hash=NULL,refresh_attempts=0,refresh_available_at=now(),updated_at=now()
    WHERE id=$1 AND refresh_claim=$2 AND refresh_state='refreshing' AND refresh_lease_until>clock_timestamp()
    AND credentials_encrypted=$5 AND refresh_config_hash=$6 AND app_id=$7`,
        [
          claim.id,
          claim.refresh_claim,
          encrypted,
          result.installation.expiresAt,
          claim.credentials_encrypted,
          digest,
          config.appId,
        ],
      );
      return !!updated.rowCount;
    });
    if (!published) await terminal(claim, "unknown");
  } catch (error) {
    if (!dispatched && busy(error))
      await pool.query(
        `UPDATE agent_channel_bot_vaults SET refresh_state='ready',refresh_claim=NULL,refresh_lease_until=NULL,refresh_config_hash=NULL,
   refresh_attempts=refresh_attempts-1,refresh_available_at=now()+interval '10 seconds',updated_at=now()
   WHERE id=$1 AND refresh_claim=$2 AND refresh_state='refreshing'`,
        [claim.id, claim.refresh_claim],
      );
    else await terminal(claim, "unknown");
  }
  return true;
}
