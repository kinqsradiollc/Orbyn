import { z } from "zod";
import { pool, transaction, type Queryable } from "../../db/pool.js";
import { decryptSecret } from "../../lib/secrets.js";
import { reachableTeams } from "../../capabilities/policy.js";
import { readAutomationIdentity } from "../agent-context/identities.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { slackInstallation, type SlackOAuthConfig } from "./slack-oauth.js";
import { sendSlackDm, slackAgentMessage } from "./slack-delivery.js";

/** Persist a Background transition with its existing job transaction; hidden idea chats never leave Orbyn. */
export async function queueAgentJobUpdate(
  db: Queryable,
  jobId: string,
  event: "done" | "failed" | "waiting",
  waitingId = "",
) {
  await db.query(
    `INSERT INTO agent_channel_outbox(user_id,connection_id,connection_version,source_kind,source_id,event_key,event,waiting_id)
    SELECT j.user_id,c.id,c.version,'job',j.id,$3,$2,$4 FROM ai_jobs j
    JOIN agent_channel_installations c ON c.user_id=j.user_id AND c.provider='slack' AND c.dm_enabled AND c.disconnected_at IS NULL
    JOIN ai_chats chat ON chat.id=j.chat_id AND chat.origin<>'idea'
    WHERE j.id=$1 AND j.runtime_lane='background' AND j.run_origin<>'idea' AND j.state=$2
    ON CONFLICT DO NOTHING`,
    [
      jobId,
      event,
      event === "waiting" ? `waiting:${waitingId}` : event,
      waitingId,
    ],
  );
}

/** One morning DM per night and consent revision, never a message for every Overnight job. */
export async function queueAgentNightUpdate(
  db: Queryable,
  nightId: string,
  userId: string,
) {
  await db.query(
    `INSERT INTO agent_channel_outbox(user_id,connection_id,connection_version,source_kind,source_id,event_key,event)
    SELECT n.user_id,c.id,c.version,'night',n.id,'morning','overnight' FROM assistant_nights n
    JOIN agent_channel_installations c ON c.user_id=n.user_id AND c.provider='slack' AND c.dm_enabled AND c.disconnected_at IS NULL
    WHERE n.id=$1 AND n.user_id=$2 AND (n.summary->>'end_at')::timestamptz<=clock_timestamp()
    ON CONFLICT DO NOTHING`,
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
const waitingQuestion = z.object({
  kind: z.literal("person"),
  question: z.string().max(1200),
});
const blockedTeams = `NOT EXISTS(SELECT 1 FROM teams channel_team WHERE NOT channel_team.assistant_allowed AND channel_team.id IN (
 SELECT p.team_id FROM projects p WHERE p.id=c.project_id
 UNION SELECT d.team_id FROM assistant_job_sources s JOIN docs d ON s.source_kind='doc' AND d.id=s.source_id WHERE s.job_id=j.id
 UNION SELECT p.team_id FROM assistant_job_sources s JOIN projects p ON s.source_kind='project' AND p.id=s.source_id WHERE s.job_id=j.id
 UNION SELECT i.team_id FROM assistant_job_sources s JOIN items i ON s.source_kind='task' AND i.id=s.source_id WHERE s.job_id=j.id
 UNION SELECT r.team_id FROM assistant_job_sources s JOIN work_records r ON s.source_kind='record' AND r.id=s.source_id WHERE s.job_id=j.id
 UNION SELECT s.source_id FROM assistant_job_sources s WHERE s.job_id=j.id AND s.source_kind='team'))`;

/** Dispatch one durable intent under current source and consent fences. Uncertain sends are never replayed. */
export async function deliverAgentChannelOne(
  config: SlackOAuthConfig,
  appUrl: string,
  request: typeof fetch = fetch,
): Promise<boolean> {
  // Validate the configured website before claiming; no browser/request origin is trusted.
  slackAgentMessage({ event: "overnight", appUrl });
  // Recover only expired claims, without joining other authority rows or holding inverse locks.
  await pool.query(`UPDATE agent_channel_outbox SET state='unknown',claim_id=NULL,lease_until=NULL,updated_at=now()
    WHERE state='dispatching' AND lease_until<clock_timestamp()`);
  await pool.query(
    `UPDATE agent_channel_outbox SET state='cancelled',updated_at=now() WHERE state='queued' AND expires_at<=clock_timestamp()`,
  );
  const delivery = await transaction(async (db) => {
    const row = (
      await db.query<Delivery>(`WITH candidate AS (
      SELECT id FROM agent_channel_outbox WHERE state='queued' AND available_at<=clock_timestamp() AND expires_at>clock_timestamp() AND attempts<3
      ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE agent_channel_outbox o SET state='dispatching',claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1,updated_at=now()
      FROM candidate WHERE o.id=candidate.id RETURNING o.*`)
    ).rows[0];
    return row;
  });
  if (!delivery) return false;
  let dispatched = false;
  let encrypted: string | undefined;
  let installation: z.output<typeof slackInstallation> | undefined;
  try {
    encrypted = (
      await pool.query<{ credentials_encrypted: string }>(
        "SELECT credentials_encrypted FROM agent_channel_installations WHERE id=$1 AND user_id=$2",
        [delivery.connection_id, delivery.user_id],
      )
    ).rows[0]?.credentials_encrypted;
    if (encrypted)
      installation = slackInstallation.parse(
        JSON.parse(await decryptSecret(encrypted)),
      );
  } catch {
    /* No raw credential parse or provider error escapes this boundary. */
  }
  try {
    await transaction(async (db) => {
      const owned = (
        await db.query(
          `SELECT id FROM agent_channel_outbox WHERE id=$1 AND claim_id=$2 AND state='dispatching'
        AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() FOR UPDATE NOWAIT`,
          [delivery.id, delivery.claim_id],
        )
      ).rowCount;
      if (!owned) return;
      const finish = async (
        state: "sent" | "failed" | "unknown" | "cancelled",
        channelId: string | null = null,
        messageTs: string | null = null,
      ) => {
        await db.query(
          `UPDATE agent_channel_outbox SET state=$3,claim_id=NULL,lease_until=NULL,channel_id=$4,message_ts=$5,updated_at=now()
          WHERE id=$1 AND claim_id=$2`,
          [delivery.id, delivery.claim_id, state, channelId, messageTs],
        );
      };
      const fence = (
        await db.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_xact_lock(hashtextextended('agenda-sources:' || $1::text,0)) AS locked",
          [delivery.user_id],
        )
      ).rows[0].locked;
      if (!fence) {
        await db.query(
          "UPDATE agent_channel_outbox SET state='queued',attempts=attempts-1,claim_id=NULL,lease_until=NULL,available_at=now()+interval '10 seconds',updated_at=now() WHERE id=$1 AND claim_id=$2",
          [delivery.id, delivery.claim_id],
        );
        return;
      }
      const user = (
        await db.query(
          "SELECT id FROM users WHERE id=$1 AND NOT disabled AND email_verified FOR SHARE NOWAIT",
          [delivery.user_id],
        )
      ).rowCount;
      const channel = (
        await db.query<{
          external_user_id: string;
          workspace_id: string;
          bot_user_id: string;
          scopes: string[];
        }>(
          `SELECT external_user_id,workspace_id,bot_user_id,scopes FROM agent_channel_installations
        WHERE id=$1 AND user_id=$2 AND provider='slack' AND version=$3 AND dm_enabled AND disconnected_at IS NULL
        AND credentials_encrypted=$4 AND app_id=$5 AND (token_expires_at IS NULL OR token_expires_at>clock_timestamp()+interval '30 seconds') FOR SHARE NOWAIT`,
          [
            delivery.connection_id,
            delivery.user_id,
            delivery.connection_version,
            encrypted ?? null,
            config.appId,
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
        !user ||
        !channel ||
        !grant ||
        !installation ||
        installation.appId !== config.appId ||
        installation.userId !== channel.external_user_id ||
        installation.workspaceId !== channel.workspace_id ||
        installation.botUserId !== channel.bot_user_id ||
        JSON.stringify(installation.scopes) !==
          JSON.stringify(channel.scopes) ||
        !installation.scopes.includes("chat:write") ||
        !installation.scopes.includes("im:write") ||
        (installation.expiresAt !== null &&
          Date.parse(installation.expiresAt) <= Date.now() + 30000)
      ) {
        await finish("cancelled");
        return;
      }
      let message;
      const identity = await readAutomationIdentity(
        db,
        delivery.user_id,
        delivery.source_kind === "night" ? "overnight" : "background",
      );
      if (delivery.source_kind === "night") {
        const night = (
          await db.query(
            "SELECT id FROM assistant_nights WHERE id=$1 AND user_id=$2 AND (summary->>'end_at')::timestamptz<=clock_timestamp()",
            [delivery.source_id, delivery.user_id],
          )
        ).rowCount;
        if (!night) {
          await finish("cancelled");
          return;
        }
        message = slackAgentMessage({
          event: "overnight",
          appUrl,
          agentName: identity.revision > 0 ? identity.name : undefined,
        });
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
          await db.query<{
            title: string;
            run_state: { state?: { waiting?: unknown } };
          }>(
            `SELECT c.title,j.run_state FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id
          WHERE j.id=$1 AND j.user_id=$2 AND j.state=$3 AND j.runtime_lane='background' AND j.run_origin<>'idea' AND c.origin<>'idea'
          AND ($3<>'waiting' OR j.run_state->'state'->'waiting'->>'id'=$4)
          AND ${assistantChatVisible("c", "$2", scope)} AND ${assistantJobSourcesVisible("j", "$2", false, scope)} AND ${blockedTeams}`,
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
        const question = waitingQuestion.safeParse(
          job.run_state?.state?.waiting,
        );
        message = slackAgentMessage({
          event: delivery.event as "done" | "failed" | "waiting",
          title: job.title,
          question: question.success ? question.data.question : undefined,
          appUrl,
          agentName: identity.revision > 0 ? identity.name : undefined,
        });
      }
      dispatched = true;
      const result = await sendSlackDm(
        installation.accessToken,
        channel.external_user_id,
        message,
        request,
      );
      if (result.state === "limited" && delivery.attempts < 3) {
        await db.query(
          `UPDATE agent_channel_outbox SET state='queued',claim_id=NULL,lease_until=NULL,available_at=now()+make_interval(secs=>$3),updated_at=now()
          WHERE id=$1 AND claim_id=$2`,
          [delivery.id, delivery.claim_id, result.retryAfter],
        );
        return;
      }
      if (result.state === "sent")
        await finish("sent", result.channelId, result.messageTs);
      else await finish(result.state === "limited" ? "failed" : result.state);
    });
  } catch (error) {
    // A transaction/commit failure may happen after remote acceptance. Preserve uncertainty.
    const busy =
      !dispatched &&
      ["55P03", "40P01"].includes((error as { code?: string })?.code ?? "");
    await pool.query(
      `UPDATE agent_channel_outbox SET state=$3,claim_id=NULL,lease_until=NULL,attempts=CASE WHEN $3='queued' THEN attempts-1 ELSE attempts END,
      available_at=CASE WHEN $3='queued' THEN now()+interval '10 seconds' ELSE available_at END,updated_at=now() WHERE id=$1 AND claim_id=$2 AND state='dispatching'`,
      [delivery.id, delivery.claim_id, busy ? "queued" : "unknown"],
    );
  }
  return true;
}
