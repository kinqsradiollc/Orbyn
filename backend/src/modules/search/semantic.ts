import { blockText, type DocBlock } from "@orbyn/core";
import { assistantMayRead } from "../../lib/doc-visibility.js";
import { pool } from "../../db/pool.js";
import { embed, ProviderError } from "../ai/providers/adapters.js";
import { resolveEmbedding } from "../ai/providers/resolve.js";
import { notKeptOut } from "../../lib/assistant-off.js";
import { readableDocs } from "../../lib/visibility.js";
import { semanticConfiguration, type NearHit } from "./vectors.js";
import {
  withCurrentEmbeddingPage,
  recordEmbeddingFailure,
} from "./embedding-state.js";

// Whether search by meaning is possible and on lives in ./vectors.ts, which
// loads no AI provider (docs, links and agents' paths ask it).
export {
  forgetVectors,
  hasVectors,
  semanticModel,
  semanticOn,
  type NearHit,
} from "./vectors.js";

/**
 * Finding a page that says the thing in other words.
 *
 * This rests on pgvector, which the stock Postgres image does not ship, so
 * everything here asks first and does nothing when it is absent — the word
 * search carries on alone, which is how the workspace already worked. It
 * also stays off until somebody turns it on, because measuring a page means
 * sending its words to whichever provider is configured, and that is a
 * decision for whoever runs the workspace rather than a default.
 */

/** How many lines are measured in one call to the provider. */
const BATCH = 64;
/** Lines shorter than this say too little to be worth measuring. */
const MIN_WORDS = 4;

/** The lines of a page worth measuring: the ones that say something. */
export function passages(
  content: DocBlock[],
): { block_id: string; quote: string }[] {
  return content.flatMap((b) => {
    const text = blockText(b).trim();
    if (!b.id || text.split(/\s+/).length < MIN_WORDS) return [];
    return [{ block_id: b.id, quote: text.slice(0, 2000) }];
  });
}

/** How Postgres wants a vector written. */
const asVector = (v: number[]) => `[${v.join(",")}]`;

/**
 * Measure the pages waiting in the queue. Returns how many pages were done,
 * so a worker can tell whether there is more to do.
 *
 * A line whose words have not changed keeps the measurement it already has,
 * so an ordinary edit to one paragraph costs one line, not a page.
 */
export async function measureQueued(limit = 5): Promise<number> {
  const config = await semanticConfiguration();
  if (!config) return 0;
  const model = config.model;
  const waiting = (
    await pool.query<{
      doc_id: string;
      content: DocBlock[];
      version: number;
      queue_revision: string;
    }>(
      `SELECT q.doc_id, d.content, d.version, q.queue_revision FROM doc_embedding_queue q
         JOIN docs d ON d.id = q.doc_id
         LEFT JOIN doc_embedding_failures f ON f.doc_id=q.doc_id
           AND f.queue_revision=q.queue_revision AND f.embedding_generation=$2
           AND f.doc_version=d.version
        -- A page in Trash can't be searched: measuring it would be a call
        -- to the provider for nothing. It is queued again when restored.
        -- A page in a project kept out of the assistant is never sent.
        WHERE d.deleted_at IS NULL AND ${notKeptOut("d")}
          -- A team that keeps its pages out of the assistant (OTH-04)
          -- keeps them from its provider too.
          AND ${assistantMayRead("d")}
          AND (f.retry_at IS NULL OR f.retry_at<=now())
        ORDER BY q.queued_at,q.doc_id LIMIT $1`,
      [limit, config.generation],
    )
  ).rows;
  let done = 0;
  pages: for (const page of waiting) {
    try {
      const ai = await resolveEmbedding(config);
      if (!ai) continue;
      const wanted = passages(page.content);
      const known = new Map(
        (
          await pool.query<{
            block_id: string;
            quote: string;
            embedding: string;
          }>(
            `SELECT block_id, quote, embedding::text FROM doc_embeddings
            WHERE doc_id = $1 AND embedding_generation = $2
              AND vector_dims(embedding) = $3`,
            [page.doc_id, config.generation, config.dimensions],
          )
        ).rows.map((r) => [r.block_id, r]),
      );
      const fresh = wanted.filter(
        (p) => known.get(p.block_id)?.quote !== p.quote,
      );
      const measured = new Map<string, string>();
      for (let at = 0; at < fresh.length; at += BATCH) {
        // Queue selection may precede several slow calls. Recheck before every
        // batch so later pages/batches do not send text after an intervening edit,
        // keep-out change, disable or provider revision change.
        const eligible = await pool.query(
          `SELECT d.id FROM docs d CROSS JOIN ai_settings s
          JOIN ai_providers p ON p.id=s.embedding_provider_id
         WHERE d.id=$1 AND d.version=$2 AND d.deleted_at IS NULL
           AND ${notKeptOut("d")} AND ${assistantMayRead("d")}
           AND s.id AND s.embedding_search_enabled AND p.enabled
           AND s.embedding_generation=$3 AND s.semantic_accepted_at IS NOT NULL
           AND s.embedding_provider_revision=p.embedding_revision`,
          [page.doc_id, page.version, config.generation],
        );
        if (!eligible.rowCount) continue pages;
        const batch = fresh.slice(at, at + BATCH);
        const vectors = await embed(
          ai,
          batch.map((p) => p.quote),
          { model, expectedDimensions: config.dimensions },
        );
        for (const [i, p] of batch.entries())
          measured.set(p.block_id, asVector(vectors[i]));
      }
      const saved = await withCurrentEmbeddingPage(config, page, async (db) => {
        await db.query("DELETE FROM doc_embedding_failures WHERE doc_id=$1", [
          page.doc_id,
        ]);
        await db.query("DELETE FROM doc_embeddings WHERE doc_id=$1", [
          page.doc_id,
        ]);
        for (const passage of wanted) {
          const vector =
            measured.get(passage.block_id) ??
            known.get(passage.block_id)?.embedding;
          if (!vector) throw new Error("A measured passage has no vector.");
          await db.query(
            `INSERT INTO doc_embeddings
            (doc_id,block_id,quote,embedding,model,embedding_generation,doc_version)
           VALUES ($1,$2,$3,$4::vector,$5,$6,$7)`,
            [
              page.doc_id,
              passage.block_id,
              passage.quote,
              vector,
              model,
              config.generation,
              page.version,
            ],
          );
        }
        await db.query(
          "DELETE FROM doc_embedding_queue WHERE doc_id=$1 AND queue_revision=$2",
          [page.doc_id, page.queue_revision],
        );
      });
      if (saved) done++;
    } catch (error) {
      await recordEmbeddingFailure(
        config,
        page,
        error instanceof ProviderError
          ? "provider_unavailable"
          : "worker_error",
      );
    }
  }
  return done;
}

/**
 * Pages whose lines are nearest in meaning to what was asked. Comes back
 * empty — never throws — when semantic search is off or the provider is
 * unreachable, because a search should still work when it is.
 */
export async function nearest(
  userId: string,
  query: string,
  limit = 10,
  projectId?: string,
): Promise<NearHit[]> {
  try {
    const config = await semanticConfiguration();
    if (!config) return [];
    const model = config.model;
    const ai = await resolveEmbedding(config);
    if (!ai) return [];
    const [vector] = await embed(ai, [query], {
      model,
      timeoutMs: 15_000,
      expectedDimensions: config.dimensions,
    });
    if (!vector?.length) return [];
    return (
      await pool.query<NearHit>(
        `SELECT e.doc_id AS id, e.block_id, e.quote,
                1 - (e.embedding <=> $2::vector) AS nearness
           FROM doc_embeddings e JOIN docs d ON d.id = e.doc_id
          WHERE d.deleted_at IS NULL AND ${notKeptOut("d")}
            AND ${assistantMayRead("d")}
            AND ${readableDocs("d")}
            AND ($4::uuid IS NULL OR d.project_id = $4)
            AND e.embedding_generation = $5 AND e.doc_version = d.version
            AND vector_dims(e.embedding) = $6
            AND EXISTS (
              SELECT 1 FROM ai_settings s JOIN ai_providers p ON p.id=s.embedding_provider_id
               WHERE s.id AND s.embedding_search_enabled AND p.enabled
                 AND s.semantic_accepted_at IS NOT NULL
                 AND s.embedding_generation=$5
                 AND s.embedding_provider_revision=p.embedding_revision)
          ORDER BY e.embedding <=> $2::vector
          LIMIT $3`,
        [
          userId,
          asVector(vector),
          limit,
          projectId ?? null,
          config.generation,
          config.dimensions,
        ],
      )
    ).rows;
  } catch {
    // Meaning is a bonus on top of words; losing it is not losing the search.
    return [];
  }
}

/** How often the measuring service looks for pages to measure. */
const MEASURE_MS = 60_000;

/**
 * The measuring service's loop (services/measure.ts): measure what's
 * queued, a few pages at a time, until stopped. Its own process, apart from
 * reminders, so a slow provider can't delay them.
 */
export async function runMeasurer() {
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopping = true;
    });
  while (!stopping) {
    let more = false;
    try {
      await pool.query(
        `INSERT INTO service_heartbeats(service, last_seen_at) VALUES('measure', now())
         ON CONFLICT (service) DO UPDATE SET last_seen_at = now()`,
      );
      more = (await measureQueued()) > 0;
    } catch (error) {
      console.error(
        JSON.stringify({
          service: "measure",
          message: "measuring failed",
          error: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
    if (!stopping)
      await new Promise((resolve) =>
        setTimeout(resolve, more ? 1_000 : MEASURE_MS),
      );
  }
}
