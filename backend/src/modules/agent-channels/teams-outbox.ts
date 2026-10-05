import { teamsQuestionCard } from "./teams-question-card.js";
import { createHash } from "node:crypto";
import { pool, transaction, type Queryable } from "../../db/pool.js";
import { decryptSecret } from "../../lib/secrets.js";
import { reachableTeams } from "../../capabilities/policy.js";
import { readAutomationIdentity } from "../agent-context/identities.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { channelJobTeamsAllowed } from "./outbox.js";
import { slackAgentMessage } from "./slack-delivery.js";
import {
  teamsOAuthConfigDigest,
  type TeamsOAuthConfig,
} from "./teams-oauth.js";
import {
  sendTeamsMessage,
  validateTeamsBotConfig,
  teamsConversationReference,
  type TeamsBotConfig,
  type TeamsConversationReference,
} from "./teams-transport.js";

/** Commit Background-only intent alongside its transition. Hidden idea and Overnight jobs never enqueue. */
export async function queueTeamsJobUpdate(
  db: Queryable,
  jobId: string,
  event: "done" | "failed" | "waiting",
  waitingId = "",
) {
  await db.query(
    `INSERT INTO agent_channel_teams_outbox(user_id,connection_id,connection_version,source_kind,source_id,event_key,event,waiting_id)
    SELECT j.user_id,c.id,c.version,'job',j.id,$3,$2,$4 FROM ai_jobs j
    JOIN agent_channel_teams_installations c ON c.user_id=j.user_id AND c.dm_enabled AND c.disconnected_at IS NULL AND c.conversation_encrypted IS NOT NULL
    JOIN ai_chats chat ON chat.id=j.chat_id AND chat.origin<>'idea'
    WHERE j.id=$1 AND j.runtime_lane='background' AND j.run_origin<>'idea' AND j.state=$2 ON CONFLICT DO NOTHING`,
    [
      jobId,
      event,
      event === "waiting" ? `waiting:${waitingId}` : event,
      waitingId,
    ],
  );
}
/** Queue one morning intent per night and reviewed connection revision. */
export async function queueTeamsNightUpdate(
  db: Queryable,
  nightId: string,
  userId: string,
) {
  await db.query(
    `INSERT INTO agent_channel_teams_outbox(user_id,connection_id,connection_version,source_kind,source_id,event_key,event)
    SELECT n.user_id,c.id,c.version,'night',n.id,'morning','overnight' FROM assistant_nights n
    JOIN agent_channel_teams_installations c ON c.user_id=n.user_id AND c.dm_enabled AND c.disconnected_at IS NULL AND c.conversation_encrypted IS NOT NULL
    WHERE n.id=$1 AND n.user_id=$2 AND (n.summary->>'end_at')::timestamptz<=clock_timestamp() ON CONFLICT DO NOTHING`,
    [nightId, userId],
  );
}
type Delivery = {
  id: string;
  user_id: string;
  connection_id: string;
  connection_version: number;
  source_kind: "job" | "night";
  source_id: string;
  event: "done" | "failed" | "waiting" | "overnight";
  waiting_id: string;
  claim_id: string;
  attempts: number;
};
/** Current source/grant/consent fences stay held through sending. Unknown outcomes never requeue. */
export async function deliverTeamsChannelOne(
  oauth: TeamsOAuthConfig,
  bot: TeamsBotConfig,
  appUrl: string,
  send: typeof sendTeamsMessage = sendTeamsMessage,
): Promise<boolean> {
  validateTeamsBotConfig(bot);
  slackAgentMessage({ event: "overnight", appUrl });
  if (oauth.botAppId !== bot.appId)
    throw new Error("Teams bot configuration is unavailable");
  const configHash = teamsOAuthConfigDigest(oauth);
  await pool.query(
    "UPDATE agent_channel_teams_outbox SET state='unknown',claim_id=NULL,lease_until=NULL,updated_at=now() WHERE state='dispatching' AND lease_until<clock_timestamp()",
  );
  await pool.query(
    "UPDATE agent_channel_teams_outbox SET state='cancelled',updated_at=now() WHERE state='queued' AND expires_at<=clock_timestamp()",
  );
  const delivery = await transaction(
    async (db) =>
      (
        await db.query<Delivery>(`WITH candidate AS (
    SELECT id FROM agent_channel_teams_outbox WHERE state='queued' AND available_at<=clock_timestamp() AND expires_at>clock_timestamp() AND attempts<3
    ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE agent_channel_teams_outbox o SET state='dispatching',claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1,updated_at=now()
    FROM candidate WHERE o.id=candidate.id RETURNING o.*`)
      ).rows[0],
  );
  if (!delivery) return false;
  let encrypted: string | undefined,
    target: TeamsConversationReference | undefined;
  let dispatched = false;
  try {
    encrypted = (
      await pool.query(
        "SELECT conversation_encrypted FROM agent_channel_teams_installations WHERE id=$1 AND user_id=$2",
        [delivery.connection_id, delivery.user_id],
      )
    ).rows[0]?.conversation_encrypted;
    if (encrypted)
      target = teamsConversationReference.parse(
        JSON.parse(await decryptSecret(encrypted)),
      );
  } catch {
    /* No private contents escape parse/decryption failures. */
  }
  try {
    await transaction(async (db) => {
      const owned = await db.query(
        "SELECT id FROM agent_channel_teams_outbox WHERE id=$1 AND claim_id=$2 AND state='dispatching' AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() FOR UPDATE NOWAIT",
        [delivery.id, delivery.claim_id],
      );
      if (!owned.rowCount) return;
      const finish = async (
        state: "sent" | "failed" | "unknown" | "cancelled",
        activityId: string | null = null,
        card?: NonNullable<ReturnType<typeof teamsQuestionCard>>,
      ) => {
        await db.query(
          "UPDATE agent_channel_teams_outbox SET state=$3,activity_id=$4,reply_question_digest=$5,reply_nonce_hash=$6,reply_expires_at=CASE WHEN $5::text IS NOT NULL THEN clock_timestamp()+interval '15 minutes' ELSE NULL END,claim_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND claim_id=$2",
          [
            delivery.id,
            delivery.claim_id,
            state,
            activityId,
            state === "sent" ? (card?.questionDigest ?? null) : null,
            state === "sent" ? (card?.cardNonceHash ?? null) : null,
          ],
        );
      };
      const retry = async (seconds: number, restoreAttempt = false) => {
        await db.query(
          "UPDATE agent_channel_teams_outbox SET state='queued',claim_id=NULL,lease_until=NULL,attempts=attempts-CASE WHEN $4 THEN 1 ELSE 0 END,available_at=now()+make_interval(secs=>$3),updated_at=now() WHERE id=$1 AND claim_id=$2",
          [delivery.id, delivery.claim_id, seconds, restoreAttempt],
        );
      };
      const fence = (
        await db.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_xact_lock(hashtextextended('agenda-sources:' || $1::text,0)) AS locked",
          [delivery.user_id],
        )
      ).rows[0].locked;
      if (!fence) {
        await retry(10, true);
        return;
      }
      const user = await db.query(
        "SELECT id FROM users WHERE id=$1 AND NOT disabled AND email_verified FOR SHARE NOWAIT",
        [delivery.user_id],
      );
      const connection = (
        await db.query(
          `SELECT tenant_id,object_id,conversation_encrypted,conversation_hash,conversation_route_hash FROM agent_channel_teams_installations
        WHERE id=$1 AND user_id=$2 AND version=$3 AND dm_enabled AND disconnected_at IS NULL AND bot_app_id=$4 AND config_hash=$5 AND conversation_route_hash IS NOT NULL FOR SHARE NOWAIT`,
          [
            delivery.connection_id,
            delivery.user_id,
            delivery.connection_version,
            bot.appId,
            configHash,
          ],
        )
      ).rows[0];
      const grant = (
        await db.query<{ personal: boolean; team_ids: string[] | null }>(
          "SELECT personal,team_ids FROM agent_grants WHERE user_id=$1 AND kind='assistant' AND revoked_at IS NULL AND suspended_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp())",
          [delivery.user_id],
        )
      ).rows[0];
      if (
        !user.rowCount ||
        !connection ||
        !grant ||
        !target ||
        encrypted !== connection.conversation_encrypted ||
        target.tenantId !== connection.tenant_id ||
        target.objectId !== connection.object_id ||
        target.botId !== `28:${bot.appId}` ||
        createHash("sha256").update(JSON.stringify(target)).digest("hex") !==
          connection.conversation_hash
      ) {
        await finish("cancelled");
        return;
      }
      const identity = await readAutomationIdentity(
        db,
        delivery.user_id,
        delivery.source_kind === "night" ? "overnight" : "background",
      );
      let title: string | undefined, waiting: unknown;
      if (delivery.source_kind === "night") {
        if (
          !(
            await db.query(
              "SELECT id FROM assistant_nights WHERE id=$1 AND user_id=$2 AND (summary->>'end_at')::timestamptz<=clock_timestamp()",
              [delivery.source_id, delivery.user_id],
            )
          ).rowCount
        ) {
          await finish("cancelled");
          return;
        }
      } else {
        const teams = (
          await reachableTeams(
            db,
            delivery.user_id,
            grant.team_ids,
            "assistant",
          )
        ).map((team) => team.id);
        const scope = { user: "$2", teams: "$5", personal: "$6" };
        const job = (
          await db.query<{ title: string; waiting: unknown }>(
            `SELECT c.title,j.run_state->'state'->'waiting' AS waiting FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id
          WHERE j.id=$1 AND j.user_id=$2 AND j.state=$3 AND j.runtime_lane='background' AND j.run_origin<>'idea' AND c.origin<>'idea'
          AND ($3<>'waiting' OR j.run_state->'state'->'waiting'->>'id'=$4)
          AND ${assistantChatVisible("c", "$2", scope)} AND ${assistantJobSourcesVisible("j", "$2", false, scope)} AND ${channelJobTeamsAllowed}`,
            [
              delivery.source_id,
              delivery.user_id,
              delivery.event,
              delivery.waiting_id,
              teams,
              grant.personal,
            ],
          )
        ).rows[0];
        if (!job) {
          await finish("cancelled");
          return;
        }
        title = job.title;
        waiting = job.waiting;
      }
      const text =
        slackAgentMessage({
          event: delivery.event,
          title,
          appUrl,
          agentName: identity.revision > 0 ? identity.name : undefined,
        }).text +
        "\n" +
        new URL("/app", appUrl).href;
      const card =
        delivery.event === "waiting"
          ? (teamsQuestionCard(delivery.id, waiting) ?? undefined)
          : undefined;
      dispatched = true;
      const result = await send(bot, target, text, card);
      if (
        (result.state === "rate_limited" || result.state === "unavailable") &&
        delivery.attempts < 3
      ) {
        await retry(
          result.state === "rate_limited" ? result.retryAfterSeconds : 30,
        );
        return;
      }
      await finish(
        result.state === "sent"
          ? "sent"
          : result.state === "unknown"
            ? "unknown"
            : "failed",
        result.state === "sent" ? result.activityId : null,
        card,
      );
    });
  } catch (error) {
    const busy =
      !dispatched &&
      ["55P03", "40P01"].includes((error as { code?: string })?.code ?? "");
    await pool.query(
      `UPDATE agent_channel_teams_outbox SET state=$3,claim_id=NULL,lease_until=NULL,attempts=CASE WHEN $3='queued' THEN attempts-1 ELSE attempts END,
      available_at=CASE WHEN $3='queued' THEN now()+interval '10 seconds' ELSE available_at END,updated_at=now() WHERE id=$1 AND claim_id=$2 AND state='dispatching'`,
      [delivery.id, delivery.claim_id, busy ? "queued" : "unknown"],
    );
  }
  return true;
}
