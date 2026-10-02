import { pool, type Queryable } from "../../db/pool.js";

/**
 * Whether search by meaning is possible here (pgvector and its tables) and
 * turned on. Apart from ./semantic.ts, which measures text with the AI
 * provider, so the pages, links and agent paths that only ask never load one.
 */

let present: boolean | null = null;

/** Whether this database can hold embeddings at all. Asked once. */
export async function hasVectors(db: Queryable = pool): Promise<boolean> {
  if (present !== null) return present;
  const row = (
    await db.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
              AND to_regclass('doc_embeddings') IS NOT NULL
              AND to_regclass('doc_embedding_queue') IS NOT NULL AS ok`,
    )
  ).rows[0];
  present = !!row?.ok;
  return present;
}

/** Forget what was asked, so a test can change the answer. */
export const forgetVectors = () => {
  present = null;
};

/**
 * The model that measures text, when search by meaning is possible here,
 * turned on, and set up (a model chosen and the sending accepted); null
 * otherwise. Words alone carry the search whenever this is null.
 */
export async function semanticModel(
  db: Queryable = pool,
): Promise<string | null> {
  return (await semanticConfiguration(db))?.model ?? null;
}

/** The exact provider/model generation for which sending text was accepted. */
export type EmbeddingConfiguration = {
  model: string;
  providerId: string;
  providerRevision: string;
  dimensions: number;
  generation: string;
};

/** Resolve accepted embedding configuration without loading AI credentials. */
export async function semanticConfiguration(
  db: Queryable = pool,
): Promise<EmbeddingConfiguration | null> {
  if (!(await hasVectors(db))) return null;
  const row = (
    await db.query<EmbeddingConfiguration>(
      `SELECT s.embedding_model AS model,
              s.embedding_provider_id AS "providerId",
              s.embedding_provider_revision::text AS "providerRevision",
              s.embedding_dimensions AS dimensions,
              s.embedding_generation AS generation
         FROM ai_settings s JOIN ai_providers p ON p.id=s.embedding_provider_id
        WHERE s.id AND s.embedding_search_enabled AND p.enabled
          AND s.semantic_accepted_at IS NOT NULL AND s.embedding_model <> ''
          AND s.embedding_dimensions IS NOT NULL
          AND s.embedding_provider_revision = p.embedding_revision`,
    )
  ).rows[0];
  return row ?? null;
}

/** Whether semantic search is both possible here and wanted. */
export async function semanticOn(db: Queryable = pool): Promise<boolean> {
  return !!(await semanticModel(db));
}

/** A page found by meaning rather than by words. */
export type NearHit = {
  id: string;
  block_id: string;
  quote: string;
  nearness: number;
};
