import { randomBytes, randomUUID } from "node:crypto";
import {
  chatgptLeaseStart,
  chatgptLeaseChallenge,
  chatgptLeaseFinish,
  chatgptExecutorLease,
  chatgptLeaseRenewal,
  chatgptLeaseHeartbeatMessage,
  chatgptCatalogPublication,
  chatgptModelBinding,
  fail,
} from "@orbyn/core";
import { transaction, type Db } from "../../db/pool.js";
import { requireLiveSession } from "./chatgpt-connections.js";
import {
  verifyChatgptExecutorProof,
  verifyChatgptCatalogProof,
} from "./chatgpt-executor-proof.js";

type Session = { userId: string; sessionId: string };
type Enrollment = {
  id: string;
  connection_id: string;
  epoch: string;
  public_key: string;
  public_key_fingerprint: string;
  session_id: string;
};
type Lease = {
  epoch: string;
  enrollment_epoch: string;
  session_id: string;
  heartbeat_sequence: string;
  expires_at: Date;
};

/** Lock connection before enrollment/lease, matching key renewal and disconnect. */
async function lockExecutor(db: Db, session: Session, id: string) {
  const parent = (
    await db.query<{ connection_id: string }>(
      `SELECT e.connection_id FROM chatgpt_executor_enrollments e
     JOIN chatgpt_identity_connections c ON c.id=e.connection_id
     WHERE e.id=$1 AND c.user_id=$2 AND c.revoked_at IS NULL`,
      [id, session.userId],
    )
  ).rows[0];
  if (!parent) fail(404, "That ChatGPT executor is not available.");
  const connection = (
    await db.query<{ issuer: string; subject: string; client_id: string }>(
      "SELECT issuer,subject,client_id FROM chatgpt_identity_connections WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE",
      [parent.connection_id, session.userId],
    )
  ).rows[0];
  if (!connection) fail(404, "That ChatGPT executor is not available.");
  const enrollment = (
    await db.query<Enrollment>(
      "SELECT * FROM chatgpt_executor_enrollments WHERE id=$1 AND connection_id=$2 AND session_id=$3 FOR UPDATE",
      [id, parent.connection_id, session.sessionId],
    )
  ).rows[0];
  if (!enrollment) fail(404, "That ChatGPT executor is not available.");
  const binding = chatgptModelBinding.parse({
    user_id: session.userId,
    connection_id: parent.connection_id,
    ...connection,
  });
  return { enrollment, binding };
}

async function savedLease(db: Db, id: string) {
  return (
    await db.query<Lease>(
      "SELECT * FROM chatgpt_executor_leases WHERE executor_id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
}

async function requireLease(
  db: Db,
  session: Session,
  enrollment: Enrollment,
  epoch: number,
) {
  const lease = await savedLease(db, enrollment.id);
  if (
    !lease ||
    Number(lease.epoch) !== epoch ||
    lease.enrollment_epoch !== enrollment.epoch ||
    lease.session_id !== session.sessionId
  )
    fail(409, "The ChatGPT executor lease changed. Reconnect it.");
  await requireLiveSession(db, session);
  const current = await db.query(
    "SELECT 1 FROM chatgpt_executor_leases WHERE executor_id=$1 AND expires_at>clock_timestamp()",
    [enrollment.id],
  );
  if (!current.rowCount)
    fail(409, "The ChatGPT executor lease expired. Reconnect it.");
  return lease;
}

/** Start a bounded one-use proof for the exact enrolled device/session. */
export async function beginChatgptExecutorLease(
  session: Session,
  value: unknown,
) {
  const input = chatgptLeaseStart.parse(value);
  return transaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      session.userId,
    ]);
    await requireLiveSession(db, session);
    const { enrollment, binding } = await lockExecutor(
      db,
      session,
      input.executor_id,
    );
    const pending = (
      await db.query<{ count: string }>(
        "SELECT count(*) FROM chatgpt_lease_challenges WHERE user_id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()",
        [session.userId],
      )
    ).rows[0];
    if (Number(pending.count) >= 5)
      fail(429, "Finish or wait for an existing executor lease proof.");
    const lease = await savedLease(db, enrollment.id);
    const epoch = lease ? Number(lease.epoch) : 0;
    if (!Number.isSafeInteger(epoch + 1))
      fail(409, "This executor lease cannot be renewed.");
    const id = randomUUID();
    const message = JSON.stringify([
      "orbyn:executor:lease-claim:v1",
      id,
      session.sessionId,
      binding,
      enrollment.id,
      Number(enrollment.epoch),
      epoch,
      randomBytes(32).toString("base64url"),
    ]);
    await requireLiveSession(db, session);
    const row = (
      await db.query<{ expires_at: Date }>(
        `INSERT INTO chatgpt_lease_challenges(id,user_id,session_id,executor_id,enrollment_epoch,expected_lease_epoch,proof_message)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING expires_at`,
        [
          id,
          session.userId,
          session.sessionId,
          enrollment.id,
          enrollment.epoch,
          epoch,
          message,
        ],
      )
    ).rows[0];
    return chatgptLeaseChallenge.parse({
      id,
      executor_id: enrollment.id,
      binding,
      enrollment_epoch: Number(enrollment.epoch),
      expected_lease_epoch: epoch,
      proof_message: message,
      expires_at: row.expires_at.toISOString(),
    });
  });
}

/** Claim increments the lease generation atomically; competing proofs cannot both win. */
export async function finishChatgptExecutorLease(
  session: Session,
  value: unknown,
) {
  const input = chatgptLeaseFinish.parse(value);
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    const parent = (
      await db.query<{ executor_id: string }>(
        "SELECT executor_id FROM chatgpt_lease_challenges WHERE id=$1 AND user_id=$2 AND session_id=$3",
        [input.challenge_id, session.userId, session.sessionId],
      )
    ).rows[0];
    if (!parent) fail(404, "That executor lease proof is not available.");
    const { enrollment, binding } = await lockExecutor(
      db,
      session,
      parent.executor_id,
    );
    const challenge = (
      await db.query<{
        enrollment_epoch: string;
        expected_lease_epoch: string;
        proof_message: string;
        consumed_at: Date | null;
      }>("SELECT * FROM chatgpt_lease_challenges WHERE id=$1 FOR UPDATE", [
        input.challenge_id,
      ])
    ).rows[0];
    const live = await db.query(
      "SELECT 1 FROM chatgpt_lease_challenges WHERE id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()",
      [input.challenge_id],
    );
    if (!live.rowCount || challenge.enrollment_epoch !== enrollment.epoch)
      fail(409, "Start a fresh executor lease proof.");
    try {
      if (
        verifyChatgptExecutorProof(
          enrollment.public_key,
          challenge.proof_message,
          input.signature,
        ) !== enrollment.public_key_fingerprint
      )
        throw new Error();
    } catch {
      fail(400, "The executor proof could not be verified.");
    }
    const previous = await savedLease(db, enrollment.id);
    const epoch = previous ? Number(previous.epoch) : 0;
    if (
      epoch !== Number(challenge.expected_lease_epoch) ||
      !Number.isSafeInteger(epoch + 1)
    )
      fail(409, "The executor lease changed. Start a fresh proof.");
    await requireLiveSession(db, session);
    const fresh = await db.query(
      "SELECT 1 FROM chatgpt_lease_challenges WHERE id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()",
      [input.challenge_id],
    );
    if (!fresh.rowCount) fail(409, "Start a fresh executor lease proof.");
    const row = (
      await db.query<{ expires_at: Date }>(
        `INSERT INTO chatgpt_executor_leases(executor_id,enrollment_epoch,session_id,epoch,expires_at)
       VALUES($1,$2,$3,$4,clock_timestamp()+interval '2 minutes')
       ON CONFLICT(executor_id) DO UPDATE SET enrollment_epoch=EXCLUDED.enrollment_epoch,session_id=EXCLUDED.session_id,epoch=EXCLUDED.epoch,heartbeat_sequence=0,expires_at=EXCLUDED.expires_at RETURNING expires_at`,
        [enrollment.id, enrollment.epoch, session.sessionId, epoch + 1],
      )
    ).rows[0];
    await db.query(
      "UPDATE chatgpt_lease_challenges SET consumed_at=clock_timestamp() WHERE id=$1",
      [input.challenge_id],
    );
    return chatgptExecutorLease.parse({
      executor_id: enrollment.id,
      binding,
      enrollment_epoch: Number(enrollment.epoch),
      lease_epoch: epoch + 1,
      expires_at: row.expires_at.toISOString(),
    });
  });
}

/** Signed heartbeats extend only an unexpired current lease, once per sequence. */
export async function renewChatgptExecutorLease(
  session: Session,
  value: unknown,
) {
  const input = chatgptLeaseRenewal.parse(value);
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    const { enrollment, binding } = await lockExecutor(
      db,
      session,
      input.heartbeat.executor_id,
    );
    const lease = await requireLease(
      db,
      session,
      enrollment,
      input.heartbeat.lease_epoch,
    );
    if (input.heartbeat.sequence <= Number(lease.heartbeat_sequence))
      fail(409, "This executor heartbeat is stale.");
    try {
      verifyChatgptExecutorProof(
        enrollment.public_key,
        chatgptLeaseHeartbeatMessage(input.heartbeat),
        input.signature,
      );
    } catch {
      fail(400, "The executor proof could not be verified.");
    }
    await requireLiveSession(db, session);
    const row = (
      await db.query<{ expires_at: Date }>(
        "UPDATE chatgpt_executor_leases SET heartbeat_sequence=$2,expires_at=clock_timestamp()+interval '2 minutes' WHERE executor_id=$1 AND expires_at>clock_timestamp() RETURNING expires_at",
        [enrollment.id, input.heartbeat.sequence],
      )
    ).rows[0];
    if (!row) fail(409, "The ChatGPT executor lease expired. Reconnect it.");
    return chatgptExecutorLease.parse({
      executor_id: enrollment.id,
      binding,
      enrollment_epoch: Number(enrollment.epoch),
      lease_epoch: Number(lease.epoch),
      expires_at: row.expires_at.toISOString(),
    });
  });
}

/** Publish only signed bounded metadata through the exact live owning executor. */
export async function publishChatgptExecutorCatalog(
  session: Session,
  value: unknown,
) {
  const input = chatgptCatalogPublication.parse(value);
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    const { enrollment, binding } = await lockExecutor(
      db,
      session,
      input.catalog.executor_id,
    );
    await requireLease(db, session, enrollment, input.catalog.lease_epoch);
    if (JSON.stringify(binding) !== JSON.stringify(input.catalog.binding))
      fail(409, "The ChatGPT registration changed. Reload its models.");
    try {
      verifyChatgptCatalogProof(
        enrollment.public_key,
        input.catalog,
        input.signature,
      );
    } catch {
      fail(400, "The executor proof could not be verified.");
    }
    const previous = (
      await db.query<{ lease_epoch: string; sequence: string }>(
        "SELECT lease_epoch,sequence FROM chatgpt_executor_catalogs WHERE executor_id=$1 FOR UPDATE",
        [enrollment.id],
      )
    ).rows[0];
    if (
      previous &&
      Number(previous.lease_epoch) === input.catalog.lease_epoch &&
      Number(previous.sequence) >= input.catalog.sequence
    )
      fail(409, "This model catalog publication is stale.");
    await requireLease(db, session, enrollment, input.catalog.lease_epoch);
    const row = (
      await db.query<{ published_at: Date }>(
        `INSERT INTO chatgpt_executor_catalogs(executor_id,enrollment_epoch,lease_epoch,sequence,models,capabilities)
       SELECT $1,$2,$3,$4,$5,$6 FROM chatgpt_executor_leases WHERE executor_id=$1 AND expires_at>clock_timestamp() ON CONFLICT(executor_id) DO UPDATE SET enrollment_epoch=EXCLUDED.enrollment_epoch,lease_epoch=EXCLUDED.lease_epoch,sequence=EXCLUDED.sequence,models=EXCLUDED.models,capabilities=EXCLUDED.capabilities,published_at=clock_timestamp() RETURNING published_at`,
        [
          enrollment.id,
          enrollment.epoch,
          input.catalog.lease_epoch,
          input.catalog.sequence,
          JSON.stringify(input.catalog.models),
          JSON.stringify(input.catalog.capabilities ?? []),
        ],
      )
    ).rows[0];
    if (!row) fail(409, "The ChatGPT executor lease expired. Reconnect it.");
    return {
      executor_id: enrollment.id,
      lease_epoch: input.catalog.lease_epoch,
      sequence: input.catalog.sequence,
      published_at: row.published_at.toISOString(),
    };
  });
}
