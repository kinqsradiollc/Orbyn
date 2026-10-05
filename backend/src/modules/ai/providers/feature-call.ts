import { randomUUID } from "node:crypto";
import { fail, aiFeatureProvider, type AiFeatureProvider } from "@orbyn/core";
import { pool, transaction, type Queryable } from "../../../db/pool.js";
import { recordAssistantSources } from "../../../lib/assistant-job-sources.js";
import { readableDocs } from "../../../lib/visibility.js";
import { docKeptOut, PAGE_KEPT_OUT } from "../../../lib/assistant-off.js";
import { requireAssistantAllowed } from "../../../lib/teams.js";
import { assertChatgptJobAccess } from "../../auth/chatgpt-inference.js";
import { resolveUserAi } from "./user-choice.js";
import { complete, type ChatMessage } from "./adapters.js";

export type PageFeatureSource = { id: string; version: number };
export type PageFeatureKind =
  "doc_assist" | "doc_ask" | "study_cards" | "study_grade" | "study_explain";

/** Page input must remain readable, AI-enabled and at its captured revision. */
async function assertPageSources(
  db: Queryable,
  owner: string,
  sources: PageFeatureSource[],
) {
  for (const source of sources) {
    const page = (
      await db.query<{ version: number; team_id: string | null }>(
        `SELECT d.version,d.team_id FROM docs d WHERE d.id=$2 AND d.deleted_at IS NULL AND ${readableDocs("d")}`,
        [owner, source.id],
      )
    ).rows[0];
    if (!page) fail(404, "Page not found");
    if (Number(page.version) !== source.version)
      fail(409, "The page changed. Start a fresh request.");
    if (await docKeptOut(db, source.id)) fail(422, PAGE_KEPT_OUT);
    await requireAssistantAllowed(page.team_id);
  }
}

/** One bounded first-party page call, with captured consent and no chat or tool authority. */
export async function completePageFeature(
  owner: string,
  kind: PageFeatureKind,
  sources: PageFeatureSource[],
  messages: ChatMessage[],
  options: Omit<NonNullable<Parameters<typeof complete>[2]>, "signal"> & {
    onProvider?: (provider: AiFeatureProvider) => void;
  } = {},
): Promise<string> {
  if (!sources.length || sources.length > 16)
    fail(400, "Choose a bounded set of source pages.");
  const { onProvider, ...completionOptions } = options;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    fail(400, "Choose a supported feature-call deadline.");
  const operationId = randomUUID();
  const claimedBy = `feature:${randomUUID()}`;
  const jobId = await transaction(async (db) => {
    const user = await db.query(
      "SELECT id FROM users WHERE id=$1 AND NOT disabled FOR SHARE",
      [owner],
    );
    if (!user.rowCount) fail(403, "This account cannot run the assistant.");
    await assertPageSources(db, owner, sources);
    const job = (
      await db.query<{ id: string }>(
        `INSERT INTO ai_jobs(user_id,state,claimed_by,lease_until,sources_checked,run_state)
       VALUES($1,'running',$2,clock_timestamp()+interval '150 seconds',false,$3::jsonb) RETURNING id`,
        [
          owner,
          claimedBy,
          JSON.stringify({
            version: 2,
            feature: kind,
            operation_id: operationId,
            sources,
          }),
        ],
      )
    ).rows[0];
    for (const source of sources)
      await db.query(
        "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
        [job.id, source.id],
      );
    return job.id;
  });
  try {
    await recordAssistantSources(
      jobId,
      owner,
      {},
      sources.map((source) => `doc:${source.id}`),
    );
    const ai = await resolveUserAi(owner, jobId, async () => {});
    if (!ai) fail(503, "The selected AI provider is unavailable.");
    const providerAuthority = ai.assertAuthority;
    const assertAuthority = async () => {
      await providerAuthority?.();
      await assertChatgptJobAccess(owner, jobId);
      await assertPageSources(pool, owner, sources);
    };
    const text = await complete(
      { ...ai, operationId, assertAuthority },
      messages,
      {
        ...completionOptions,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    await assertAuthority();
    await ai.recordCompletion?.();
    const finished = await pool.query(
      `UPDATE ai_jobs SET state='done',lease_until=NULL,claimed_by=NULL,heartbeat_at=now()
       WHERE id=$1 AND user_id=$2 AND state='running' AND claimed_by=$3 AND lease_until>clock_timestamp() RETURNING result`,
      [jobId, owner, claimedBy],
    );
    if (!finished.rowCount)
      fail(409, "This feature request expired. Start a fresh request.");
    const provider = aiFeatureProvider.safeParse(
      finished.rows[0]?.result?.feature_provider,
    );
    if (provider.success) onProvider?.(provider.data);
    return text;
  } catch (error) {
    await pool
      .query(
        `UPDATE ai_jobs SET state='failed',lease_until=NULL,claimed_by=NULL,error_status=503,
       error_message='This feature request did not complete. It was not retried.',heartbeat_at=now()
       WHERE id=$1 AND user_id=$2 AND state='running' AND claimed_by=$3`,
        [jobId, owner, claimedBy],
      )
      .catch(() => {});
    throw error;
  }
}
