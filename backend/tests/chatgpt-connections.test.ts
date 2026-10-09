import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import "./setup.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  beginChatgptConnection,
  finishChatgptConnection,
  listChatgptConnections,
  revokeChatgptConnection,
  readChatgptModelPreference,
  saveChatgptModelPreference,
  beginChatgptExecutorEnrollment,
  finishChatgptExecutorEnrollment,
} = await import("../src/modules/auth/chatgpt-connections.js");
const people: { userId: string; sessionId: string }[] = [];
const clientId = "oaiapp_connection_fixture";
const status = (expected: number) => (error: unknown) =>
  (error as { statusCode: number }).statusCode === expected;
const verified = async (
  _token: string,
  expected: { clientId: string; nonce: string },
) => ({
  issuer: "https://auth.openai.com" as const,
  subject: "disconnect-fixture",
  clientId: expected.clientId,
});

async function executorFixture(native = false) {
  const attempt = await beginChatgptConnection(people[0]);
  const connection = await finishChatgptConnection(
    people[0],
    { challengeId: attempt.id, clientId, idToken: "fixture" },
    verified,
  );
  const keys = native
    ? generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    : generateKeyPairSync("ed25519");
  const input = {
    connection_id: connection.id,
    host_id: randomUUID(),
    public_key: keys.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64url"),
  };
  const start = () => beginChatgptExecutorEnrollment(people[0], input);
  const finish = (
    challenge: Awaited<ReturnType<typeof start>>,
    person = people[0],
  ) =>
    finishChatgptExecutorEnrollment(person, {
      challenge_id: challenge.id,
      signature: sign(
        native ? "sha256" : null,
        Buffer.from(challenge.proof_message),
        native
          ? { key: keys.privateKey, dsaEncoding: "ieee-p1363" }
          : keys.privateKey,
      ).toString("base64url"),
    });
  return { connection, input, start, finish };
}

test("executor enrollment requires a valid one-time proof from the exact owning session", async () => {
  const fixture = await executorFixture();
  const challenge = await fixture.start();
  await assert.rejects(fixture.finish(challenge, people[1]), status(404));
  const otherSession = (
    await pool.query<{ id: string }>(
      "INSERT INTO sessions(user_id,token_hash) VALUES($1,$2) RETURNING id",
      [people[0].userId, randomUUID()],
    )
  ).rows[0];
  await assert.rejects(
    fixture.finish(challenge, {
      userId: people[0].userId,
      sessionId: otherSession.id,
    }),
    status(404),
  );
  await pool.query("DELETE FROM sessions WHERE id=$1", [otherSession.id]);
  await assert.rejects(
    finishChatgptExecutorEnrollment(people[0], {
      challenge_id: challenge.id,
      signature: "A".repeat(86),
    }),
    status(400),
  );
  const enrollment = await fixture.finish(challenge);
  assert.equal(enrollment.enrollment_epoch, 1);
  assert.equal(enrollment.binding.connection_id, fixture.connection.id);
  assert.equal(
    enrollment.public_key_fingerprint,
    challenge.public_key_fingerprint,
  );
  await assert.rejects(fixture.finish(challenge), status(409));
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM chatgpt_executor_enrollments WHERE connection_id=$1",
        [fixture.connection.id],
      )
    ).rowCount,
    1,
  );
});

test("executor enrollment bounds pending attempts and rejects expired and wrong-algorithm proofs", async () => {
  const fixture = await executorFixture();
  const x25519 = generateKeyPairSync("x25519")
    .publicKey.export({ type: "spki", format: "der" })
    .toString("base64url");
  await assert.rejects(
    beginChatgptExecutorEnrollment(people[0], {
      ...fixture.input,
      public_key: x25519,
    }),
    status(400),
  );
  const challenges = await Promise.all(
    Array.from({ length: 5 }, fixture.start),
  );
  await assert.rejects(fixture.start(), status(429));
  await pool.query(
    "UPDATE chatgpt_executor_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
    [challenges[0].id],
  );
  await assert.rejects(fixture.finish(challenges[0]), status(409));
  await fixture.start();
});

test("competing executor renewals have one winner and cannot replace a recreated registration", async () => {
  const fixture = await executorFixture();
  const first = await fixture.finish(await fixture.start());
  const pending = await Promise.all([fixture.start(), fixture.start()]);
  const results = await Promise.allSettled(
    pending.map((c) => fixture.finish(c)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(rejected.reason.statusCode, 409);
  const stale = await fixture.start();
  await pool.query("DELETE FROM chatgpt_executor_enrollments WHERE id=$1", [
    first.id,
  ]);
  const replacement = await fixture.finish(await fixture.start());
  await fixture.finish(await fixture.start());
  assert.notEqual(replacement.id, first.id);
  await assert.rejects(fixture.finish(stale), status(409));
});

test("disconnect removes executor registrations and fences proofs even after reauthentication", async () => {
  const fixture = await executorFixture();
  await fixture.finish(await fixture.start());
  const pending = await fixture.start();
  await revokeChatgptConnection(people[0], fixture.connection.id);
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM chatgpt_executor_enrollments WHERE connection_id=$1",
        [fixture.connection.id],
      )
    ).rowCount,
    0,
  );
  await assert.rejects(fixture.finish(pending), status(404));
  const attempt = await beginChatgptConnection(people[0]);
  await finishChatgptConnection(
    people[0],
    { challengeId: attempt.id, clientId, idToken: "fixture" },
    verified,
  );
  await assert.rejects(fixture.finish(pending), status(409));
});

test("executor completion rechecks account restrictions and exact-session expiry", async () => {
  const fixture = await executorFixture();
  const pending = await fixture.start();
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
    people[0].userId,
  ]);
  try {
    await assert.rejects(fixture.finish(pending), status(403));
  } finally {
    await pool.query("UPDATE users SET disabled=false WHERE id=$1", [
      people[0].userId,
    ]);
  }
  await pool.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
    [people[0].sessionId],
  );
  try {
    await assert.rejects(fixture.finish(pending), status(401));
  } finally {
    await pool.query(
      "UPDATE sessions SET expires_at=now()+interval '30 days' WHERE id=$1",
      [people[0].sessionId],
    );
  }
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM chatgpt_executor_enrollments WHERE connection_id=$1",
        [fixture.connection.id],
      )
    ).rowCount,
    0,
  );
});

test("executor device cap is rechecked at completion and concurrent replay has one winner", async () => {
  const fixture = await executorFixture();
  const pending = await fixture.start();
  await pool.query(
    `INSERT INTO chatgpt_executor_enrollments(connection_id,host_id,session_id,public_key,public_key_fingerprint,epoch)
     SELECT $1,gen_random_uuid(),$2,$3,$4,1 FROM generate_series(1,20)`,
    [
      fixture.connection.id,
      people[0].sessionId,
      fixture.input.public_key,
      pending.public_key_fingerprint,
    ],
  );
  await assert.rejects(fixture.start(), status(429));
  await assert.rejects(fixture.finish(pending), status(429));
  await pool.query(
    "DELETE FROM chatgpt_executor_enrollments WHERE connection_id=$1",
    [fixture.connection.id],
  );
  const results = await Promise.allSettled([
    fixture.finish(pending),
    fixture.finish(pending),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejection = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(rejection.reason.statusCode, 409);
  await assert.rejects(
    beginChatgptExecutorEnrollment(people[1], fixture.input),
    status(404),
  );
});

test("executor completion rejects expiry while waiting on an account or session lock", async () => {
  for (const table of ["users", "sessions"] as const) {
    const fixture = await executorFixture();
    const challenge = await fixture.start();
    const holder = await pool.connect();
    let released = false;
    try {
      await pool.query(
        "UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",
        [people[0].sessionId],
      );
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [
        table === "users" ? people[0].userId : people[0].sessionId,
      ]);
      const completion = fixture.finish(challenge).then(
        () => null,
        (error) => error,
      );
      let blocked = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        await holder.query("SELECT pg_stat_clear_snapshot()");
        const waiting = await holder.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1 LIMIT 1",
          [
            table === "users"
              ? "%SELECT disabled,email_verified FROM users%"
              : "%SELECT id FROM sessions%",
          ],
        );
        if (waiting.rowCount) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(blocked, "completion must begin before the session expires");
      await holder.query("SELECT pg_sleep(2.1)");
      await holder.query("COMMIT");
      released = true;
      const error = await completion;
      assert.equal(
        error?.statusCode,
        401,
        "transaction-start time must not revive an expired session",
      );
    } finally {
      if (!released) await holder.query("ROLLBACK");
      holder.release();
      await pool.query(
        "UPDATE sessions SET expires_at=now()+interval '30 days' WHERE id=$1",
        [people[0].sessionId],
      );
    }
  }
});
before(async () => {
  await migrate();
  for (let i = 0; i < 2; i++) {
    const user = (
      await pool.query<{ id: string }>(
        "INSERT INTO users(email,password_hash,name,email_verified) VALUES($1,'fixture-not-used','Connection fixture',true) RETURNING id",
        [`connection-${randomUUID()}@example.com`],
      )
    ).rows[0];
    const session = (
      await pool.query<{ id: string }>(
        "INSERT INTO sessions(user_id,token_hash) VALUES($1,$2) RETURNING id",
        [user.id, randomUUID()],
      )
    ).rows[0];
    people.push({ userId: user.id, sessionId: session.id });
  }
});
beforeEach(async () => {
  await pool.query(
    "DELETE FROM chatgpt_identity_challenges WHERE user_id=ANY($1::uuid[])",
    [people.map((p) => p.userId)],
  );
  await pool.query(
    "DELETE FROM chatgpt_identity_connections WHERE user_id=ANY($1::uuid[])",
    [people.map((p) => p.userId)],
  );
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    people.map((p) => p.userId),
  ]);
  await pool.end();
});

test("listing and disconnecting require ownership; disconnect fences pending callbacks", async () => {
  const challenge = await beginChatgptConnection(people[0]);
  const connection = await finishChatgptConnection(
    people[0],
    {
      challengeId: challenge.id,
      clientId,
      idToken: "fixture",
    },
    verified,
  );
  assert.equal((await listChatgptConnections(people[0]))[0].id, connection.id);
  assert.deepEqual(await listChatgptConnections(people[1]), []);
  await assert.rejects(
    revokeChatgptConnection(people[1], connection.id),
    status(404),
  );
  const pending = await beginChatgptConnection(people[0]);
  await assert.rejects(
    finishChatgptConnection(
      people[0],
      {
        challengeId: pending.id,
        clientId,
        idToken: "fixture",
      },
      async (token, expected) => {
        await revokeChatgptConnection(people[0], connection.id);
        return verified(token, expected);
      },
    ),
    status(409),
  );
  assert.deepEqual(await listChatgptConnections(people[0]), []);
  await revokeChatgptConnection(people[0], connection.id);
  const fresh = await beginChatgptConnection(people[0]);
  const reconnected = await finishChatgptConnection(
    people[0],
    {
      challengeId: fresh.id,
      clientId,
      idToken: "fixture",
    },
    verified,
  );
  assert.equal(reconnected.id, connection.id);
});

test("connection reads and revocation reject expired sessions", async () => {
  const binding = { ...people[0], sessionId: randomUUID() };
  await assert.rejects(listChatgptConnections(binding), status(401));
  await assert.rejects(
    revokeChatgptConnection(binding, randomUUID()),
    status(401),
  );
});

test("account restrictions changed during verification prevent linking", async () => {
  const challenge = await beginChatgptConnection(people[0]);
  try {
    await assert.rejects(
      finishChatgptConnection(
        people[0],
        {
          challengeId: challenge.id,
          clientId,
          idToken: "fixture",
        },
        async (token, expected) => {
          await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
            people[0].userId,
          ]);
          return verified(token, expected);
        },
      ),
      status(403),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT id FROM chatgpt_identity_connections WHERE user_id=$1",
          [people[0].userId],
        )
      ).rows.length,
      0,
    );
  } finally {
    await pool.query("UPDATE users SET disabled=false WHERE id=$1", [
      people[0].userId,
    ]);
  }
});

test("verified linking consumes a session's nonce once and stores no credential", async () => {
  const challenge = await beginChatgptConnection(people[0]);
  const verify = async (
    _token: string,
    expected: { clientId: string; nonce: string },
  ) => {
    assert.equal(expected.nonce, challenge.nonce);
    return {
      issuer: "https://auth.openai.com" as const,
      subject: "verified-subject",
      clientId: expected.clientId,
    };
  };
  const input = {
    challengeId: challenge.id,
    clientId,
    idToken: "fixture-id-token",
  };
  const connection = await finishChatgptConnection(people[0], input, verify);
  assert.equal(connection.subject, "verified-subject");
  await assert.rejects(
    finishChatgptConnection(people[0], input, verify),
    status(409),
  );
  const record = (
    await pool.query(
      "SELECT row_to_json(c) AS value FROM chatgpt_identity_connections c WHERE id=$1",
      [connection.id],
    )
  ).rows[0].value;
  assert.ok(!JSON.stringify(record).includes("fixture-id-token"));
  assert.equal(record.access_token, undefined);
  assert.equal(record.refresh_token, undefined);
});
test("another user or session cannot finish a challenge", async () => {
  const challenge = await beginChatgptConnection(people[0]);
  const input = { challengeId: challenge.id, clientId, idToken: "fixture" };
  const verify = async () => {
    throw Error("must not verify");
  };
  await assert.rejects(
    finishChatgptConnection(people[1], input, verify),
    status(404),
  );
  await assert.rejects(
    finishChatgptConnection(
      { ...people[0], sessionId: people[1].sessionId },
      input,
      verify,
    ),
    status(404),
  );
  await assert.rejects(
    beginChatgptConnection({ ...people[0], sessionId: people[1].sessionId }),
    status(401),
  );
});
test("expired, changed-registration and failed-verification attempts cannot link", async () => {
  const challenge = await beginChatgptConnection(people[0], clientId);
  const verify = async () => {
    throw Error("private-provider-detail");
  };
  await assert.rejects(
    finishChatgptConnection(
      people[0],
      { challengeId: challenge.id, clientId: "another", idToken: "fixture" },
      verify,
    ),
    status(409),
  );
  await assert.rejects(
    finishChatgptConnection(
      people[0],
      { challengeId: challenge.id, clientId, idToken: "fixture" },
      verify,
    ),
    status(400),
  );
  await pool.query(
    "UPDATE chatgpt_identity_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
    [challenge.id],
  );
  await assert.rejects(
    finishChatgptConnection(
      people[0],
      { challengeId: challenge.id, clientId, idToken: "fixture" },
      verify,
    ),
    status(409),
  );
});
test("concurrent completion commits exactly one link and receipt", async () => {
  const challenge = await beginChatgptConnection(people[0]);
  const input = { challengeId: challenge.id, clientId, idToken: "fixture" };
  const verify = async () => ({
    issuer: "https://auth.openai.com" as const,
    subject: "race-subject",
    clientId,
  });
  const outcomes = await Promise.allSettled([
    finishChatgptConnection(people[0], input, verify),
    finishChatgptConnection(people[0], input, verify),
  ]);
  assert.equal(
    outcomes.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = outcomes.find(
    (result) => result.status === "rejected",
  ) as PromiseRejectedResult;
  assert.ok(status(409)(rejected.reason));
});
test("another Orbyn account cannot silently take over a verified identity", async () => {
  const verify = async () => ({
    issuer: "https://auth.openai.com" as const,
    subject: "same-subject",
    clientId,
  });
  const first = await beginChatgptConnection(people[0]);
  await finishChatgptConnection(
    people[0],
    { challengeId: first.id, clientId, idToken: "fixture" },
    verify,
  );
  const second = await beginChatgptConnection(people[1]);
  await assert.rejects(
    finishChatgptConnection(
      people[1],
      { challengeId: second.id, clientId, idToken: "fixture" },
      verify,
    ),
    status(409),
  );
});
test("session deletion and challenge expiry during verification prevent linking", async () => {
  const session = (
    await pool.query<{ id: string }>(
      "INSERT INTO sessions(user_id,token_hash) VALUES($1,$2) RETURNING id",
      [people[0].userId, randomUUID()],
    )
  ).rows[0];
  const owner = { userId: people[0].userId, sessionId: session.id };
  const challenge = await beginChatgptConnection(owner);
  await assert.rejects(
    finishChatgptConnection(
      owner,
      { challengeId: challenge.id, clientId, idToken: "fixture" },
      async () => {
        await pool.query("DELETE FROM sessions WHERE id=$1", [session.id]);
        return {
          issuer: "https://auth.openai.com",
          subject: "deleted-session-subject",
          clientId,
        };
      },
    ),
    status(401),
  );
  const expired = await beginChatgptConnection(people[0]);
  await assert.rejects(
    finishChatgptConnection(
      people[0],
      { challengeId: expired.id, clientId, idToken: "fixture" },
      async () => {
        await pool.query(
          "UPDATE chatgpt_identity_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
          [expired.id],
        );
        return {
          issuer: "https://auth.openai.com",
          subject: "expired-subject",
          clientId,
        };
      },
    ),
    status(409),
  );
});

test("concurrent starts cannot exceed the owner's five-attempt cap", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 7 }, () => beginChatgptConnection(people[0])),
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    5,
  );
  for (const result of results)
    if (result.status === "rejected") assert.ok(status(429)(result.reason));
});

test("backend preference metadata stays bound to a live owner connection and cascades on deletion", async () => {
  const challenge = await beginChatgptConnection(people[0]);
  const connection = await finishChatgptConnection(
    people[0],
    { challengeId: challenge.id, clientId, idToken: "fixture" },
    verified,
  );
  const first = await readChatgptModelPreference(people[0], connection.id);
  assert.deepEqual(first, {
    binding: {
      user_id: people[0].userId,
      connection_id: connection.id,
      issuer: connection.issuer,
      subject: connection.subject,
      client_id: clientId,
    },
    model: null,
    version: 0,
  });
  await assert.rejects(
    readChatgptModelPreference(people[1], connection.id),
    status(404),
  );
  await assert.rejects(readChatgptModelPreference(people[0], "invalid-id"));
  await pool.query(
    "INSERT INTO chatgpt_model_preferences(connection_id,model,version) VALUES($1,'fixture-model',3)",
    [connection.id],
  );
  assert.deepEqual(await readChatgptModelPreference(people[0], connection.id), {
    ...first,
    model: "fixture-model",
    version: 3,
  });
  for (const [model, version] of [
    ["bad model", "3"],
    ["", "3"],
    ["fixture-model", "-1"],
    ["fixture-model", "9007199254740992"],
  ])
    await assert.rejects(
      pool.query(
        "UPDATE chatgpt_model_preferences SET model=$2,version=$3 WHERE connection_id=$1",
        [connection.id, model, version],
      ),
    );
  await revokeChatgptConnection(people[0], connection.id);
  await assert.rejects(
    readChatgptModelPreference(people[0], connection.id),
    status(404),
  );
  await pool.query("DELETE FROM chatgpt_identity_connections WHERE id=$1", [
    connection.id,
  ]);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM chatgpt_model_preferences WHERE connection_id=$1",
        [connection.id],
      )
    ).rowCount,
    0,
  );
});

test("backend preferences recheck account restrictions and exact session validity", async () => {
  const challenge = await beginChatgptConnection(people[0]);
  const connection = await finishChatgptConnection(
    people[0],
    { challengeId: challenge.id, clientId, idToken: "fixture" },
    verified,
  );
  try {
    await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
      people[0].userId,
    ]);
    await assert.rejects(
      readChatgptModelPreference(people[0], connection.id),
      status(403),
    );
    await pool.query("UPDATE users SET disabled=false WHERE id=$1", [
      people[0].userId,
    ]);
    await pool.query(
      "UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [people[0].sessionId],
    );
    await assert.rejects(
      readChatgptModelPreference(people[0], connection.id),
      status(401),
    );
  } finally {
    await pool.query("UPDATE users SET disabled=false WHERE id=$1", [
      people[0].userId,
    ]);
    await pool.query(
      "UPDATE sessions SET expires_at=now()+interval '1 day' WHERE id=$1",
      [people[0].sessionId],
    );
  }
});

test("backend model writes require catalog validation, identity agreement and the current version", async () => {
  const challenge = await beginChatgptConnection(people[0]);
  const connection = await finishChatgptConnection(
    people[0],
    { challengeId: challenge.id, clientId, idToken: "fixture" },
    verified,
  );
  const first = await readChatgptModelPreference(people[0], connection.id);
  const available = async (binding: unknown, model: string) => {
    assert.deepEqual(binding, first.binding);
    if (!model.startsWith("fixture-")) throw new Error("Unavailable model");
  };
  await assert.rejects(
    saveChatgptModelPreference(
      people[1],
      { ...first, model: "fixture-a" },
      available,
    ),
    status(404),
  );
  await assert.rejects(
    saveChatgptModelPreference(
      people[0],
      {
        ...first,
        binding: { ...first.binding, subject: "other" },
        model: "fixture-a",
      },
      available,
    ),
    status(409),
  );
  await assert.rejects(
    saveChatgptModelPreference(
      people[0],
      { ...first, model: "unavailable" },
      available,
    ),
  );
  const outcomes = await Promise.allSettled([
    saveChatgptModelPreference(
      people[0],
      { ...first, model: "fixture-a" },
      available,
    ),
    saveChatgptModelPreference(
      people[0],
      { ...first, model: "fixture-b" },
      available,
    ),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
  const saved = await readChatgptModelPreference(people[0], connection.id);
  assert.equal(saved.version, 1);
  let staleValidations = 0;
  await assert.rejects(
    saveChatgptModelPreference(
      people[0],
      { ...first, model: "fixture-stale" },
      async () => {
        staleValidations++;
      },
    ),
    status(409),
  );
  assert.equal(staleValidations, 0);
  await revokeChatgptConnection(people[0], connection.id);
  const returningChallenge = await beginChatgptConnection(people[0], clientId);
  const returning = await finishChatgptConnection(
    people[0],
    {
      challengeId: returningChallenge.id,
      clientId,
      idToken: "fixture",
    },
    verified,
  );
  assert.equal(returning.id, connection.id);
  assert.deepEqual(
    await readChatgptModelPreference(people[0], returning.id),
    saved,
  );
  const cleared = await saveChatgptModelPreference(
    people[0],
    { ...saved, model: null },
    async () => {
      throw new Error("No catalog needed to clear a choice");
    },
  );
  assert.equal(cleared.model, null);
  assert.equal(cleared.version, 2);
  await revokeChatgptConnection(people[0], connection.id);
  const next = await beginChatgptConnection(people[0], clientId);
  const returned = await finishChatgptConnection(
    people[0],
    { challengeId: next.id, clientId, idToken: "fixture" },
    verified,
  );
  assert.equal(returned.id, connection.id);
  assert.deepEqual(
    await readChatgptModelPreference(people[0], returned.id),
    cleared,
  );
});

test("revocation during trusted catalog validation prevents the pending model write", async () => {
  const challenge = await beginChatgptConnection(people[0]);
  const connection = await finishChatgptConnection(
    people[0],
    { challengeId: challenge.id, clientId, idToken: "fixture" },
    verified,
  );
  const first = await readChatgptModelPreference(people[0], connection.id);
  await assert.rejects(
    saveChatgptModelPreference(
      people[0],
      { ...first, model: "fixture-a" },
      async () => {
        await revokeChatgptConnection(people[0], connection.id);
      },
    ),
    status(404),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM chatgpt_model_preferences WHERE connection_id=$1",
        [connection.id],
      )
    ).rowCount,
    0,
  );
});

test("account or session changes during catalog validation prevent preference writes", async () => {
  const challenge = await beginChatgptConnection(people[0]);
  const connection = await finishChatgptConnection(
    people[0],
    { challengeId: challenge.id, clientId, idToken: "fixture" },
    verified,
  );
  const first = await readChatgptModelPreference(people[0], connection.id);
  for (const mode of ["disabled", "unverified", "expired"]) {
    try {
      await assert.rejects(
        saveChatgptModelPreference(
          people[0],
          { ...first, model: "fixture-model" },
          async () => {
            if (mode === "disabled")
              await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
                people[0].userId,
              ]);
            if (mode === "unverified")
              await pool.query(
                "UPDATE users SET email_verified=false WHERE id=$1",
                [people[0].userId],
              );
            if (mode === "expired")
              await pool.query(
                "UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE id=$1",
                [people[0].sessionId],
              );
          },
        ),
        status(mode === "expired" ? 401 : 403),
      );
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM chatgpt_model_preferences WHERE connection_id=$1",
            [connection.id],
          )
        ).rowCount,
        0,
      );
    } finally {
      await pool.query(
        "UPDATE users SET disabled=false,email_verified=true WHERE id=$1",
        [people[0].userId],
      );
      await pool.query(
        "UPDATE sessions SET expires_at=now()+interval '1 day' WHERE id=$1",
        [people[0].sessionId],
      );
    }
  }
});

test("native P-256 enrollments pass the migrated key constraints and keep exact proof ownership", async () => {
  const fixture = await executorFixture(true);
  assert.equal(fixture.input.public_key.length, 122);
  const challenge = await fixture.start();
  await assert.rejects(fixture.finish(challenge, people[1]), status(404));
  const enrollment = await fixture.finish(challenge);
  assert.equal(enrollment.binding.connection_id, fixture.connection.id);
  assert.equal(
    enrollment.public_key_fingerprint,
    challenge.public_key_fingerprint,
  );
  await assert.rejects(fixture.finish(challenge), status(409));
});
