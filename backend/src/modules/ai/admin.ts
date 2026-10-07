import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import {
  AI_PROVIDERS,
  aiProviderInput,
  aiModelControlError,
  type AiProviderOptions,
  type AiModelUsage,
  aiProviderUpdate,
  aiSettingsInput,
  aiNightBudgetInput,
  aiTestInput,
  aiCatalogInput,
  semanticSetupInput,
  fail,
  type AiProvider,
  type AiProviderKind,
  type AiSettings,
} from "@orbyn/core";
import { query, transaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { hasVectors } from "../search/semantic.js";
import { assistantMayRead } from "../../lib/doc-visibility.js";
import { notKeptOut } from "../../lib/assistant-off.js";
import { authorize } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { encryptSecret, maskSecret } from "../../lib/secrets.js";
import {
  complete,
  embed,
  listModels,
  ProviderError,
} from "./providers/adapters.js";
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
  controls_revision:
    row.generation_revision === undefined
      ? undefined
      : String(row.generation_revision),
});

type BudgetSettings = {
  provider_id: string | null;
  model: string;
  night_token_budget: number;
  embedding_generation: string;
  updated_at_epoch: string | null;
};
const budgetRevision = (row: BudgetSettings) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        row.provider_id,
        row.model,
        row.night_token_budget,
        row.embedding_generation,
        row.updated_at_epoch,
      ]),
    )
    .digest("hex");

async function currentSettings(): Promise<AiSettings> {
  const row = (
    await query<{
      provider_id: string | null;
      model: string;
      updated_at: Date | null;
      enabled: boolean | null;
      semantic_search: boolean;
      embedding_model: string;
      embedding_provider_id: string | null;
      embedding_dimensions: number | null;
      embedding_generation: string;
      embedding_search_enabled: boolean;
      embedding_ready: boolean;
      semantic_accepted_at: Date | null;
      measure_running: boolean;
      night_token_budget: number;
      updated_at_epoch: string | null;
    }>(
      `SELECT s.provider_id, s.model, s.updated_at, s.semantic_search, p.enabled, s.night_token_budget,
              s.embedding_model, s.semantic_accepted_at, extract(epoch FROM s.updated_at)::text AS updated_at_epoch,
              s.embedding_provider_id,s.embedding_dimensions,s.embedding_generation,
              s.embedding_search_enabled,
              (s.embedding_search_enabled AND ep.enabled AND s.semantic_accepted_at IS NOT NULL
                AND s.embedding_model <> '' AND s.embedding_dimensions IS NOT NULL
                AND s.embedding_provider_revision=ep.embedding_revision) AS embedding_ready,
              EXISTS (SELECT 1 FROM service_heartbeats h WHERE h.service = 'measure'
                        AND h.last_seen_at > now() - interval '3 minutes') AS measure_running
       FROM ai_settings s LEFT JOIN ai_providers p ON p.id = s.provider_id
         LEFT JOIN ai_providers ep ON ep.id=s.embedding_provider_id WHERE s.id`,
    )
  ).rows[0];
  const fromDatabase = !!(row?.provider_id && row.enabled && row.model);
  const possible = await hasVectors();
  const acceptedEmbedding = possible && !!row?.embedding_ready;
  const progress = acceptedEmbedding
    ? (
        await query<{ pending: number; indexed: number }>(
          `SELECT count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM doc_embedding_queue q WHERE q.doc_id=d.id))::integer AS pending,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM doc_embeddings e WHERE e.doc_id=d.id
           AND e.embedding_generation=$1 AND e.doc_version=d.version))::integer AS indexed
      FROM docs d WHERE d.deleted_at IS NULL AND ${notKeptOut("d")}
        AND ${assistantMayRead("d")}`,
          [row.embedding_generation],
        )
      ).rows[0]
    : undefined;
  return {
    night_token_budget: row?.night_token_budget ?? 1000000,
    settings_revision: row ? budgetRevision(row) : undefined,
    provider_id: row?.provider_id ?? null,
    model: row?.model ?? "",
    source: fromDatabase ? "database" : "none",
    semantic_search: acceptedEmbedding,
    /** Whether this database could do it at all, so the console can say so. */
    semantic_possible: possible,
    embedding_model: row?.embedding_model ?? "",
    embedding_provider_id: row?.embedding_provider_id ?? null,
    embedding_dimensions: row?.embedding_dimensions ?? null,
    embedding_generation: row?.embedding_generation,
    embedding_needs_validation:
      !!row?.embedding_search_enabled && !acceptedEmbedding,
    embedding_pending_pages: progress?.pending,
    embedding_indexed_pages: progress?.indexed,
    semantic_accepted_at: row?.semantic_accepted_at
      ? iso(row.semantic_accepted_at)
      : null,
    measure_running: !!row?.measure_running,
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
  options: AiProviderOptions,
) {
  const controlError = aiModelControlError(kind, undefined, options);
  if (controlError) fail(422, controlError);
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
      (k) => k !== "api_key" && k !== "expected_revision",
    );
    return transaction(async (db) => {
      const selected = (
        await db.query<{ provider_id: string | null; model: string }>(
          "SELECT provider_id,model FROM ai_settings WHERE id FOR SHARE",
        )
      ).rows[0];
      const locked = (
        await db.query<ProviderRow>(
          "SELECT * FROM ai_providers WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!locked) fail(404, "AI provider not found.");
      if (
        d.expected_revision &&
        (/^[1-9][0-9]*$/.test(d.expected_revision)
          ? String(locked.generation_revision) !== d.expected_revision
          : locked.updated_at.toISOString() !== d.expected_revision)
      )
        fail(
          409,
          "This connection changed. Reload its saved controls before trying again.",
        );
      // Derive omitted fields from the locked row, not the preflight read.
      next.name = d.name ?? locked.name;
      next.base_url =
        (d.base_url ?? locked.base_url) ||
        AI_PROVIDERS[locked.kind].defaultBaseUrl;
      next.options = d.options ?? locked.options ?? {};
      next.enabled = d.enabled ?? locked.enabled;
      checkRequired(locked.kind, next.base_url, next.options);
      if (d.api_key === undefined) {
        key.encrypted = locked.api_key_encrypted;
        key.hint = locked.key_hint;
      }
      if (selected?.provider_id === id) {
        const controlError = aiModelControlError(
          current.kind,
          selected.model,
          next.options,
        );
        if (controlError) fail(422, controlError);
      }
      const row = (
        await db.query<ProviderRow>(
          `UPDATE ai_providers SET name=$1, base_url=$2, options=$3, enabled=$4,
             api_key_encrypted=$5, key_hint=$6, updated_at=now()
           WHERE id=$7 RETURNING *`,
          [
            next.name,
            next.base_url,
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
    const input = aiCatalogInput.parse(r.body ?? {});
    const row = await providerRow(idParam(r));
    const revision = String(row.generation_revision);
    if (input.expected_revision && input.expected_revision !== revision)
      fail(409, "The provider changed. Refresh connections and try again.");
    const target = await connection(row, "");
    try {
      const models = await listModels(target);
      // Network I/O never holds a database lock. Reject old catalogs even after
      // A→B→A connection changes; generation is stronger than field equality.
      const current = (
        await query<{ generation_revision: string }>(
          "SELECT generation_revision::text FROM ai_providers WHERE id=$1",
          [row.id],
        )
      ).rows[0];
      if (!current || current.generation_revision !== revision)
        fail(409, "The provider changed. Refresh connections and try again.");
      return { models, provider_revision: revision };
    } catch (error) {
      if (error instanceof ProviderError) fail(502, error.message);
      throw error;
    }
  });

  app.post("/ai/providers/:id/test", strictRateLimit, async (r) => {
    const actor = await authorize(r, "ai:manage");
    const id = idParam(r);
    const d = aiTestInput.parse(r.body ?? {});
    const row = await providerRow(id);
    const settings = await currentSettings();
    const model =
      d.model || (settings.provider_id === id ? settings.model : "");
    if (!model) fail(422, "Choose a model to test.");
    const target = await connection(row, model);
    target.cacheScope = actor.id;
    let usage: AiModelUsage | undefined;
    target.recordUsage = async (observed) => {
      usage = observed;
    };
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
        ...(usage ? { usage } : {}),
      };
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      return { ok: false, latency_ms: null, message: error.message };
    }
  });

  /**
   * Search by meaning: its own setup. On needs pgvector, a connected
   * provider, a model that measures text and the admin's agreement that
   * every page is sent to be measured. Off forgets every measurement.
   */
  app.put("/ai/settings/semantic", strictRateLimit, async (r) => {
    const actor = await authorize(r, "ai:manage");
    const d = semanticSetupInput.parse(r.body);
    if (d.on) {
      if (!(await hasVectors()))
        fail(
          409,
          "This database can't search by meaning: it needs the pgvector image (see the setup guide).",
        );
      const current = await currentSettings();
      if (!d.expected_generation)
        fail(
          409,
          "Reload embedding setup and select its provider before accepting.",
        );
      if (!d.embedding_provider_id)
        fail(422, "Choose an embedding provider explicitly.");
      if (d.expected_generation !== current.embedding_generation)
        fail(
          409,
          "Embedding settings changed. Reload the setup before accepting.",
        );
      const provider = await providerRow(d.embedding_provider_id);
      if (!provider.enabled)
        fail(409, "Enable the embedding provider before using it.");
      const model = d.embedding_model ?? current.embedding_model ?? "";
      if (!model) fail(422, "Choose the model that measures text.");
      if (!d.accept)
        fail(
          422,
          "Agree that every page is sent to the provider to be measured.",
        );
      let dimensions: number;
      try {
        // Only fixed non-personal text is sent before configuration is committed.
        const [probe] = await embed(
          await connection(provider, model, "embedding"),
          ["Orbyn embedding configuration validation."],
          { timeoutMs: 15_000 },
        );
        dimensions = probe.length;
      } catch (error) {
        if (error instanceof ProviderError) fail(422, error.message);
        throw error;
      }
      await transaction(async (db) => {
        const saved = (
          await db.query<{ embedding_generation: string }>(
            "SELECT embedding_generation FROM ai_settings WHERE id FOR UPDATE",
          )
        ).rows[0];
        if (saved.embedding_generation !== d.expected_generation)
          fail(
            409,
            "Embedding settings changed during validation. Reload the setup.",
          );
        const selected = (
          await db.query<ProviderRow>(
            "SELECT * FROM ai_providers WHERE id=$1 FOR SHARE",
            [provider.id],
          )
        ).rows[0];
        if (
          !selected?.enabled ||
          selected.embedding_revision !== provider.embedding_revision
        )
          fail(
            409,
            "The embedding provider changed during validation. Validate it again.",
          );
        await db.query(
          `UPDATE ai_settings SET embedding_search_enabled = true, embedding_model = $1,
             semantic_accepted_at = now(), semantic_accepted_by = $2,
             embedding_provider_id=$3,embedding_provider_revision=$4,
             embedding_dimensions=$5,embedding_generation=gen_random_uuid(),
             updated_by = $2, updated_at = now() WHERE id`,
          [
            model,
            actor.id,
            provider.id,
            provider.embedding_revision,
            dimensions,
          ],
        );
        await db.query("DELETE FROM doc_embeddings");
        await db.query("DELETE FROM doc_embedding_queue");
        // Everything written so far is measured once, by the measuring
        // service (pages kept out of the assistant never are).
        await db.query(
          `INSERT INTO doc_embedding_queue (doc_id)
           SELECT d.id FROM docs d
            WHERE d.deleted_at IS NULL AND ${notKeptOut("d")} AND ${assistantMayRead("d")}
           ON CONFLICT DO NOTHING`,
        );
        await audit(
          {
            actorId: actor.id,
            action: "ai.semantic_on",
            targetType: "system",
            targetId: null,
            details: {
              model,
              provider_id: provider.id,
              provider_revision: provider.embedding_revision,
              dimensions,
            },
          },
          db,
        );
      });
    } else
      await transaction(async (db) => {
        const saved = (
          await db.query<{ embedding_generation: string }>(
            "SELECT embedding_generation FROM ai_settings WHERE id FOR UPDATE",
          )
        ).rows[0];
        if (
          d.expected_generation &&
          saved.embedding_generation !== d.expected_generation
        )
          fail(409, "Embedding settings changed. Reload the setup.");
        await db.query(
          `UPDATE ai_settings SET embedding_search_enabled = false,
             embedding_generation=gen_random_uuid(),
             embedding_model = coalesce($1, embedding_model),
             semantic_accepted_at = NULL, semantic_accepted_by = NULL,
             updated_by = $2, updated_at = now() WHERE id`,
          [d.embedding_model ?? null, actor.id],
        );
        // Measurements are the pages' words in another form: off forgets them.
        if (await hasVectors()) {
          await db.query("DELETE FROM doc_embeddings");
          await db.query("DELETE FROM doc_embedding_queue");
        }
        await audit(
          {
            actorId: actor.id,
            action: "ai.semantic_off",
            targetType: "system",
            targetId: null,
            details: {},
          },
          db,
        );
      });
    return currentSettings();
  });

  app.put("/ai/settings/night-budget", strictRateLimit, async (r) => {
    const actor = await authorize(r, "ai:manage");
    const input = aiNightBudgetInput.parse(r.body);
    await transaction(async (db) => {
      const current = (
        await db.query<BudgetSettings>(`SELECT provider_id,model,night_token_budget,embedding_generation,
        extract(epoch FROM updated_at)::text AS updated_at_epoch FROM ai_settings WHERE id FOR UPDATE`)
      ).rows[0];
      if (!current || budgetRevision(current) !== input.expected_revision)
        fail(409, "AI settings changed. Refresh the budget before saving.");
      await db.query(
        "UPDATE ai_settings SET night_token_budget=$1,updated_by=$2,updated_at=now() WHERE id",
        [input.night_token_budget, actor.id],
      );
      await audit(
        {
          actorId: actor.id,
          action: "ai.night_budget_changed",
          targetType: "system",
          targetId: null,
          details: {
            before: current.night_token_budget,
            after: input.night_token_budget,
          },
        },
        db,
      );
    });
    return currentSettings();
  });

  app.put("/ai/settings", async (r) => {
    const actor = await authorize(r, "ai:manage");
    const d = aiSettingsInput.parse(r.body);
    if (d.night_token_budget !== undefined)
      fail(409, "Use the night-shift budget control to change its allowance.");
    // Search by meaning is turned on only through its own setup, below.
    if (d.semantic_search === true)
      fail(
        422,
        "Turn on search by meaning in its own setup: it needs a model and your agreement.",
      );
    let providerName: string | null = null;
    await transaction(async (db) => {
      // Match enqueue/provider-update lock order and validate the committed pair.
      await db.query("SELECT id FROM ai_settings WHERE id FOR UPDATE");
      if (d.provider_id) {
        const row = (
          await db.query<ProviderRow>(
            "SELECT * FROM ai_providers WHERE id=$1 FOR SHARE",
            [d.provider_id],
          )
        ).rows[0];
        if (!row) fail(404, "Provider not found");
        if (!row.enabled) fail(409, "Turn this provider on before using it.");
        if (!d.model) fail(422, "Choose a model for the assistant.");
        const controlError = aiModelControlError(
          row.kind,
          d.model,
          row.options ?? {},
        );
        if (controlError) fail(422, controlError);
        providerName = row.name;
      }
      await db.query(
        `UPDATE ai_settings SET provider_id=$1, model=$2, updated_by=$3,
           embedding_search_enabled = CASE WHEN $4::boolean=false THEN false ELSE embedding_search_enabled END,
           embedding_generation = CASE WHEN $4::boolean=false THEN gen_random_uuid() ELSE embedding_generation END,
           semantic_accepted_at = CASE WHEN $4::boolean=false THEN NULL ELSE semantic_accepted_at END,
           semantic_accepted_by = CASE WHEN $4::boolean=false THEN NULL ELSE semantic_accepted_by END,
           updated_at=now()
         WHERE id`,
        [
          d.provider_id,
          d.provider_id ? d.model : "",
          actor.id,
          d.semantic_search ?? null,
        ],
      );
      if (d.semantic_search === false && (await hasVectors())) {
        await db.query("DELETE FROM doc_embeddings");
        await db.query("DELETE FROM doc_embedding_queue");
      }
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
