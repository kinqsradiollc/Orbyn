import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  beginTeamsInstallation,
  captureTeamsInstallation,
  readTeamsInstallationRequest,
  confirmTeamsInstallation,
} = await import("../src/modules/agent-channels/teams-installations.js");
const config = {
  clientId: randomUUID(),
  clientSecret: "fixture-client-secret",
  botAppId: randomUUID(),
  redirectUri: "https://orbyn.example/api/agent-channels/teams/callback",
};
const owners: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
const refusal = (status: number) => (e: unknown) =>
  (e as { statusCode?: number })?.statusCode === status;
async function fixture() {
  const userId = randomUUID(),
    sessionId = randomUUID();
  owners.push(userId);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Teams tester',true)",
    [userId, `${userId}@fixture.invalid`],
  );
  await pool.query(
    "INSERT INTO sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
    [sessionId, userId, randomUUID()],
  );
  const binding = { userId, sessionId },
    start = await beginTeamsInstallation(binding, config);
  const state = new URL(start.authorization_url).searchParams.get("state")!;
  const identity = {
    tenantId: randomUUID(),
    objectId: randomUUID(),
    subject: "fixture-subject",
    displayName: "Microsoft tester",
  };
  const redeem = async () => identity;
  const review = {
    expected_version: 0,
    tenant_id: identity.tenantId,
    object_id: identity.objectId,
  };
  return { binding, start, state, identity, redeem, review };
}
const pending = async (id: string) =>
  (
    await pool.query(
      "SELECT * FROM agent_channel_teams_oauth_pending WHERE id=$1",
      [id],
    )
  ).rows[0];
test("identity capture is encrypted, session-owned and has no DM or personal token authority", async () => {
  const f = await fixture();
  assert.deepEqual(
    await captureTeamsInstallation(
      config,
      { state: f.state, code: "fixture-code" },
      f.redeem,
    ),
    { captured: true },
  );
  const stored = await pending(f.start.id);
  assert.equal(stored.state, "ready");
  assert.equal(stored.pkce_encrypted, null);
  assert.equal(stored.exchange_claim, null);
  assert.ok(!stored.identity_encrypted.includes(f.identity.objectId));
  assert.notEqual(stored.state_hash, f.state);
  assert.deepEqual(
    (await readTeamsInstallationRequest(f.binding, f.start.id, config))
      .identity,
    f.identity,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM agent_channel_teams_installations WHERE user_id=$1",
        [f.binding.userId],
      )
    ).rowCount,
    0,
  );
});
test("only the initiating live session can read or review the captured identity", async () => {
  const f = await fixture(),
    other = await fixture();
  await captureTeamsInstallation(
    config,
    { state: f.state, code: "fixture" },
    f.redeem,
  );
  await assert.rejects(
    readTeamsInstallationRequest(other.binding, f.start.id, config),
    refusal(404),
  );
  const second = randomUUID();
  await pool.query(
    "INSERT INTO sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
    [second, f.binding.userId, randomUUID()],
  );
  await assert.rejects(
    confirmTeamsInstallation(
      { ...f.binding, sessionId: second },
      f.start.id,
      config,
      f.review,
    ),
    refusal(409),
  );
  await pool.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
    [f.binding.sessionId],
  );
  await assert.rejects(
    readTeamsInstallationRequest(f.binding, f.start.id, config),
    refusal(401),
  );
});
test("concurrent callbacks redeem a code once and refuse all replays", async () => {
  const f = await fixture();
  let calls = 0;
  const redeem = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return f.identity;
  };
  const outcomes = await Promise.allSettled([
    captureTeamsInstallation(
      config,
      { state: f.state, code: "fixture" },
      redeem,
    ),
    captureTeamsInstallation(
      config,
      { state: f.state, code: "fixture" },
      redeem,
    ),
  ]);
  assert.equal(calls, 1);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  await assert.rejects(
    captureTeamsInstallation(
      config,
      { state: f.state, code: "fixture" },
      redeem,
    ),
    refusal(409),
  );
  assert.equal(calls, 1);
});
test("transport uncertainty clears secrets and never retries a claimed code", async () => {
  const f = await fixture();
  let calls = 0;
  await assert.rejects(
    captureTeamsInstallation(
      config,
      { state: f.state, code: "fixture" },
      async () => {
        calls++;
        throw new Error("private-provider-token");
      },
    ),
    refusal(503),
  );
  const stored = await pending(f.start.id);
  assert.equal(stored.state, "failed");
  assert.equal(stored.pkce_encrypted, null);
  assert.equal(stored.identity_encrypted, null);
  await assert.rejects(
    captureTeamsInstallation(
      config,
      { state: f.state, code: "fixture" },
      f.redeem,
    ),
    refusal(409),
  );
  assert.equal(calls, 1);
});
test("revocation during exchange prevents review publication and clears private pending data", async () => {
  const f = await fixture();
  await assert.rejects(
    captureTeamsInstallation(
      config,
      { state: f.state, code: "fixture" },
      async () => {
        await pool.query(
          "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
          [f.binding.sessionId],
        );
        return f.identity;
      },
    ),
    refusal(503),
  );
  assert.equal((await pending(f.start.id)).state, "failed");
  assert.equal((await pending(f.start.id)).identity_encrypted, null);
});
test("confirmed review creates only a one-use expiring conversation challenge and leaves messages off", async () => {
  const f = await fixture();
  await captureTeamsInstallation(
    config,
    { state: f.state, code: "fixture" },
    f.redeem,
  );
  await assert.rejects(
    confirmTeamsInstallation(f.binding, f.start.id, config, {
      ...f.review,
      object_id: randomUUID(),
    }),
    refusal(409),
  );
  const connection = await confirmTeamsInstallation(
    f.binding,
    f.start.id,
    config,
    f.review,
  );
  assert.equal(connection.dm_enabled, false);
  assert.match(connection.link_token, /^[A-Za-z0-9_-]{43}$/);
  const stored = (
    await pool.query(
      "SELECT * FROM agent_channel_teams_installations WHERE id=$1",
      [connection.id],
    )
  ).rows[0];
  assert.notEqual(stored.link_nonce_hash, connection.link_token);
  assert.equal(stored.conversation_encrypted, null);
  assert.equal(stored.dm_enabled, false);
  assert.equal((await pending(f.start.id)).identity_encrypted, null);
  assert.equal((await pending(f.start.id)).state, "confirmed");
  await assert.rejects(
    confirmTeamsInstallation(f.binding, f.start.id, config, f.review),
    refusal(409),
  );
});
test("changed configuration, expiry, wrong identity and stale connection revision cannot confirm", async () => {
  const f = await fixture();
  await captureTeamsInstallation(
    config,
    { state: f.state, code: "fixture" },
    f.redeem,
  );
  await assert.rejects(
    confirmTeamsInstallation(
      f.binding,
      f.start.id,
      { ...config, botAppId: randomUUID() },
      f.review,
    ),
    refusal(409),
  );
  await assert.rejects(
    confirmTeamsInstallation(f.binding, f.start.id, config, {
      ...f.review,
      expected_version: 1,
    }),
    refusal(409),
  );
  await pool.query(
    "UPDATE agent_channel_teams_oauth_pending SET expires_at=now()-interval '1 second' WHERE id=$1",
    [f.start.id],
  );
  await assert.rejects(
    confirmTeamsInstallation(f.binding, f.start.id, config, f.review),
    refusal(409),
  );
});
test("the same verified Microsoft identity cannot steal another Orbyn owner mapping", async () => {
  const first = await fixture();
  await captureTeamsInstallation(
    config,
    { state: first.state, code: "fixture" },
    first.redeem,
  );
  await confirmTeamsInstallation(
    first.binding,
    first.start.id,
    config,
    first.review,
  );
  const other = await fixture();
  await captureTeamsInstallation(
    config,
    { state: other.state, code: "fixture" },
    first.redeem,
  );
  await assert.rejects(
    confirmTeamsInstallation(
      other.binding,
      other.start.id,
      config,
      first.review,
    ),
    refusal(409),
  );
});
test("OAuth cancellation clears PKCE and never invokes token redemption", async () => {
  const f = await fixture();
  assert.deepEqual(
    await captureTeamsInstallation(
      config,
      { state: f.state, error: "access_denied" },
      async () => {
        throw new Error("Must not redeem");
      },
    ),
    { captured: false },
  );
  assert.equal((await pending(f.start.id)).state, "failed");
  assert.equal((await pending(f.start.id)).pkce_encrypted, null);
});

test("concurrent cross-owner confirmation keeps one mapping and normalizes the uniqueness refusal", async () => {
  const first = await fixture(),
    other = await fixture();
  await captureTeamsInstallation(
    config,
    { state: first.state, code: "fixture" },
    first.redeem,
  );
  await captureTeamsInstallation(
    config,
    { state: other.state, code: "fixture" },
    first.redeem,
  );
  const results = await Promise.allSettled([
    confirmTeamsInstallation(
      first.binding,
      first.start.id,
      config,
      first.review,
    ),
    confirmTeamsInstallation(
      other.binding,
      other.start.id,
      config,
      first.review,
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(refusal(409)(rejected.reason), true);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM agent_channel_teams_installations WHERE bot_app_id=$1 AND tenant_id=$2 AND object_id=$3",
        [config.botAppId, first.identity.tenantId, first.identity.objectId],
      )
    ).rows[0].count,
    "1",
  );
});
test("fixed expiry sweeps private attempts and abandoned links even without Teams configured", async () => {
  const { SWEEP_RULES } = await import("../src/lib/sweep.js");
  const f = await fixture();
  await captureTeamsInstallation(
    config,
    { state: f.state, code: "fixture" },
    f.redeem,
  );
  const installed = await confirmTeamsInstallation(
    f.binding,
    f.start.id,
    config,
    f.review,
  );
  await pool.query(
    "UPDATE agent_channel_teams_oauth_pending SET expires_at=now()-interval '1 second' WHERE id=$1",
    [f.start.id],
  );
  await pool.query(
    "UPDATE agent_channel_teams_installations SET updated_at=now()-interval '31 days',link_expires_at=now()-interval '1 second' WHERE id=$1",
    [installed.id],
  );
  for (const key of [
    "agent_channel_teams_oauth_pending",
    "agent_channel_teams_disconnected",
  ]) {
    const rule = SWEEP_RULES.find((r) => r.key === key)!;
    assert.equal(rule.configurable, false);
    await pool.query(`DELETE FROM ${rule.table} WHERE ${rule.where}`);
  }
  assert.equal(await pending(f.start.id), undefined);
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM agent_channel_teams_installations WHERE id=$1",
        [installed.id],
      )
    ).rowCount,
    0,
  );
});
test("active attempts are bounded per owner instead of creating unlimited private captures", async () => {
  const f = await fixture();
  for (let n = 0; n < 4; n++) await beginTeamsInstallation(f.binding, config);
  await assert.rejects(beginTeamsInstallation(f.binding, config), refusal(429));
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM agent_channel_teams_oauth_pending WHERE user_id=$1",
        [f.binding.userId],
      )
    ).rows[0].count,
    "5",
  );
});

const { SignJWT, exportJWK, generateKeyPair } = await import("jose");
const { bindTeamsPersonalConversation } =
  await import("../src/modules/agent-channels/teams-conversations.js");
const pair = await generateKeyPair("RS256", { modulusLength: 2048 });
const signingKey = {
  ...(await exportJWK(pair.publicKey)),
  kid: "personal-link",
  endorsements: ["msteams"],
};
async function preparedLink() {
  const f = await fixture();
  await captureTeamsInstallation(
    config,
    { state: f.state, code: "fixture" },
    f.redeem,
  );
  const link = await confirmTeamsInstallation(
    f.binding,
    f.start.id,
    config,
    f.review,
  );
  const activity = {
    type: "message",
    id: randomUUID(),
    channelId: "msteams",
    serviceUrl: "https://smba.trafficmanager.net/teams/",
    from: { id: "29:reviewed-human", aadObjectId: f.identity.objectId },
    recipient: { id: `28:${config.botAppId}` },
    conversation: {
      id: "personal-fixture",
      conversationType: "personal",
      tenantId: f.identity.tenantId,
    },
    channelData: { tenant: { id: f.identity.tenantId } },
    textFormat: "plain",
    text: `/orbyn connect ${link.link_token}`,
  };
  return { f, link, activity };
}
async function connectionMessage(activity: unknown, valid = true) {
  const token = await new SignJWT({
    serviceUrl: "https://smba.trafficmanager.net/teams/",
  })
    .setProtectedHeader({ alg: "RS256", kid: "personal-link" })
    .setIssuer("https://api.botframework.com")
    .setAudience(valid ? config.botAppId : randomUUID())
    .setNotBefore(Math.floor(Date.now() / 1000) - 10)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
    .sign(pair.privateKey);
  return bindTeamsPersonalConversation(
    Buffer.from(JSON.stringify(activity)),
    {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    config,
    async () => [signingKey],
  );
}
test("signed personal conversation consumes the reviewed challenge once, encrypts reference and leaves DMs off", async () => {
  const { f, link, activity } = await preparedLink();
  const result = await connectionMessage(activity);
  assert.equal(result.id, link.id);
  assert.equal(result.version, link.version + 1);
  assert.equal(result.dm_enabled, false);
  const stored = (
    await pool.query(
      "SELECT * FROM agent_channel_teams_installations WHERE user_id=$1",
      [f.binding.userId],
    )
  ).rows[0];
  assert.equal(stored.link_nonce_hash, null);
  assert.equal(stored.link_expires_at, null);
  assert.ok(stored.conversation_encrypted);
  assert.ok(!stored.conversation_encrypted.includes(activity.conversation.id));
  await assert.rejects(connectionMessage(activity), refusal(409));
});
test("provider JWT, reviewed human, tenant and personal context are all required for linking", async () => {
  const { activity } = await preparedLink();
  await assert.rejects(
    connectionMessage(activity, false),
    (e: unknown) => (e as { status?: number }).status === 401,
  );
  await assert.rejects(
    connectionMessage({
      ...activity,
      from: { ...activity.from, aadObjectId: randomUUID() },
    }),
    refusal(409),
  );
  await assert.rejects(
    connectionMessage({
      ...activity,
      channelData: { tenant: { id: randomUUID() } },
    }),
    refusal(403),
  );
  await assert.rejects(
    connectionMessage({
      ...activity,
      conversation: { ...activity.conversation, conversationType: "groupChat" },
    }),
    refusal(400),
  );
  await assert.rejects(
    connectionMessage({ ...activity, type: "conversationUpdate" }),
    refusal(400),
  );
  await assert.rejects(
    connectionMessage({ ...activity, text: "/orbyn connect invalid" }),
    refusal(400),
  );
});
test("concurrent signed link messages bind one conversation and cannot replay the challenge", async () => {
  const { activity } = await preparedLink();
  const outcomes = await Promise.allSettled([
    connectionMessage(activity),
    connectionMessage(activity),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    outcomes.filter((x) => x.status === "rejected" && refusal(409)(x.reason))
      .length,
    1,
  );
});
test("disabled owner, expired challenge and disconnect prevent personal linking", async () => {
  const first = await preparedLink();
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
    first.f.binding.userId,
  ]);
  await assert.rejects(connectionMessage(first.activity), refusal(403));
  const expired = await preparedLink();
  await pool.query(
    "UPDATE agent_channel_teams_installations SET link_expires_at=now()-interval '1 second' WHERE id=$1",
    [expired.link.id],
  );
  await assert.rejects(connectionMessage(expired.activity), refusal(409));
  const disconnected = await preparedLink();
  await pool.query(
    "UPDATE agent_channel_teams_installations SET disconnected_at=now() WHERE id=$1",
    [disconnected.link.id],
  );
  await assert.rejects(connectionMessage(disconnected.activity), refusal(409));
});

const { readTeamsChannel, disconnectTeamsInstallation } =
  await import("../src/modules/agent-channels/teams-installations.js");
test("owned connection status hides secrets, reports configuration drift and disconnect clears pending authority", async () => {
  const { f, link, activity } = await preparedLink();
  assert.equal(
    (await readTeamsChannel(f.binding, config))?.state,
    "awaiting_conversation",
  );
  assert.equal((await readTeamsChannel(f.binding))?.state, "reconnect");
  await connectionMessage(activity);
  const linked = await readTeamsChannel(f.binding, config);
  assert.equal(linked?.state, "linked");
  assert.doesNotMatch(
    JSON.stringify(linked),
    /link_token|encrypted|29:|personal-fixture/,
  );
  const attempt = await beginTeamsInstallation(f.binding, config);
  await assert.rejects(
    disconnectTeamsInstallation(f.binding, link.version),
    refusal(409),
  );
  const result = await disconnectTeamsInstallation(f.binding, linked!.version);
  assert.equal(result.state, "disconnected");
  assert.equal(result.dm_enabled, false);
  assert.equal((await pending(attempt.id)).state, "failed");
  assert.equal((await pending(attempt.id)).pkce_encrypted, null);
  const stored = (
    await pool.query(
      "SELECT * FROM agent_channel_teams_installations WHERE id=$1",
      [link.id],
    )
  ).rows[0];
  assert.equal(stored.conversation_encrypted, null);
  assert.equal(stored.conversation_hash, null);
  assert.equal(stored.link_nonce_hash, null);
  await assert.rejects(connectionMessage(activity), refusal(409));
  assert.equal((await readTeamsChannel(f.binding))?.state, "disconnected");
  const other = await fixture();
  assert.equal(await readTeamsChannel(other.binding, config), null);
  await assert.rejects(
    disconnectTeamsInstallation(other.binding, result.version),
    refusal(409),
  );
});
