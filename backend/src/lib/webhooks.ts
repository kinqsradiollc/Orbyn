import type { WebhookEvent } from "@orbyn/core";
import type { Db } from "../db/pool.js";

/**
 * Queue an event for everyone's webhooks that should hear about it: the
 * owner of a personal item, or every member of the item's team. Runs inside
 * the caller's transaction, so a rolled-back change sends nothing. The
 * notifier delivers the rows.
 */
export async function queueWebhooks(
  db: Db,
  event: WebhookEvent,
  audience: { user_id: string; team_id: string | null },
  data: Record<string, unknown>,
) {
  await db.query(
    `INSERT INTO webhook_deliveries (webhook_id, event, payload)
     SELECT w.id, $1, $4::jsonb FROM webhooks w
     WHERE w.active AND $1 = ANY (w.events)
       AND ((($3::uuid) IS NULL AND w.user_id = $2)
         OR w.user_id IN (SELECT user_id FROM team_members WHERE team_id = $3))`,
    [
      event,
      audience.user_id,
      audience.team_id,
      JSON.stringify({ event, occurred_at: new Date().toISOString(), data }),
    ],
  );
}
