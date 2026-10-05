import "./setup.js";
import { before, after, afterEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { encryptSecret, decryptSecret } = await import("../src/lib/secrets.js");
const { rotateSlackOne } =
  await import("../src/modules/agent-channels/rotation.js");
const { setSlackDmPermission, disconnectSlackInstallation } =
  await import("../src/modules/agent-channels/slack-installations.js");
const { queueAgentJobUpdate, deliverAgentChannelOne } =
  await import("../src/modules/agent-channels/outbox.js");
const owners: string[] = [];
const config = {
  clientId: "123.456",
  clientSecret: "synthetic-slack-client-secret",
  appId: "AFIXTURE",
  redirectUri: "https://orbyn.example/api/agent-channels/slack/callback",
};
before(() => migrate());
afterEach(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
});
after(() => pool.end());
const fresh = () => ({
  ok: true,
  token_type: "bot",
  scope: "chat:write,im:write",
  access_token: "synthetic-new-access",
  refresh_token: "synthetic-new-refresh",
  expires_in: 43200,
});
async function fixture() {
  const userId = randomUUID(),
    sessionId = randomUUID();
  owners.push(userId);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Rotation tester',true)",
    [userId, `${userId}@fixture.invalid`],
  );
  await pool.query(
    "INSERT INTO sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
    [sessionId, userId, randomUUID()],
  );
  const previous = {
    appId: config.appId,
    workspaceId: `T${userId.replaceAll("-", "").toUpperCase()}`,
    workspaceName: "Fixture",
    userId: `U${userId.replaceAll("-", "").toUpperCase()}`,
    botUserId: "UBOT",
    accessToken: "synthetic-old-access",
    refreshToken: "synthetic-old-refresh",
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    scopes: ["chat:write", "im:write"],
  };
  const encrypted = await encryptSecret(JSON.stringify(previous));
  const connection = (
    await pool.query(
      `INSERT INTO agent_channel_installations(user_id,provider,app_id,workspace_id,workspace_name,external_user_id,bot_user_id,scopes,credentials_encrypted,token_expires_at,dm_enabled)
  VALUES($1,'slack',$2,$3,'Fixture',$4,'UBOT',ARRAY['chat:write','im:write'],$5,$6,true) RETURNING id`,
      [
        userId,
        config.appId,
        previous.workspaceId,
        previous.userId,
        encrypted,
        previous.expiresAt,
      ],
    )
  ).rows[0].id as string;
  return { userId, connection, previous, binding: { userId, sessionId } };
}
async function row(f: Awaited<ReturnType<typeof fixture>>) {
  return (
    await pool.query("SELECT * FROM agent_channel_installations WHERE id=$1", [
      f.connection,
    ])
  ).rows[0];
}
function sender(response: () => Response = () => Response.json(fresh())) {
  const calls: string[] = [];
  const request: typeof fetch = async (_url, init) => {
    calls.push(
      new URLSearchParams(String(init?.body)).get("refresh_token") ?? "",
    );
    return response();
  };
  return { calls, request };
}
test("concurrent workers redeem one token and replace its encrypted pair without changing mapping or consent revision", async () => {
  const f = await fixture(),
    s = sender();
  await Promise.all(
    Array.from({ length: 4 }, () => rotateSlackOne(config, s.request)),
  );
  assert.deepEqual(s.calls, ["synthetic-old-refresh"]);
  const current = await row(f);
  assert.equal(current.refresh_state, "ready");
  assert.equal(current.refresh_claim, null);
  assert.equal(current.refresh_attempts, 0);
  assert.equal(current.version, 1);
  assert.equal(current.dm_enabled, true);
  const decoded = JSON.parse(
    await decryptSecret(current.credentials_encrypted),
  );
  assert.equal(decoded.refreshToken, "synthetic-new-refresh");
  assert.equal(decoded.userId, f.previous.userId);
  assert.equal(decoded.workspaceId, f.previous.workspaceId);
  assert.equal(decoded.expiresAt, current.token_expires_at.toISOString());
  assert.equal(await rotateSlackOne(config, s.request), false);
});
test("transport ambiguity and expired dispatch claims clear credentials and never replay a refresh token", async () => {
  const f = await fixture();
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    throw new Error("private-token");
  };
  await rotateSlackOne(config, request);
  assert.equal(calls, 1);
  const current = await row(f);
  assert.equal(current.refresh_state, "unknown");
  assert.equal(current.credentials_encrypted, null);
  assert.equal(current.dm_enabled, false);
  assert.equal(current.version, 2);
  assert.equal(await rotateSlackOne(config, request), false);
  assert.equal(calls, 1);
  const abandoned = await fixture();
  await pool.query(
    "UPDATE agent_channel_installations SET refresh_state='refreshing',refresh_claim=gen_random_uuid(),refresh_lease_until=now()-interval '1 second',refresh_config_hash='fixture' WHERE id=$1",
    [abandoned.connection],
  );
  await rotateSlackOne(config, request);
  assert.equal((await row(abandoned)).refresh_state, "unknown");
  assert.equal((await row(abandoned)).credentials_encrypted, null);
  assert.equal(calls, 1);
});
test("known invalid-token refusal requires explicit reconnect and cannot be silently re-enabled", async () => {
  const f = await fixture(),
    s = sender(() =>
      Response.json({ ok: false, error: "invalid_refresh_token" }),
    );
  await rotateSlackOne(config, s.request);
  assert.equal((await row(f)).refresh_state, "reconnect");
  await assert.rejects(
    () =>
      setSlackDmPermission(
        f.binding,
        { expected_version: 2, dm_enabled: true },
        config,
      ),
    (error: unknown) => (error as { statusCode: number }).statusCode === 409,
  );
  assert.equal(await rotateSlackOne(config, s.request), false);
  assert.equal(s.calls.length, 1);
});
test("rate-limit retry respects availability and stops after three declared refusals", async () => {
  const f = await fixture(),
    s = sender(
      () => new Response("", { status: 429, headers: { "retry-after": "17" } }),
    );
  for (let i = 1; i <= 3; i++) {
    await rotateSlackOne(config, s.request);
    const current = await row(f);
    if (i < 3) {
      assert.equal(current.refresh_state, "ready");
      assert.equal(current.refresh_attempts, i);
      assert.ok(current.refresh_available_at.getTime() > Date.now() + 15000);
      assert.equal(await rotateSlackOne(config, s.request), false);
      await pool.query(
        "UPDATE agent_channel_installations SET refresh_available_at=now()-interval '1 second' WHERE id=$1",
        [f.connection],
      );
    } else {
      assert.equal(current.refresh_state, "reconnect");
      assert.equal(current.credentials_encrypted, null);
    }
  }
  assert.equal(s.calls.length, 3);
});
test("revoked owner, account mapping, app and non-rotating credentials cannot be redeemed", async () => {
  for (const kind of ["owner", "unlink", "mapping", "app", "nonrotating"]) {
    const f = await fixture(),
      s = sender();
    if (kind === "owner")
      await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
        f.userId,
      ]);
    if (kind === "unlink")
      await disconnectSlackInstallation(f.binding, { expected_version: 1 });
    if (kind === "mapping")
      await pool.query(
        "UPDATE agent_channel_installations SET workspace_id='TOTHER' WHERE id=$1",
        [f.connection],
      );
    if (kind === "app")
      await pool.query(
        "UPDATE agent_channel_installations SET app_id='AOTHER' WHERE id=$1",
        [f.connection],
      );
    if (kind === "nonrotating")
      await pool.query(
        "UPDATE agent_channel_installations SET token_expires_at=NULL WHERE id=$1",
        [f.connection],
      );
    await rotateSlackOne(config, s.request);
    assert.equal(s.calls.length, 0);
    await pool.query("DELETE FROM users WHERE id=$1", [f.userId]);
  }
});
test("a failed commit after token redemption remains unknown even if the database error is a lock refusal", async () => {
  const f = await fixture();
  let accepted = false,
    failOnce = true;
  const hooked = new WeakSet<object>();
  const acquire = (connection: import("pg").PoolClient) => {
    if (hooked.has(connection)) return;
    hooked.add(connection);
    const query = connection.query.bind(connection) as (
      ...args: unknown[]
    ) => unknown;
    mock.method(connection, "query", (...args: unknown[]) => {
      if (args[0] === "COMMIT" && accepted && failOnce) {
        failOnce = false;
        return Promise.reject(
          Object.assign(new Error("Synthetic commit refusal"), {
            code: "55P03",
          }),
        );
      }
      return query(...args);
    });
  };
  pool.on("acquire", acquire);
  const s = sender(() => {
    accepted = true;
    return Response.json(fresh());
  });
  try {
    await rotateSlackOne(config, s.request);
    assert.equal(failOnce, false);
    assert.equal((await row(f)).refresh_state, "unknown");
    assert.equal((await row(f)).credentials_encrypted, null);
    assert.equal(await rotateSlackOne(config, s.request), false);
    assert.equal(s.calls.length, 1);
  } finally {
    pool.off("acquire", acquire);
    mock.restoreAll();
  }
});
test("a cold pool1 worker decrypts and publishes rotating credentials outside authority transactions", async () => {
  const f = await fixture();
  const script = `await import('./backend/tests/setup.ts');const {rotateSlackOne}=await import('./backend/src/modules/agent-channels/rotation.ts');const {pool}=await import('./backend/src/db/pool.ts');let calls=0;try {const worked=await rotateSlackOne(${JSON.stringify(config)},async()=>{calls++;return Response.json(${JSON.stringify(fresh())});});process.stdout.write(JSON.stringify({worked,calls}));}finally{await pool.end();}`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...process.env, DB_POOL_MAX: "1", SECRETS_KEY: "" },
      timeout: 15000,
    },
  );
  assert.deepEqual(JSON.parse(stdout), { worked: true, calls: 1 });
  assert.equal((await row(f)).refresh_state, "ready");
});
test("delivery defers a rotating token and resumes with the new credential without spending send attempts", async () => {
  const f = await fixture();
  const chat = randomUUID();
  await pool.query(
    "INSERT INTO agent_grants(user_id,kind,access,team_ids) VALUES($1,'assistant','write',NULL)",
    [f.userId],
  );
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Private work','goal')",
    [chat, f.userId],
  );
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,state,run_state,run_origin,sources_checked) VALUES($1,$2,'done',$3,'goal',true) RETURNING id",
      [
        f.userId,
        chat,
        JSON.stringify({
          version: 1,
          request: { automation: { kind: "goal" } },
          state: {},
        }),
      ],
    )
  ).rows[0].id;
  await queueAgentJobUpdate(pool, job, "done");
  await pool.query(
    "UPDATE agent_channel_installations SET refresh_state='refreshing',refresh_claim=gen_random_uuid(),refresh_lease_until=now()+interval '1 minute',refresh_config_hash='fixture' WHERE id=$1",
    [f.connection],
  );
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer synthetic-new-access",
    );
    return String(url).endsWith("conversations.open")
      ? Response.json({ ok: true, channel: { id: "DFIXTURE" } })
      : Response.json({
          ok: true,
          channel: "DFIXTURE",
          ts: "1234567890.123456",
        });
  };
  await deliverAgentChannelOne(config, "https://orbyn.example", request);
  assert.equal(calls, 0);
  let queued = (
    await pool.query("SELECT * FROM agent_channel_outbox WHERE user_id=$1", [
      f.userId,
    ])
  ).rows[0];
  assert.equal(queued.state, "queued");
  assert.equal(queued.attempts, 0);
  await pool.query(
    "UPDATE agent_channel_installations SET refresh_state='ready',refresh_claim=NULL,refresh_lease_until=NULL,refresh_config_hash=NULL WHERE id=$1",
    [f.connection],
  );
  await rotateSlackOne(config, sender().request);
  await pool.query(
    "UPDATE agent_channel_outbox SET available_at=now() WHERE id=$1",
    [queued.id],
  );
  await deliverAgentChannelOne(config, "https://orbyn.example", request);
  queued = (
    await pool.query("SELECT * FROM agent_channel_outbox WHERE id=$1", [
      queued.id,
    ])
  ).rows[0];
  assert.equal(queued.state, "sent");
  assert.equal(calls, 2);
  assert.equal(queued.attempts, 1);
});

test("a busy owner fence defers before HTTP without spending a refresh attempt", async () => {
  const f = await fixture(),
    s = sender(),
    holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      f.userId,
    ]);
    await rotateSlackOne(config, s.request);
    assert.equal(s.calls.length, 0);
    const current = await row(f);
    assert.equal(current.refresh_state, "ready");
    assert.equal(current.refresh_attempts, 0);
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }
  await pool.query(
    "UPDATE agent_channel_installations SET refresh_available_at=now() WHERE id=$1",
    [f.connection],
  );
  await rotateSlackOne(config, s.request);
  assert.equal(s.calls.length, 1);
});
test("a concurrent DM consent change waits for redemption and successful refresh cannot re-enable it", async () => {
  const f = await fixture(),
    writer = await pool.connect();
  const pid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0]
    .pid;
  let mutation: Promise<unknown> | undefined,
    changed = false,
    observed = false;
  try {
    await rotateSlackOne(config, async () => {
      mutation = writer
        .query(
          "UPDATE agent_channel_installations SET dm_enabled=false,version=version+1 WHERE id=$1",
          [f.connection],
        )
        .then(() => {
          changed = true;
        });
      for (let i = 0; i < 200; i++) {
        const locked = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",
          [pid],
        );
        if (locked.rowCount) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(observed, true);
      assert.equal(changed, false);
      return Response.json(fresh());
    });
    await mutation;
    const current = await row(f);
    assert.equal(current.refresh_state, "ready");
    assert.equal(current.version, 2);
    assert.equal(current.dm_enabled, false);
    assert.equal(
      JSON.parse(await decryptSecret(current.credentials_encrypted))
        .refreshToken,
      "synthetic-new-refresh",
    );
  } finally {
    await mutation?.catch(() => undefined);
    writer.release();
  }
});
