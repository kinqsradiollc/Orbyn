import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import "./setup.js";
const { digest } = await import("../src/lib/auth.js");
const { createService } = await import("../src/services/http.js");
const { chatgptModelRoutes } =
  await import("../src/modules/auth/chatgpt-model-routes.js");
const { chatgptExecutorRoutes } =
  await import("../src/modules/auth/chatgpt-executor-routes.js");
import { chatgptLeaseHeartbeatMessage } from "@orbyn/core";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  beginChatgptConnection,
  finishChatgptConnection,
  beginChatgptExecutorEnrollment,
  finishChatgptExecutorEnrollment,
  revokeChatgptConnection,
} = await import("../src/modules/auth/chatgpt-connections.js");
const {
  beginChatgptExecutorLease,
  finishChatgptExecutorLease,
  renewChatgptExecutorLease,
  publishChatgptExecutorCatalog,
} = await import("../src/modules/auth/chatgpt-executor-leases.js");
const { chatgptCatalogProofMessage } =
  await import("../src/modules/auth/chatgpt-executor-proof.js");
const { readChatgptModelCatalog, selectChatgptDefaultModel } =
  await import("../src/modules/auth/chatgpt-model-catalog.js");
const users: string[] = [];
const status = (expected: number) => (error: unknown) =>
  (error as { statusCode: number }).statusCode === expected;
before(async () => {
  await migrate();
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.end();
});

async function person(userId?: string) {
  const id =
    userId ??
    (
      await pool.query<{ id: string }>(
        "INSERT INTO users(email,password_hash,name,email_verified) VALUES($1,'fixture-not-used','Lease fixture',true) RETURNING id",
        [`${randomUUID()}@example.com`],
      )
    ).rows[0].id;
  if (!userId) users.push(id);
  const token = `lease-session-${randomUUID()}`;
  const sessionId = (
    await pool.query<{ id: string }>(
      "INSERT INTO sessions(user_id,token_hash) VALUES($1,$2) RETURNING id",
      [id, digest(token)],
    )
  ).rows[0].id;
  return { userId: id, sessionId, token };
}
async function fixture() {
  const session = await person();
  const attempt = await beginChatgptConnection(session);
  const connection = await finishChatgptConnection(
    session,
    {
      challengeId: attempt.id,
      clientId: "fixture-issued-client",
      idToken: "fixture",
    },
    async (_token, expected) => ({
      issuer: "https://auth.openai.com" as const,
      subject: randomUUID(),
      clientId: expected.clientId,
    }),
  );
  const keys = generateKeyPairSync("ed25519");
  const signature = (message: string) =>
    sign(null, Buffer.from(message), keys.privateKey).toString("base64url");
  const enrollmentInput = {
    connection_id: connection.id,
    host_id: randomUUID(),
    public_key: keys.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64url"),
  };
  const enroll = async () => {
    const challenge = await beginChatgptExecutorEnrollment(
      session,
      enrollmentInput,
    );
    return finishChatgptExecutorEnrollment(session, {
      challenge_id: challenge.id,
      signature: signature(challenge.proof_message),
    });
  };
  const executor = await enroll();
  const start = () =>
    beginChatgptExecutorLease(session, { executor_id: executor.id });
  const finish = (
    challenge: Awaited<ReturnType<typeof start>>,
    who = session,
  ) =>
    finishChatgptExecutorLease(who, {
      challenge_id: challenge.id,
      signature: signature(challenge.proof_message),
    });
  const claim = async () => finish(await start());
  const publication = (lease_epoch: number, sequence = 1) => {
    const catalog = {
      executor_id: executor.id,
      binding: executor.binding,
      lease_epoch,
      sequence,
      models: [
        { slug: "model-b", display_name: "B" },
        { slug: "model-a", display_name: "A" },
      ],
    };
    return {
      catalog,
      signature: signature(chatgptCatalogProofMessage(catalog)),
    };
  };
  return {
    session,
    executor,
    connection,
    signature,
    start,
    finish,
    claim,
    publication,
    enroll,
  };
}

test("lease claims require exact owner/session, valid signature, fresh proof and one-use completion", async () => {
  const f = await fixture();
  const proof = await f.start();
  await assert.rejects(f.finish(proof, await person()), status(404));
  await assert.rejects(
    f.finish(proof, await person(f.session.userId)),
    status(404),
  );
  await assert.rejects(
    finishChatgptExecutorLease(f.session, {
      challenge_id: proof.id,
      signature: "A".repeat(86),
    }),
    status(400),
  );
  const lease = await f.finish(proof);
  assert.equal(lease.lease_epoch, 1);
  await assert.rejects(f.finish(proof), status(409));
  const expired = await f.start();
  await pool.query(
    "UPDATE chatgpt_lease_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [expired.id],
  );
  await assert.rejects(f.finish(expired), status(409));
});

test("competing lease proofs have one winner and heartbeats reject signature and sequence replay", async () => {
  const f = await fixture();
  const a = await f.start(),
    b = await f.start();
  const results = await Promise.allSettled([f.finish(a), f.finish(b)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.statusCode,
    409,
  );
  const heartbeat = { executor_id: f.executor.id, lease_epoch: 1, sequence: 1 };
  const input = {
    heartbeat,
    signature: f.signature(chatgptLeaseHeartbeatMessage(heartbeat)),
  };
  await assert.rejects(
    renewChatgptExecutorLease(f.session, {
      ...input,
      signature: "A".repeat(86),
    }),
    status(400),
  );
  const renewed = await renewChatgptExecutorLease(f.session, input);
  assert.equal(renewed.lease_epoch, 1);
  await assert.rejects(
    renewChatgptExecutorLease(f.session, input),
    status(409),
  );
});

test("catalog publications bind signed metadata and preserve order; tampering and replay keep the accepted snapshot", async () => {
  const f = await fixture();
  const lease = await f.claim();
  const publication = f.publication(lease.lease_epoch);
  await publishChatgptExecutorCatalog(f.session, publication);
  await assert.rejects(
    publishChatgptExecutorCatalog(f.session, publication),
    status(409),
  );
  const tampered = f.publication(lease.lease_epoch, 2);
  tampered.catalog.models.reverse();
  await assert.rejects(
    publishChatgptExecutorCatalog(f.session, tampered),
    status(400),
  );
  const wrong = f.publication(lease.lease_epoch, 2);
  wrong.catalog.binding = { ...wrong.catalog.binding, subject: "wrong" };
  await assert.rejects(
    publishChatgptExecutorCatalog(f.session, wrong),
    status(409),
  );
  const row = (
    await pool.query(
      "SELECT sequence,models FROM chatgpt_executor_catalogs WHERE executor_id=$1",
      [f.executor.id],
    )
  ).rows[0];
  assert.equal(Number(row.sequence), 1);
  assert.deepEqual(row.models, publication.catalog.models);
});

test("expired leases cannot publish or renew; replacement fences the old generation", async () => {
  const f = await fixture();
  await f.claim();
  await pool.query(
    "UPDATE chatgpt_executor_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE executor_id=$1",
    [f.executor.id],
  );
  await assert.rejects(
    publishChatgptExecutorCatalog(f.session, f.publication(1)),
    status(409),
  );
  const heartbeat = { executor_id: f.executor.id, lease_epoch: 1, sequence: 1 };
  await assert.rejects(
    renewChatgptExecutorLease(f.session, {
      heartbeat,
      signature: f.signature(chatgptLeaseHeartbeatMessage(heartbeat)),
    }),
    status(409),
  );
  assert.equal((await f.claim()).lease_epoch, 2);
  await assert.rejects(
    publishChatgptExecutorCatalog(f.session, f.publication(1)),
    status(409),
  );
  await publishChatgptExecutorCatalog(f.session, f.publication(2));
});

test("key re-enrollment fences active leases and pending lease proofs; disconnect cascades metadata", async () => {
  const f = await fixture();
  await f.claim();
  await publishChatgptExecutorCatalog(f.session, f.publication(1));
  const pending = await f.start();
  await f.enroll();
  await assert.rejects(f.finish(pending), status(409));
  await assert.rejects(
    publishChatgptExecutorCatalog(f.session, f.publication(1, 2)),
    status(409),
  );
  assert.equal((await f.claim()).enrollment_epoch, 2);
  await revokeChatgptConnection(f.session, f.connection.id);
  for (const table of [
    "chatgpt_executor_leases",
    "chatgpt_executor_catalogs",
    "chatgpt_lease_challenges",
  ]) {
    assert.equal(
      (
        await pool.query(`SELECT 1 FROM ${table} WHERE executor_id=$1`, [
          f.executor.id,
        ])
      ).rowCount,
      0,
    );
  }
  await assert.rejects(f.start(), status(404));
});

test("pending proof caps and live account/session checks apply before lease mutation", async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++) await f.start();
  await assert.rejects(f.start(), status(429));
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
    f.session.userId,
  ]);
  await assert.rejects(f.start(), status(403));
  await pool.query("UPDATE users SET disabled=false WHERE id=$1", [
    f.session.userId,
  ]);
  await pool.query(
    "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [f.session.sessionId],
  );
  await assert.rejects(f.start(), status(401));
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM chatgpt_executor_leases WHERE executor_id=$1",
        [f.executor.id],
      )
    ).rowCount,
    0,
  );
});

test("a lease proof that expires while waiting on the existing lease row cannot claim a generation", async () => {
  const f = await fixture();
  await f.claim();
  const proof = await f.start();
  await pool.query(
    "UPDATE chatgpt_lease_challenges SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",
    [proof.id],
  );
  const holder = await pool.connect();
  await holder.query("BEGIN");
  await holder.query(
    "SELECT executor_id FROM chatgpt_executor_leases WHERE executor_id=$1 FOR UPDATE",
    [f.executor.id],
  );
  const attempt = f.finish(proof).then(
    () => null,
    (error) => error,
  );
  let observed = false;
  try {
    for (let i = 0; i < 100; i++) {
      await holder.query("SELECT pg_stat_clear_snapshot()");
      const wait = await holder.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%chatgpt_executor_leases%FOR UPDATE%'",
      );
      if (wait.rowCount) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await holder.query("SELECT pg_sleep(2.1)");
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }
  const error = await attempt;
  assert.ok(
    observed,
    "completion must actually be blocked on the existing lease row",
  );
  assert.equal(error?.statusCode, 409);
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT epoch FROM chatgpt_executor_leases WHERE executor_id=$1",
          [f.executor.id],
        )
      ).rows[0].epoch,
    ),
    1,
  );
});

test("owned cross-device catalog reads expose explicit state and one account-bound persisted default", async () => {
  const f = await fixture();
  const reader = await person(f.session.userId);
  const selection = {
    connection_id: f.connection.id,
    executor_id: f.executor.id,
  };
  assert.equal(
    (await readChatgptModelCatalog(reader, selection)).status,
    "unavailable",
  );
  await f.claim();
  await publishChatgptExecutorCatalog(f.session, f.publication(1));
  const ready = await readChatgptModelCatalog(reader, selection);
  assert.equal(ready.status, "ready");
  assert.deepEqual(
    ready.models.map((m) => m.slug),
    ["model-b", "model-a"],
  );
  const saved = await selectChatgptDefaultModel(reader, {
    selection,
    preference: { ...ready.preference, model: "model-b" },
  });
  assert.equal(saved.version, 1);
  assert.equal(
    (await readChatgptModelCatalog(f.session, selection)).preference.model,
    "model-b",
  );
  const changed = f.publication(1, 2);
  changed.catalog.models = [changed.catalog.models[1]];
  changed.signature = f.signature(chatgptCatalogProofMessage(changed.catalog));
  await publishChatgptExecutorCatalog(f.session, changed);
  const removed = await readChatgptModelCatalog(reader, selection);
  assert.equal(
    removed.preference.model,
    "model-b",
    "a removed default is retained rather than replaced",
  );
  await assert.rejects(
    selectChatgptDefaultModel(reader, {
      selection,
      preference: { ...saved, model: "model-b" },
    }),
    status(409),
  );
  assert.equal(
    (await readChatgptModelCatalog(reader, selection)).preference.version,
    1,
  );
});

test("stale and offline catalogs cannot authorize defaults; clearing remains explicit", async () => {
  const f = await fixture();
  const reader = await person(f.session.userId);
  const selection = {
    connection_id: f.connection.id,
    executor_id: f.executor.id,
  };
  await f.claim();
  await publishChatgptExecutorCatalog(f.session, f.publication(1));
  await pool.query(
    "UPDATE chatgpt_executor_catalogs SET published_at=clock_timestamp()-interval '6 minutes' WHERE executor_id=$1",
    [f.executor.id],
  );
  const stale = await readChatgptModelCatalog(reader, selection);
  assert.equal(stale.status, "stale");
  await assert.rejects(
    selectChatgptDefaultModel(reader, {
      selection,
      preference: { ...stale.preference, model: "model-a" },
    }),
    status(503),
  );
  await pool.query(
    "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [f.session.sessionId],
  );
  const offline = await readChatgptModelCatalog(reader, selection);
  assert.equal(offline.status, "offline");
  await assert.rejects(
    selectChatgptDefaultModel(reader, {
      selection,
      preference: { ...offline.preference, model: "model-a" },
    }),
    status(503),
  );
  assert.equal(
    (
      await selectChatgptDefaultModel(reader, {
        selection,
        preference: offline.preference,
      })
    ).model,
    null,
  );
});

test("catalog/default ownership and version fences prevent cross-account changes and lost updates", async () => {
  const f = await fixture();
  const selection = {
    connection_id: f.connection.id,
    executor_id: f.executor.id,
  };
  await f.claim();
  await publishChatgptExecutorCatalog(f.session, f.publication(1));
  const state = await readChatgptModelCatalog(f.session, selection);
  const other = await person();
  await assert.rejects(readChatgptModelCatalog(other, selection), status(404));
  await assert.rejects(
    readChatgptModelCatalog(f.session, {
      ...selection,
      executor_id: randomUUID(),
    }),
    status(404),
  );
  await assert.rejects(
    selectChatgptDefaultModel(f.session, {
      selection,
      preference: {
        ...state.preference,
        binding: { ...state.binding, subject: "wrong" },
        model: "model-a",
      },
    }),
    status(409),
  );
  const results = await Promise.allSettled(
    ["model-a", "model-b"].map((model) =>
      selectChatgptDefaultModel(f.session, {
        selection,
        preference: { ...state.preference, model },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.statusCode,
    409,
  );
  assert.equal(
    (await readChatgptModelCatalog(f.session, selection)).preference.version,
    1,
  );
});

test("first-party models and executor routes reject other principals, malformed bodies and rate excess", async () => {
  const f = await fixture();
  await f.claim();
  await publishChatgptExecutorCatalog(f.session, f.publication(1));
  const selection = {
    connection_id: f.connection.id,
    executor_id: f.executor.id,
  };
  const app = await createService("all", [
    chatgptModelRoutes,
    chatgptExecutorRoutes,
  ]);
  let address = 1;
  const call = (
    method: "GET" | "PUT" | "POST",
    url: string,
    token?: string,
    payload?: unknown,
    ip?: string,
  ) =>
    app.inject({
      method,
      url,
      headers: token
        ? {
            authorization: `Bearer ${token}`,
            "idempotency-key": "fixture-request-key",
          }
        : {},
      payload: payload as object,
      remoteAddress: ip ?? `10.78.0.${address++}`,
    });
  const url = `/models?connection_id=${selection.connection_id}&executor_id=${selection.executor_id}`;
  try {
    assert.equal((await call("GET", url)).statusCode, 401);
    assert.equal((await call("GET", url, "oat_fixture")).statusCode, 401);
    const apiKey = `ok_${randomUUID()}`;
    await pool.query(
      "INSERT INTO api_keys(user_id,name,prefix,key_hash) VALUES($1,'Fixture','ok_fixture',$2)",
      [f.session.userId, digest(apiKey)],
    );
    assert.equal((await call("GET", url, apiKey)).statusCode, 403);
    assert.equal(
      (
        await call(
          "POST",
          "/ai/connections/chatgpt/leases/challenges",
          apiKey,
          { executor_id: f.executor.id },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await call("GET", "/models?connection_id=invalid", f.session.token))
        .statusCode,
      422,
    );
    const got = await call("GET", url, f.session.token);
    assert.equal(got.statusCode, 200, got.body);
    assert.equal(got.headers["cache-control"], "no-store");
    const state = got.json();
    assert.equal(state.status, "ready");
    const change = {
      selection,
      preference: { ...state.preference, model: "model-a" },
    };
    assert.equal(
      (
        await call("PUT", "/models/default", f.session.token, {
          ...change,
          access_token: "must-not-be-accepted",
        })
      ).statusCode,
      422,
    );
    const saved = await call("PUT", "/models/default", f.session.token, change);
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.headers["cache-control"], "no-store");
    // The identical Idempotency-Key cannot bypass live CAS by replaying the first answer.
    assert.equal(
      (await call("PUT", "/models/default", f.session.token, change))
        .statusCode,
      409,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/ai/connections/chatgpt/leases/challenges",
          f.session.token,
          { executor_id: f.executor.id, refresh_token: "forbidden" },
        )
      ).statusCode,
      422,
    );
    const badHeartbeat = await call(
      "POST",
      "/ai/connections/chatgpt/leases/heartbeat",
      f.session.token,
      {
        heartbeat: { executor_id: f.executor.id, lease_epoch: 1, sequence: 2 },
        signature: "A".repeat(86),
      },
    );
    assert.equal(badHeartbeat.statusCode, 400);
    let last = 0;
    for (let i = 0; i < 11; i++)
      last = (
        await call("PUT", "/models/default", f.session.token, {}, "10.78.9.1")
      ).statusCode;
    assert.equal(last, 429);
    const serialized = JSON.stringify(state);
    assert.equal(serialized.includes("public_key"), false);
    assert.equal(serialized.includes("token"), false);
  } finally {
    await app.close();
  }
});

test("the central sweeper removes expired lease proofs and retains live proofs", async () => {
  const f = await fixture();
  const expired = await f.start();
  const live = await f.start();
  await pool.query(
    "UPDATE chatgpt_lease_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [expired.id],
  );
  const { runSweep } = await import("../src/lib/sweep.js");
  const result = await runSweep();
  assert.ok(result);
  assert.equal(result.errors.chatgpt_lease_challenges, undefined);
  assert.ok(result.removed.chatgpt_lease_challenges >= 1);
  const rows = await pool.query<{ id: string }>(
    "SELECT id FROM chatgpt_lease_challenges WHERE id=ANY($1::uuid[])",
    [[expired.id, live.id]],
  );
  assert.deepEqual(
    rows.rows.map((r) => r.id),
    [live.id],
  );
});

test("owned device discovery is credential-free, cross-device and excludes revoked/expired registrations", async () => {
  const { listChatgptExecutors } =
    await import("../src/modules/auth/chatgpt-model-catalog.js");
  const f = await fixture();
  const remote = await person(f.session.userId);
  assert.deepEqual(await listChatgptExecutors(remote), [
    {
      executor_id: f.executor.id,
      connection_id: f.connection.id,
      host_id: f.executor.host_id,
    },
  ]);
  assert.deepEqual(await listChatgptExecutors(await person()), []);
  await pool.query(
    "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [f.session.sessionId],
  );
  assert.deepEqual(await listChatgptExecutors(remote), []);
  await assert.rejects(listChatgptExecutors(f.session), status(401));
  const revoked = await fixture();
  await revokeChatgptConnection(revoked.session, revoked.connection.id);
  assert.deepEqual(await listChatgptExecutors(revoked.session), []);
});

test("device discovery API enforces session principals, empty query, account restrictions and rate limits", async () => {
  const f = await fixture();
  const app = await createService("all", [chatgptExecutorRoutes]);
  const path = "/ai/connections/chatgpt/executors";
  const call = (token?: string, url = path, ip = "10.78.5.1") =>
    app.inject({
      method: "GET",
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      remoteAddress: ip,
    });
  try {
    assert.equal((await call()).statusCode, 401);
    assert.equal((await call("oat_fixture")).statusCode, 401);
    const apiKey = `ok_${randomUUID()}`;
    await pool.query(
      "INSERT INTO api_keys(user_id,name,prefix,key_hash) VALUES($1,'Fixture','ok_fixture',$2)",
      [f.session.userId, digest(apiKey)],
    );
    assert.equal((await call(apiKey)).statusCode, 403);
    assert.equal(
      (await call(f.session.token, `${path}?access_token=forbidden`))
        .statusCode,
      422,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/ai/connections/chatgpt/leases/challenges",
          headers: {
            authorization: `Bearer ${f.session.token}`,
            "content-type": "application/json",
          },
          payload: "{",
        })
      ).statusCode,
      400,
    );
    const got = await call(f.session.token);
    assert.equal(got.statusCode, 200, got.body);
    assert.equal(got.headers["cache-control"], "no-store");
    assert.deepEqual(got.json(), [
      {
        executor_id: f.executor.id,
        connection_id: f.connection.id,
        host_id: f.executor.host_id,
      },
    ]);
    await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
      f.session.userId,
    ]);
    assert.equal((await call(f.session.token)).statusCode, 403);
    await pool.query("UPDATE users SET disabled=false WHERE id=$1", [
      f.session.userId,
    ]);
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++)
      statuses.push(
        (await call(f.session.token, path, "10.78.5.2")).statusCode,
      );
    assert.ok(statuses.includes(429));
  } finally {
    await app.close();
  }
});
