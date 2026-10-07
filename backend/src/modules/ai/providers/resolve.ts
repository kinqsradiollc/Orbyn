import {
  AI_PROVIDERS,
  aiModelControlError,
  type AiProviderOptions,
  type AiProviderKind,
} from "@orbyn/core";
import { fail } from "@orbyn/core";
import { query, transaction } from "../../../db/pool.js";
import {
  readManagedSelection,
  assertManagedSelection,
  readJobManagedSnapshot,
  type ManagedAiSnapshot,
} from "./managed-authority.js";
import { decryptSecret } from "../../../lib/secrets.js";
import type { ResolvedAi } from "./adapters.js";
import type { EmbeddingConfiguration } from "../../search/vectors.js";

export type ProviderRow = {
  id: string;
  kind: AiProviderKind;
  name: string;
  base_url: string;
  api_key_encrypted: string | null;
  key_hint: string;
  options: AiProviderOptions | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
  embedding_revision: string;
  provider_revision?: string;
  generation_revision?: string;
};

/** How to call a saved provider with `model`, decrypting its key. */
export async function connection(
  row: ProviderRow,
  model: string,
  purpose: "generation" | "embedding" = "generation",
): Promise<ResolvedAi> {
  const { reasoningEffort, cacheMode, cacheRetention, ...connectionOptions } =
    row.options ?? {};
  const options =
    purpose === "embedding" ? connectionOptions : (row.options ?? {});
  const controlError =
    model && purpose === "generation"
      ? aiModelControlError(row.kind, model, options)
      : null;
  if (controlError) fail(422, controlError);
  const definition = AI_PROVIDERS[row.kind];
  return {
    kind: row.kind,
    format: definition?.format ?? "openai",
    baseUrl: row.base_url || definition?.defaultBaseUrl || "",
    apiKey: row.api_key_encrypted
      ? await decryptSecret(row.api_key_encrypted)
      : "",
    model,
    options,
    source: "database",
    providerId: row.id,
    providerRevision: row.provider_revision ?? row.updated_at.toISOString(),
    limits: definition?.limits,
    structuredOutput: definition?.structuredOutput,
    local: definition?.local,
    defaultApiKey: definition?.defaultApiKey,
    requestFormat: definition?.requestFormat,
  };
}

/**
 * The provider the assistant should use: the admin's choice from the admin
 * console, or nothing (the assistant is off). There is no server fallback.
 */
export async function resolveAi(
  captured?: ManagedAiSnapshot,
): Promise<ResolvedAi | null> {
  const selected = await transaction(async (db) => {
    const live = await readManagedSelection(db);
    if (captured) assertManagedSelection(captured, live.snapshot);
    return live;
  });
  if (!selected.provider || !selected.snapshot.provider) return null;
  const ai = await connection(
    selected.provider,
    selected.snapshot.provider.model,
  );
  return {
    ...ai,
    assertAuthority: async () =>
      transaction(async (db) => {
        assertManagedSelection(
          selected.snapshot,
          (await readManagedSelection(db)).snapshot,
        );
      }),
  };
}

/** Resume and explicit fallback use the job's enqueue-time managed identity only. */
export async function resolveJobManagedAi(
  owner: string,
  jobId: string,
): Promise<ResolvedAi | null> {
  const captured = await transaction((db) =>
    readJobManagedSnapshot(db, owner, jobId),
  );
  return resolveAi(captured);
}

/** Embeddings use only their accepted provider revision, independently of chat. */
export async function resolveEmbedding(
  config: EmbeddingConfiguration,
): Promise<ResolvedAi | null> {
  const row = (
    await query<ProviderRow>(
      `SELECT * FROM ai_providers
      WHERE id=$1 AND enabled AND embedding_revision=$2::bigint`,
      [config.providerId, config.providerRevision],
    )
  ).rows[0];
  return row ? connection(row, config.model, "embedding") : null;
}
