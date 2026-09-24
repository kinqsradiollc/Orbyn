import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  apiKeyInput,
  fail,
  webhookInput,
  webhookUpdate,
  type ApiKey,
  type NewApiKey,
  type NewWebhook,
  type Webhook,
} from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import {
  apiKeyId,
  authenticate,
  digest,
  isApiKeyRequest,
} from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { assertPublicUrl } from "../../lib/netguard.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import { sendWebhook } from "../../worker/webhooks.js";

/**
 * Personal API keys and outgoing webhooks: how other tools (Zapier, Make,
 * scripts) work with your Orbyn account. Webhooks send only the events
 * someone picked, to the address they gave.
 */
const MAX_KEYS = 20;
const MAX_WEBHOOKS = 10;
const WEBHOOK_COLUMNS =
  "id, url, events, lead_minutes, active, last_status, last_error, last_delivered_at, created_at";

let openApi: string | null | undefined;

/**
 * The hand-maintained OpenAPI description (docs/openapi.yaml), read once.
 * Looked for next to the repository's docs, from the source or the build.
 */
async function openApiSpec() {
  if (openApi !== undefined) return openApi;
  const candidates = [
    new URL("../../../../docs/openapi.yaml", import.meta.url),
    new URL("docs/openapi.yaml", `file://${process.cwd()}/`),
    new URL("../docs/openapi.yaml", `file://${process.cwd()}/`),
  ];
  openApi = null;
  for (const file of candidates) {
    const text = await readFile(file, "utf8").catch(() => null);
    if (text) {
      openApi = text;
      break;
    }
  }
  return openApi;
}

export async function accessRoutes(app: FastifyInstance) {
  // What automation tools need to know about the API, without signing in.
  app.get("/openapi.yaml", async (_r, reply) => {
    const spec = await openApiSpec();
    if (!spec) fail(404, "This server doesn't include the API description.");
    return reply
      .header("Content-Type", "application/yaml; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(spec);
  });

  app.get("/me/api-keys", async (r) => {
    const u = await authenticate(r);
    return (
      await reader(r.headers).query<ApiKey>(
        "SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC",
        [u.id],
      )
    ).rows;
  });

  // The key is shown once; only its hash is kept.
  app.post(
    "/me/api-keys",
    strictRateLimit,
    async (r, reply): Promise<NewApiKey> => {
      const u = await authenticate(r);
      const d = apiKeyInput.parse(r.body);
      const count = (
        await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM api_keys WHERE user_id = $1",
          [u.id],
        )
      ).rows[0].n;
      if (count >= MAX_KEYS)
        fail(409, `You can have up to ${MAX_KEYS} API keys.`);
      const key = `ok_${randomBytes(32).toString("base64url")}`;
      const row = await transaction(async (db) => {
        const created = (
          await db.query<ApiKey>(
            `INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES ($1, $2, $3, $4)
           RETURNING id, name, prefix, created_at, last_used_at`,
            [u.id, d.name, key.slice(0, 10), digest(key)],
          )
        ).rows[0];
        await audit(
          {
            actorId: u.id,
            action: "api_key.created",
            targetType: "api_key",
            targetId: created.id,
            details: {
              user_id: u.id,
              name: created.name,
              prefix: created.prefix,
            },
          },
          db,
        );
        return created;
      });
      reply.code(201);
      return { ...row, key };
    },
  );

  // A key may retire itself, but not the owner's other keys: a leaked key
  // mustn't be able to cut off everything else they've connected.
  app.delete("/me/api-keys/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    if (isApiKeyRequest(r) && (await apiKeyId(r)) !== id)
      fail(
        403,
        "A personal API key can remove only itself. Sign in to Orbyn to remove other keys.",
      );
    await transaction(async (db) => {
      const gone = (
        await db.query<{ id: string; name: string; prefix: string }>(
          "DELETE FROM api_keys WHERE id = $1 AND user_id = $2 RETURNING id, name, prefix",
          [id, u.id],
        )
      ).rows[0];
      if (!gone) fail(404, "API key not found");
      await audit(
        {
          actorId: u.id,
          action: "api_key.deleted",
          targetType: "api_key",
          targetId: gone.id,
          details: {
            user_id: u.id,
            name: gone.name,
            prefix: gone.prefix,
            via: isApiKeyRequest(r) ? "api_key" : "session",
          },
        },
        db,
      );
    });
    return reply.code(204).send();
  });

  app.get("/me/webhooks", async (r) => {
    const u = await authenticate(r);
    return (
      await reader(r.headers).query<Webhook>(
        `SELECT ${WEBHOOK_COLUMNS} FROM webhooks WHERE user_id = $1 ORDER BY created_at DESC`,
        [u.id],
      )
    ).rows;
  });

  // The signing secret is shown once.
  app.post(
    "/me/webhooks",
    strictRateLimit,
    async (r, reply): Promise<NewWebhook> => {
      const u = await authenticate(r);
      const d = webhookInput.parse(r.body);
      await assertPublicUrl(d.url);
      const count = (
        await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM webhooks WHERE user_id = $1",
          [u.id],
        )
      ).rows[0].n;
      if (count >= MAX_WEBHOOKS)
        fail(409, `You can have up to ${MAX_WEBHOOKS} webhooks.`);
      const secret = `whsec_${randomBytes(24).toString("base64url")}`;
      const row = (
        await pool.query<Webhook>(
          `INSERT INTO webhooks (user_id, url, events, secret_encrypted, lead_minutes)
           VALUES ($1, $2, $3, $4, $5) RETURNING ${WEBHOOK_COLUMNS}`,
          [
            u.id,
            d.url,
            [...new Set(d.events)],
            await encryptSecret(secret),
            d.lead_minutes,
          ],
        )
      ).rows[0];
      reply.code(201);
      return { ...row, secret };
    },
  );

  app.put("/me/webhooks/:id", async (r) => {
    const u = await authenticate(r);
    const d = webhookUpdate.parse(r.body);
    if (d.url) await assertPublicUrl(d.url);
    const row = (
      await pool.query<Webhook>(
        `UPDATE webhooks SET url = coalesce($3, url), events = coalesce($4, events),
           active = coalesce($5, active), lead_minutes = coalesce($6, lead_minutes)
         WHERE id = $1 AND user_id = $2 RETURNING ${WEBHOOK_COLUMNS}`,
        [
          idParam(r),
          u.id,
          d.url ?? null,
          d.events ? [...new Set(d.events)] : null,
          d.active ?? null,
          d.lead_minutes ?? null,
        ],
      )
    ).rows[0];
    if (!row) fail(404, "Webhook not found");
    return row;
  });

  app.delete("/me/webhooks/:id", async (r, reply) => {
    const u = await authenticate(r);
    const deleted = await pool.query(
      "DELETE FROM webhooks WHERE id = $1 AND user_id = $2",
      [idParam(r), u.id],
    );
    if (!deleted.rowCount) fail(404, "Webhook not found");
    return reply.code(204).send();
  });

  // Send a "ping" right away and report what the other end answered.
  app.post("/me/webhooks/:id/test", strictRateLimit, async (r) => {
    const u = await authenticate(r);
    const hook = (
      await pool.query<{ id: string; url: string; secret_encrypted: string }>(
        "SELECT id, url, secret_encrypted FROM webhooks WHERE id = $1 AND user_id = $2",
        [idParam(r), u.id],
      )
    ).rows[0];
    if (!hook) fail(404, "Webhook not found");
    const result = await sendWebhook(
      hook.url,
      await decryptSecret(hook.secret_encrypted),
      `test_${randomBytes(6).toString("hex")}`,
      "ping",
      { event: "ping", occurred_at: new Date().toISOString(), data: {} },
    );
    await pool.query(
      "UPDATE webhooks SET last_status = $2, last_error = $3, last_delivered_at = CASE WHEN $4 THEN now() ELSE last_delivered_at END WHERE id = $1",
      [hook.id, result.status, result.error, result.ok],
    );
    return result;
  });
}
