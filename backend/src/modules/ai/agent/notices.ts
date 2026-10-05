import { assistantJobSourcesVisible } from "../../../lib/assistant-job-sources.js";
import { queueAgentJobUpdate } from "../../agent-channels/outbox.js";
import { assistantChatVisible } from "../../../lib/assistant-visibility.js";
import { announceTo } from "../../presence/live.js";
import { transaction, type Queryable } from "../../../db/pool.js";

/** Persist notice intent with the job transition; reconsider it after the away grace period. */
export async function notifyAssistantAway(
  db: Queryable,
  jobId: string,
  event: "done" | "failed" | "waiting",
  waitingId = "",
): Promise<void> {
  await queueAgentJobUpdate(db, jobId, event, waitingId);
  const key = event === "waiting" ? `waiting:${waitingId}` : event;
  await db.query(
    `INSERT INTO assistant_notice_events(job_id,event_key,event,waiting_id)
     SELECT id,$2,$3,$4 FROM ai_jobs WHERE id=$1 AND run_origin='person'
     ON CONFLICT DO NOTHING`,
    [jobId, key, event, waitingId],
  );
  await emitPendingAssistantNotices(db, jobId);
}

async function emitPendingAssistantNotices(db: Queryable, jobId?: string) {
  // Seen events and superseded questions must never be reconsidered later.
  await db.query(
    `UPDATE assistant_notice_events e SET resolved_at=now() FROM ai_jobs j
     WHERE j.id=e.job_id AND e.resolved_at IS NULL AND ($1::uuid IS NULL OR j.id=$1)
       AND (j.run_origin <> 'person' OR j.last_polled_at >= e.created_at
         OR j.state <> e.event OR (e.event='waiting' AND
           j.run_state->'state'->'waiting'->>'id' IS DISTINCT FROM e.waiting_id))`,
    [jobId ?? null],
  );
  const events = (
    await db.query<{ job_id: string; event_key: string; event: string }>(
      `SELECT e.job_id,e.event_key,e.event FROM assistant_notice_events e JOIN ai_jobs j ON j.id=e.job_id
     WHERE e.resolved_at IS NULL AND j.run_origin='person'
       AND ($1::uuid IS NULL OR j.id=$1)
       AND coalesce(j.last_polled_at,j.created_at) < now() - interval '30 seconds'
     ORDER BY e.created_at LIMIT 100 FOR UPDATE OF e SKIP LOCKED`,
      [jobId ?? null],
    )
  ).rows;
  for (const event of events) {
    const inserted = await db.query<{ user_id: string }>(
      `INSERT INTO notifications
        (user_id,item_id,item_version,channel,destination,title,body,state,kind,ref)
       SELECT j.user_id,NULL,0,d.channel,d.destination,
         left(coalesce(nullif(a.name,''),'Orbyn') || $2,200),left(c.title,2000),
         CASE WHEN d.channel='inapp' THEN 'sent' ELSE 'pending' END,
         'assistant','chat:' || c.id || ':' || j.id || ':' || $3
       FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id
       JOIN users u ON u.id=j.user_id AND NOT u.disabled
       LEFT JOIN agent_settings a ON a.user_id=u.id
       CROSS JOIN LATERAL (
         SELECT 'inapp' AS channel,u.id::text AS destination
         UNION ALL SELECT 'push',token FROM devices WHERE user_id=u.id
       ) d
       WHERE j.id=$1 AND ${assistantChatVisible("c", "j.user_id")}
         AND ${assistantJobSourcesVisible("j", "j.user_id")}
       ON CONFLICT DO NOTHING RETURNING user_id`,
      [
        event.job_id,
        event.event === "done"
          ? " finished your request"
          : event.event === "failed"
            ? " could not finish your request"
            : " needs your answer",
        event.event_key,
      ],
    );
    await db.query(
      "UPDATE assistant_notice_events SET resolved_at=now() WHERE job_id=$1 AND event_key=$2",
      [event.job_id, event.event_key],
    );
    for (const userId of new Set(inserted.rows.map((row) => row.user_id)))
      await announceTo(db as never, { user_id: userId }, "changed", {
        area: "assistant",
      });
  }
}

/** Drain durable notice intents; rollback preserves every undelivered intent. */
export async function flushAssistantAwayNotices() {
  await transaction((db) => emitPendingAssistantNotices(db));
}
