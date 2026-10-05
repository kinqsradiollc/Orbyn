import { createHash } from "node:crypto";
import {
  fail,
  slackInstallationConfirm,
  slackChannelPermission,
  slackChannelDisconnect,
} from "@orbyn/core";
import { transaction, type Db } from "../../db/pool.js";
import { encryptSecret, decryptSecret } from "../../lib/secrets.js";
import {
  exchangeSlackCode,
  newSlackOAuthState,
  slackAuthorizationUrl,
  slackOAuthConfigDigest,
  slackInstallation,
  type SlackInstallation,
  type SlackOAuthConfig,
} from "./slack-oauth.js";

type Binding = { userId: string; sessionId: string };
type Channel = {
  id: string;
  user_id: string;
  app_id: string;
  workspace_id: string;
  workspace_name: string;
  external_user_id: string;
  scopes: string[];
  dm_enabled: boolean;
  version: number;
  disconnected_at: Date | null;
  token_expires_at: Date | null;
};
type Pending = {
  id: string;
  user_id: string;
  session_id: string;
  config_hash: string;
  state: "pending" | "exchanging" | "ready" | "done" | "failed";
  installation_encrypted: string | null;
  connection_id: string | null;
  expires_at: Date;
};
const view = (row: Channel) => ({
  id: row.id,
  workspace_id: row.workspace_id,
  workspace_name: row.workspace_name,
  external_user_id: row.external_user_id,
  bot_scopes: row.scopes,
  dm_enabled: row.dm_enabled,
  version: Number(row.version),
  disconnected: row.disconnected_at !== null,
  token_expires_at: row.token_expires_at?.toISOString() ?? null,
});

async function decodeInstallation(
  encrypted: string,
): Promise<SlackInstallation> {
  try {
    const parsed = slackInstallation.safeParse(
      JSON.parse(await decryptSecret(encrypted)),
    );
    if (!parsed.success) throw new Error("Unavailable");
    return parsed.data;
  } catch {
    fail(503, "This Slack connection is no longer available.");
  }
}

/** Owner/session locks and a post-lock reread fence logout and account switches. */
async function live(db: Db, binding: Binding, write = true) {
  await db.query(
    `SELECT id FROM users WHERE id=$1 FOR ${write ? "UPDATE" : "SHARE"}`,
    [binding.userId],
  );
  await db.query(
    "SELECT id FROM sessions WHERE id=$1 AND user_id=$2 FOR SHARE",
    [binding.sessionId, binding.userId],
  );
  const current = await db.query(
    "SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.expires_at>clock_timestamp() AND NOT u.disabled AND u.email_verified",
    [binding.sessionId, binding.userId],
  );
  if (!current.rowCount)
    fail(401, "This Orbyn session is no longer available.");
}

/** Start a bounded one-use installation owned by the initiating Orbyn session. */
export async function beginSlackInstallation(
  binding: Binding,
  config: SlackOAuthConfig,
) {
  const oauth = newSlackOAuthState();
  const configHash = slackOAuthConfigDigest(config);
  const authorizationUrl = slackAuthorizationUrl(config, oauth.state);
  return transaction(async (db) => {
    await live(db, binding);
    const count = await db.query(
      "SELECT count(*)::int AS n FROM agent_channel_oauth_pending WHERE user_id=$1 AND state IN ('pending','exchanging','ready') AND expires_at>clock_timestamp()",
      [binding.userId],
    );
    if (count.rows[0].n >= 5)
      fail(429, "Finish an existing Slack connection first.");
    const row = (
      await db.query<Pending>(
        "INSERT INTO agent_channel_oauth_pending(user_id,session_id,state_hash,config_hash) VALUES($1,$2,$3,$4) RETURNING id,expires_at",
        [binding.userId, binding.sessionId, oauth.digest, configHash],
      )
    ).rows[0];
    return {
      id: row.id,
      authorization_url: authorizationUrl,
      expires_at: row.expires_at.toISOString(),
    };
  });
}

/** Public OAuth return captures encrypted credentials; it cannot link or enable DM. */
export async function captureSlackInstallation(
  config: SlackOAuthConfig,
  callback: { state: string; code?: string; error?: string },
  request: typeof fetch = fetch,
) {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(callback.state) ||
    !!callback.code === !!callback.error ||
    (callback.code?.length ?? 0) > 4096 ||
    (callback.error?.length ?? 0) > 512
  )
    fail(400, "This Slack connection request is unavailable.");
  const hash = createHash("sha256").update(callback.state).digest("hex");
  const configHash = slackOAuthConfigDigest(config);
  const captured = await transaction(async (db) => {
    const candidate = (
      await db.query<Pending>(
        "SELECT * FROM agent_channel_oauth_pending WHERE state_hash=$1",
        [hash],
      )
    ).rows[0];
    if (!candidate) fail(404, "This Slack connection request is unavailable.");
    await live(db, {
      userId: candidate.user_id,
      sessionId: candidate.session_id,
    });
    const row = (
      await db.query<Pending & { exchange_claim: string | null }>(
        `UPDATE agent_channel_oauth_pending SET state=$3,exchange_claim=CASE WHEN $3='exchanging' THEN gen_random_uuid() ELSE NULL END
       WHERE id=$1 AND state_hash=$2 AND state='pending' AND config_hash=$4 AND expires_at>clock_timestamp() RETURNING *`,
        [
          candidate.id,
          hash,
          callback.error ? "failed" : "exchanging",
          configHash,
        ],
      )
    ).rows[0];
    if (!row)
      fail(409, "This Slack connection request expired or was already used.");
    return row;
  });
  if (callback.error) return { captured: false };
  try {
    const installation = await exchangeSlackCode(
      config,
      callback.code!,
      request,
    );
    const encrypted = await encryptSecret(JSON.stringify(installation));
    await transaction(async (db) => {
      await live(db, {
        userId: captured.user_id,
        sessionId: captured.session_id,
      });
      const changed = await db.query(
        `UPDATE agent_channel_oauth_pending SET state='ready',exchange_claim=NULL,installation_encrypted=$3
         WHERE id=$1 AND state='exchanging' AND exchange_claim=$2 AND config_hash=$4 AND expires_at>clock_timestamp()`,
        [captured.id, captured.exchange_claim, encrypted, configHash],
      );
      if (!changed.rowCount)
        fail(409, "This Slack connection request expired or changed.");
    });
    return { captured: true };
  } catch {
    // An uncertain exchange is never retried, and a callback never re-links an account.
    await transaction(async (db) => {
      await db.query(
        "UPDATE agent_channel_oauth_pending SET state='failed',exchange_claim=NULL,installation_encrypted=NULL WHERE id=$1 AND state='exchanging' AND exchange_claim=$2",
        [captured.id, captured.exchange_claim],
      );
    });
    fail(
      503,
      "Slack authorization could not be completed. Start a new connection.",
    );
  }
}

/** Reveal verified actor/workspace for explicit review, never bot credentials. */
export async function readSlackInstallationRequest(
  binding: Binding,
  id: string,
  config: SlackOAuthConfig,
) {
  const configHash = slackOAuthConfigDigest(config);
  const row = await transaction(async (db) => {
    await live(db, binding, false);
    const row = (
      await db.query<Pending>(
        "SELECT * FROM agent_channel_oauth_pending WHERE id=$1 AND user_id=$2 AND session_id=$3",
        [id, binding.userId, binding.sessionId],
      )
    ).rows[0];
    if (!row) fail(404, "This Slack connection request is unavailable.");
    return row;
  });
  const expired = row.expires_at.getTime() <= Date.now();
  const unavailable = row.config_hash !== configHash;
  const installation =
    !expired &&
    !unavailable &&
    row.state === "ready" &&
    row.installation_encrypted
      ? await decodeInstallation(row.installation_encrypted)
      : null;
  return {
    id: row.id,
    state: unavailable
      ? "unavailable"
      : expired && row.state !== "done"
        ? "expired"
        : row.state,
    expires_at: row.expires_at.toISOString(),
    identity: installation
      ? {
          workspace_id: installation.workspaceId,
          workspace_name: installation.workspaceName,
          external_user_id: installation.userId,
          bot_scopes: installation.scopes,
        }
      : null,
  };
}

/** Confirm the reviewed actor in the exact originating session; messages stay opt-in. */
export async function confirmSlackInstallation(
  binding: Binding,
  id: string,
  config: SlackOAuthConfig,
  value: unknown,
) {
  const input = slackInstallationConfirm.parse(value);
  const configHash = slackOAuthConfigDigest(config);
  // Crypto may initialize the shared encryption key through the pool. Keep it
  // outside the transaction (DB_POOL_MAX=1 is supported), then fence this exact
  // encrypted snapshot under the live owner/session and pending-row locks.
  const candidate = await transaction(async (db) => {
    await live(db, binding, false);
    return (
      await db.query<Pending>(
        "SELECT * FROM agent_channel_oauth_pending WHERE id=$1 AND user_id=$2 AND session_id=$3",
        [id, binding.userId, binding.sessionId],
      )
    ).rows[0];
  });
  if (!candidate) fail(404, "This Slack connection request is unavailable.");
  const installation = candidate.installation_encrypted
    ? await decodeInstallation(candidate.installation_encrypted)
    : null;
  try {
    return await transaction(async (db) => {
      await live(db, binding);
      const row = (
        await db.query<Pending>(
          "SELECT * FROM agent_channel_oauth_pending WHERE id=$1 AND user_id=$2 AND session_id=$3 FOR UPDATE",
          [id, binding.userId, binding.sessionId],
        )
      ).rows[0];
      if (!row) fail(404, "This Slack connection request is unavailable.");
      const current = (
        await db.query<Channel>(
          "SELECT * FROM agent_channel_installations WHERE user_id=$1 AND provider='slack' FOR UPDATE",
          [binding.userId],
        )
      ).rows[0];
      if (row.state === "done" && current?.id === row.connection_id)
        return view(current);
      if (
        row.state !== "ready" ||
        !row.installation_encrypted ||
        !installation ||
        row.installation_encrypted !== candidate.installation_encrypted ||
        row.config_hash !== configHash ||
        row.expires_at.getTime() <= Date.now()
      )
        fail(409, "This Slack connection request expired or changed.");
      if ((current?.version ?? 0) !== input.expected_version)
        fail(409, "The Slack connection changed. Refresh and review it again.");
      if (
        installation.appId !== config.appId ||
        installation.workspaceId !== input.workspace_id ||
        installation.userId !== input.external_user_id ||
        JSON.stringify(installation.scopes) !==
          JSON.stringify(input.expected_bot_scopes)
      )
        fail(409, "The reviewed Slack identity changed.");
      const credentials = row.installation_encrypted;
      const connected = (
        await db.query<Channel>(
          `INSERT INTO agent_channel_installations(user_id,provider,app_id,workspace_id,workspace_name,external_user_id,bot_user_id,scopes,credentials_encrypted,token_expires_at,dm_enabled)
         VALUES($1,'slack',$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(user_id,provider) DO UPDATE SET app_id=excluded.app_id,workspace_id=excluded.workspace_id,workspace_name=excluded.workspace_name,
         external_user_id=excluded.external_user_id,bot_user_id=excluded.bot_user_id,scopes=excluded.scopes,credentials_encrypted=excluded.credentials_encrypted,
         token_expires_at=excluded.token_expires_at,dm_enabled=excluded.dm_enabled,disconnected_at=NULL,version=agent_channel_installations.version+1,updated_at=now() RETURNING *`,
          [
            binding.userId,
            installation.appId,
            installation.workspaceId,
            installation.workspaceName,
            installation.userId,
            installation.botUserId,
            installation.scopes,
            credentials,
            installation.expiresAt,
            input.dm_enabled,
          ],
        )
      ).rows[0];
      await db.query(
        "UPDATE agent_channel_oauth_pending SET state='done',installation_encrypted=NULL,connection_id=$2 WHERE id=$1",
        [id, connected.id],
      );
      return view(connected);
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505")
      fail(409, "This Slack identity is already connected.");
    throw error;
  }
}

/** Local unlink removes credentials and fences queued deliveries, without uninstalling a shared Slack bot. */
export async function disconnectSlackInstallation(
  binding: Binding,
  value: unknown,
) {
  const input = slackChannelDisconnect.parse(value);
  return transaction(async (db) => {
    await live(db, binding);
    const row = (
      await db.query<Channel>(
        `UPDATE agent_channel_installations SET dm_enabled=false,credentials_encrypted=NULL,token_expires_at=NULL,disconnected_at=now(),version=version+1,updated_at=now()
       WHERE user_id=$1 AND provider='slack' AND version=$2 RETURNING *`,
        [binding.userId, input.expected_version],
      )
    ).rows[0];
    if (!row)
      fail(409, "The Slack connection changed. Refresh and review it again.");
    return view(row);
  });
}

/** Read only this owner's local mapping; configuration never comes from the client. */
export async function readSlackChannel(binding: Binding) {
  return transaction(async (db) => {
    await live(db, binding, false);
    const row = (
      await db.query<Channel>(
        "SELECT * FROM agent_channel_installations WHERE user_id=$1 AND provider='slack'",
        [binding.userId],
      )
    ).rows[0];
    return row ? view(row) : null;
  });
}

/** Versioned opt-in is local to this mapping; disabling remains available if app configuration is removed. */
export async function setSlackDmPermission(
  binding: Binding,
  value: unknown,
  config?: SlackOAuthConfig,
) {
  const input = slackChannelPermission.parse(value);
  if (input.dm_enabled && !config)
    fail(503, "Slack connection is not configured.");
  if (input.dm_enabled) slackOAuthConfigDigest(config!);
  return transaction(async (db) => {
    await live(db, binding);
    const row = (
      await db.query<Channel>(
        `UPDATE agent_channel_installations SET dm_enabled=$3,version=version+1,updated_at=now()
       WHERE user_id=$1 AND provider='slack' AND version=$2 AND
       (NOT $3 OR (disconnected_at IS NULL AND credentials_encrypted IS NOT NULL AND app_id=$4)) RETURNING *`,
        [
          binding.userId,
          input.expected_version,
          input.dm_enabled,
          config?.appId ?? null,
        ],
      )
    ).rows[0];
    if (!row) fail(409, "The Slack connection changed or needs reconnection.");
    return view(row);
  });
}
