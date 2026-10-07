import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  chatgptInferenceInput,
  chatgptInferenceAssignment,
  chatgptInferencePublication,
  chatgptInferenceReceiptMessage,
  chatgptInferenceResult,
  fail,
  type ChatgptInferenceAssignment,
} from "@orbyn/core";
import { transaction, type Db } from "../../db/pool.js";
import { encryptSecret, decryptSecret } from "../../lib/secrets.js";
import { requireLiveSession } from "./chatgpt-connections.js";
import { readChatgptCatalogLocked } from "./chatgpt-model-catalog.js";
import { verifyChatgptExecutorProof } from "./chatgpt-executor-proof.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import {
  readAiProviderChoice,
  assertJobAiProviderChoice,
} from "./ai-provider-choice.js";
import { recordCompletedChatgptUsage } from "./chatgpt-usage.js";
import { recordProviderUse } from "../ai/provider-provenance.js";
type Session = { userId: string; sessionId: string };
type Selection = { connection_id: string; executor_id: string };
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Serialize dispatch with provider edits and require the captured billing consent. */
async function providerLive(
  db: Db,
  owner: string,
  selection: Selection,
  version?: number,
) {
  await db.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [owner]);
  const choice = await readAiProviderChoice(db, owner);
  if (
    choice.primary !== "chatgpt" ||
    choice.connection_id !== selection.connection_id ||
    choice.executor_id !== selection.executor_id ||
    (version !== undefined && choice.version !== version)
  )
    fail(409, "Your AI provider choice changed. Start a fresh request.");
  return choice.version;
}

/** Current job authority is mandatory before exposing any conversation or accepting output. */
async function jobLive(db: Db, owner: string, id: string) {
  const { guardAgendaInferenceJob } =
    await import("../ai/providers/agenda-call.js");
  await guardAgendaInferenceJob(db, owner, id);
  const { guardPageInferenceJob } =
    await import("../docs/maintenance-inference.js");
  await guardPageInferenceJob(db, owner, id);
  // Publication can update job provenance after locking the request. Serialize
  // the job first; a SHARE lock here would require an upgrade behind a poll
  // already waiting for that request, creating a job/request lock cycle.
  const job = await db.query(
    `SELECT j.id FROM ai_jobs j JOIN users u ON u.id=j.user_id WHERE j.id=$2 AND j.user_id=$1 AND NOT u.disabled AND j.state='running' AND j.lease_until>clock_timestamp() AND ${assistantJobSourcesVisible("j", "$1", false)}
      AND (coalesce(j.run_state->>'version','') NOT IN ('2','3') OR (
        jsonb_typeof(j.run_state->'sources')='array'
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.run_state->'sources') feature_source
          LEFT JOIN docs feature_doc ON feature_doc.id=(feature_source->>'id')::uuid
          WHERE ((coalesce(feature_source->>'kind','doc')='doc') AND feature_doc.version::text IS DISTINCT FROM feature_source->>'version')
            OR (feature_source ? 'recording_file_id' AND NOT EXISTS(SELECT 1 FROM page_files feature_file
              WHERE feature_file.id=(feature_source->>'recording_file_id')::uuid
                AND feature_file.doc_id=feature_doc.id AND feature_file.status='ready' AND feature_file.mime LIKE 'audio/%'))
            OR (feature_source->>'kind'='team' AND NOT EXISTS(SELECT 1 FROM teams feature_team
              JOIN team_members feature_member ON feature_member.team_id=feature_team.id
              WHERE feature_team.id=(feature_source->>'id')::uuid AND feature_member.user_id=$1
                AND feature_member.role<>'viewer' AND feature_team.assistant_allowed)))
      )) FOR UPDATE OF j`,
    [owner, id],
  );
  if (!job.rowCount) fail(409, "The assistant job or its sources changed.");
  await assertJobAiProviderChoice(db, owner, id);
}
/** Cached loop replies still require current producing-source authority. */
export async function assertChatgptJobAccess(owner: string, jobId: string) {
  return transaction((db) => jobLive(db, owner, jobId));
}
async function device(
  db: Db,
  owner: string,
  selection: Selection,
  requireOutputLimits = false,
) {
  const row = (
    await db.query(
      "SELECT e.session_id,e.epoch,e.public_key,l.epoch AS lease_epoch FROM chatgpt_executor_enrollments e JOIN chatgpt_executor_leases l ON l.executor_id=e.id WHERE e.id=$1 AND e.connection_id=$2",
      [selection.executor_id, selection.connection_id],
    )
  ).rows[0];
  if (!row) fail(503, "The ChatGPT device is unavailable.");
  const session = { userId: owner, sessionId: row.session_id };
  await requireLiveSession(db, session);
  const catalog = await readChatgptCatalogLocked(
    db,
    session,
    selection,
    false,
    true,
    requireOutputLimits,
  );
  if (catalog.status !== "ready")
    fail(503, "The ChatGPT device or its model catalog is unavailable.");
  const current = (
    await db.query(
      "SELECT e.session_id,e.epoch,e.public_key,l.epoch AS lease_epoch FROM chatgpt_executor_enrollments e JOIN chatgpt_executor_leases l ON l.executor_id=e.id WHERE e.id=$1 AND e.connection_id=$2 FOR SHARE OF e,l",
      [selection.executor_id, selection.connection_id],
    )
  ).rows[0];
  if (!current || current.session_id !== row.session_id)
    fail(409, "The ChatGPT executor session changed.");
  return { row: current, session, catalog };
}

/** Internal runner-only enqueue: no HTTP endpoint accepts arbitrary prompt input. */
export async function queueChatgptInference(
  owner: string,
  jobId: string,
  selection: Selection,
  input: unknown,
  expectedModel?: string,
  expectedProviderVersion?: number,
  operationId: string = randomUUID(),
) {
  z.uuid().parse(operationId);
  if (Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 * 1024)
    fail(400, "The ChatGPT request exceeded its size limit.");
  const payload = chatgptInferenceInput.parse(input);
  const encrypted = await encryptSecret(JSON.stringify(payload));
  return transaction(async (db) => {
    const providerVersion = await providerLive(
      db,
      owner,
      selection,
      expectedProviderVersion,
    );
    await jobLive(db, owner, jobId);
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [
      jobId,
      operationId,
    ]);
    const existing = (
      await db.query(
        `SELECT o.state,o.request_id,o.fallback_result_encrypted,r.expires_at,r.request_hash,r.model,r.executor_id,r.connection_id,r.provider_choice_version
       FROM chatgpt_inference_operations o LEFT JOIN chatgpt_inference_requests r ON r.id=o.request_id
       WHERE o.job_id=$1 AND o.operation_id=$2 AND o.user_id=$3 FOR UPDATE OF o`,
        [jobId, operationId, owner],
      )
    ).rows[0];
    if (existing) {
      if (existing.state === "fallback_started") {
        if (!existing.fallback_result_encrypted)
          fail(
            409,
            "This fallback has an unknown completion. It was not retried.",
          );
        return {
          id: (existing.request_id ?? operationId) as string,
          expires_at: new Date().toISOString(),
        };
      }
      if (!existing.request_id || !existing.expires_at)
        fail(409, "This call has no recoverable response. It was not retried.");
      if (
        existing.executor_id !== selection.executor_id ||
        existing.connection_id !== selection.connection_id ||
        Number(existing.provider_choice_version) !== providerVersion ||
        (expectedModel !== undefined && existing.model !== expectedModel)
      )
        fail(409, "The captured ChatGPT operation changed.");
      // Binding identity is unchanged by disconnect; existing completed output needs no new device call.
      const identity = (
        await db.query(
          "SELECT issuer,subject,client_id FROM chatgpt_identity_connections WHERE id=$1 AND user_id=$2",
          [selection.connection_id, owner],
        )
      ).rows[0];
      if (
        !identity ||
        digest({
          binding: {
            user_id: owner,
            connection_id: selection.connection_id,
            ...identity,
          },
          model: existing.model,
          payload,
          job_id: jobId,
        }) !== existing.request_hash
      )
        fail(409, "The captured ChatGPT input changed.");
      return {
        id: existing.request_id as string,
        expires_at: existing.expires_at.toISOString() as string,
      };
    }
    const { row, catalog } = await device(
      db,
      owner,
      selection,
      payload.max_output_tokens !== undefined,
    );
    const model = catalog.preference.model;
    if (expectedModel !== undefined && model !== expectedModel)
      fail(409, "The selected ChatGPT default model changed.");
    if (!model || !catalog.models.some((m) => m.slug === model))
      fail(409, "Choose an available ChatGPT default model first.");
    const nonce = randomBytes(32).toString("base64url");
    const requestHash = digest({
      binding: catalog.binding,
      model,
      payload,
      job_id: jobId,
    });
    const result = (
      await db.query(
        `INSERT INTO chatgpt_inference_requests(user_id,job_id,executor_id,connection_id,enrollment_epoch,lease_epoch,model,nonce,request_hash,payload_encrypted,provider_choice_version)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,expires_at`,
        [
          owner,
          jobId,
          selection.executor_id,
          selection.connection_id,
          row.epoch,
          row.lease_epoch,
          model,
          nonce,
          requestHash,
          encrypted,
          providerVersion,
        ],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO chatgpt_inference_operations(job_id,operation_id,user_id,request_id,state) VALUES($1,$2,$3,$4,'assigned')",
      [jobId, operationId, owner, result.id],
    );
    return {
      id: result.id as string,
      expires_at: result.expires_at.toISOString() as string,
    };
  });
}

/** Persist before managed fallback: an uncertain fallback can never restart under the same slot. */
export async function beginChatgptFallback(
  owner: string,
  jobId: string,
  operationId: string,
) {
  z.uuid().parse(operationId);
  return transaction(async (db) => {
    await jobLive(db, owner, jobId);
    const choice = await assertJobAiProviderChoice(db, owner, jobId);
    if (choice.primary !== "chatgpt" || !choice.fallback_to_default)
      fail(403, "Fallback was not authorized.");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [
      jobId,
      operationId,
    ]);
    const row = (
      await db.query(
        "SELECT state,request_id FROM chatgpt_inference_operations WHERE job_id=$1 AND operation_id=$2 AND user_id=$3 FOR UPDATE",
        [jobId, operationId, owner],
      )
    ).rows[0];
    if (row?.state === "fallback_started")
      fail(409, "This fallback has an unknown completion. It was not retried.");
    if (row) {
      const receipt = (
        await db.query(
          "SELECT state,result_encrypted FROM chatgpt_inference_requests WHERE id=$1 FOR UPDATE",
          [row.request_id],
        )
      ).rows[0];
      if (!receipt?.result_encrypted)
        fail(409, "This private call cannot safely change provider.");
      const result = chatgptInferenceResult.parse(
        JSON.parse(await decryptSecret(receipt.result_encrypted)),
      );
      if (
        result.status !== "failed" ||
        result.phase !== "admission" ||
        !["eligibility", "usage_limit", "unavailable"].includes(result.reason)
      )
        fail(409, "This private call cannot safely change provider.");
      await db.query(
        "UPDATE chatgpt_inference_operations SET state='fallback_started' WHERE job_id=$1 AND operation_id=$2",
        [jobId, operationId],
      );
    } else {
      await db.query(
        "INSERT INTO chatgpt_inference_operations(job_id,operation_id,user_id,state) VALUES($1,$2,$3,'fallback_started')",
        [jobId, operationId, owner],
      );
    }
  });
}

/** A received managed response can recover under the original slot without another request. */
export async function finishChatgptFallback(
  owner: string,
  jobId: string,
  operationId: string,
  text: string,
  model: string,
) {
  const encrypted = await encryptSecret(
    JSON.stringify(
      chatgptInferenceResult.parse({ status: "completed", text, usage: null }),
    ),
  );
  return transaction(async (db) => {
    await jobLive(db, owner, jobId);
    const saved = await db.query(
      "UPDATE chatgpt_inference_operations SET fallback_result_encrypted=$4 WHERE user_id=$1 AND job_id=$2 AND operation_id=$3 AND state='fallback_started' AND fallback_result_encrypted IS NULL RETURNING operation_id",
      [owner, jobId, operationId, encrypted],
    );
    if (!saved.rowCount) fail(409, "The fallback operation changed.");
    await recordProviderUse(
      owner,
      jobId,
      "default",
      model,
      true,
      "completed",
      operationId,
      db,
    );
  });
}

export async function readCachedChatgptFallback(
  owner: string,
  jobId: string,
  operationId: string,
) {
  return transaction(async (db) => {
    await jobLive(db, owner, jobId);
    const row = (
      await db.query(
        "SELECT state,fallback_result_encrypted FROM chatgpt_inference_operations WHERE user_id=$1 AND job_id=$2 AND operation_id=$3",
        [owner, jobId, operationId],
      )
    ).rows[0];
    if (row?.state !== "fallback_started") return null;
    if (!row.fallback_result_encrypted)
      fail(409, "This fallback has an unknown completion. It was not retried.");
    const result = chatgptInferenceResult.parse(
      JSON.parse(await decryptSecret(row.fallback_result_encrypted)),
    );
    if (result.status !== "completed")
      fail(409, "This fallback did not complete.");
    return result;
  });
}

export async function readChatgptOperation(
  owner: string,
  jobId: string,
  operationId: string,
) {
  return transaction(async (db) => {
    await jobLive(db, owner, jobId);
    const row = (
      await db.query(
        "SELECT request_id,state,fallback_result_encrypted FROM chatgpt_inference_operations WHERE user_id=$1 AND job_id=$2 AND operation_id=$3",
        [owner, jobId, operationId],
      )
    ).rows[0];
    if (!row) fail(404, "This private operation is unavailable.");
    if (row.fallback_result_encrypted)
      return chatgptInferenceResult.parse(
        JSON.parse(await decryptSecret(row.fallback_result_encrypted)),
      );
    if (row.state === "fallback_started" || !row.request_id)
      fail(
        409,
        "This operation has an unknown completion. It was not retried.",
      );
    return readChatgptInferenceLocked(db, owner, jobId, row.request_id);
  });
}

/** Queue only work with no unfinished physical assignment; never retry an unknown charge. */
export async function deferUnassignedChatgptJob(
  owner: string,
  jobId: string,
  claimedBy: string | null,
) {
  return transaction(async (db) => {
    const user = await db.query(
      "SELECT id FROM users WHERE id=$1 AND NOT disabled FOR SHARE",
      [owner],
    );
    if (!user.rowCount) return false;
    const held = await db.query(
      `SELECT id FROM ai_jobs WHERE id=$1 AND user_id=$2 AND state='running'
       AND NOT cancel_requested AND lease_until>clock_timestamp()
       AND ($3::text IS NULL OR claimed_by=$3) FOR UPDATE`,
      [jobId, owner, claimedBy],
    );
    if (!held.rowCount) return false;
    await jobLive(db, owner, jobId);
    const choice = await assertJobAiProviderChoice(db, owner, jobId);
    if (choice.primary !== "chatgpt" || choice.fallback_to_default)
      return false;
    const changed = await db.query(
      `UPDATE ai_jobs j SET state='queued',claimed_by=NULL,lease_until=NULL,heartbeat_at=now()
       WHERE j.id=$1 AND j.user_id=$2 AND j.state='running' AND NOT j.cancel_requested
         AND j.lease_until>clock_timestamp() AND ($3::text IS NULL OR j.claimed_by=$3)
         AND j.runtime_lane IN ('background','overnight')
         AND NOT EXISTS(SELECT 1 FROM chatgpt_inference_operations operation
           LEFT JOIN chatgpt_inference_requests received ON received.id=operation.request_id
           WHERE operation.job_id=j.id AND operation.user_id=j.user_id
             AND operation.fallback_result_encrypted IS NULL
             AND (received.id IS NULL OR received.result_encrypted IS NULL))
       RETURNING j.id`,
      [jobId, owner, claimedBy],
    );
    if (changed.rowCount !== 1) return false;
    await db.query(
      `UPDATE items task SET agent_state='queued',agent_result=NULL,updated_at=now()
       WHERE task.agent_job_id=$1 AND task.agent_state='working'
         AND EXISTS(SELECT 1 FROM agent_grants owner_grant WHERE owner_grant.id=task.agent_grant_id AND owner_grant.user_id=$2)`,
      [jobId, owner],
    );
    return true;
  });
}

/** Claim is owned by the exact enrolled session and never steals another device's work. */
export async function claimChatgptInference(
  session: Session,
  executorId: string,
): Promise<ChatgptInferenceAssignment | null> {
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    const enrollment = (
      await db.query(
        "SELECT connection_id,session_id FROM chatgpt_executor_enrollments WHERE id=$1",
        [executorId],
      )
    ).rows[0];
    if (!enrollment || enrollment.session_id !== session.sessionId)
      fail(404, "This ChatGPT executor is unavailable.");
    await providerLive(db, session.userId, {
      executor_id: executorId,
      connection_id: enrollment.connection_id,
    });
    const selected = await device(db, session.userId, {
      executor_id: executorId,
      connection_id: enrollment.connection_id,
    });
    let request = (
      await db.query(
        "SELECT * FROM chatgpt_inference_requests WHERE executor_id=$1 AND user_id=$2 AND state='queued' AND expires_at>clock_timestamp() ORDER BY created_at,id LIMIT 1",
        [executorId, session.userId],
      )
    ).rows[0];
    if (!request) return null;
    // Parent/source/job authority always precedes the physical envelope lock.
    await jobLive(db, session.userId, request.job_id);
    request = (
      await db.query(
        "SELECT * FROM chatgpt_inference_requests WHERE id=$1 AND executor_id=$2 AND user_id=$3 AND state='queued' AND expires_at>clock_timestamp() FOR UPDATE SKIP LOCKED",
        [request.id, executorId, session.userId],
      )
    ).rows[0];
    if (!request) return null;
    if (request.provider_choice_version === null)
      fail(409, "This ChatGPT request has no current provider consent.");
    await providerLive(
      db,
      session.userId,
      {
        executor_id: executorId,
        connection_id: enrollment.connection_id,
      },
      Number(request.provider_choice_version),
    );
    if (
      String(request.enrollment_epoch) !== String(selected.row.epoch) ||
      String(request.lease_epoch) !== String(selected.row.lease_epoch)
    )
      fail(409, "The ChatGPT executor lease changed.");
    await jobLive(db, session.userId, request.job_id);
    const payload = chatgptInferenceInput.parse(
      JSON.parse(await decryptSecret(request.payload_encrypted)),
    );
    if (
      digest({
        binding: selected.catalog.binding,
        model: request.model,
        payload,
        job_id: request.job_id,
      }) !== request.request_hash
    )
      fail(409, "The ChatGPT request changed.");
    if (payload.max_output_tokens !== undefined) {
      await readChatgptCatalogLocked(
        db,
        session,
        {
          executor_id: executorId,
          connection_id: enrollment.connection_id,
        },
        false,
        true,
        true,
      );
    }
    if (!selected.catalog.models.some((m) => m.slug === request.model))
      fail(409, "The assigned ChatGPT model is unavailable.");
    const claimed = await db.query(
      "UPDATE chatgpt_inference_requests SET state='claimed',claimed_at=now() WHERE id=$1 AND state='queued' AND expires_at>clock_timestamp() RETURNING id",
      [request.id],
    );
    if (!claimed.rowCount)
      fail(409, "The ChatGPT request expired before it was claimed.");
    return chatgptInferenceAssignment.parse({
      id: request.id,
      job_id: request.job_id,
      executor_id: executorId,
      binding: selected.catalog.binding,
      enrollment_epoch: Number(request.enrollment_epoch),
      lease_epoch: Number(request.lease_epoch),
      model: request.model,
      nonce: request.nonce,
      request_hash: request.request_hash,
      expires_at: request.expires_at.toISOString(),
      payload,
    });
  });
}

/** A replay, stale lease, account change or revoked source cannot publish a result. */
export async function finishChatgptInference(session: Session, value: unknown) {
  const publication = chatgptInferencePublication.parse(value),
    r = publication.receipt;
  if (Buffer.byteLength(JSON.stringify(r.result)) > 4 * 1024 * 1024)
    fail(400, "The ChatGPT reply exceeded its size limit.");
  const encrypted = await encryptSecret(JSON.stringify(r.result));
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    await providerLive(db, session.userId, {
      executor_id: r.executor_id,
      connection_id: r.binding.connection_id,
    });
    const selected = await device(db, session.userId, {
      executor_id: r.executor_id,
      connection_id: r.binding.connection_id,
    });
    if (
      selected.session.sessionId !== session.sessionId ||
      JSON.stringify(selected.catalog.binding) !== JSON.stringify(r.binding)
    )
      fail(404, "This ChatGPT executor is unavailable.");
    const candidate = (
      await db.query(
        "SELECT job_id FROM chatgpt_inference_requests WHERE id=$1 AND user_id=$2 AND executor_id=$3",
        [r.request_id, session.userId, r.executor_id],
      )
    ).rows[0];
    if (!candidate) fail(404, "This ChatGPT request is unavailable.");
    await jobLive(db, session.userId, candidate.job_id);
    const request = (
      await db.query(
        "SELECT * FROM chatgpt_inference_requests WHERE id=$1 AND user_id=$2 AND executor_id=$3 FOR UPDATE",
        [r.request_id, session.userId, r.executor_id],
      )
    ).rows[0];
    if (!request) fail(404, "This ChatGPT request is unavailable.");
    if (request.provider_choice_version === null)
      fail(409, "This ChatGPT request has no current provider consent.");
    await providerLive(
      db,
      session.userId,
      {
        executor_id: r.executor_id,
        connection_id: r.binding.connection_id,
      },
      Number(request.provider_choice_version),
    );
    if (
      request.state !== "claimed" ||
      request.expires_at.getTime() <= Date.now() ||
      request.model !== r.model ||
      request.nonce !== r.nonce ||
      request.request_hash !== r.request_hash ||
      Number(request.enrollment_epoch) !== r.enrollment_epoch ||
      Number(request.lease_epoch) !== r.lease_epoch ||
      String(selected.row.epoch) !== String(request.enrollment_epoch) ||
      String(selected.row.lease_epoch) !== String(request.lease_epoch)
    )
      fail(409, "The ChatGPT request or lease changed.");
    await jobLive(db, session.userId, request.job_id);
    try {
      verifyChatgptExecutorProof(
        selected.row.public_key,
        chatgptInferenceReceiptMessage(r),
        publication.signature,
      );
    } catch {
      fail(400, "The ChatGPT result signature is invalid.");
    }
    await db.query(
      "UPDATE chatgpt_inference_requests SET state=$2,result_encrypted=$3,finished_at=now(),payload_encrypted='' WHERE id=$1",
      [r.request_id, r.result.status, encrypted],
    );
    if (r.result.status === "completed")
      await recordCompletedChatgptUsage(
        db,
        session.userId,
        r.request_id,
        r.model,
        r.result.usage,
      );
    if (r.result.status === "completed") {
      const operation = (
        await db.query(
          "SELECT operation_id FROM chatgpt_inference_operations WHERE request_id=$1",
          [r.request_id],
        )
      ).rows[0];
      await recordProviderUse(
        session.userId,
        request.job_id,
        "chatgpt",
        r.model,
        false,
        "completed",
        operation?.operation_id,
        db,
      );
    }
    return { accepted: true };
  });
}

/** Runner polls only its own still-authorized job and never mistakes partial output for success. */
export async function readChatgptInference(
  owner: string,
  jobId: string,
  id: string,
) {
  return transaction(async (db) => {
    await jobLive(db, owner, jobId);
    return readChatgptInferenceLocked(db, owner, jobId, id);
  });
}
async function readChatgptInferenceLocked(
  db: Db,
  owner: string,
  jobId: string,
  id: string,
) {
  const row = (
    await db.query(
      "SELECT state,result_encrypted,expires_at,executor_id,connection_id,provider_choice_version FROM chatgpt_inference_requests WHERE id=$1 AND user_id=$2 AND job_id=$3 FOR UPDATE",
      [id, owner, jobId],
    )
  ).rows[0];
  if (!row) fail(404, "This ChatGPT request is unavailable.");
  if (row.provider_choice_version === null)
    fail(409, "This ChatGPT request has no current provider consent.");
  await providerLive(db, owner, row, Number(row.provider_choice_version));
  if (row.result_encrypted)
    return chatgptInferenceResult.parse(
      JSON.parse(await decryptSecret(row.result_encrypted)),
    );
  if (row.state === "queued" && row.expires_at.getTime() <= Date.now()) {
    const unavailable = chatgptInferenceResult.parse({
      status: "failed",
      reason: "unavailable",
      phase: "admission",
      http_status: null,
      provider_code: null,
    });
    const encrypted = await encryptSecret(JSON.stringify(unavailable));
    await db.query(
      "UPDATE chatgpt_inference_requests SET state='failed',result_encrypted=$2,payload_encrypted='',finished_at=now() WHERE id=$1",
      [id, encrypted],
    );
    return unavailable;
  }
  if (row.state === "cancelled" || row.expires_at.getTime() <= Date.now())
    fail(503, "The ChatGPT request did not complete in time.");
  return null;
}
export async function cancelChatgptInference(owner: string, id: string) {
  return transaction((db) =>
    db.query(
      "UPDATE chatgpt_inference_requests SET state='cancelled',payload_encrypted='' WHERE id=$1 AND user_id=$2 AND state IN ('queued','claimed')",
      [id, owner],
    ),
  );
}
