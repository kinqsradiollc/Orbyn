import { configuredTeamsBot } from "./teams-config.js";
import type { TeamsBotConfig } from "./teams-transport.js";
import { captureTeamsQuestionReply } from "./teams-question-receipts.js";
import {
  readTeamsQuestionReply,
  TeamsQuestionReplyError,
  teamsQuestionInvokeAck,
} from "./teams-question-reply.js";
import { z } from "zod";
import { fail } from "@orbyn/core";
import { transaction } from "../../db/pool.js";
import {
  authenticateTeamsActivity,
  type TeamsSigningKey,
} from "./teams-auth.js";
import {
  bindTeamsPersonalConversation,
  teamsConversationRouteDigest,
} from "./teams-conversations.js";
import type { TeamsOAuthConfig } from "./teams-oauth.js";

const personalRemoval = z.object({
  type: z.enum(["installationUpdate", "conversationUpdate"]),
  id: z.string().min(1).max(500),
  timestamp: z.iso.datetime({ offset: true }),
  recipient: z.object({ id: z.string().min(1).max(200) }),
  conversation: z.object({
    id: z.string().min(1).max(1000),
    conversationType: z.literal("personal"),
    tenantId: z.uuid().optional(),
  }),
  channelData: z.object({ tenant: z.object({ id: z.uuid() }) }),
  action: z.enum(["remove", "remove-upgrade"]).optional(),
  membersRemoved: z
    .array(z.object({ id: z.string().min(1).max(500) }))
    .max(100)
    .optional(),
});
/** Only a verified provider lifecycle event can revoke the currently proved personal route.
 * Installation actors are not used to choose recipients. Unknown events/text are not persisted.
 */
export async function receiveTeamsActivity(
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>,
  config: TeamsOAuthConfig,
  keys?: (refresh?: boolean) => Promise<TeamsSigningKey[]>,
  bot: TeamsBotConfig | undefined = configuredTeamsBot(),
) {
  const activity = await authenticateTeamsActivity(
    raw,
    headers,
    { appId: config.botAppId },
    keys,
  );
  const cardInvoke =
    activity.type === "invoke" && activity.name === "adaptiveCard/action";
  const cardSubmit =
    activity.type === "message" &&
    (activity.value as { orbyn_action?: unknown } | undefined)?.orbyn_action ===
      "orbyn.answer-question";
  if (cardInvoke || cardSubmit) {
    let captured = false;
    try {
      const submitted = await readTeamsQuestionReply(
        raw,
        headers,
        { appId: config.botAppId },
        keys,
      );
      if (submitted) {
        if (!bot) fail(503, "Teams reply delivery is not configured.");
        await captureTeamsQuestionReply(submitted, config, bot);
        captured = true;
      }
    } catch (error) {
      if (!(error instanceof TeamsQuestionReplyError)) throw error;
    }
    return cardInvoke
      ? teamsQuestionInvokeAck(captured)
      : { received: captured };
  }
  if (
    activity.type === "message" &&
    typeof activity.text === "string" &&
    /^\/orbyn connect [A-Za-z0-9_-]{43}$/.test(activity.text)
  ) {
    try {
      await bindTeamsPersonalConversation(raw, headers, config, keys);
    } catch (error) {
      if (
        ![400, 403, 409].includes(
          (error as { statusCode?: number })?.statusCode ?? 0,
        )
      )
        throw error;
      return { received: true, linked: false };
    }
    return { received: true, linked: true };
  }
  const parsed = personalRemoval.safeParse(activity);
  if (!parsed.success) return { received: true };
  const event = parsed.data,
    tenantId = event.channelData.tenant.id;
  if (event.conversation.tenantId && event.conversation.tenantId !== tenantId)
    fail(403, "This Teams event is unavailable.");
  const removed =
    event.type === "installationUpdate"
      ? !!event.action
      : event.membersRemoved?.some(
          (member) => member.id === `28:${config.botAppId}`,
        );
  if (!removed) return { received: true };
  if (Date.parse(event.timestamp) > Date.now() + 300000)
    fail(400, "This Teams event is unavailable.");
  const routeHash = teamsConversationRouteDigest(
    config.botAppId,
    tenantId,
    event.conversation.id,
  );
  await transaction(async (db) => {
    const candidate = (
      await db.query<{ id: string; user_id: string }>(
        `SELECT id,user_id FROM agent_channel_teams_installations
      WHERE bot_app_id=$1 AND tenant_id=$2 AND conversation_route_hash=$3 AND conversation_bound_at<=$4::timestamptz`,
        [config.botAppId, tenantId, routeHash, event.timestamp],
      )
    ).rows[0];
    if (!candidate) return;
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      candidate.user_id,
    ]);
    const revoked = await db.query(
      `UPDATE agent_channel_teams_installations SET dm_enabled=false,disconnected_at=now(),
      conversation_encrypted=NULL,conversation_hash=NULL,conversation_route_hash=NULL,conversation_bound_at=NULL,
      link_nonce_hash=NULL,link_expires_at=NULL,version=version+1,updated_at=now()
      WHERE id=$1 AND user_id=$2 AND bot_app_id=$3 AND tenant_id=$4 AND conversation_route_hash=$5 AND conversation_bound_at<=$6::timestamptz`,
      [
        candidate.id,
        candidate.user_id,
        config.botAppId,
        tenantId,
        routeHash,
        event.timestamp,
      ],
    );
    if (revoked.rowCount)
      await db.query(
        "UPDATE agent_channel_teams_oauth_pending SET state='failed',pkce_encrypted=NULL,identity_encrypted=NULL,exchange_claim=NULL WHERE user_id=$1 AND state IN ('pending','exchanging','ready')",
        [candidate.user_id],
      );
  });
  return { received: true };
}
