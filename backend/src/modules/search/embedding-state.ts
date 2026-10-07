import { transaction, type Queryable } from "../../db/pool.js";
import { assistantMayRead } from "../../lib/doc-visibility.js";
import { notKeptOut } from "../../lib/assistant-off.js";
import {
  semanticConfiguration,
  type EmbeddingConfiguration,
} from "./vectors.js";

/** The captured page and queue identity for an embedding attempt. */
export type EmbeddingPage = {
  doc_id: string;
  version: number;
  queue_revision: string;
};

/** Apply a success/failure only while consent, visibility and queue identity still match. */
export async function withCurrentEmbeddingPage(
  config: EmbeddingConfiguration,
  page: EmbeddingPage,
  apply: (db: Queryable) => Promise<void>,
): Promise<boolean> {
  return transaction(async (db) => {
    // Provider requests never hold these locks. Keep success and failure order identical.
    await db.query("SELECT id FROM ai_settings WHERE id FOR SHARE");
    await db.query("SELECT id FROM ai_providers WHERE id=$1 FOR SHARE", [
      config.providerId,
    ]);
    const current = await semanticConfiguration(db);
    if (
      !current ||
      current.generation !== config.generation ||
      current.providerRevision !== config.providerRevision
    )
      return false;
    const document = await db.query<{
      project_id: string | null;
      team_id: string | null;
    }>(
      "SELECT d.project_id,d.team_id FROM docs d WHERE d.id=$1 AND d.version=$2 AND d.deleted_at IS NULL FOR SHARE OF d",
      [page.doc_id, page.version],
    );
    if (!document.rowCount) return false;
    await db.query("SELECT id FROM projects WHERE id=$1 FOR SHARE", [
      document.rows[0].project_id,
    ]);
    await db.query("SELECT id FROM teams WHERE id=$1 FOR SHARE", [
      document.rows[0].team_id,
    ]);
    if (
      !(
        await db.query(
          `SELECT d.id FROM docs d WHERE d.id=$1 AND ${notKeptOut("d")} AND ${assistantMayRead("d")}`,
          [page.doc_id],
        )
      ).rowCount
    )
      return false;
    if (
      !(
        await db.query(
          "SELECT doc_id FROM doc_embedding_queue WHERE doc_id=$1 AND queue_revision=$2 FOR UPDATE",
          [page.doc_id, page.queue_revision],
        )
      ).rowCount
    )
      return false;
    await apply(db);
    return true;
  });
}

/** Store no provider detail or passage text; retries remain fenced to the failed attempt. */
export async function recordEmbeddingFailure(
  config: EmbeddingConfiguration,
  page: EmbeddingPage,
  code: "provider_unavailable" | "worker_error",
): Promise<boolean> {
  return withCurrentEmbeddingPage(config, page, async (db) => {
    await db.query(
      `INSERT INTO doc_embedding_failures AS old
      (doc_id,queue_revision,embedding_generation,doc_version,attempts,error_code,retry_at)
      VALUES ($1,$2,$3,$4,1,$5,now()+interval '60 seconds')
      ON CONFLICT(doc_id) DO UPDATE SET
        queue_revision=excluded.queue_revision, embedding_generation=excluded.embedding_generation,
        doc_version=excluded.doc_version,error_code=excluded.error_code,failed_at=now(),
        attempts=CASE WHEN old.queue_revision=$2 AND old.embedding_generation=$3 AND old.doc_version=$4
          THEN least(old.attempts+1,16) ELSE 1 END,
        retry_at=now()+make_interval(secs=>CASE
          WHEN old.queue_revision=$2 AND old.embedding_generation=$3 AND old.doc_version=$4
          THEN least(3600,60*power(2,least(old.attempts,6)))::integer ELSE 60 END)`,
      [page.doc_id, page.queue_revision, config.generation, page.version, code],
    );
  });
}
