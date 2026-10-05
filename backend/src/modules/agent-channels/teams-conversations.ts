import { createHash } from "node:crypto";
import { z } from "zod";
import { fail } from "@orbyn/core";
import { transaction } from "../../db/pool.js";
import { encryptSecret } from "../../lib/secrets.js";
import {
  authenticateTeamsActivity,
  type TeamsSigningKey,
} from "./teams-auth.js";
import {
  teamsOAuthConfigDigest,
  type TeamsOAuthConfig,
} from "./teams-oauth.js";

const message = z.object({
  type: z.literal("message"),
  id: z.string().min(1).max(500),
  timestamp: z.iso.datetime({ offset: true }),
  channelId: z.literal("msteams"),
  serviceUrl: z.string(),
  from: z.object({
    id: z
      .string()
      .regex(/^29:.+/)
      .max(500),
    aadObjectId: z.uuid(),
  }),
  recipient: z.object({ id: z.string().min(1).max(200) }),
  conversation: z.object({
    id: z.string().min(1).max(1000),
    conversationType: z.literal("personal"),
    tenantId: z.uuid().optional(),
  }),
  channelData: z.object({ tenant: z.object({ id: z.uuid() }) }),
  text: z.string().regex(/^\/orbyn connect [A-Za-z0-9_-]{43}$/),
  textFormat: z.literal("plain").optional(),
  channel: z.never().optional(),
});
/** Hash only the authenticated route tuple; service base changes cannot hide an uninstall. */
export const teamsConversationRouteDigest = (
  botAppId: string,
  tenantId: string,
  conversationId: string,
) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        botAppId.toLowerCase(),
        tenantId.toLowerCase(),
        conversationId,
      ]),
    )
    .digest("hex");

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Bind only a Connector-authenticated personal message carrying the reviewed one-use challenge.
 * Installation actors, email addresses and user-supplied conversation URLs have no linking authority.
 * No DM is sent or enabled by this handshake.
 */
export async function bindTeamsPersonalConversation(
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>,
  config: TeamsOAuthConfig,
  keys?: (refresh?: boolean) => Promise<TeamsSigningKey[]>,
) {
  const verified = await authenticateTeamsActivity(
    raw,
    headers,
    { appId: config.botAppId },
    keys,
  );
  const parsed = message.safeParse(verified);
  if (!parsed.success)
    fail(400, "This is not a personal Teams connection message.");
  const activity = parsed.data;
  const tenantId = activity.channelData.tenant.id;
  if (
    activity.conversation.tenantId &&
    activity.conversation.tenantId !== tenantId
  )
    fail(403, "This Teams conversation is unavailable.");
  if (Date.parse(activity.timestamp) > Date.now() + 300000)
    fail(400, "This Teams connection message is unavailable.");
  const nonceHash = digest(activity.text.slice("/orbyn connect ".length));
  const reference = JSON.stringify({
    serviceUrl: activity.serviceUrl,
    tenantId,
    conversationId: activity.conversation.id,
    userId: activity.from.id,
    objectId: activity.from.aadObjectId,
    botId: activity.recipient.id,
  });
  const encrypted = await encryptSecret(reference);
  const configHash = teamsOAuthConfigDigest(config);
  return transaction(async (db) => {
    const candidate = (
      await db.query<{ id: string; user_id: string }>(
        `SELECT id,user_id FROM agent_channel_teams_installations
       WHERE bot_app_id=$1 AND tenant_id=$2 AND object_id=$3 AND link_nonce_hash=$4
       AND config_hash=$5 AND disconnected_at IS NULL AND link_expires_at>clock_timestamp()`,
        [
          config.botAppId,
          tenantId,
          activity.from.aadObjectId,
          nonceHash,
          configHash,
        ],
      )
    ).rows[0];
    if (!candidate) fail(409, "This Teams connection changed or expired.");
    const owner = await db.query(
      "SELECT id FROM users WHERE id=$1 AND NOT disabled AND email_verified FOR UPDATE",
      [candidate.user_id],
    );
    if (!owner.rowCount) fail(403, "This Teams connection is unavailable.");
    const linked = await db.query(
      `UPDATE agent_channel_teams_installations SET conversation_encrypted=$6,conversation_hash=$7,conversation_route_hash=$9,conversation_bound_at=$10::timestamptz,
       link_nonce_hash=NULL,link_expires_at=NULL,dm_enabled=false,version=version+1,updated_at=now()
       WHERE id=$1 AND bot_app_id=$2 AND tenant_id=$3 AND object_id=$4 AND link_nonce_hash=$5
       AND config_hash=$8 AND disconnected_at IS NULL AND link_expires_at>clock_timestamp()
       RETURNING id,version`,
      [
        candidate.id,
        config.botAppId,
        tenantId,
        activity.from.aadObjectId,
        nonceHash,
        encrypted,
        digest(reference),
        configHash,
        teamsConversationRouteDigest(
          config.botAppId,
          tenantId,
          activity.conversation.id,
        ),
        activity.timestamp,
      ],
    );
    if (!linked.rowCount)
      fail(409, "This Teams connection changed or expired.");
    return { ...linked.rows[0], dm_enabled: false };
  }).catch((error: unknown) => {
    if ((error as { code?: string })?.code === "23505")
      fail(409, "This Teams conversation is already connected.");
    throw error;
  });
}
