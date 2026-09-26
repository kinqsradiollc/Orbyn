import { blockText, type DocBlock } from "@orbyn/core";
import { pool, type Queryable } from "../../db/pool.js";
import { embed } from "../ai/providers/adapters.js";
import { resolveAi } from "../ai/providers/resolve.js";

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

let present: boolean | null = null;

/** Whether this database can hold embeddings at all. Asked once. */
export async function hasVectors(db: Queryable = pool): Promise<boolean> {
  if (present !== null) return present;
  const row = (
    await db.query<{ ok: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS ok",
    )
  ).rows[0];
  present = !!row?.ok;
  return present;
}

/** Forget what was asked, so a test can change the answer. */
export const forgetVectors = () => {
  present = null;
};

/** Whether semantic search is both possible here and wanted. */
export async function semanticOn(db: Queryable = pool): Promise<boolean> {
  if (!(await hasVectors(db))) return false;
  const row = (
    await db.query<{ on: boolean }>(
      "SELECT semantic_search AS on FROM ai_settings WHERE id",
    )
  ).rows[0];
  return !!row?.on;
}

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
  if (!(await semanticOn())) return 0;
  const ai = await resolveAi();
  if (!ai) return 0;
  const waiting = (
    await pool.query<{ doc_id: string; content: DocBlock[] }>(
      `SELECT q.doc_id, d.content FROM doc_embedding_queue q
         JOIN docs d ON d.id = q.doc_id
        ORDER BY q.queued_at LIMIT $1`,
      [limit],
    )
  ).rows;
  let done = 0;
  for (const page of waiting) {
    const wanted = passages(page.content);
    const known = new Map(
      (
        await pool.query<{ block_id: string; quote: string }>(
          "SELECT block_id, quote FROM doc_embeddings WHERE doc_id = $1",
          [page.doc_id],
        )
      ).rows.map((r) => [r.block_id, r.quote]),
    );
    const fresh = wanted.filter((p) => known.get(p.block_id) !== p.quote);
    // Lines that have gone from the page no longer answer for it.
    await pool.query(
      "DELETE FROM doc_embeddings WHERE doc_id = $1 AND NOT (block_id = ANY($2::text[]))",
      [page.doc_id, wanted.map((p) => p.block_id)],
    );
    for (let at = 0; at < fresh.length; at += BATCH) {
      const batch = fresh.slice(at, at + BATCH);
      const vectors = await embed(
        ai,
        batch.map((p) => p.quote),
      );
      for (const [i, p] of batch.entries())
        await pool.query(
          `INSERT INTO doc_embeddings (doc_id, block_id, quote, embedding, model)
             VALUES ($1,$2,$3,$4::vector,$5)
           ON CONFLICT (doc_id, block_id)
             DO UPDATE SET quote = $3, embedding = $4::vector, model = $5,
                           created_at = now()`,
          [page.doc_id, p.block_id, p.quote, asVector(vectors[i]), ai.model],
        );
    }
    await pool.query("DELETE FROM doc_embedding_queue WHERE doc_id = $1", [
      page.doc_id,
    ]);
    done++;
  }
  return done;
}

/** A page found by meaning rather than by words. */
export type NearHit = {
  id: string;
  block_id: string;
  quote: string;
  nearness: number;
};

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
    if (!(await semanticOn())) return [];
    const ai = await resolveAi();
    if (!ai) return [];
    const [vector] = await embed(ai, [query], { timeoutMs: 15_000 });
    if (!vector?.length) return [];
    return (
      await pool.query<NearHit>(
        `SELECT e.doc_id AS id, e.block_id, e.quote,
                1 - (e.embedding <=> $2::vector) AS nearness
           FROM doc_embeddings e JOIN docs d ON d.id = e.doc_id
          WHERE ((d.team_id IS NULL AND d.user_id = $1)
                 OR d.team_id IN (SELECT team_id FROM team_members
                                   WHERE user_id = $1))
            AND ($4::uuid IS NULL OR d.project_id = $4)
          ORDER BY e.embedding <=> $2::vector
          LIMIT $3`,
        [userId, asVector(vector), limit, projectId ?? null],
      )
    ).rows;
  } catch {
    // Meaning is a bonus on top of words; losing it is not losing the search.
    return [];
  }
}
