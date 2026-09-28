import type { Queryable } from "../../../db/pool.js";

/** Queue a personal chat notice only when the person has stopped polling. */
export async function notifyAssistantAway(
  db: Queryable,
  jobId: string,
  event: "done" | "failed" | "waiting",
  waitingId = "",
): Promise<void> {
  await db.query(
    `INSERT INTO notifications
      (user_id, item_id, item_version, channel, destination, title, body, state, kind, ref)
     SELECT j.user_id, NULL, 0, delivery.channel, delivery.destination,
       left(coalesce(nullif(a.name, ''), 'Orbyn') || $2, 200),
       left(c.title, 2000),
       CASE WHEN delivery.channel = 'inapp' THEN 'sent' ELSE 'pending' END,
       'assistant', 'chat:' || c.id || ':' || j.id || ':' || $3
     FROM ai_jobs j
     JOIN ai_chats c ON c.id = j.chat_id AND c.user_id = j.user_id
     JOIN users u ON u.id = j.user_id AND NOT u.disabled
     LEFT JOIN agent_settings a ON a.user_id = j.user_id
     CROSS JOIN LATERAL (
       SELECT 'inapp' AS channel, u.id::text AS destination
       UNION ALL SELECT 'push', d.token FROM devices d WHERE d.user_id = u.id
     ) delivery
     WHERE j.id = $1
       AND coalesce(j.last_polled_at, j.created_at) < now() - interval '30 seconds'
     ON CONFLICT DO NOTHING`,
    [
      jobId,
      event === "done"
        ? " finished your request"
        : event === "failed"
          ? " could not finish your request"
          : " needs your answer",
      event === "waiting" ? `waiting:${waitingId}` : event,
    ],
  );
}
