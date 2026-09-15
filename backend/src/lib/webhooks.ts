import type { WebhookEvent } from "@orbyn/core";
import type { Queryable } from "../db/pool.js";

/**
 * Queue an event for everyone's webhooks that should hear about it: the
 * owner of a personal item, or every member of the item's team. Runs inside
 * the caller's transaction, so a rolled-back change sends nothing. The
 * notifier delivers the rows. With a `dedupeKey`, each webhook gets the
 * event at most once for that key (scheduled events such as
 * `event.starting`).
 */
export async function queueWebhooks(
  db: Queryable,
  event: WebhookEvent,
  audience: { user_id: string; team_id: string | null },
  data: Record<string, unknown>,
  dedupeKey: string | null = null,
) {
  await db.query(
    `INSERT INTO webhook_deliveries (webhook_id, event, payload, dedupe_key)
     SELECT w.id, $1, $4::jsonb, $5 FROM webhooks w
     WHERE w.active AND $1 = ANY (w.events)
       AND ((($3::uuid) IS NULL AND w.user_id = $2)
         OR w.user_id IN (SELECT user_id FROM team_members WHERE team_id = $3))
     ON CONFLICT DO NOTHING`,
    [
      event,
      audience.user_id,
      audience.team_id,
      JSON.stringify({ event, occurred_at: new Date().toISOString(), data }),
      dedupeKey,
    ],
  );
}

/** Queue an event for one webhook, at most once for `dedupeKey`. */
export async function queueWebhookFor(
  db: Queryable,
  webhookId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
  dedupeKey: string,
) {
  await db.query(
    `INSERT INTO webhook_deliveries (webhook_id, event, payload, dedupe_key)
     VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT DO NOTHING`,
    [
      webhookId,
      event,
      JSON.stringify({ event, occurred_at: new Date().toISOString(), data }),
      dedupeKey,
    ],
  );
}
