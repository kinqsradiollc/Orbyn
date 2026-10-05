import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { pool, transaction, type Db } from "../../db/pool.js";
import { encryptSecret, decryptSecret } from "../../lib/secrets.js";
import type { UserRow } from "../../lib/auth.js";
import { reachableTeams } from "../../capabilities/policy.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { answerAssistantQuestion } from "../ai/agent/run.js";
import { channelJobTeamsAllowed } from "./outbox.js";
import {
  slackOAuthConfigDigest,
  type SlackOAuthConfig,
} from "./slack-oauth.js";
import {
  SlackInteractionError,
  type SlackReply,
} from "./slack-interactions.js";
import type { SlackThreadReply } from "./slack-events.js";
import { slackQuestion, slackQuestionDigest } from "./question-card.js";

const intent = z
  .object({
    appId: z.string(),
    workspaceId: z.string(),
    userId: z.string(),
    channelId: z.string(),
    messageTs: z.string(),
    requestDigest: z.string().length(64),
    deliveryId: z.uuid().optional(),
    action: z.enum(["choice", "answer"]),
    choice: z.number().int().min(0).max(4).optional(),
    answer: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();
type Intent = z.output<typeof intent>;
type Sent = {
  id: string;
  user_id: string;
  source_id: string;
  connection_id: string;
  connection_version: number;
  reply_question_digest: string;
  reply_thread_enabled: boolean;
  waiting_id: string;
  reply_expires_at: Date;
};
const configDigest = (config: SlackOAuthConfig, secret: string) =>
  createHash("sha256")
    .update(slackOAuthConfigDigest(config))
    .update("\0")
    .update(secret)
    .digest("hex");
const normalized = (reply: SlackReply | SlackThreadReply): Intent => {
  if (reply.action !== "choice" && reply.action !== "answer")
    throw new SlackInteractionError(400);
  // Message inputs are not supported on these cards. Free answers must carry a
  // thread identity, not an unminted orbyn.submit action.
  if (reply.action === "answer" && "deliveryId" in reply)
    throw new SlackInteractionError(400);
  return intent.parse({
    appId: reply.appId,
    workspaceId: reply.workspaceId,
    userId: reply.userId,
    channelId: reply.channelId,
    messageTs: reply.messageTs,
    requestDigest: reply.requestDigest,
    ...("deliveryId" in reply ? { deliveryId: reply.deliveryId } : {}),
    action: reply.action,
    ...(reply.action === "choice"
      ? { choice: reply.choice }
      : { answer: reply.answer }),
  });
};

/** Check current ownership, consent, source authority and the exact question under write fences. */
async function authority(
  db: Db,
  reply: Intent,
  config: SlackOAuthConfig,
  expectedOutbox?: string,
) {
  const sent = (
    await db.query<Sent>(
      `SELECT o.* FROM agent_channel_outbox o JOIN agent_channel_installations c ON c.id=o.connection_id
     WHERE o.state='sent' AND o.source_kind='job' AND o.event='waiting'
      AND o.channel_id=$1 AND o.message_ts=$2 AND c.app_id=$3 AND c.workspace_id=$4 AND c.external_user_id=$5
      AND ($6::uuid IS NULL OR o.id=$6) AND ($7::uuid IS NULL OR o.id=$7)
      AND o.reply_question_digest IS NOT NULL AND o.reply_expires_at>clock_timestamp()
     ORDER BY o.id LIMIT 1 FOR SHARE OF o NOWAIT`,
      [
        reply.channelId,
        reply.messageTs,
        config.appId,
        reply.workspaceId,
        reply.userId,
        reply.deliveryId ?? null,
        expectedOutbox ?? null,
      ],
    )
  ).rows[0];
  if (!sent || reply.appId !== config.appId)
    throw new SlackInteractionError(403);
  const fence = (
    await db.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended('agenda-sources:' || $1::text,0)) AS locked",
      [sent.user_id],
    )
  ).rows[0].locked;
  if (!fence) {
    const busy = new Error("Channel source is busy.") as Error & {
      code: string;
    };
    busy.code = "55P03";
    throw busy;
  }
  const user = (
    await db.query<UserRow>(
      "SELECT * FROM users WHERE id=$1 AND NOT disabled AND email_verified FOR SHARE NOWAIT",
      [sent.user_id],
    )
  ).rows[0];
  const connection = (
    await db.query<{ scopes: string[] }>(
      `SELECT c.scopes FROM agent_channel_installations c JOIN agent_channel_bot_vaults v ON v.id=c.bot_vault_id
     WHERE c.id=$1 AND c.user_id=$2 AND c.version=$3 AND c.dm_enabled AND c.disconnected_at IS NULL
      AND c.provider='slack' AND c.app_id=$4 AND c.workspace_id=$5 AND c.external_user_id=$6
      AND v.app_id=c.app_id AND v.workspace_id=c.workspace_id AND v.bot_user_id=c.bot_user_id AND v.scopes=c.scopes
      AND v.credentials_encrypted IS NOT NULL AND v.refresh_state IN ('ready','refreshing')
     FOR SHARE OF c,v NOWAIT`,
      [
        sent.connection_id,
        sent.user_id,
        sent.connection_version,
        config.appId,
        reply.workspaceId,
        reply.userId,
      ],
    )
  ).rows[0];
  const grant = (
    await db.query<{ personal: boolean; team_ids: string[] | null }>(
      `SELECT personal,team_ids FROM agent_grants WHERE user_id=$1 AND kind='assistant'
      AND revoked_at IS NULL AND suspended_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE NOWAIT`,
      [sent.user_id],
    )
  ).rows[0];
  if (
    !user ||
    !connection ||
    !grant ||
    !connection.scopes.includes("chat:write") ||
    !connection.scopes.includes("im:write") ||
    (reply.action === "answer" &&
      (!sent.reply_thread_enabled || !connection.scopes.includes("im:history")))
  )
    throw new SlackInteractionError(403);
  const teams = (
    await reachableTeams(db, sent.user_id, grant.team_ids, "assistant")
  ).map((team) => team.id);
  const scope = { user: "$2", teams: "$3", personal: "$4" };
  const job = (
    await db.query<{ run_state: { state?: { waiting?: unknown } } }>(
      `SELECT j.run_state FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id
     WHERE j.id=$1 AND j.user_id=$2 AND j.state='waiting' AND NOT j.cancel_requested
      AND j.runtime_lane='background' AND j.run_origin<>'idea' AND c.origin<>'idea'
      AND ${assistantChatVisible("c", "$2", scope)} AND ${assistantJobSourcesVisible("j", "$2", false, scope)} AND ${channelJobTeamsAllowed}
     FOR UPDATE OF j NOWAIT`,
      [sent.source_id, sent.user_id, teams, grant.personal],
    )
  ).rows[0];
  const question = slackQuestion.safeParse(job?.run_state?.state?.waiting);
  if (
    !question.success ||
    question.data.id !== sent.waiting_id ||
    slackQuestionDigest(sent.id, question.data) !== sent.reply_question_digest
  )
    throw new SlackInteractionError(409);
  const answer =
    reply.action === "choice"
      ? question.data.choices[reply.choice ?? -1]
      : reply.answer;
  if (!answer) throw new SlackInteractionError(400);
  return { sent, user, answer, waiting_id: question.data.id };
}

/** Store one encrypted reply before acknowledging it; duplicate signed requests cannot answer again. */
export async function captureSlackQuestionReply(
  input: SlackReply | SlackThreadReply,
  config: SlackOAuthConfig,
  secret: string,
  deadline = Date.now() + 2200,
) {
  const reply = normalized(input);
  const encrypted = await encryptSecret(JSON.stringify(reply));
  return transaction(async (db) => {
    await db.query("SET LOCAL statement_timeout='1500ms'");
    await db.query("SET LOCAL lock_timeout='100ms'");
    if (Date.now() >= deadline)
      throw new Error("Slack reply capture deadline exceeded.");
    const digest = configDigest(config, secret);
    const prior = (
      await db.query(
        "SELECT id FROM agent_channel_reply_receipts WHERE request_digest=$1 AND config_hash=$2",
        [reply.requestDigest, digest],
      )
    ).rowCount;
    if (prior) return { received: true };
    const { sent } = await authority(db, reply, config);
    if (Date.now() >= deadline)
      throw new Error("Slack reply capture deadline exceeded.");
    const inserted = (
      await db.query(
        `INSERT INTO agent_channel_reply_receipts(user_id,outbox_id,request_digest,config_hash,reply_encrypted,expires_at)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
        [
          sent.user_id,
          sent.id,
          reply.requestDigest,
          digest,
          encrypted,
          sent.reply_expires_at,
        ],
      )
    ).rowCount;
    if (!inserted) {
      const duplicate = (
        await db.query(
          "SELECT id FROM agent_channel_reply_receipts WHERE request_digest=$1 AND config_hash=$2",
          [reply.requestDigest, digest],
        )
      ).rowCount;
      if (!duplicate) throw new SlackInteractionError(409);
    }
    return { received: true };
  });
}

/** Answer and retire the durable receipt in one transaction, with no external side effect to replay. */
export async function consumeSlackQuestionReplyOne(
  config: SlackOAuthConfig,
  secret: string,
  log: FastifyBaseLogger,
) {
  await pool.query(`UPDATE agent_channel_reply_receipts SET state='queued',claim_id=NULL,lease_until=NULL,updated_at=now()
    WHERE state='processing' AND lease_until<clock_timestamp()`);
  await pool.query(`UPDATE agent_channel_reply_receipts SET state='refused',reply_encrypted=NULL,claim_id=NULL,lease_until=NULL,updated_at=now()
    WHERE state IN ('queued','processing') AND (expires_at<=clock_timestamp() OR attempts>=3 AND state='queued')`);
  const receipt = await transaction(
    async (db) =>
      (
        await db.query<{
          id: string;
          claim_id: string;
          outbox_id: string;
          reply_encrypted: string;
          request_digest: string;
          config_hash: string;
        }>(`WITH candidate AS (SELECT id FROM agent_channel_reply_receipts WHERE state='queued' AND available_at<=clock_timestamp()
       AND expires_at>clock_timestamp() AND attempts<3 ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
       UPDATE agent_channel_reply_receipts r SET state='processing',claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1,updated_at=now()
       FROM candidate WHERE r.id=candidate.id RETURNING r.*`)
      ).rows[0],
  );
  if (!receipt) return false;
  let decoded: Intent | undefined;
  try {
    decoded = intent.parse(
      JSON.parse(await decryptSecret(receipt.reply_encrypted)),
    );
  } catch {
    /* Generic terminal refusal only. */
  }
  try {
    await transaction(async (db) => {
      await db.query("SET LOCAL statement_timeout='5s'");
      await db.query("SET LOCAL lock_timeout='100ms'");
      const owned = (
        await db.query(
          `SELECT id FROM agent_channel_reply_receipts WHERE id=$1 AND claim_id=$2 AND state='processing'
        AND expires_at>clock_timestamp() AND lease_until>clock_timestamp() FOR UPDATE NOWAIT`,
          [receipt.id, receipt.claim_id],
        )
      ).rowCount;
      if (!owned) return;
      if (
        !decoded ||
        decoded.requestDigest !== receipt.request_digest ||
        configDigest(config, secret) !== receipt.config_hash
      )
        throw new SlackInteractionError(403);
      const bound = await authority(db, decoded, config, receipt.outbox_id);
      await answerAssistantQuestion(
        bound.sent.source_id,
        bound.user,
        { waiting_id: bound.waiting_id, answer: bound.answer },
        log,
        db,
      );
      await db.query(
        `UPDATE agent_channel_reply_receipts SET state='accepted',reply_encrypted=NULL,claim_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND claim_id=$2`,
        [receipt.id, receipt.claim_id],
      );
    });
  } catch (error) {
    // If COMMIT succeeded but its acknowledgement was lost, the claim predicate
    // no longer matches. An accepted answer is never queued a second time.
    const busy = ["55P03", "40P01"].includes(
      (error as { code?: string })?.code ?? "",
    );
    await pool.query(
      `UPDATE agent_channel_reply_receipts SET state=$3,reply_encrypted=CASE WHEN $3='queued' THEN reply_encrypted ELSE NULL END,
      claim_id=NULL,lease_until=NULL,attempts=CASE WHEN $3='queued' THEN attempts-1 ELSE attempts END,
      available_at=now()+interval '10 seconds',updated_at=now() WHERE id=$1 AND claim_id=$2 AND state='processing'`,
      [receipt.id, receipt.claim_id, busy ? "queued" : "refused"],
    );
  }
  return true;
}
