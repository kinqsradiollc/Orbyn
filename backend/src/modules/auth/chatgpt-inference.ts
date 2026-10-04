import { createHash, randomBytes } from "node:crypto";
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
import { readAiProviderChoice } from "./ai-provider-choice.js";
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
  const job = await db.query(
    `SELECT j.id FROM ai_jobs j JOIN users u ON u.id=j.user_id WHERE j.id=$2 AND j.user_id=$1 AND NOT u.disabled AND j.state='running' AND j.lease_until>clock_timestamp() AND ${assistantJobSourcesVisible("j", "$1", false)}`,
    [owner, id],
  );
  if (!job.rowCount) fail(409, "The assistant job or its sources changed.");
}
async function device(db: Db, owner: string, selection: Selection) {
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
) {
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
    const { row, catalog } = await device(db, owner, selection);
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
    return {
      id: result.id as string,
      expires_at: result.expires_at.toISOString() as string,
    };
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
    const request = (
      await db.query(
        "SELECT * FROM chatgpt_inference_requests WHERE executor_id=$1 AND user_id=$2 AND state='queued' AND expires_at>clock_timestamp() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
        [executorId, session.userId],
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
    const row = (
      await db.query(
        "SELECT state,result_encrypted,expires_at,executor_id,connection_id,provider_choice_version FROM chatgpt_inference_requests WHERE id=$1 AND user_id=$2 AND job_id=$3",
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
    if (row.state === "cancelled" || row.expires_at.getTime() <= Date.now())
      fail(503, "The ChatGPT request did not complete in time.");
    return null;
  });
}
export async function cancelChatgptInference(owner: string, id: string) {
  return transaction((db) =>
    db.query(
      "UPDATE chatgpt_inference_requests SET state='cancelled',payload_encrypted='' WHERE id=$1 AND user_id=$2 AND state IN ('queued','claimed')",
      [id, owner],
    ),
  );
}
