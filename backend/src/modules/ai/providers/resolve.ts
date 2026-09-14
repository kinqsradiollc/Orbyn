import { AI_PROVIDERS, type AiProviderKind } from "@orbyn/core";
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
export async function connection(
  row: ProviderRow,
  model: string,
): Promise<ResolvedAi> {
  const definition = AI_PROVIDERS[row.kind];
  return {
    kind: row.kind,
    format: definition?.format ?? "openai",
    baseUrl: row.base_url || definition?.defaultBaseUrl || "",
    apiKey: row.api_key_encrypted
      ? await decryptSecret(row.api_key_encrypted)
      : "",
    model,
    options: row.options ?? {},
    source: "database",
    limits: definition?.limits,
  };
}

/**
 * The provider the assistant should use: the admin's choice from the admin
 * console, or nothing (the assistant is off). There is no server fallback.
 */
export async function resolveAi(): Promise<ResolvedAi | null> {
  const row = (
    await query<ProviderRow & { model: string }>(
      `SELECT p.*, s.model FROM ai_settings s
       JOIN ai_providers p ON p.id = s.provider_id
       WHERE s.id AND p.enabled AND s.model <> ''`,
    )
  ).rows[0];
  return row ? connection(row, row.model) : null;
}
