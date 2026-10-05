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
  user_id: string;
  credentials_encrypted: string;
  refresh_claim: string;
  refresh_attempts: number;
};
async function terminal(claim: Claim, state: "unknown" | "reconnect") {
  await pool.query(
    `UPDATE agent_channel_installations SET refresh_state=$3,refresh_claim=NULL,refresh_lease_until=NULL,refresh_config_hash=NULL,
    credentials_encrypted=NULL,token_expires_at=NULL,dm_enabled=false,version=version+1,updated_at=now()
    WHERE id=$1 AND refresh_claim=$2 AND refresh_state='refreshing'`,
    [claim.id, claim.refresh_claim, state],
  );
}
async function owner(db: Db, id: string) {
  return (
    await db.query(
      "SELECT id FROM users WHERE id=$1 AND NOT disabled AND email_verified FOR SHARE NOWAIT",
      [id],
    )
  ).rowCount;
}
/** Rotate one connected token before expiry. Ambiguous redemptions require reconnect; never replay a refresh token. */
export async function rotateSlackOne(
  config: SlackOAuthConfig,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const digest = slackOAuthConfigDigest(config);
  await pool.query(`UPDATE agent_channel_installations SET refresh_state='unknown',refresh_claim=NULL,refresh_lease_until=NULL,refresh_config_hash=NULL,
    credentials_encrypted=NULL,token_expires_at=NULL,dm_enabled=false,version=version+1,updated_at=now()
    WHERE refresh_state='refreshing' AND refresh_lease_until<clock_timestamp()`);
  const claim = await transaction(
    async (db) =>
      (
        await db.query<Claim>(
          `WITH candidate AS (
    SELECT c.id FROM agent_channel_installations c JOIN users u ON u.id=c.user_id
    WHERE c.provider='slack' AND c.app_id=$1 AND c.disconnected_at IS NULL AND c.credentials_encrypted IS NOT NULL
      AND c.refresh_state='ready' AND c.refresh_attempts<3 AND c.refresh_available_at<=clock_timestamp()
      AND c.token_expires_at<=clock_timestamp()+interval '5 minutes' AND NOT u.disabled AND u.email_verified
    ORDER BY c.token_expires_at,c.id FOR UPDATE OF c SKIP LOCKED LIMIT 1)
    UPDATE agent_channel_installations c SET refresh_state='refreshing',refresh_claim=gen_random_uuid(),
      refresh_lease_until=clock_timestamp()+interval '60 seconds',refresh_config_hash=$2,refresh_attempts=refresh_attempts+1,updated_at=now()
    FROM candidate WHERE c.id=candidate.id RETURNING c.*`,
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
    /* A corrupted credential cannot be redeemed. */
  }
  let dispatched = false;
  try {
    const result = await transaction(async (db) => {
      // NOWAIT avoids a reverse lock wait against owner/session settings writes.
      if (!(await owner(db, claim.user_id)))
        return { state: "reconnect" } as const;
      const row = (
        await db.query<{
          workspace_id: string;
          external_user_id: string;
          bot_user_id: string;
          scopes: string[];
        }>(
          `SELECT workspace_id,external_user_id,bot_user_id,scopes FROM agent_channel_installations
        WHERE id=$1 AND user_id=$2 AND refresh_claim=$3 AND refresh_state='refreshing' AND refresh_lease_until>clock_timestamp()
        AND refresh_config_hash=$4 AND credentials_encrypted=$5 AND app_id=$6 AND disconnected_at IS NULL FOR UPDATE NOWAIT`,
          [
            claim.id,
            claim.user_id,
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
        previous.userId !== row.external_user_id ||
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
        `UPDATE agent_channel_installations SET refresh_state='ready',refresh_claim=NULL,refresh_lease_until=NULL,refresh_config_hash=NULL,
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
    // Crypto stays outside authority transactions, including cold DB-backed-key workers.
    const encrypted = await encryptSecret(JSON.stringify(result.installation));
    const published = await transaction(async (db) => {
      if (!(await owner(db, claim.user_id))) return false;
      const updated = await db.query(
        `UPDATE agent_channel_installations SET credentials_encrypted=$3,token_expires_at=$4,
        refresh_state='ready',refresh_claim=NULL,refresh_lease_until=NULL,refresh_config_hash=NULL,refresh_attempts=0,refresh_available_at=now(),updated_at=now()
        WHERE id=$1 AND user_id=$5 AND refresh_claim=$2 AND refresh_state='refreshing' AND refresh_lease_until>clock_timestamp()
        AND credentials_encrypted=$6 AND refresh_config_hash=$7 AND app_id=$8 AND disconnected_at IS NULL`,
        [
          claim.id,
          claim.refresh_claim,
          encrypted,
          result.installation.expiresAt,
          claim.user_id,
          claim.credentials_encrypted,
          digest,
          config.appId,
        ],
      );
      return !!updated.rowCount;
    });
    if (!published) await terminal(claim, "unknown");
  } catch (error) {
    if (
      !dispatched &&
      ["55P03", "40P01"].includes((error as { code?: string }).code ?? "")
    ) {
      await pool.query(
        `UPDATE agent_channel_installations SET refresh_state='ready',refresh_claim=NULL,refresh_lease_until=NULL,refresh_config_hash=NULL,
        refresh_attempts=refresh_attempts-1,refresh_available_at=now()+interval '10 seconds',updated_at=now()
        WHERE id=$1 AND refresh_claim=$2 AND refresh_state='refreshing'`,
        [claim.id, claim.refresh_claim],
      );
    } else await terminal(claim, "unknown");
  }
  return true;
}
