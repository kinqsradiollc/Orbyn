import { fail } from "@orbyn/core";
import { transaction, type Db } from "../../db/pool.js";
type Binding = { userId: string; sessionId: string };
async function live(db: Db, b: Binding) {
  const row = await db.query(
    "SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.expires_at>clock_timestamp() AND NOT u.disabled AND u.email_verified FOR SHARE OF s,u",
    [b.sessionId, b.userId],
  );
  if (!row.rowCount) fail(401, "This Orbyn session is no longer available.");
  const current = await db.query(
    "SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.expires_at>clock_timestamp() AND NOT u.disabled AND u.email_verified",
    [b.sessionId, b.userId],
  );
  if (!current.rowCount)
    fail(401, "This Orbyn session is no longer available.");
}
/** A one-click request binds the initiating app session; the runtime claims it as the same person. */
export async function startChatgptConnectRequest(b: Binding) {
  return transaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [b.userId]);
    await live(db, b);
    const pending = await db.query(
      "SELECT count(*) FROM chatgpt_connect_requests WHERE user_id=$1 AND state IN ('pending','claimed') AND expires_at>now()",
      [b.userId],
    );
    if (Number(pending.rows[0].count) >= 5)
      fail(429, "Finish or wait for an existing ChatGPT connection.");
    const row = (
      await db.query(
        "INSERT INTO chatgpt_connect_requests(user_id,session_id) VALUES($1,$2) RETURNING id,expires_at",
        [b.userId, b.sessionId],
      )
    ).rows[0];
    return {
      id: row.id,
      expires_at: row.expires_at.toISOString(),
      launch_url: `orbyn://chatgpt?request=${row.id}`,
    };
  });
}
export async function readChatgptConnectRequest(b: Binding, id: string) {
  return transaction(async (db) => {
    await live(db, b);
    const row = (
      await db.query(
        "SELECT id,state,connection_id,expires_at FROM chatgpt_connect_requests WHERE id=$1 AND user_id=$2 AND session_id=$3",
        [id, b.userId, b.sessionId],
      )
    ).rows[0];
    if (!row) fail(404, "This ChatGPT connection request is not available.");
    return {
      ...row,
      state:
        ["pending", "claimed"].includes(row.state) &&
        row.expires_at.getTime() <= Date.now()
          ? "expired"
          : row.state,
      expires_at: row.expires_at.toISOString(),
    };
  });
}
export async function claimChatgptConnectRequest(b: Binding, id: string) {
  return transaction(async (db) => {
    await live(db, b);
    const row = (
      await db.query(
        "SELECT * FROM chatgpt_connect_requests WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [id, b.userId],
      )
    ).rows[0];
    if (!row) fail(404, "This ChatGPT connection request is not available.");
    await live(db, { userId: b.userId, sessionId: row.session_id });
    if (row.state !== "pending" || row.expires_at.getTime() <= Date.now())
      fail(409, "Start a fresh ChatGPT connection.");
    await db.query(
      "UPDATE chatgpt_connect_requests SET state='claimed',claim_session_id=$2 WHERE id=$1",
      [id, b.sessionId],
    );
    return { claimed: true };
  });
}
export async function finishChatgptConnectRequest(
  b: Binding,
  id: string,
  connectionId: string | null,
) {
  return transaction(async (db) => {
    await live(db, b);
    const row = (
      await db.query(
        "SELECT * FROM chatgpt_connect_requests WHERE id=$1 AND user_id=$2 AND claim_session_id=$3 FOR UPDATE",
        [id, b.userId, b.sessionId],
      )
    ).rows[0];
    if (!row) fail(404, "This ChatGPT connection request is not available.");
    await live(db, { userId: b.userId, sessionId: row.session_id });
    if (row.state !== "claimed" || row.expires_at.getTime() <= Date.now())
      fail(409, "Start a fresh ChatGPT connection.");
    if (connectionId) {
      const connection = await db.query(
        "SELECT id FROM chatgpt_identity_connections WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL FOR SHARE",
        [connectionId, b.userId],
      );
      if (!connection.rowCount)
        fail(404, "This ChatGPT account is not available.");
    }
    await db.query(
      "UPDATE chatgpt_connect_requests SET state=$2,connection_id=$3 WHERE id=$1",
      [id, connectionId ? "completed" : "failed", connectionId],
    );
    return { finished: true };
  });
}

/** A signed-in local runtime sees only its person's still-live, explicitly requested handoffs. */
export async function pendingChatgptConnectRequests(b: Binding) {
  return transaction(async (db) => {
    await live(db, b);
    return (
      await db.query(
        "SELECT r.id,r.expires_at FROM chatgpt_connect_requests r JOIN sessions s ON s.id=r.session_id WHERE r.user_id=$1 AND r.state='pending' AND r.expires_at>clock_timestamp() AND s.user_id=r.user_id AND s.expires_at>clock_timestamp() ORDER BY r.created_at,r.id LIMIT 1",
        [b.userId],
      )
    ).rows.map((row) => ({ ...row, expires_at: row.expires_at.toISOString() }));
  });
}
