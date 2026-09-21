import type { FastifyInstance } from "fastify";
import {
  AI_PROVIDERS,
  aiProviderInput,
  aiProviderUpdate,
  aiSettingsInput,
  aiTestInput,
  fail,
  type AiProvider,
  type AiProviderKind,
  type AiSettings,
} from "@orbyn/core";
import { query, transaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { hasVectors } from "../search/semantic.js";
import { authorize } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { encryptSecret, maskSecret } from "../../lib/secrets.js";
import { complete, listModels, ProviderError } from "./providers/adapters.js";
import { assertProviderUrl } from "./providers/network.js";
import { connection, type ProviderRow } from "./providers/resolve.js";

const iso = (value: Date | string) => new Date(value).toISOString();

/** What admins see. The encrypted key never leaves the server. */
const toPublic = (row: ProviderRow): AiProvider => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  base_url: row.base_url,
  has_key: !!row.api_key_encrypted,
  key_hint: row.key_hint,
  options: row.options ?? {},
  enabled: row.enabled,
  created_at: iso(row.created_at),
  updated_at: iso(row.updated_at),
});

async function currentSettings(): Promise<AiSettings> {
  const row = (
    await query<{
      provider_id: string | null;
      model: string;
      updated_at: Date | null;
      enabled: boolean | null;
      semantic_search: boolean;
    }>(
      `SELECT s.provider_id, s.model, s.updated_at, s.semantic_search, p.enabled
       FROM ai_settings s LEFT JOIN ai_providers p ON p.id = s.provider_id WHERE s.id`,
    )
  ).rows[0];
  const fromDatabase = !!(row?.provider_id && row.enabled && row.model);
  return {
    provider_id: row?.provider_id ?? null,
    model: row?.model ?? "",
    source: fromDatabase ? "database" : "none",
    semantic_search: !!row?.semantic_search,
    /** Whether this database could do it at all, so the console can say so. */
    semantic_possible: await hasVectors(),
    updated_at: row?.updated_at ? iso(row.updated_at) : null,
  };
}

async function providerRow(id: string): Promise<ProviderRow> {
  const row = (
    await query<ProviderRow>("SELECT * FROM ai_providers WHERE id=$1", [id])
  ).rows[0];
  if (!row) fail(404, "Provider not found");
  return row;
}

/**
 * BrainRouter's key rules: a cloud provider needs a key unless it has a
 * default one (opencode), and a pasted key for a non-local provider must be
 * at least 16 characters.
 */
function checkKey(
  kind: AiProviderKind,
  key: string | undefined,
  change: "create" | "update",
) {
  const def = AI_PROVIDERS[kind];
  if (key && !def.local && key.length < 16)
    fail(422, "That API key looks too short. Paste the full key.");
  const missing = change === "create" ? !key : key === "";
  if (missing && def.requiresKey && !def.defaultApiKey)
    fail(422, `${def.label} needs an API key.`);
}

function checkRequired(
  kind: AiProviderKind,
  baseUrl: string,
  options: { apiVersion?: string },
) {
  const definition = AI_PROVIDERS[kind];
  if (!baseUrl) fail(422, `${definition.label} needs a base URL.`);
  for (const option of definition.options)
    if (option.required && !options[option.key])
      fail(422, `${definition.label} needs an ${option.label.toLowerCase()}.`);
}

/**
 * Admin console routes for AI providers, served by the AI service. Keys are
 * encrypted on arrival, only a masked hint is returned, and every change is
 * audited without the key.
 */
export async function aiAdminRoutes(app: FastifyInstance) {
  app.get("/ai/providers", async (r) => {
    await authorize(r, "ai:manage");
    const rows = (
      await query<ProviderRow>(
        "SELECT * FROM ai_providers ORDER BY created_at, id",
      )
    ).rows;
    return { providers: rows.map(toPublic), settings: await currentSettings() };
  });

  app.post("/ai/providers", async (r, reply) => {
    const actor = await authorize(r, "ai:manage");
    const d = aiProviderInput.parse(r.body);
    checkKey(d.kind, d.api_key, "create");
    const baseUrl = d.base_url || AI_PROVIDERS[d.kind].defaultBaseUrl;
    checkRequired(d.kind, baseUrl, d.options);
    await assertProviderUrl(baseUrl);
    const encrypted = d.api_key ? await encryptSecret(d.api_key) : null;
    const row = await transaction(async (db) => {
      const created = (
        await db.query<ProviderRow>(
          `INSERT INTO ai_providers(kind,name,base_url,api_key_encrypted,key_hint,options,enabled,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            d.kind,
            d.name,
            baseUrl,
            encrypted,
            d.api_key ? maskSecret(d.api_key) : "",
            JSON.stringify(d.options),
            d.enabled,
            actor.id,
          ],
        )
      ).rows[0];
      await audit(
        {
          actorId: actor.id,
          action: "ai.provider_created",
          targetType: "ai_provider",
          targetId: created.id,
          details: { kind: d.kind, name: d.name, has_key: !!encrypted },
        },
        db,
      );
      return created;
    });
    reply.code(201);
    return toPublic(row);
  });

  app.put("/ai/providers/:id", async (r) => {
    const actor = await authorize(r, "ai:manage");
    const id = idParam(r);
    const d = aiProviderUpdate.parse(r.body);
    const current = await providerRow(id);
    checkKey(current.kind, d.api_key, "update");
    const next = {
      name: d.name ?? current.name,
      base_url: d.base_url ?? current.base_url,
      options: d.options ?? current.options ?? {},
      enabled: d.enabled ?? current.enabled,
    };
    const baseUrl = next.base_url || AI_PROVIDERS[current.kind].defaultBaseUrl;
    checkRequired(current.kind, baseUrl, next.options);
    if (baseUrl !== current.base_url) await assertProviderUrl(baseUrl);
    // Omitted keeps the key, "" removes it, anything else replaces it.
    const key =
      d.api_key === undefined
        ? {
            encrypted: current.api_key_encrypted,
            hint: current.key_hint,
            change: null,
          }
        : d.api_key === ""
          ? { encrypted: null, hint: "", change: "removed" }
          : {
              encrypted: await encryptSecret(d.api_key),
              hint: maskSecret(d.api_key),
              change: "replaced",
            };
    const changed = (Object.keys(d) as (keyof typeof d)[]).filter(
      (k) => k !== "api_key",
    );
    return transaction(async (db) => {
      const row = (
        await db.query<ProviderRow>(
          `UPDATE ai_providers SET name=$1, base_url=$2, options=$3, enabled=$4,
             api_key_encrypted=$5, key_hint=$6, updated_at=now()
           WHERE id=$7 RETURNING *`,
          [
            next.name,
            baseUrl,
            JSON.stringify(next.options),
            next.enabled,
            key.encrypted,
            key.hint,
            id,
          ],
        )
      ).rows[0];
      await audit(
        {
          actorId: actor.id,
          action: "ai.provider_updated",
          targetType: "ai_provider",
          targetId: id,
          details: {
            name: row.name,
            changed,
            ...(key.change ? { key: key.change } : {}),
          },
        },
        db,
      );
      return toPublic(row);
    });
  });

  app.delete("/ai/providers/:id", async (r, reply) => {
    const actor = await authorize(r, "ai:manage");
    const id = idParam(r);
    const current = await providerRow(id);
    await transaction(async (db) => {
      // Deleting the active provider turns the assistant off until another is chosen.
      await db.query("UPDATE ai_settings SET model='' WHERE provider_id=$1", [
        id,
      ]);
      await db.query("DELETE FROM ai_providers WHERE id=$1", [id]);
      await audit(
        {
          actorId: actor.id,
          action: "ai.provider_deleted",
          targetType: "ai_provider",
          targetId: id,
          details: { kind: current.kind, name: current.name },
        },
        db,
      );
    });
    return reply.code(204).send();
  });

  app.post("/ai/providers/:id/models", strictRateLimit, async (r) => {
    await authorize(r, "ai:manage");
    const row = await providerRow(idParam(r));
    const target = await connection(row, "");
    try {
      return { models: await listModels(target) };
    } catch (error) {
      if (error instanceof ProviderError) fail(502, error.message);
      throw error;
    }
  });

  app.post("/ai/providers/:id/test", strictRateLimit, async (r) => {
    await authorize(r, "ai:manage");
    const id = idParam(r);
    const d = aiTestInput.parse(r.body ?? {});
    const row = await providerRow(id);
    const settings = await currentSettings();
    const model =
      d.model || (settings.provider_id === id ? settings.model : "");
    if (!model) fail(422, "Choose a model to test.");
    const target = await connection(row, model);
    const started = Date.now();
    try {
      await complete(
        target,
        [
          { role: "system", content: "Reply with the single word OK." },
          { role: "user", content: "ping" },
        ],
        { timeoutMs: 20_000 },
      );
      const latency = Date.now() - started;
      return {
        ok: true,
        latency_ms: latency,
        message: `Connected. ${model} replied in ${latency} ms.`,
      };
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      return { ok: false, latency_ms: null, message: error.message };
    }
  });

  app.put("/ai/settings", async (r) => {
    const actor = await authorize(r, "ai:manage");
    const d = aiSettingsInput.parse(r.body);
    let providerName: string | null = null;
    if (d.provider_id) {
      const row = await providerRow(d.provider_id);
      if (!row.enabled) fail(409, "Turn this provider on before using it.");
      if (!d.model) fail(422, "Choose a model for the assistant.");
      providerName = row.name;
    }
    await transaction(async (db) => {
      await db.query(
        `UPDATE ai_settings SET provider_id=$1, model=$2, updated_by=$3,
           semantic_search = coalesce($4, semantic_search), updated_at=now()
         WHERE id`,
        [
          d.provider_id,
          d.provider_id ? d.model : "",
          actor.id,
          d.semantic_search ?? null,
        ],
      );
      await audit(
        {
          actorId: actor.id,
          action: "ai.settings_changed",
          targetType: "ai_provider",
          targetId: d.provider_id,
          details: {
            provider: providerName,
            model: d.provider_id ? d.model : null,
          },
        },
        db,
      );
    });
    return currentSettings();
  });
}
