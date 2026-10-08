import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail } from "@orbyn/core";
import { pool, transaction, type Db } from "../../../db/pool.js";
import { encryptSecret, decryptSecret } from "../../../lib/secrets.js";
import {
  recordAssistantSources,
  assistantJobSourcesVisible,
} from "../../../lib/assistant-job-sources.js";
import { assertJobAiProviderChoice } from "../../auth/ai-provider-choice.js";
import {
  readManagedSelection,
  readJobManagedSnapshot,
  assertManagedSelection,
} from "./managed-authority.js";
import { resolveUserAi, ChatgptDeviceDeferred } from "./user-choice.js";
import { complete, type ResolvedAi, type ChatMessage } from "./adapters.js";

const context = z
  .object({
    version: z.literal(6),
    operation_id: z.uuid().optional(),
    maintenance: z.enum(["memory", "sweep"]),
    chat_id: z.uuid(),
    queue_id: z.uuid().optional(),
    source_turn_count: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    source_digest: z.string().regex(/^[0-9a-f]{32}$/),
    input_digest: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    source_project_id: z.uuid().nullable().optional(),
    preference: z
      .object({
        connection_id: z.uuid(),
        model: z.string().nullable(),
        version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      })
      .nullable(),
  })
  .strict();

/** Source and model authority also fence device publication and cached replies. */
export async function guardChatMaintenanceJob(
  db: Db,
  owner: string,
  jobId: string,
): Promise<void> {
  const job = (
    await db.query(
      "SELECT run_state,result FROM ai_jobs WHERE id=$1 AND user_id=$2",
      [jobId, owner],
    )
  ).rows[0];
  if (job?.run_state?.version !== 6) return;
  const parsed = context.safeParse(job.run_state);
  if (!parsed.success)
    fail(409, "This maintenance request needs a fresh source.");
  const state = parsed.data;
  if (state.maintenance === "memory" && state.source_turn_count === undefined)
    fail(409, "The queued memory source is unverified.");
  const source = (
    await db.query(
      `SELECT CASE WHEN $3::int IS NULL THEN chat_maintenance_source_digest(c) ELSE chat_maintenance_memory_digest(c,$3) END AS digest,c.origin,c.pinned,c.swept_at FROM ai_chats c JOIN users u ON u.id=c.user_id WHERE c.id=$1 AND c.user_id=$2 AND NOT u.disabled`,
      [
        state.chat_id,
        owner,
        state.maintenance === "memory" ? state.source_turn_count : null,
      ],
    )
  ).rows[0];
  if (
    !source ||
    source.digest !== state.source_digest ||
    (state.maintenance === "memory" && source.origin !== "person") ||
    (state.maintenance === "sweep" && (source.pinned || source.swept_at))
  )
    fail(409, "The maintenance source changed.");
  if (state.maintenance === "memory") {
    const queue = (
      await db.query(
        "SELECT md5(turns::text) AS digest,source_project_id FROM memory_queue WHERE id=$1 AND user_id=$2 AND chat_id=$3 AND maintenance_job_id=$4",
        [state.queue_id, owner, state.chat_id, jobId],
      )
    ).rows[0];
    if (
      !queue ||
      queue.digest !== state.input_digest ||
      queue.source_project_id !== state.source_project_id
    )
      fail(409, "The queued memory source changed.");
  }
  const choice = await assertJobAiProviderChoice(db, owner, jobId);
  const preference =
    choice.primary === "chatgpt"
      ? ((
          await db.query(
            "SELECT connection_id,model,version::float8 AS version FROM chatgpt_model_preferences WHERE connection_id=$1 FOR SHARE",
            [choice.connection_id],
          )
        ).rows[0] ?? null)
      : null;
  if (JSON.stringify(preference) !== JSON.stringify(state.preference))
    fail(409, "The captured maintenance model changed.");
  if (
    choice.primary === "default" ||
    job.result?.feature_provider?.source === "default"
  )
    assertManagedSelection(
      await readJobManagedSnapshot(db, owner, jobId),
      (await readManagedSelection(db)).snapshot,
    );
  const visible = await db.query(
    `SELECT j.id FROM ai_jobs j WHERE j.id=$2 AND ${assistantJobSourcesVisible("j", "$1", false)}`,
    [owner, jobId],
  );
  if (!visible.rowCount)
    fail(409, "A maintenance source is no longer available to AI.");
}

/** Capture a new compaction once; retries retain its original recipient and call identity. */
export async function captureChatSweepJob(
  db: Db,
  owner: string,
  chatId: string,
): Promise<string> {
  const existing = (
    await db.query(
      "SELECT c.sweep_job_id,j.run_state->>'source_digest' AS captured,chat_maintenance_source_digest(c) AS current FROM ai_chats c LEFT JOIN ai_jobs j ON j.id=c.sweep_job_id WHERE c.id=$1 AND c.user_id=$2",
      [chatId, owner],
    )
  ).rows[0];
  if (existing?.sweep_job_id && existing.captured === existing.current)
    return existing.sweep_job_id;
  const job = (
    await db.query(
      `INSERT INTO ai_jobs(user_id,state,run_state)
    SELECT $2,'queued',jsonb_build_object('version',6,'maintenance','sweep','chat_id',c.id,
      'source_digest',chat_maintenance_source_digest(c),'preference',
      (SELECT jsonb_build_object('connection_id',p.connection_id,'model',p.model,'version',p.version)
       FROM user_ai_provider_choice choice JOIN chatgpt_model_preferences p ON p.connection_id=choice.connection_id WHERE choice.user_id=$2 AND choice.primary_provider='chatgpt'))
    FROM ai_chats c WHERE c.id=$1 AND c.user_id=$2 RETURNING id`,
      [chatId, owner],
    )
  ).rows[0];
  if (!job) fail(404, "Chat not found");
  await db.query(
    "UPDATE ai_chats SET sweep_job_id=$3 WHERE id=$1 AND user_id=$2",
    [chatId, owner, job.id],
  );
  return job.id;
}

/** A single maintenance model operation; unknown completion is never automatically replayed. */
export async function completeChatMaintenance(
  owner: string,
  jobId: string,
  messages: ChatMessage[],
  options: {
    ai?: ResolvedAi;
    send?: typeof complete;
    onClaim?: (claim: string) => void;
  } = {},
): Promise<string> {
  const source = (
    await pool.query(
      "SELECT run_state FROM ai_jobs WHERE id=$1 AND user_id=$2",
      [jobId, owner],
    )
  ).rows[0];
  const state = context.parse(source?.run_state);
  await recordAssistantSources(jobId, owner, {}, [
    `chat:${state.chat_id}`,
    ...(state.source_project_id ? [`project:${state.source_project_id}`] : []),
  ]);
  const claim = `maintenance:${randomUUID()}`;
  const cached = await transaction(async (db) => {
    // Take the exclusive job lock before guards acquire share locks on its snapshot.
    // Concurrent device polls must never form a SHARE-to-UPDATE lock upgrade cycle.
    const job = (
      await db.query(
        "SELECT state,lease_until,result FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [jobId, owner],
      )
    ).rows[0];
    if (!job) fail(404, "This maintenance job is unavailable.");
    await guardChatMaintenanceJob(db, owner, jobId);
    if (
      job.state === "running" &&
      job.lease_until &&
      new Date(job.lease_until).getTime() > Date.now()
    )
      fail(409, "Maintenance is already running.");
    const output = job.result?.maintenance_output_encrypted;
    if (
      job.state !== "queued" &&
      !(job.state === "running" && typeof output === "string")
    ) {
      if (job.state === "running")
        await db.query(
          "UPDATE ai_jobs SET state='failed',claimed_by=NULL,lease_until=NULL,error_message='Maintenance completion is unknown; not replayed.' WHERE id=$1",
          [jobId],
        );
      return { refused: true, output: null };
    }
    await db.query(
      "UPDATE ai_jobs SET state='running',claimed_by=$2,lease_until=clock_timestamp()+interval '150 seconds',heartbeat_at=now() WHERE id=$1",
      [jobId, claim],
    );
    return {
      refused: false,
      output: typeof output === "string" ? output : null,
    };
  });
  if (cached.refused)
    fail(409, "This maintenance call cannot be safely retried.");
  options.onClaim?.(claim);
  if (cached.output) return decryptSecret(cached.output);
  try {
    const choice = await transaction((db) =>
      assertJobAiProviderChoice(db, owner, jobId),
    );
    // Injection is internal test infrastructure only, never a replacement for a personal choice.
    const ai =
      options.ai && choice.primary === "default"
        ? options.ai
        : await resolveUserAi(owner, jobId, async () => {}, true);
    if (!ai) fail(503, "The selected maintenance provider is unavailable.");
    const assertAuthority = async () => {
      await ai.assertAuthority?.();
      await transaction((db) => guardChatMaintenanceJob(db, owner, jobId));
    };
    await assertAuthority();
    const send =
      choice.primary === "default" ? (options.send ?? complete) : complete;
    const output = await send(
      { ...ai, operationId: state.operation_id ?? jobId, assertAuthority },
      messages,
      { timeoutMs: 60_000 },
    );
    await assertAuthority();
    const encrypted = await encryptSecret(output);
    await ai.recordCompletion?.();
    const saved = await pool.query(
      "UPDATE ai_jobs SET result=coalesce(result,'{}'::jsonb)||jsonb_build_object('maintenance_output_encrypted',$3::text) WHERE id=$1 AND user_id=$2 AND state='running' AND claimed_by=$4 AND lease_until>clock_timestamp()",
      [jobId, owner, encrypted, claim],
    );
    if (!saved.rowCount) fail(409, "This maintenance claim expired.");
    return output;
  } catch (error) {
    await pool.query(
      "UPDATE ai_jobs SET state=$3,claimed_by=NULL,lease_until=NULL,error_message=$4 WHERE id=$1 AND user_id=$2 AND state='running' AND claimed_by=$5",
      [
        jobId,
        owner,
        error instanceof ChatgptDeviceDeferred ? "queued" : "failed",
        error instanceof ChatgptDeviceDeferred
          ? "Waiting for the selected ChatGPT device."
          : "Maintenance did not complete; no automatic replacement provider or replay.",
        claim,
      ],
    );
    throw error;
  }
}

/** Commit-time recheck and finish occur in the same transaction as the derived write. */
export async function finishChatMaintenance(
  db: Db,
  owner: string,
  jobId: string,
  claim: string,
): Promise<void> {
  await db.query(
    "SELECT id FROM ai_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE",
    [jobId, owner],
  );
  await guardChatMaintenanceJob(db, owner, jobId);
  const finished = await db.query(
    "UPDATE ai_jobs SET state='done',claimed_by=NULL,lease_until=NULL,heartbeat_at=now() WHERE id=$1 AND user_id=$2 AND state='running' AND lease_until>clock_timestamp() AND claimed_by=$3 AND result->>'maintenance_output_encrypted' IS NOT NULL",
    [jobId, owner, claim],
  );
  if (!finished.rowCount) fail(409, "This maintenance claim expired.");
}

/** Release a write retry with cached output; only confirmed invalid JSON starts a new call. */
export async function releaseChatMaintenance(
  owner: string,
  jobId: string,
  claim: string,
  invalidOutput = false,
): Promise<void> {
  await pool.query(
    `UPDATE ai_jobs SET claimed_by=NULL,lease_until=clock_timestamp(),
    state=CASE WHEN $3 THEN 'queued' ELSE state END,
    result=CASE WHEN $3 THEN result-'maintenance_output_encrypted' ELSE result END,
    run_state=CASE WHEN $3 THEN jsonb_set(run_state,'{operation_id}',to_jsonb($4::text)) ELSE run_state END
    WHERE id=$1 AND user_id=$2 AND state='running' AND claimed_by=$5 AND result->>'maintenance_output_encrypted' IS NOT NULL`,
    [jobId, owner, invalidOutput, randomUUID(), claim],
  );
}
