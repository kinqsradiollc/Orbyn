import { randomBytes } from "node:crypto";
import {
  AGENT_INBOX_KINDS,
  AGENT_INBOX_URI,
  fail,
  type AgentInboxKind,
} from "@orbyn/core";
import { pool, transaction, type Queryable } from "../../db/pool.js";
import { decryptSecret } from "../../lib/secrets.js";
import { sendWebhook, type WebhookResult } from "../../worker/webhooks.js";
import { OPEN_ITEM } from "./service.js";

/**
 * Waking a connection's agent (H0): for agent apps that run on a schedule
 * rather than listening. When something lands in its inbox and the person
 * set a wake-up address, the worker POSTs a signed call there, at most one
 * per 5 minutes per connection (everything since is in the one call). The
 * call carries only the connection's id, how many items wait, where the
 * inbox is and which kinds wait: never what they say. Signed like Orbyn's
 * webhooks (X-Orbyn-Signature: sha256=HMAC(secret, "<timestamp>.<body>")),
 * with its own secret shown once in Connected agents; failures back off
 * (5 minutes, doubling, up to an hour), then give up until the next item.
 */

/** What a wake-up says: nothing more. */
export type WakePayload = {
  grant: string;
  count: number;
  inbox_url: string;
  kinds: AgentInboxKind[];
};

const MAX_ATTEMPTS = 8;

/** How many items wait for a connection, and of which kinds. */
export async function wakePayload(
  db: Queryable,
  grantId: string,
): Promise<WakePayload> {
  const rows = (
    await db.query<{ kind: AgentInboxKind; n: number }>(
      `SELECT i.kind, count(*)::int AS n FROM agent_inbox i
        WHERE i.grant_id = $1 AND ${OPEN_ITEM("i")}
        GROUP BY i.kind`,
      [grantId],
    )
  ).rows;
  const kinds = new Set(rows.map((r) => r.kind));
  return {
    grant: grantId,
    count: rows.reduce((sum, r) => sum + r.n, 0),
    inbox_url: AGENT_INBOX_URI,
    kinds: AGENT_INBOX_KINDS.filter((k) => kinds.has(k)),
  };
}

type WakeJob = {
  grant_id: string;
  attempts: number;
  wake_url: string | null;
  wake_secret_encrypted: string | null;
  live: boolean;
};

/**
 * Sends the wake-ups that are due (the worker, each cycle). SKIP LOCKED
 * lets several workers share them. Returns how many were tried.
 */
export async function deliverWakes(limit = 20): Promise<number> {
  return transaction(async (db) => {
    const jobs = (
      await db.query<WakeJob>(
        `SELECT w.grant_id, w.attempts, g.wake_url, g.wake_secret_encrypted,
                (g.revoked_at IS NULL AND g.suspended_at IS NULL
                  AND (g.expires_at IS NULL OR g.expires_at > now())) AS live
           FROM agent_wakes w JOIN agent_grants g ON g.id = w.grant_id
          WHERE w.due_at IS NOT NULL AND w.due_at <= now()
          ORDER BY w.due_at LIMIT $1
          FOR UPDATE OF w SKIP LOCKED`,
        [limit],
      )
    ).rows;
    for (const job of jobs) {
      const payload = await wakePayload(db, job.grant_id);
      if (
        !job.live ||
        !job.wake_url ||
        !job.wake_secret_encrypted ||
        payload.count === 0
      ) {
        await db.query(
          "UPDATE agent_wakes SET due_at = NULL, attempts = 0 WHERE grant_id = $1",
          [job.grant_id],
        );
        continue;
      }
      const result = await sendWebhook(
        job.wake_url,
        await decryptSecret(job.wake_secret_encrypted),
        `wake_${randomBytes(8).toString("hex")}`,
        "agent.wake",
        payload,
      );
      if (result.ok)
        await db.query(
          `UPDATE agent_wakes SET due_at = NULL, sent_at = now(), attempts = 0,
             last_status = $2, last_error = NULL
           WHERE grant_id = $1`,
          [job.grant_id, result.status],
        );
      else
        await db.query(
          `UPDATE agent_wakes SET attempts = attempts + 1, last_status = $2,
             last_error = $3,
             due_at = CASE WHEN attempts + 1 >= $4 THEN NULL
               ELSE now() + make_interval(secs => LEAST(3600, 300 * power(2, attempts)::int)) END
           WHERE grant_id = $1`,
          [job.grant_id, result.status, result.error, MAX_ATTEMPTS],
        );
    }
    return jobs.length;
  });
}

/**
 * "Test" beside the wake-up address: one call now with what waits, and
 * what the other end answered. It doesn't count against the 5 minutes.
 */
export async function testWake(
  userId: string,
  grantId: string,
): Promise<WebhookResult> {
  const g = (
    await pool.query<{ wake_url: string | null; secret: string | null }>(
      `SELECT wake_url, wake_secret_encrypted AS secret FROM agent_grants
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [grantId, userId],
    )
  ).rows[0];
  if (!g) fail(404, "Connection not found");
  if (!g.wake_url || !g.secret)
    fail(409, "Set a wake-up address for this agent first.");
  const result = await sendWebhook(
    g.wake_url,
    await decryptSecret(g.secret),
    `test_${randomBytes(6).toString("hex")}`,
    "agent.wake",
    await wakePayload(pool, grantId),
  );
  await pool.query(
    `INSERT INTO agent_wakes (grant_id, last_status, last_error) VALUES ($1, $2, $3)
     ON CONFLICT (grant_id) DO UPDATE SET last_status = $2, last_error = $3`,
    [grantId, result.status, result.error],
  );
  return result;
}
