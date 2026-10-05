import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { fail } from "@orbyn/core";
import { transaction, type Db } from "../../db/pool.js";
import { encryptSecret, decryptSecret } from "../../lib/secrets.js";
import {
  exchangeTeamsCode,
  newTeamsOAuthState,
  teamsAuthorizationUrl,
  teamsOAuthConfigDigest,
  type TeamsOAuthConfig,
} from "./teams-oauth.js";

type Binding = { userId: string; sessionId: string };
type Pending = {
  id: string;
  user_id: string;
  session_id: string;
  config_hash: string;
  state: "pending" | "exchanging" | "ready" | "confirmed" | "failed";
  expires_at: Date;
  pkce_encrypted: string | null;
  identity_encrypted: string | null;
};
const identity = z
  .object({
    tenantId: z.uuid(),
    objectId: z.uuid(),
    subject: z.string().min(1).max(255),
    displayName: z.string().min(1).max(200),
  })
  .strict();
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function live(db: Db, binding: Binding) {
  await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
    binding.userId,
  ]);
  await db.query(
    "SELECT id FROM sessions WHERE id=$1 AND user_id=$2 FOR SHARE",
    [binding.sessionId, binding.userId],
  );
  const current = await db.query(
    `SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=$1 AND s.user_id=$2 AND s.expires_at>clock_timestamp() AND NOT u.disabled AND u.email_verified`,
    [binding.sessionId, binding.userId],
  );
  if (!current.rowCount)
    fail(401, "This Orbyn session is no longer available.");
}
/** Begin an identity-only OAuth attempt owned by the exact live Orbyn session. */
export async function beginTeamsInstallation(
  binding: Binding,
  config: TeamsOAuthConfig,
) {
  const oauth = newTeamsOAuthState(),
    hash = teamsOAuthConfigDigest(config);
  const encrypted = await encryptSecret(
    JSON.stringify({ verifier: oauth.verifier, nonce: oauth.nonce }),
  );
  const url = teamsAuthorizationUrl(config, oauth);
  return transaction(async (db) => {
    await live(db, binding);
    const count = (
      await db.query(
        "SELECT count(*)::int AS n FROM agent_channel_teams_oauth_pending WHERE user_id=$1 AND state IN ('pending','exchanging','ready') AND expires_at>clock_timestamp()",
        [binding.userId],
      )
    ).rows[0].n;
    if (count >= 5) fail(429, "Finish an existing Teams connection first.");
    const pending = (
      await db.query<{ id: string; expires_at: Date }>(
        `INSERT INTO agent_channel_teams_oauth_pending(user_id,session_id,state_hash,config_hash,pkce_encrypted)
      VALUES($1,$2,$3,$4,$5) RETURNING id,expires_at`,
        [binding.userId, binding.sessionId, oauth.digest, hash, encrypted],
      )
    ).rows[0];
    return {
      id: pending.id,
      authorization_url: url,
      expires_at: pending.expires_at.toISOString(),
    };
  });
}
/** A public OAuth return captures identity only, after committing its unique redemption claim. */
export async function captureTeamsInstallation(
  config: TeamsOAuthConfig,
  input: { state: string; code?: string; error?: string },
  redeem: typeof exchangeTeamsCode = exchangeTeamsCode,
) {
  const callback = z
    .object({
      state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      code: z.string().min(1).max(8192).optional(),
      error: z.string().min(1).max(512).optional(),
    })
    .strict()
    .refine((value) => !!value.code !== !!value.error)
    .parse(input);
  const hash = teamsOAuthConfigDigest(config),
    claim = randomBytes(16).toString("hex");
  const pending = await transaction(async (db) => {
    const row = (
      await db.query<Pending>(
        "SELECT * FROM agent_channel_teams_oauth_pending WHERE state_hash=$1 AND config_hash=$2 AND state='pending' AND expires_at>clock_timestamp()",
        [digest(callback.state), hash],
      )
    ).rows[0];
    if (!row) fail(409, "This Teams connection changed or expired.");
    await live(db, { userId: row.user_id, sessionId: row.session_id });
    if (callback.error) {
      const cancelled = await db.query(
        "UPDATE agent_channel_teams_oauth_pending SET state='failed',pkce_encrypted=NULL WHERE id=$1 AND state='pending' AND config_hash=$2 AND expires_at>clock_timestamp()",
        [row.id, hash],
      );
      if (!cancelled.rowCount)
        fail(409, "This Teams connection changed or expired.");
      return null;
    }
    const claimed = await db.query(
      "UPDATE agent_channel_teams_oauth_pending SET state='exchanging',exchange_claim=$2::uuid WHERE id=$1 AND state='pending' AND config_hash=$3 AND expires_at>clock_timestamp() AND user_id=$4 AND session_id=$5",
      [row.id, claim, hash, row.user_id, row.session_id],
    );
    if (!claimed.rowCount)
      fail(409, "This Teams connection changed or expired.");
    return row;
  });
  if (!pending) return { captured: false };
  try {
    const pkce = z
      .object({
        verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      })
      .strict()
      .parse(JSON.parse(await decryptSecret(pending.pkce_encrypted!)));
    const verified = identity.parse(await redeem(config, callback.code!, pkce));
    const encrypted = await encryptSecret(JSON.stringify(verified));
    return await transaction(async (db) => {
      await live(db, {
        userId: pending.user_id,
        sessionId: pending.session_id,
      });
      const saved = await db.query(
        `UPDATE agent_channel_teams_oauth_pending SET state='ready',pkce_encrypted=NULL,exchange_claim=NULL,identity_encrypted=$3
        WHERE id=$1 AND state='exchanging' AND exchange_claim=$2::uuid AND config_hash=$4 AND expires_at>clock_timestamp()`,
        [pending.id, claim, encrypted, hash],
      );
      if (!saved.rowCount)
        fail(409, "This Teams connection changed or expired.");
      return { captured: true };
    });
  } catch {
    await transaction(async (db) => {
      await db.query(
        "UPDATE agent_channel_teams_oauth_pending SET state='failed',pkce_encrypted=NULL,identity_encrypted=NULL,exchange_claim=NULL WHERE id=$1 AND state='exchanging' AND exchange_claim=$2::uuid",
        [pending.id, claim],
      );
    });
    fail(503, "Teams sign-in could not be completed. Start a new connection.");
  }
}
/** Read captured identity only from the original live session, never from a bearer state or another device. */
export async function readTeamsInstallationRequest(
  binding: Binding,
  id: string,
  config: TeamsOAuthConfig,
) {
  const hash = teamsOAuthConfigDigest(config);
  const row = await transaction(async (db) => {
    await live(db, binding);
    return (
      await db.query<Pending>(
        "SELECT * FROM agent_channel_teams_oauth_pending WHERE id=$1 AND user_id=$2 AND session_id=$3",
        [id, binding.userId, binding.sessionId],
      )
    ).rows[0];
  });
  if (!row) fail(404, "Teams connection request not found.");
  const expired =
    row.expires_at.getTime() <= Date.now() || row.config_hash !== hash;
  const captured =
    !expired && row.state === "ready" && row.identity_encrypted
      ? identity.parse(JSON.parse(await decryptSecret(row.identity_encrypted)))
      : null;
  if (captured) {
    await transaction(async (db) => {
      await live(db, binding);
      const current = await db.query(
        "SELECT id FROM agent_channel_teams_oauth_pending WHERE id=$1 AND user_id=$2 AND session_id=$3 AND state='ready' AND config_hash=$4 AND identity_encrypted=$5 AND expires_at>clock_timestamp() FOR SHARE",
        [id, binding.userId, binding.sessionId, hash, row.identity_encrypted],
      );
      if (!current.rowCount)
        fail(409, "This Teams connection changed or expired.");
    });
  }
  return {
    id: row.id,
    state: expired ? "expired" : row.state,
    expires_at: row.expires_at.toISOString(),
    identity: captured,
  };
}
/** Explicit identity review creates a one-use personal-conversation handshake, with DMs still off. */
export async function confirmTeamsInstallation(
  binding: Binding,
  id: string,
  config: TeamsOAuthConfig,
  review: { expected_version: number; tenant_id: string; object_id: string },
) {
  const hash = teamsOAuthConfigDigest(config),
    nonce = randomBytes(32).toString("base64url");
  const row = await transaction(async (db) => {
    await live(db, binding);
    return (
      await db.query<Pending>(
        "SELECT * FROM agent_channel_teams_oauth_pending WHERE id=$1 AND user_id=$2 AND session_id=$3 AND state='ready' AND config_hash=$4 AND expires_at>clock_timestamp()",
        [id, binding.userId, binding.sessionId, hash],
      )
    ).rows[0];
  });
  if (!row?.identity_encrypted)
    fail(409, "This Teams connection changed or expired.");
  const verified = identity.parse(
    JSON.parse(await decryptSecret(row.identity_encrypted)),
  );
  const checked = z
    .object({
      expected_version: z.number().int().min(0),
      tenant_id: z.uuid(),
      object_id: z.uuid(),
    })
    .strict()
    .parse(review);
  if (
    checked.tenant_id !== verified.tenantId ||
    checked.object_id !== verified.objectId
  )
    fail(409, "This Teams identity changed. Refresh before reviewing.");
  return transaction(async (db) => {
    await live(db, binding);
    const pending = await db.query(
      "SELECT id FROM agent_channel_teams_oauth_pending WHERE id=$1 AND state='ready' AND identity_encrypted=$2 AND config_hash=$3 AND expires_at>clock_timestamp() AND user_id=$4 AND session_id=$5 FOR UPDATE",
      [id, row.identity_encrypted, hash, binding.userId, binding.sessionId],
    );
    if (!pending.rowCount)
      fail(409, "This Teams connection changed or expired.");
    const current = (
      await db.query<{ id: string; version: number }>(
        "SELECT id,version FROM agent_channel_teams_installations WHERE user_id=$1 FOR UPDATE",
        [binding.userId],
      )
    ).rows[0];
    if ((current?.version ?? 0) !== checked.expected_version)
      fail(409, "This Teams connection changed. Refresh before reviewing.");
    const taken = await db.query(
      "SELECT id FROM agent_channel_teams_installations WHERE bot_app_id=$1 AND tenant_id=$2 AND object_id=$3 AND user_id<>$4",
      [config.botAppId, verified.tenantId, verified.objectId, binding.userId],
    );
    if (taken.rowCount) fail(409, "This Teams account is already connected.");
    const connection = (
      await db.query<{ id: string; version: number; link_expires_at: Date }>(
        `INSERT INTO agent_channel_teams_installations(user_id,bot_app_id,tenant_id,object_id,display_name,config_hash,link_nonce_hash,link_expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '10 minutes')
      ON CONFLICT(user_id) DO UPDATE SET bot_app_id=EXCLUDED.bot_app_id,tenant_id=EXCLUDED.tenant_id,object_id=EXCLUDED.object_id,display_name=EXCLUDED.display_name,
      config_hash=EXCLUDED.config_hash,link_nonce_hash=EXCLUDED.link_nonce_hash,link_expires_at=EXCLUDED.link_expires_at,
      conversation_encrypted=NULL,conversation_hash=NULL,disconnected_at=NULL,dm_enabled=false,version=agent_channel_teams_installations.version+1,updated_at=now()
      RETURNING id,version,link_expires_at`,
        [
          binding.userId,
          config.botAppId,
          verified.tenantId,
          verified.objectId,
          verified.displayName,
          hash,
          digest(nonce),
        ],
      )
    ).rows[0];
    await db.query(
      "UPDATE agent_channel_teams_oauth_pending SET state='confirmed',identity_encrypted=NULL WHERE id=$1",
      [id],
    );
    return {
      id: connection.id,
      version: connection.version,
      link_token: nonce,
      link_expires_at: connection.link_expires_at.toISOString(),
      dm_enabled: false,
    };
  }).catch((error: unknown) => {
    if ((error as { code?: string })?.code === "23505")
      fail(409, "This Teams account is already connected.");
    throw error;
  });
}
