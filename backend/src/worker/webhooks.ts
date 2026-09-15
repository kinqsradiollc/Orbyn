import { createHmac } from "node:crypto";
import { transaction } from "../db/pool.js";
import { assertPublicUrl } from "../lib/netguard.js";
import { decryptSecret } from "../lib/secrets.js";

const MAX_ATTEMPTS = 8;
const TIMEOUT_MS = 10_000;

export type WebhookResult = {
  ok: boolean;
  status: number | null;
  error: string | null;
};

/**
 * POST one event. The body is signed so receivers can check it came from
 * Orbyn: `X-Orbyn-Signature: sha256=HMAC(secret, "<timestamp>.<body>")`.
 */
export async function sendWebhook(
  url: string,
  secret: string,
  deliveryId: string,
  event: string,
  payload: unknown,
): Promise<WebhookResult> {
  try {
    await assertPublicUrl(url);
  } catch (error) {
    return { ok: false, status: null, error: (error as Error).message };
  }
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Orbyn-Webhooks/1",
        "X-Orbyn-Event": event,
        "X-Orbyn-Delivery": deliveryId,
        "X-Orbyn-Timestamp": timestamp,
        "X-Orbyn-Signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => {});
    return response.ok
      ? { ok: true, status: response.status, error: null }
      : {
          ok: false,
          status: response.status,
          error: `The endpoint answered ${response.status}.`,
        };
  } catch (error) {
    const name = (error as Error).name;
    return {
      ok: false,
      status: null,
      error:
        name === "TimeoutError"
          ? "The endpoint didn't answer within 10 seconds."
          : "Couldn't reach the endpoint.",
    };
  }
}

/**
 * Claim and deliver one queued webhook event. Returns false when the queue is
 * empty. SKIP LOCKED lets several notifier lanes and replicas share the work;
 * failures back off exponentially up to an hour, then give up.
 */
export async function deliverWebhookOne(): Promise<boolean> {
  return transaction(async (db) => {
    const job = (
      await db.query<{
        id: string;
        event: string;
        payload: unknown;
        attempts: number;
        webhook_id: string;
        url: string;
        secret_encrypted: string;
        active: boolean;
      }>(
        `SELECT d.id, d.event, d.payload, d.attempts, d.webhook_id, w.url, w.secret_encrypted, w.active
         FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
         WHERE d.state = 'pending' AND d.available_at <= now()
         ORDER BY d.available_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`,
      )
    ).rows[0];
    if (!job) return false;
    if (!job.active) {
      await db.query(
        "UPDATE webhook_deliveries SET state = 'failed' WHERE id = $1",
        [job.id],
      );
      return true;
    }
    const result = await sendWebhook(
      job.url,
      await decryptSecret(job.secret_encrypted),
      job.id,
      job.event,
      job.payload,
    );
    if (result.ok)
      await db.query(
        "UPDATE webhook_deliveries SET state = 'sent', response_status = $2 WHERE id = $1",
        [job.id, result.status],
      );
    else
      await db.query(
        `UPDATE webhook_deliveries SET attempts = attempts + 1, response_status = $2,
           state = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'pending' END,
           available_at = now() + make_interval(secs => LEAST(3600, 30 * power(2, attempts)::int))
         WHERE id = $1`,
        [job.id, result.status, MAX_ATTEMPTS],
      );
    await db.query(
      `UPDATE webhooks SET last_status = $2, last_error = $3,
         last_delivered_at = CASE WHEN $4 THEN now() ELSE last_delivered_at END
       WHERE id = $1`,
      [job.webhook_id, result.status, result.error, result.ok],
    );
    return true;
  });
}
