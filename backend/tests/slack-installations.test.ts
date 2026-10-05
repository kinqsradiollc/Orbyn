import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  slackChannelConnection,
  slackInstallationRequest,
  slackInstallationStart,
} from "@orbyn/core";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  beginSlackInstallation,
  captureSlackInstallation,
  readSlackInstallationRequest,
  confirmSlackInstallation,
  readSlackChannel,
  disconnectSlackInstallation,
  setSlackDmPermission,
} = await import("../src/modules/agent-channels/slack-installations.js");
const owners: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
const config = {
  clientId: "123.456",
  clientSecret: "synthetic-slack-client-secret",
  appId: "AFIXTURE",
  redirectUri: "https://orbyn.example/api/agent-channels/slack/callback",
};
async function fixture() {
  const userId = randomUUID(),
    sessionId = randomUUID();
  owners.push(userId);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Slack fixture',true)",
    [userId, `${userId}@fixture.invalid`],
  );
  await pool.query(
    "INSERT INTO sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
    [sessionId, userId, randomUUID()],
  );
  const actor = userId.replaceAll("-", "").toUpperCase();
  const binding = { userId, sessionId };
  const installation = {
    ok: true,
    app_id: config.appId,
    token_type: "bot",
    access_token: "synthetic-bot-secret",
    bot_user_id: "UBOT",
    scope: "chat:write,im:write",
    authed_user: { id: `U${actor}` },
    team: { id: `T${actor}`, name: "Fixture workspace" },
    is_enterprise_install: false,
  };
  const start = await beginSlackInstallation(binding, config);
  slackInstallationStart.parse(start);
  const state = new URL(start.authorization_url).searchParams.get("state")!;
  const send: typeof fetch = async () => Response.json(installation);
  const review = {
    workspace_id: installation.team.id,
    external_user_id: installation.authed_user.id,
    expected_bot_scopes: ["chat:write", "im:write"],
    expected_version: 0,
    dm_enabled: false,
  };
  return { binding, installation, start, state, send, review };
}
const status = (expected: number) => (error: unknown) => {
  assert.equal((error as { statusCode: number }).statusCode, expected);
  assert.doesNotMatch(
    String(error),
    /synthetic-bot-secret|synthetic-code|upstream-private/,
  );
  return true;
};

test("Slack callback captures encrypted pending credentials without linking or enabling messages", async () => {
  const f = await fixture();
  await captureSlackInstallation(
    config,
    { state: f.state, code: "synthetic-code" },
    f.send,
  );
  assert.equal(await readSlackChannel(f.binding), null);
  const row = (
    await pool.query("SELECT * FROM agent_channel_oauth_pending WHERE id=$1", [
      f.start.id,
    ])
  ).rows[0];
  assert.equal(row.state, "ready");
  assert.notEqual(row.state_hash, f.state);
  assert.doesNotMatch(row.installation_encrypted, /synthetic-bot-secret/);
  const pending = await readSlackInstallationRequest(
    f.binding,
    f.start.id,
    config,
  );
  assert.equal(pending.identity?.workspace_id, f.installation.team.id);
  slackInstallationRequest.parse(pending);
  assert.deepEqual(pending.identity?.bot_scopes, f.review.expected_bot_scopes);
  assert.doesNotMatch(
    JSON.stringify(pending),
    /synthetic-bot-secret|accessToken|refreshToken/,
  );
  const connected = await confirmSlackInstallation(
    f.binding,
    f.start.id,
    config,
    f.review,
  );
  assert.equal(connected.dm_enabled, false);
  slackChannelConnection.parse(connected);
  assert.deepEqual(connected.bot_scopes, f.review.expected_bot_scopes);
  assert.equal(connected.version, 1);
  assert.doesNotMatch(
    JSON.stringify(connected),
    /synthetic-bot-secret|credentials_encrypted/,
  );
  const settled = (
    await pool.query(
      "SELECT installation_encrypted,state FROM agent_channel_oauth_pending WHERE id=$1",
      [f.start.id],
    )
  ).rows[0];
  assert.equal(settled.state, "done");
  assert.equal(settled.installation_encrypted, null);
});
test("Concurrent duplicate Slack callbacks exchange a code only once", async () => {
  const f = await fixture();
  let calls = 0;
  const send: typeof fetch = async () => {
    calls++;
    return Response.json(f.installation);
  };
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      captureSlackInstallation(
        config,
        { state: f.state, code: "synthetic-code" },
        send,
      ),
    ),
  );
  assert.equal(calls, 1);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of results) if (r.status === "rejected") status(409)(r.reason);
});
test("Unknown Slack exchange failure is final and cannot replay the same state", async () => {
  const f = await fixture();
  let calls = 0;
  const send: typeof fetch = async () => {
    calls++;
    throw new Error("upstream-private");
  };
  await assert.rejects(
    captureSlackInstallation(
      config,
      { state: f.state, code: "synthetic-code" },
      send,
    ),
    status(503),
  );
  await assert.rejects(
    captureSlackInstallation(
      config,
      { state: f.state, code: "synthetic-code" },
      send,
    ),
    status(409),
  );
  assert.equal(calls, 1);
  assert.equal(
    (await readSlackInstallationRequest(f.binding, f.start.id, config)).state,
    "failed",
  );
});
test("Denied, expired and configuration-changed Slack callbacks never exchange", async () => {
  const denied = await fixture(),
    expired = await fixture(),
    changed = await fixture();
  let calls = 0;
  const send: typeof fetch = async () => {
    calls++;
    return Response.json(denied.installation);
  };
  await captureSlackInstallation(
    config,
    { state: denied.state, error: "access_denied" },
    send,
  );
  await pool.query(
    "UPDATE agent_channel_oauth_pending SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired.start.id],
  );
  await assert.rejects(
    captureSlackInstallation(
      config,
      { state: expired.state, code: "synthetic-code" },
      send,
    ),
    status(409),
  );
  await assert.rejects(
    captureSlackInstallation(
      { ...config, appId: "ANEWAPP" },
      { state: changed.state, code: "synthetic-code" },
      send,
    ),
    status(409),
  );
  assert.equal(calls, 0);
});
test("A second session or different owner cannot confirm the initiating session's Slack account", async () => {
  const f = await fixture(),
    other = await fixture();
  await captureSlackInstallation(
    config,
    { state: f.state, code: "synthetic-code" },
    f.send,
  );
  const second = randomUUID();
  await pool.query(
    "INSERT INTO sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
    [second, f.binding.userId, randomUUID()],
  );
  for (const b of [other.binding, { ...f.binding, sessionId: second }]) {
    await assert.rejects(
      readSlackInstallationRequest(b, f.start.id, config),
      status(404),
    );
    await assert.rejects(
      confirmSlackInstallation(b, f.start.id, config, f.review),
      status(404),
    );
  }
  assert.equal(await readSlackChannel(f.binding), null);
});
test("Reviewed actor and connection version are immutable inputs to confirmation", async () => {
  const f = await fixture();
  await captureSlackInstallation(
    config,
    { state: f.state, code: "synthetic-code" },
    f.send,
  );
  for (const changed of [
    { external_user_id: "UOTHER" },
    { workspace_id: "TOTHER" },
    { expected_bot_scopes: ["chat:write"] },
    { expected_version: 1 },
  ])
    await assert.rejects(
      confirmSlackInstallation(f.binding, f.start.id, config, {
        ...f.review,
        ...changed,
      }),
      status(409),
    );
  assert.equal(await readSlackChannel(f.binding), null);
  const first = await confirmSlackInstallation(
    f.binding,
    f.start.id,
    config,
    f.review,
  );
  const replay = await confirmSlackInstallation(f.binding, f.start.id, config, {
    ...f.review,
    dm_enabled: true,
  });
  assert.equal(replay.version, first.version);
  assert.equal(replay.dm_enabled, false);
});
test("A Slack actor cannot be mapped to two Orbyn owners", async () => {
  const f = await fixture(),
    other = await fixture();
  await captureSlackInstallation(
    config,
    { state: f.state, code: "synthetic-code" },
    f.send,
  );
  await confirmSlackInstallation(f.binding, f.start.id, config, f.review);
  await captureSlackInstallation(
    config,
    { state: other.state, code: "synthetic-code" },
    f.send,
  );
  await assert.rejects(
    confirmSlackInstallation(other.binding, other.start.id, config, f.review),
    status(409),
  );
  assert.equal(await readSlackChannel(other.binding), null);
});
test("Versioned DM opt-in, disable and unlink invalidate old revisions and clear credentials", async () => {
  const f = await fixture();
  await captureSlackInstallation(
    config,
    { state: f.state, code: "synthetic-code" },
    f.send,
  );
  await confirmSlackInstallation(f.binding, f.start.id, config, f.review);
  const enabled = await setSlackDmPermission(
    f.binding,
    { expected_version: 1, dm_enabled: true },
    config,
  );
  assert.equal(enabled.version, 2);
  assert.equal(enabled.dm_enabled, true);
  await assert.rejects(
    setSlackDmPermission(f.binding, { expected_version: 1, dm_enabled: false }),
    status(409),
  );
  const disabled = await setSlackDmPermission(f.binding, {
    expected_version: 2,
    dm_enabled: false,
  });
  assert.equal(disabled.dm_enabled, false);
  const unlinked = await disconnectSlackInstallation(f.binding, {
    expected_version: 3,
  });
  assert.equal(unlinked.version, 4);
  assert.equal(unlinked.disconnected, true);
  const stored = (
    await pool.query(
      "SELECT credentials_encrypted,dm_enabled FROM agent_channel_installations WHERE id=$1",
      [unlinked.id],
    )
  ).rows[0];
  assert.equal(stored.credentials_encrypted, null);
  assert.equal(stored.dm_enabled, false);
  await assert.rejects(
    setSlackDmPermission(
      f.binding,
      { expected_version: 4, dm_enabled: true },
      config,
    ),
    status(409),
  );
});
test("Session revocation and disabled owners cannot start, capture or confirm Slack installs", async () => {
  const f = await fixture();
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
    f.binding.userId,
  ]);
  await assert.rejects(beginSlackInstallation(f.binding, config), status(401));
  await assert.rejects(
    captureSlackInstallation(
      config,
      { state: f.state, code: "synthetic-code" },
      f.send,
    ),
    status(401),
  );
  const loggedOut = await fixture();
  await pool.query("DELETE FROM sessions WHERE id=$1", [
    loggedOut.binding.sessionId,
  ]);
  await assert.rejects(
    beginSlackInstallation(loggedOut.binding, config),
    status(401),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM agent_channel_oauth_pending WHERE id=$1",
        [loggedOut.start.id],
      )
    ).rowCount,
    0,
  );
});
test("Owner serialization bounds outstanding Slack OAuth requests under concurrency", async () => {
  const f = await fixture();
  const attempts = await Promise.allSettled(
    Array.from({ length: 6 }, () => beginSlackInstallation(f.binding, config)),
  );
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 4);
  for (const r of attempts) if (r.status === "rejected") status(429)(r.reason);
});
