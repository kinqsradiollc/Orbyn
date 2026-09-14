import { AI_PROVIDERS, type AiProviderKind } from "@orbyn/core";
import { env } from "../../../config/env.js";
import { query } from "../../../db/pool.js";
import { decryptSecret } from "../../../lib/secrets.js";
import type { ResolvedAi } from "./adapters.js";

export type ProviderRow = {
  id: string;
  kind: AiProviderKind;
  name: string;
  base_url: string;
  api_key_encrypted: string | null;
  key_hint: string;
  options: { apiVersion?: string } | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

/** How to call a saved provider with `model`, decrypting its key. */
export function connection(row: ProviderRow, model: string): ResolvedAi {
  const definition = AI_PROVIDERS[row.kind];
  return {
    kind: row.kind,
    format: definition?.format ?? "openai",
    baseUrl: row.base_url || definition?.defaultBaseUrl || "",
    apiKey: row.api_key_encrypted ? decryptSecret(row.api_key_encrypted) : "",
    model,
    options: row.options ?? {},
    source: "database",
  };
}

/** The server's AI_* settings as a provider, or null. Never touches the database. */
export function environmentAi(): ResolvedAi | null {
  if (!env.AI_MODEL) return null;
  return {
    kind: "openai-compatible",
    format: "openai",
    baseUrl: env.AI_BASE_URL,
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL,
    options: {},
    source: "environment",
  };
}

/**
 * The provider the assistant should use: the admin's choice from the admin
 * console, otherwise the server's AI_* settings, otherwise nothing.
 */
export async function resolveAi(): Promise<ResolvedAi | null> {
  const row = (
    await query<ProviderRow & { model: string }>(
      `SELECT p.*, s.model FROM ai_settings s
       JOIN ai_providers p ON p.id = s.provider_id
       WHERE s.id AND p.enabled AND s.model <> ''`,
    )
  ).rows[0];
  if (row) return connection(row, row.model);
  return environmentAi();
}
