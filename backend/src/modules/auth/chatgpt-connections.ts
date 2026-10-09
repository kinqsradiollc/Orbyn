import { randomBytes, randomUUID } from "node:crypto";
import {
  chatgptModelBinding,
  chatgptModelPreference,
  chatgptExecutorStart,
  chatgptExecutorChallenge,
  chatgptExecutorFinish,
  chatgptConnectionRefreshIdentity,
  chatgptConnection,
  fail,
} from "@orbyn/core";
import {
  parseChatgptExecutorKey,
  verifyChatgptExecutorProof,
} from "./chatgpt-executor-proof.js";
import { pool, transaction, type Db } from "../../db/pool.js";
import {
  createOpenAiIdentityVerifier,
  createOpenAiRefreshIdentityVerifier,
  type VerifiedOpenAiIdentity,
} from "./openai-identity.js";

type SessionBinding = { userId: string; sessionId: string };
type Challenge = {
  id: string;
  nonce: string;
  expected_client_id: string | null;
  expires_at: Date;
  consumed_at: Date | null;
};
const verifyIdentity = createOpenAiIdentityVerifier();
const verifyRefreshIdentity = createOpenAiRefreshIdentityVerifier();

/** Enroll a public device key only after an exact-session, one-time proof. */
export async function beginChatgptExecutorEnrollment(
  session: SessionBinding,
  value: unknown,
) {
  const input = chatgptExecutorStart.parse(value);
  let fingerprint: string;
  try {
    fingerprint = parseChatgptExecutorKey(input.public_key).fingerprint;
  } catch {
    fail(400, "The executor proof could not be verified.");
  }
  return transaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      session.userId,
    ]);
    await requireLiveSession(db, session);
    const connection = (
      await db.query<{ issuer: string; subject: string; client_id: string }>(
        "SELECT issuer,subject,client_id FROM chatgpt_identity_connections WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE",
        [input.connection_id, session.userId],
      )
    ).rows[0];
    if (!connection) fail(404, "That ChatGPT connection is not available.");
    const pending = (
      await db.query<{ count: string }>(
        "SELECT count(*) FROM chatgpt_executor_challenges WHERE user_id=$1 AND consumed_at IS NULL AND expires_at>now()",
        [session.userId],
      )
    ).rows[0];
    if (Number(pending.count) >= 5)
      fail(429, "Finish or wait for an existing executor enrollment.");
    const current = (
      await db.query<{ id: string; epoch: string }>(
        "SELECT id,epoch FROM chatgpt_executor_enrollments WHERE connection_id=$1 AND host_id=$2",
        [input.connection_id, input.host_id],
      )
    ).rows[0];
    const epoch = current ? Number(current.epoch) : 0;
    if (!Number.isSafeInteger(epoch + 1))
      fail(409, "This executor registration cannot be renewed.");
    if (!current) {
      const hosts = (
        await db.query<{ count: string }>(
          "SELECT count(*) FROM chatgpt_executor_enrollments WHERE connection_id=$1",
          [input.connection_id],
        )
      ).rows[0];
      if (Number(hosts.count) >= 20)
        fail(
          429,
          "Remove an existing executor before enrolling another device.",
        );
    }
    const binding = chatgptModelBinding.parse({
      user_id: session.userId,
      connection_id: input.connection_id,
      ...connection,
    });
    const id = randomUUID();
    const message = JSON.stringify([
      "orbyn:executor:enroll:v1",
      id,
      session.sessionId,
      binding,
      input.host_id,
      fingerprint,
      epoch,
      current?.id ?? null,
      randomBytes(32).toString("base64url"),
    ]);
    await requireLiveSession(db, session);
    const row = (
      await db.query<{ expires_at: Date }>(
        `INSERT INTO chatgpt_executor_challenges(id,user_id,session_id,connection_id,host_id,public_key,public_key_fingerprint,expected_epoch,proof_message,expected_enrollment_id,device_type,device_name)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING expires_at`,
        [
          id,
          session.userId,
          session.sessionId,
          input.connection_id,
          input.host_id,
          input.public_key,
          fingerprint,
          epoch,
          message,
          current?.id ?? null,
          input.device?.type ?? null,
          input.device?.name ?? null,
        ],
      )
    ).rows[0];
    return chatgptExecutorChallenge.parse({
      id,
      binding,
      host_id: input.host_id,
      public_key_fingerprint: fingerprint,
      proof_message: message,
      expires_at: row.expires_at.toISOString(),
    });
  });
}

/** Persist proof completion and consume its challenge in the same transaction. */
export async function finishChatgptExecutorEnrollment(
  session: SessionBinding,
  value: unknown,
) {
  const input = chatgptExecutorFinish.parse(value);
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    // Discover the parent, then lock it before the challenge to match disconnect ordering.
    const parent = (
      await db.query<{ connection_id: string }>(
        "SELECT connection_id FROM chatgpt_executor_challenges WHERE id=$1 AND user_id=$2 AND session_id=$3",
        [input.challenge_id, session.userId, session.sessionId],
      )
    ).rows[0];
    if (!parent) fail(404, "That executor enrollment is not available.");
    const connection = (
      await db.query<{ issuer: string; subject: string; client_id: string }>(
        "SELECT issuer,subject,client_id FROM chatgpt_identity_connections WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE",
        [parent.connection_id, session.userId],
      )
    ).rows[0];
    if (!connection) fail(404, "That ChatGPT connection is not available.");
    const challenge = (
      await db.query<{
        host_id: string;
        public_key: string;
        public_key_fingerprint: string;
        expected_epoch: string;
        expected_enrollment_id: string | null;
        device_type: "desktop" | "ios" | "android" | null;
        device_name: string | null;
        proof_message: string;
        consumed_at: Date | null;
        expired: boolean;
      }>(
        "SELECT host_id,public_key,public_key_fingerprint,expected_epoch,expected_enrollment_id,device_type,device_name,proof_message,consumed_at,expires_at<=clock_timestamp() AS expired FROM chatgpt_executor_challenges WHERE id=$1 AND user_id=$2 AND session_id=$3 FOR UPDATE",
        [input.challenge_id, session.userId, session.sessionId],
      )
    ).rows[0];
    if (!challenge || challenge.consumed_at || challenge.expired)
      fail(409, "Start a fresh executor enrollment.");
    let fingerprint: string;
    try {
      fingerprint = verifyChatgptExecutorProof(
        challenge.public_key,
        challenge.proof_message,
        input.signature,
      );
    } catch {
      fail(400, "The executor proof could not be verified.");
    }
    if (fingerprint !== challenge.public_key_fingerprint)
      fail(400, "The executor proof could not be verified.");
    const current = (
      await db.query<{ id: string; epoch: string }>(
        "SELECT id,epoch FROM chatgpt_executor_enrollments WHERE connection_id=$1 AND host_id=$2",
        [parent.connection_id, challenge.host_id],
      )
    ).rows[0];
    const epoch = current ? Number(current.epoch) : 0;
    if (
      epoch !== Number(challenge.expected_epoch) ||
      (current?.id ?? null) !== challenge.expected_enrollment_id ||
      !Number.isSafeInteger(epoch + 1)
    )
      fail(409, "The executor registration changed. Start a fresh enrollment.");
    if (!current) {
      const hosts = (
        await db.query<{ count: string }>(
          "SELECT count(*) FROM chatgpt_executor_enrollments WHERE connection_id=$1",
          [parent.connection_id],
        )
      ).rows[0];
      if (Number(hosts.count) >= 20)
        fail(
          429,
          "Remove an existing executor before enrolling another device.",
        );
    }
    await requireLiveSession(db, session);
    const enrollment = (
      await db.query<{ id: string }>(
        `INSERT INTO chatgpt_executor_enrollments(connection_id,host_id,session_id,public_key,public_key_fingerprint,epoch,device_type,device_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(connection_id,host_id) DO UPDATE SET session_id=EXCLUDED.session_id,public_key=EXCLUDED.public_key,public_key_fingerprint=EXCLUDED.public_key_fingerprint,epoch=EXCLUDED.epoch,device_type=EXCLUDED.device_type,device_name=EXCLUDED.device_name,enrolled_at=now() RETURNING id`,
        [
          parent.connection_id,
          challenge.host_id,
          session.sessionId,
          challenge.public_key,
          fingerprint,
          epoch + 1,
          challenge.device_type,
          challenge.device_name,
        ],
      )
    ).rows[0];
    await db.query(
      "UPDATE chatgpt_executor_challenges SET consumed_at=now() WHERE id=$1",
      [input.challenge_id],
    );
    return {
      id: enrollment.id,
      binding: chatgptModelBinding.parse({
        user_id: session.userId,
        connection_id: parent.connection_id,
        ...connection,
      }),
      host_id: challenge.host_id,
      public_key_fingerprint: fingerprint,
      enrollment_epoch: epoch + 1,
    };
  });
}

/** Lock and recheck a live first-party session using current wall-clock time. */
export async function requireLiveSession(db: Db, binding: SessionBinding) {
  // Account restrictions can change while a remote proof is being checked.
  // Lock the parent before its session, matching sign-out/admin lock ordering.
  const person = (
    await db.query<{ disabled: boolean; email_verified: boolean }>(
      "SELECT disabled,email_verified FROM users WHERE id=$1 FOR SHARE",
      [binding.userId],
    )
  ).rows[0];
  if (!person) fail(401, "Sign in to Orbyn before connecting ChatGPT.");
  if (person.disabled || !person.email_verified)
    fail(403, "This Orbyn account cannot connect ChatGPT.");
  const live = await db.query(
    "SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND expires_at>clock_timestamp() FOR SHARE",
    [binding.sessionId, binding.userId],
  );
  if (!live.rowCount) fail(401, "Sign in to Orbyn before connecting ChatGPT.");
  // Recheck after lock acquisition: even clock_timestamp() may be evaluated
  // before waiting on a session row that another transaction only locked.
  const current = await db.query(
    "SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND expires_at>clock_timestamp()",
    [binding.sessionId, binding.userId],
  );
  if (!current.rowCount)
    fail(401, "Sign in to Orbyn before connecting ChatGPT.");
}

/** Start an OAuth nonce owned by this exact Orbyn session, not just its user. */
export async function beginChatgptConnection(
  binding: SessionBinding,
  expectedClientId?: string,
) {
  const clientId =
    expectedClientId === undefined
      ? null
      : chatgptModelBinding.shape.client_id.parse(expectedClientId);
  return transaction(async (db) => {
    // Serialize starts per owner so concurrent attempts cannot bypass the cap.
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      binding.userId,
    ]);
    await requireLiveSession(db, binding);
    const count = await db.query<{ count: string }>(
      "SELECT count(*) FROM chatgpt_identity_challenges WHERE user_id=$1 AND consumed_at IS NULL AND expires_at>now()",
      [binding.userId],
    );
    if (Number(count.rows[0].count) >= 5)
      fail(429, "Finish or wait for an existing ChatGPT sign-in attempt.");
    const nonce = randomBytes(32).toString("base64url");
    const row = (
      await db.query<Challenge>(
        `INSERT INTO chatgpt_identity_challenges(user_id,session_id,nonce,expected_client_id)
      VALUES($1,$2,$3,$4) RETURNING id,nonce,expected_client_id,expires_at,consumed_at`,
        [binding.userId, binding.sessionId, nonce, clientId],
      )
    ).rows[0];
    return {
      id: row.id,
      nonce: row.nonce,
      expires_at: row.expires_at.toISOString(),
    };
  });
}

/** Verify outside the transaction, then atomically link and consume the challenge. */
export async function finishChatgptConnection(
  binding: SessionBinding,
  input: { challengeId: string; clientId: string; idToken: string },
  verifier: (
    token: string,
    expected: { clientId: string; nonce: string },
  ) => Promise<VerifiedOpenAiIdentity> = verifyIdentity,
) {
  const clientId = chatgptModelBinding.shape.client_id.parse(input.clientId);
  const challenge = (
    await pool.query<Challenge>(
      `SELECT id,nonce,expected_client_id,expires_at,consumed_at FROM chatgpt_identity_challenges
    WHERE id=$1 AND user_id=$2 AND session_id=$3`,
      [input.challengeId, binding.userId, binding.sessionId],
    )
  ).rows[0];
  if (!challenge) fail(404, "That ChatGPT sign-in attempt is not available.");
  if (challenge.consumed_at || challenge.expires_at.getTime() <= Date.now())
    fail(409, "Start a fresh ChatGPT sign-in attempt.");
  if (challenge.expected_client_id && challenge.expected_client_id !== clientId)
    fail(
      409,
      "The ChatGPT registration changed. Start a fresh sign-in attempt.",
    );
  let identity: VerifiedOpenAiIdentity;
  try {
    identity = await verifier(input.idToken, {
      clientId,
      nonce: challenge.nonce,
    });
  } catch {
    fail(400, "ChatGPT identity could not be verified.");
  }
  if (
    identity.issuer !== "https://auth.openai.com" ||
    identity.clientId !== clientId ||
    !identity.subject ||
    identity.subject.length > 512
  )
    fail(400, "ChatGPT identity could not be verified.");
  return transaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR KEY SHARE", [
      binding.userId,
    ]);
    await requireLiveSession(db, binding);
    const available = (
      await db.query<{ available: boolean }>(
        `SELECT consumed_at IS NULL AND expires_at>now() AS available
      FROM chatgpt_identity_challenges WHERE id=$1 AND user_id=$2 AND session_id=$3 FOR UPDATE`,
        [input.challengeId, binding.userId, binding.sessionId],
      )
    ).rows[0];
    if (!available?.available)
      fail(409, "Start a fresh ChatGPT sign-in attempt.");
    const connection = (
      await db.query<{ id: string }>(
        `INSERT INTO chatgpt_identity_connections(user_id,issuer,subject,client_id)
      VALUES($1,$2,$3,$4) ON CONFLICT(issuer,subject,client_id) DO UPDATE SET verified_at=now(),revoked_at=NULL
      WHERE chatgpt_identity_connections.user_id=EXCLUDED.user_id RETURNING id`,
        [binding.userId, identity.issuer, identity.subject, identity.clientId],
      )
    ).rows[0];
    if (!connection)
      fail(409, "That ChatGPT identity is linked to another Orbyn account.");
    await db.query(
      "UPDATE chatgpt_identity_challenges SET consumed_at=now() WHERE id=$1",
      [input.challengeId],
    );
    return {
      id: connection.id,
      issuer: identity.issuer,
      subject: identity.subject,
      client_id: identity.clientId,
    };
  });
}

/** Read only this signed-in person's verified, currently connected registrations. */
export async function listChatgptConnections(binding: SessionBinding) {
  return transaction(async (db) => {
    await requireLiveSession(db, binding);
    return (
      await db.query<{
        id: string;
        issuer: string;
        subject: string;
        client_id: string;
        verified_at: Date;
      }>(
        `SELECT id,issuer,subject,client_id,verified_at FROM chatgpt_identity_connections
         WHERE user_id=$1 AND revoked_at IS NULL ORDER BY verified_at DESC,id`,
        [binding.userId],
      )
    ).rows.map((row) => ({
      ...row,
      verified_at: row.verified_at.toISOString(),
    }));
  });
}

/** Read an owner-bound preference without exposing or receiving provider credentials. */
export async function readChatgptModelPreference(
  binding: SessionBinding,
  connectionId: string,
) {
  const id = chatgptModelBinding.shape.connection_id.parse(connectionId);
  return transaction(async (db) => {
    await requireLiveSession(db, binding);
    const connection = (
      await db.query<{ issuer: string; subject: string; client_id: string }>(
        `SELECT issuer,subject,client_id FROM chatgpt_identity_connections
       WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL FOR SHARE`,
        [id, binding.userId],
      )
    ).rows[0];
    if (!connection) fail(404, "That ChatGPT connection is not available.");
    const saved = (
      await db.query<{ model: string | null; version: string }>(
        "SELECT model,version FROM chatgpt_model_preferences WHERE connection_id=$1",
        [id],
      )
    ).rows[0];
    return chatgptModelPreference.parse({
      binding: { user_id: binding.userId, connection_id: id, ...connection },
      model: saved?.model ?? null,
      version: saved ? Number(saved.version) : 0,
    });
  });
}

/** Private writer: catalog validation must come from the trusted executor adapter, never request data. */
export async function saveChatgptModelPreference(
  session: SessionBinding,
  value: unknown,
  requireAvailableModel: (
    binding: import("@orbyn/core").ChatgptModelBinding,
    model: string,
  ) => Promise<void>,
) {
  const input = chatgptModelPreference.parse(value);
  const previous = await readChatgptModelPreference(
    session,
    input.binding.connection_id,
  );
  if (JSON.stringify(previous.binding) !== JSON.stringify(input.binding))
    fail(409, "The ChatGPT registration changed. Reload its models.");
  if (previous.version !== input.version)
    fail(409, "The default model changed. Reload and try again.");
  if (typeof requireAvailableModel !== "function")
    fail(503, "The ChatGPT model catalog is unavailable.");
  if (input.model !== null)
    await requireAvailableModel(
      Object.freeze({ ...previous.binding }),
      input.model,
    );
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    const connection = (
      await db.query<{ issuer: string; subject: string; client_id: string }>(
        `SELECT issuer,subject,client_id FROM chatgpt_identity_connections
       WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE`,
        [input.binding.connection_id, session.userId],
      )
    ).rows[0];
    if (!connection) fail(404, "That ChatGPT connection is not available.");
    const binding = chatgptModelBinding.parse({
      user_id: session.userId,
      connection_id: input.binding.connection_id,
      ...connection,
    });
    if (JSON.stringify(binding) !== JSON.stringify(input.binding))
      fail(409, "The ChatGPT registration changed. Reload its models.");
    await requireLiveSession(db, session);
    return writeChatgptModelPreferenceLocked(
      db,
      binding,
      input.model,
      input.version,
    );
  });
}

/** Disconnect and fence sign-in attempts already in flight before this decision. */
export async function revokeChatgptConnection(
  binding: SessionBinding,
  id: string,
) {
  return transaction(async (db) => {
    // Match sign-in's parent-first order. Completion holds KEY SHARE on this row,
    // so either it finishes before revocation or sees its challenge consumed.
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      binding.userId,
    ]);
    await requireLiveSession(db, binding);
    const result = await db.query(
      `UPDATE chatgpt_identity_connections SET revoked_at=coalesce(revoked_at,now())
       WHERE id=$1 AND user_id=$2 RETURNING id`,
      [id, binding.userId],
    );
    if (!result.rowCount)
      fail(404, "That ChatGPT connection is not available.");
    await db.query(
      "UPDATE chatgpt_executor_challenges SET consumed_at=now() WHERE connection_id=$1 AND consumed_at IS NULL",
      [id],
    );
    await db.query(
      "DELETE FROM chatgpt_executor_enrollments WHERE connection_id=$1",
      [id],
    );
    await db.query(
      `UPDATE chatgpt_identity_challenges SET consumed_at=now()
       WHERE user_id=$1 AND consumed_at IS NULL`,
      [binding.userId],
    );
  });
}

/** Internal writer: caller must hold the owned connection lock and validate availability. */
export async function writeChatgptModelPreferenceLocked(
  db: Db,
  binding: import("@orbyn/core").ChatgptModelBinding,
  model: string | null,
  expectedVersion: number,
  requireAvailable?: () => Promise<void>,
) {
  const current = (
    await db.query<{ version: string }>(
      "SELECT version FROM chatgpt_model_preferences WHERE connection_id=$1",
      [binding.connection_id],
    )
  ).rows[0];
  const version = current ? Number(current.version) : 0;
  if (version !== expectedVersion || !Number.isSafeInteger(version + 1))
    fail(409, "The default model changed. Reload and try again.");
  if (requireAvailable) await requireAvailable();
  const saved = (
    await db.query<{ model: string | null; version: string }>(
      `INSERT INTO chatgpt_model_preferences(connection_id,model,version) VALUES($1,$2,$3)
       ON CONFLICT(connection_id) DO UPDATE SET model=EXCLUDED.model,version=EXCLUDED.version,updated_at=now()
       RETURNING model,version`,
      [binding.connection_id, model, version + 1],
    )
  ).rows[0];
  return chatgptModelPreference.parse({
    binding,
    model: saved.model,
    version: Number(saved.version),
  });
}

/** Verify refreshed ID proof against a live owned registration; cannot create, revive or alter identity. */
export async function verifyChatgptConnectionRefreshIdentity(
  binding: SessionBinding,
  value: unknown,
  verifier = verifyRefreshIdentity,
) {
  const input = chatgptConnectionRefreshIdentity.parse(value);
  const read = async (db: Db) => {
    await requireLiveSession(db, binding);
    const row = (
      await db.query<{
        id: string;
        issuer: string;
        subject: string;
        client_id: string;
      }>(
        `SELECT id,issuer,subject,client_id FROM chatgpt_identity_connections
       WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL FOR SHARE`,
        [input.connection_id, binding.userId],
      )
    ).rows[0];
    if (!row) fail(404, "That ChatGPT connection is not available.");
    return chatgptConnection.parse(row);
  };
  const original = await transaction(read);
  let identity: VerifiedOpenAiIdentity;
  try {
    identity = await verifier(input.id_token, {
      clientId: original.client_id,
      subject: original.subject,
    });
  } catch {
    fail(400, "The refreshed ChatGPT identity could not be verified.");
  }
  if (
    identity.issuer !== original.issuer ||
    identity.subject !== original.subject ||
    identity.clientId !== original.client_id
  )
    fail(400, "The refreshed ChatGPT identity could not be verified.");
  return transaction(async (db) => {
    const live = await read(db);
    if (JSON.stringify(live) !== JSON.stringify(original))
      fail(409, "The ChatGPT registration changed. Reconnect this account.");
    return live;
  });
}
