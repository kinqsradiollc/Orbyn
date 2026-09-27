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
  if (!(await hasVectors(db))) return null;
  const row = (
    await db.query<{
      on: boolean;
      model: string;
      accepted: Date | null;
    }>(
      `SELECT semantic_search AS on, embedding_model AS model,
              semantic_accepted_at AS accepted
         FROM ai_settings WHERE id`,
    )
  ).rows[0];
  return row?.on && row.model && row.accepted ? row.model : null;
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
