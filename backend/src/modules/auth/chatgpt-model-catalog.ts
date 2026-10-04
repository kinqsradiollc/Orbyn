import {
  chatgptCatalogSelection,
  chatgptCatalogRead,
  chatgptCatalogDefaultUpdate,
  chatgptModelBinding,
  chatgptModelPreference,
  chatgptExecutorList,
  fail,
} from "@orbyn/core";
import { transaction, type Db } from "../../db/pool.js";
import {
  requireLiveSession,
  writeChatgptModelPreferenceLocked,
} from "./chatgpt-connections.js";

type Session = { userId: string; sessionId: string };
type Selection = import("zod").output<typeof chatgptCatalogSelection>;

/** Discover only this person's registrations with an unexpired owning device session. */
export async function listChatgptExecutors(session: Session) {
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    const result = await db.query(
      `SELECT e.id AS executor_id,e.connection_id,e.host_id
       FROM chatgpt_executor_enrollments e
       JOIN chatgpt_identity_connections c ON c.id=e.connection_id
       JOIN sessions s ON s.id=e.session_id AND s.user_id=c.user_id
       WHERE c.user_id=$1 AND c.revoked_at IS NULL
         AND s.expires_at>clock_timestamp()
       ORDER BY c.verified_at DESC,e.enrolled_at DESC,e.id LIMIT 1000`,
      [session.userId],
    );
    await requireLiveSession(db, session);
    return chatgptExecutorList.parse(result.rows);
  });
}

/** Connection locks serialize catalog/default decisions with publication and revocation. */
export async function readChatgptCatalogLocked(
  db: Db,
  session: Session,
  selection: Selection,
  write = false,
) {
  // Lock the device session before its cascading children, matching sign-out.
  const device = (
    await db.query<{ session_id: string }>(
      "SELECT e.session_id FROM chatgpt_executor_enrollments e JOIN chatgpt_identity_connections c ON c.id=e.connection_id WHERE e.id=$1 AND c.id=$2 AND c.user_id=$3 AND c.revoked_at IS NULL",
      [selection.executor_id, selection.connection_id, session.userId],
    )
  ).rows[0];
  if (!device) fail(404, "That ChatGPT executor is not available.");
  const deviceSession = await db.query(
    "SELECT id FROM sessions WHERE id=$1 AND user_id=$2 FOR SHARE",
    [device.session_id, session.userId],
  );
  if (!deviceSession.rowCount)
    fail(404, "That ChatGPT executor is not available.");
  const connection = (
    await db.query<{ issuer: string; subject: string; client_id: string }>(
      `SELECT issuer,subject,client_id FROM chatgpt_identity_connections WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL FOR ${write ? "UPDATE" : "SHARE"}`,
      [selection.connection_id, session.userId],
    )
  ).rows[0];
  if (!connection) fail(404, "That ChatGPT connection is not available.");
  const enrollment = (
    await db.query<{ epoch: string; session_id: string }>(
      "SELECT epoch,session_id FROM chatgpt_executor_enrollments WHERE id=$1 AND connection_id=$2 FOR SHARE",
      [selection.executor_id, selection.connection_id],
    )
  ).rows[0];
  if (!enrollment) fail(404, "That ChatGPT executor is not available.");
  if (enrollment.session_id !== device.session_id)
    fail(409, "The ChatGPT executor session changed. Reload its models.");
  const lease = (
    await db.query<{
      epoch: string;
      enrollment_epoch: string;
      session_id: string;
      expires_at: Date;
    }>(
      "SELECT epoch,enrollment_epoch,session_id,expires_at FROM chatgpt_executor_leases WHERE executor_id=$1 FOR SHARE",
      [selection.executor_id],
    )
  ).rows[0];
  const snapshot = (
    await db.query<{
      models: unknown;
      enrollment_epoch: string;
      lease_epoch: string;
      sequence: string;
      published_at: Date;
    }>(
      "SELECT models,enrollment_epoch,lease_epoch,sequence,published_at FROM chatgpt_executor_catalogs WHERE executor_id=$1 FOR SHARE",
      [selection.executor_id],
    )
  ).rows[0];
  // Evaluate freshness after every row lock, with the database's current clock.
  const fresh = (
    await db.query<{ live: boolean; fresh: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM chatgpt_executor_leases l JOIN sessions s ON s.id=l.session_id
       WHERE l.executor_id=$1 AND l.enrollment_epoch=$2 AND l.session_id=$3 AND s.user_id=$4
       AND l.expires_at>clock_timestamp() AND s.expires_at>clock_timestamp()) AS live,
       EXISTS(SELECT 1 FROM chatgpt_executor_catalogs c WHERE c.executor_id=$1
         AND c.enrollment_epoch=$2 AND c.lease_epoch=$5
         AND c.published_at>clock_timestamp()-interval '5 minutes') AS fresh`,
      [
        selection.executor_id,
        enrollment.epoch,
        enrollment.session_id,
        session.userId,
        lease?.epoch ?? null,
      ],
    )
  ).rows[0];
  const binding = chatgptModelBinding.parse({
    user_id: session.userId,
    connection_id: selection.connection_id,
    ...connection,
  });
  const preference = (
    await db.query<{ model: string | null; version: string }>(
      "SELECT model,version FROM chatgpt_model_preferences WHERE connection_id=$1",
      [selection.connection_id],
    )
  ).rows[0];
  return chatgptCatalogRead.parse({
    executor_id: selection.executor_id,
    binding,
    status: !snapshot
      ? "unavailable"
      : !fresh.live
        ? "offline"
        : !fresh.fresh
          ? "stale"
          : "ready",
    models: snapshot?.models ?? [],
    preference: {
      binding,
      model: preference?.model ?? null,
      version: preference ? Number(preference.version) : 0,
    },
    published_at: snapshot?.published_at.toISOString() ?? null,
    expires_at: lease?.expires_at.toISOString() ?? null,
    sequence: snapshot ? Number(snapshot.sequence) : 0,
  });
}

/** A reader's own session can inspect another owned device's sanitized catalog. */
export async function readChatgptModelCatalog(
  session: Session,
  value: unknown,
) {
  const selection = chatgptCatalogSelection.parse(value);
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    const result = await readChatgptCatalogLocked(db, session, selection);
    await requireLiveSession(db, session);
    return result;
  });
}

/** Atomic default CAS; availability is rechecked under the same connection lock. */
export async function selectChatgptDefaultModel(
  session: Session,
  value: unknown,
) {
  const input = chatgptCatalogDefaultUpdate.parse(value);
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    const current = await readChatgptCatalogLocked(
      db,
      session,
      input.selection,
      true,
    );
    if (
      JSON.stringify(input.preference.binding) !==
      JSON.stringify(current.binding)
    )
      fail(409, "The ChatGPT registration changed. Reload its models.");
    return writeChatgptModelPreferenceLocked(
      db,
      current.binding,
      input.preference.model,
      input.preference.version,
      async () => {
        await requireLiveSession(db, session);
        if (input.preference.model === null) return;
        const catalog = await readChatgptCatalogLocked(
          db,
          session,
          input.selection,
          true,
        );
        if (catalog.status !== "ready")
          fail(503, "Reconnect the ChatGPT executor before selecting a model.");
        if (
          !catalog.models.some((model) => model.slug === input.preference.model)
        )
          fail(
            409,
            "This model is no longer available to the selected account.",
          );
      },
    );
  });
}
