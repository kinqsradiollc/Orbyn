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
  teamsOAuthConfigDigest,
  type TeamsOAuthConfig,
} from "./teams-oauth.js";
import {
  teamsBotConfigDigest,
  validateTeamsBotConfig,
  type TeamsBotConfig,
} from "./teams-transport.js";
import { teamsConversationRouteDigest } from "./teams-conversations.js";
import {
  TeamsQuestionReplyError,
  type TeamsQuestionReply,
} from "./teams-question-reply.js";
import { teamsQuestion, teamsQuestionDigest } from "./teams-question-card.js";

const intent = z
  .object({
    appId: z.uuid(),
    tenantId: z.uuid(),
    objectId: z.uuid(),
    externalUserId: z
      .string()
      .regex(/^29:.+/)
      .max(500),
    conversationId: z.string().min(1).max(1000),
    serviceUrl: z.url().max(2048),
    eventId: z.string().min(1).max(500),
    deliveryId: z.uuid(),
    waitingId: z.uuid(),
    questionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    cardNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    choice: z.number().int().min(0).max(4).optional(),
    answer: z.string().trim().min(1).max(4000).optional(),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine((v) => (v.choice !== undefined) !== (v.answer !== undefined));
type Intent = z.output<typeof intent>;
type Sent = {
  id: string;
  user_id: string;
  source_id: string;
  connection_id: string;
  connection_version: number;
  reply_question_digest: string;
  reply_nonce_hash: string;
  waiting_id: string;
  reply_expires_at: Date;
};
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const configDigest = (config: TeamsOAuthConfig, bot: TeamsBotConfig) =>
  digest(teamsOAuthConfigDigest(config) + "\0" + teamsBotConfigDigest(bot));
const normalized = (input: TeamsQuestionReply): Intent => intent.parse(input);

/** Check current ownership, consent, source authority and the exact question under write fences. */
async function authority(
  db: Db,
  reply: Intent,
  config: TeamsOAuthConfig,
  expectedOutbox?: string,
) {
  const sent = (
    await db.query<Sent>(
      `SELECT o.* FROM agent_channel_teams_outbox o
     WHERE o.id=$1 AND o.state='sent' AND o.source_kind='job' AND o.event='waiting'
     AND o.activity_id IS NOT NULL AND o.reply_question_digest=$2 AND o.waiting_id=$3
     AND o.reply_nonce_hash=$4 AND o.reply_expires_at>clock_timestamp()
     AND ($5::uuid IS NULL OR o.id=$5) FOR SHARE OF o NOWAIT`,
      [
        reply.deliveryId,
        reply.questionDigest,
        reply.waitingId,
        digest(reply.cardNonce),
        expectedOutbox ?? null,
      ],
    )
  ).rows[0];
  if (!sent || reply.appId !== config.botAppId)
    throw new TeamsQuestionReplyError(403);
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
  const referenceHash = digest(
    JSON.stringify({
      serviceUrl: reply.serviceUrl,
      tenantId: reply.tenantId,
      conversationId: reply.conversationId,
      userId: reply.externalUserId,
      objectId: reply.objectId,
      botId: `28:${reply.appId}`,
    }),
  );
  const connection = (
    await db.query(
      `SELECT id FROM agent_channel_teams_installations
     WHERE id=$1 AND user_id=$2 AND version=$3 AND dm_enabled AND disconnected_at IS NULL
     AND bot_app_id=$4 AND tenant_id=$5 AND object_id=$6 AND config_hash=$7
     AND conversation_encrypted IS NOT NULL AND conversation_hash=$8 AND conversation_route_hash=$9
     AND conversation_bound_at IS NOT NULL FOR SHARE NOWAIT`,
      [
        sent.connection_id,
        sent.user_id,
        sent.connection_version,
        reply.appId,
        reply.tenantId,
        reply.objectId,
        teamsOAuthConfigDigest(config),
        referenceHash,
        teamsConversationRouteDigest(
          reply.appId,
          reply.tenantId,
          reply.conversationId,
        ),
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
  if (!user || !connection || !grant) throw new TeamsQuestionReplyError(403);
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
  const question = teamsQuestion.safeParse(job?.run_state?.state?.waiting);
  if (
    !question.success ||
    question.data.id !== sent.waiting_id ||
    teamsQuestionDigest(sent.id, question.data) !== sent.reply_question_digest
  )
    throw new TeamsQuestionReplyError(400);
  const answer =
    reply.choice !== undefined
      ? question.data.choices[reply.choice ?? -1]
      : reply.answer;
  if (!answer) throw new TeamsQuestionReplyError(400);
  return { sent, user, answer, waiting_id: question.data.id };
}

/** Store one encrypted reply before acknowledging it; duplicate signed requests cannot answer again. */
export async function captureTeamsQuestionReply(
  input: TeamsQuestionReply,
  config: TeamsOAuthConfig,
  bot: TeamsBotConfig,
  deadline = Date.now() + 2200,
) {
  validateTeamsBotConfig(bot);
  if (bot.appId !== config.botAppId) throw new TeamsQuestionReplyError(403);
  const reply = normalized(input);
  const encrypted = await encryptSecret(JSON.stringify(reply));
  return transaction(async (db) => {
    await db.query("SET LOCAL statement_timeout='1500ms'");
    await db.query("SET LOCAL lock_timeout='100ms'");
    if (Date.now() >= deadline)
      throw new Error("Teams reply capture deadline exceeded.");
    const digest = configDigest(config, bot);
    const prior = (
      await db.query(
        "SELECT id FROM agent_channel_teams_reply_receipts WHERE request_digest=$1 AND config_hash=$2",
        [reply.requestDigest, digest],
      )
    ).rowCount;
    if (prior) return { received: true };
    const { sent } = await authority(db, reply, config);
    if (Date.now() >= deadline)
      throw new Error("Teams reply capture deadline exceeded.");
    const inserted = (
      await db.query(
        `INSERT INTO agent_channel_teams_reply_receipts(user_id,outbox_id,request_digest,config_hash,reply_encrypted,expires_at)
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
          "SELECT id FROM agent_channel_teams_reply_receipts WHERE request_digest=$1 AND config_hash=$2",
          [reply.requestDigest, digest],
        )
      ).rowCount;
      if (!duplicate) throw new TeamsQuestionReplyError(400);
    }
    return { received: true };
  });
}

/** Answer and retire the durable receipt in one transaction, with no external side effect to replay. */
export async function consumeTeamsQuestionReplyOne(
  config: TeamsOAuthConfig,
  bot: TeamsBotConfig,
  log: FastifyBaseLogger,
) {
  validateTeamsBotConfig(bot);
  if (bot.appId !== config.botAppId) throw new TeamsQuestionReplyError(403);
  await pool.query(`UPDATE agent_channel_teams_reply_receipts SET state='queued',claim_id=NULL,lease_until=NULL,updated_at=now()
    WHERE state='processing' AND lease_until<clock_timestamp()`);
  await pool.query(`UPDATE agent_channel_teams_reply_receipts SET state='refused',reply_encrypted=NULL,claim_id=NULL,lease_until=NULL,updated_at=now()
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
        }>(`WITH candidate AS (SELECT id FROM agent_channel_teams_reply_receipts WHERE state='queued' AND available_at<=clock_timestamp()
       AND expires_at>clock_timestamp() AND attempts<3 ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
       UPDATE agent_channel_teams_reply_receipts r SET state='processing',claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1,updated_at=now()
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
          `SELECT id FROM agent_channel_teams_reply_receipts WHERE id=$1 AND claim_id=$2 AND state='processing'
        AND expires_at>clock_timestamp() AND lease_until>clock_timestamp() FOR UPDATE NOWAIT`,
          [receipt.id, receipt.claim_id],
        )
      ).rowCount;
      if (!owned) return;
      if (
        !decoded ||
        decoded.requestDigest !== receipt.request_digest ||
        configDigest(config, bot) !== receipt.config_hash
      )
        throw new TeamsQuestionReplyError(403);
      const bound = await authority(db, decoded, config, receipt.outbox_id);
      await answerAssistantQuestion(
        bound.sent.source_id,
        bound.user,
        { waiting_id: bound.waiting_id, answer: bound.answer },
        log,
        db,
      );
      await db.query(
        `UPDATE agent_channel_teams_reply_receipts SET state='accepted',reply_encrypted=NULL,claim_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND claim_id=$2`,
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
      `UPDATE agent_channel_teams_reply_receipts SET state=$3,reply_encrypted=CASE WHEN $3='queued' THEN reply_encrypted ELSE NULL END,
      claim_id=NULL,lease_until=NULL,attempts=CASE WHEN $3='queued' THEN attempts-1 ELSE attempts END,
      available_at=now()+interval '10 seconds',updated_at=now() WHERE id=$1 AND claim_id=$2 AND state='processing'`,
      [receipt.id, receipt.claim_id, busy ? "queued" : "refused"],
    );
  }
  return true;
}
