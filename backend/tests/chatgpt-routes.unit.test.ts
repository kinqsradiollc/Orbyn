import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/db/pool.js";
import { digest } from "../src/lib/auth.js";
import { createService } from "../src/services/http.js";
import { chatgptConnectionRoutes } from "../src/modules/auth/chatgpt-routes.js";

// The route shield isolates DB and provider work; transaction races are covered
// separately against the disposable test database in chatgpt-connections.test.
test("ChatGPT connection routes enforce session-only access, strict inputs and rate limits", async () => {
  const userId = randomUUID(),
    sessionId = randomUUID(),
    challengeId = randomUUID();
  const connectionId = randomUUID();
  const identity = {
    id: connectionId,
    issuer: "https://auth.openai.com",
    subject: "fixture",
    client_id: "oaiapp_fixture",
  };
  const user = {
    id: userId,
    name: "Fixture",
    role: "member",
    disabled: false,
    email_verified: true,
  };
  const challenge = {
    id: challengeId,
    nonce: "fixture-nonce-1234567890",
    expected_client_id: null,
    expires_at: new Date(Date.now() + 600_000),
    consumed_at: null,
  };
  let invalidProof = false;
  let unexpectedCredential = false;
  let ownedConnection = false;
  const query = async (sql: string, args: unknown[] = []) => {
    assert.ok(
      !sql.includes("idempotency_keys"),
      "connection proofs must not be replayed from the 24-hour response cache",
    );
    if (sql.includes("JOIN sessions"))
      return {
        rows:
          args[0] === digest("expired")
            ? []
            : [{ ...user, disabled: args[0] === digest("disabled") }],
        rowCount: 1,
      };
    if (sql.includes("JOIN api_keys")) return { rows: [user], rowCount: 1 };
    if (sql.includes("SELECT disabled,email_verified FROM users"))
      return { rows: [user], rowCount: 1 };
    if (sql.includes("SELECT id FROM sessions"))
      return { rows: [{ id: sessionId }], rowCount: 1 };
    if (sql.includes("count(*) FROM chatgpt_identity_challenges"))
      return { rows: [{ count: "0" }], rowCount: 1 };
    if (sql.includes("INSERT INTO chatgpt_identity_challenges"))
      return { rows: [challenge], rowCount: 1 };
    if (sql.includes("FROM chatgpt_identity_challenges"))
      return {
        rows: invalidProof ? [challenge] : [],
        rowCount: invalidProof ? 1 : 0,
      };
    if (sql.includes("FROM chatgpt_identity_connections"))
      return {
        rows: [
          {
            ...identity,
            ...(sql.includes("verified_at") ? { verified_at: new Date() } : {}),
            ...(unexpectedCredential
              ? { access_token: "must-not-return" }
              : {}),
          },
        ],
        rowCount: 1,
      };
    if (sql.includes("UPDATE chatgpt_identity_connections"))
      return {
        rows: ownedConnection ? [{ id: connectionId }] : [],
        rowCount: ownedConnection ? 1 : 0,
      };
    return { rows: [], rowCount: 0 };
  };
  mock.method(pool, "query", query);
  mock.method(pool, "connect", async () => ({ query, release: () => {} }));
  const app = await createService("ai", [chatgptConnectionRoutes]);
  let address = 1;
  const call = (
    method: "POST" | "GET" | "DELETE",
    url: string,
    token?: string,
    payload?: object,
    remoteAddress = `10.73.0.${address++}`,
  ) =>
    app.inject({
      method,
      url,
      remoteAddress,
      headers: token
        ? {
            authorization: `Bearer ${token}`,
            "idempotency-key": "connection_fixture_key",
          }
        : {},
      ...(payload ? { payload } : {}),
    });
  const start = "/ai/connections/chatgpt/challenges";
  const complete = "/ai/connections/chatgpt/complete";
  const list = "/ai/connections/chatgpt";
  const refresh = `${list}/refresh-identity`;
  try {
    for (const [method, url] of [
      ["POST", start],
      ["POST", complete],
      ["POST", refresh],
      ["GET", list],
      ["DELETE", `${list}/${connectionId}`],
    ] as const) {
      assert.equal((await call(method, url)).statusCode, 401);
      assert.equal((await call(method, url, "ok_fixture")).statusCode, 403);
      assert.equal((await call(method, url, "disabled")).statusCode, 403);
      assert.equal((await call(method, url, "expired")).statusCode, 401);
      assert.equal((await call(method, url, "oat_fixture")).statusCode, 401);
    }
    assert.equal(
      (await call("POST", start, "session", { access_token: "forbidden" }))
        .statusCode,
      422,
    );
    assert.equal(
      (
        await call("POST", start, "session", {
          client_id: "dynamic_agent_client",
        })
      ).statusCode,
      422,
    );
    const begun = await call("POST", start, "session", {});
    assert.equal(begun.statusCode, 200, begun.body);
    assert.equal(begun.headers["cache-control"], "no-store");
    assert.deepEqual(begun.json(), {
      id: challengeId,
      nonce: challenge.nonce,
      expires_at: challenge.expires_at.toISOString(),
    });
    const proof = {
      challenge_id: challengeId,
      client_id: "oaiapp_fixture",
      id_token: "private-invalid-proof",
    };
    assert.equal(
      (
        await call("POST", complete, "session", {
          ...proof,
          user_id: randomUUID(),
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (await call("POST", complete, "session", proof)).statusCode,
      404,
    );
    invalidProof = true;
    const rejected = await call("POST", complete, "session", proof);
    assert.equal(rejected.statusCode, 400, rejected.body);
    assert.ok(!rejected.body.includes(proof.id_token));
    const refreshInput = {
      connection_id: connectionId,
      id_token: "invalid-private-refresh-proof",
    };
    assert.equal(
      (
        await call("POST", refresh, "session", {
          ...refreshInput,
          refresh_token: "forbidden",
        })
      ).statusCode,
      422,
    );
    const refreshRejected = await call(
      "POST",
      refresh,
      "session",
      refreshInput,
    );
    assert.equal(refreshRejected.statusCode, 400, refreshRejected.body);
    assert.ok(!refreshRejected.body.includes(refreshInput.id_token));
    for (let i = 0; i < 10; i++)
      await call("POST", refresh, undefined, undefined, "10.74.0.2");
    assert.equal(
      (await call("POST", refresh, undefined, undefined, "10.74.0.2"))
        .statusCode,
      429,
    );
    const listed = await call("GET", list, "session");
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.headers["cache-control"], "no-store");
    assert.equal(listed.json()[0].id, connectionId);
    unexpectedCredential = true;
    const unsafe = await call("GET", list, "session");
    // An accidental credential in a DB result must fail closed, not reach a client.
    assert.equal(unsafe.statusCode, 422);
    assert.ok(!unsafe.body.includes("must-not-return"));
    assert.equal(
      (await call("DELETE", `${list}/${connectionId}`, "session")).statusCode,
      404,
    );
    assert.equal(
      (await call("DELETE", `${list}/malformed`, "session")).statusCode,
      422,
    );
    ownedConnection = true;
    const removed = await call("DELETE", `${list}/${connectionId}`, "session");
    assert.equal(removed.statusCode, 204, removed.body);
    assert.equal(removed.body, "");
    for (let i = 0; i < 10; i++)
      await call("POST", start, undefined, undefined, "10.74.0.1");
    const limited = await call(
      "POST",
      start,
      undefined,
      undefined,
      "10.74.0.1",
    );
    assert.equal(limited.statusCode, 429);
    assert.ok(limited.headers["retry-after"]);
  } finally {
    await app.close();
    mock.restoreAll();
  }
});
