import "./setup.js";
import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { decryptSecret } = await import("../src/lib/secrets.js");
const {
  beginSlackInstallation,
  captureSlackInstallation,
  confirmSlackInstallation,
  readSlackChannel,
  readSlackInstallationRequest,
  disconnectSlackInstallation,
  setSlackDmPermission,
} = await import("../src/modules/agent-channels/slack-installations.js");
const { rotateSlackOne } =
  await import("../src/modules/agent-channels/rotation.js");
const { queueAgentJobUpdate, deliverAgentChannelOne } =
  await import("../src/modules/agent-channels/outbox.js");
const config = {
  clientId: "123.456",
  clientSecret: "synthetic-slack-client-secret",
  appId: "AFIXTURE",
  redirectUri: "https://orbyn.example/api/agent-channels/slack/callback",
};
const owners: string[] = [];
before(() => migrate());
afterEach(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
});
after(() => pool.end());
async function fixture(
  workspace = `T${randomUUID().replaceAll("-", "").toUpperCase()}`,
) {
  const userId = randomUUID(),
    sessionId = randomUUID(),
    actor = `U${userId.replaceAll("-", "").toUpperCase()}`;
  owners.push(userId);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Vault tester',true)",
    [userId, `${userId}@fixture.invalid`],
  );
  await pool.query(
    "INSERT INTO sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
    [sessionId, userId, randomUUID()],
  );
  return { binding: { userId, sessionId }, workspace, actor };
}
async function connect(
  f: Awaited<ReturnType<typeof fixture>>,
  version = 0,
  scopes = ["chat:write", "im:write"],
) {
  const start = await beginSlackInstallation(f.binding, config);
  const state = new URL(start.authorization_url).searchParams.get("state")!;
  await captureSlackInstallation(
    config,
    { state, code: "synthetic-code" },
    async () =>
      Response.json({
        ok: true,
        app_id: config.appId,
        token_type: "bot",
        access_token: `synthetic-${f.actor}`,
        refresh_token: `synthetic-refresh-${f.actor}`,
        expires_in: 120,
        bot_user_id: "UBOT",
        scope: scopes.join(","),
        authed_user: { id: f.actor },
        team: { id: f.workspace, name: "Shared fixture" },
        is_enterprise_install: false,
      }),
  );
  const review = await readSlackInstallationRequest(
    f.binding,
    start.id,
    config,
  );
  assert.ok(review.identity);
  return confirmSlackInstallation(f.binding, start.id, config, {
    workspace_id: f.workspace,
    external_user_id: f.actor,
    expected_bot_scopes: review.identity.bot_scopes,
    expected_version: version,
    dm_enabled: true,
  });
}
async function vault(f: Awaited<ReturnType<typeof fixture>>) {
  return (
    await pool.query(
      "SELECT v.* FROM agent_channel_installations c JOIN agent_channel_bot_vaults v ON v.id=c.bot_vault_id WHERE c.user_id=$1",
      [f.binding.userId],
    )
  ).rows[0];
}
const refreshed = () =>
  Response.json({
    ok: true,
    token_type: "bot",
    scope: "chat:write,im:write",
    access_token: "synthetic-canonical-access",
    refresh_token: "synthetic-canonical-refresh",
    expires_in: 43200,
  });
async function job(f: Awaited<ReturnType<typeof fixture>>) {
  const chat = randomUUID();
  await pool.query(
    "INSERT INTO agent_grants(user_id,kind,access,team_ids) VALUES($1,'assistant','write',NULL)",
    [f.binding.userId],
  );
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,$3,'goal')",
    [chat, f.binding.userId, `Private ${f.actor}`],
  );
  const id = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,state,run_state,run_origin,sources_checked) VALUES($1,$2,'done',$3,'goal',true) RETURNING id",
      [
        f.binding.userId,
        chat,
        JSON.stringify({
          version: 1,
          request: { automation: { kind: "goal" } },
          state: {},
        }),
      ],
    )
  ).rows[0].id;
  await queueAgentJobUpdate(pool, id, "done");
}
test("three owners share exactly one encrypted bot pair and one refresh claim, while identities/consents remain private", async () => {
  const a = await fixture(),
    b = await fixture(a.workspace),
    c = await fixture(a.workspace);
  for (const f of [a, b, c]) await connect(f);
  const original = await vault(a);
  assert.equal(original.id, (await vault(b)).id);
  assert.equal(original.id, (await vault(c)).id);
  assert.equal(original.installer_external_user_id, c.actor);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM agent_channel_installations WHERE bot_vault_id=$1 AND credentials_encrypted IS NOT NULL",
        [original.id],
      )
    ).rows[0].n,
    0,
  );
  let calls = 0;
  await Promise.all(
    Array.from({ length: 6 }, () =>
      rotateSlackOne(config, async (_url, init) => {
        calls++;
        assert.equal(
          new URLSearchParams(String(init?.body)).get("refresh_token"),
          `synthetic-refresh-${c.actor}`,
        );
        return refreshed();
      }),
    ),
  );
  assert.equal(calls, 1);
  for (const f of [a, b, c]) {
    const status = await readSlackChannel(f.binding);
    assert.equal(status?.external_user_id, f.actor);
    assert.equal(status?.version, 1);
    assert.equal(status?.dm_enabled, true);
    assert.equal(status?.token_state, "ready");
    assert.doesNotMatch(
      JSON.stringify(status),
      /synthetic|credentials_encrypted|installer_external_user_id|bot_vault_id/,
    );
  }
  assert.equal(
    JSON.parse(await decryptSecret((await vault(a)).credentials_encrypted))
      .userId,
    c.actor,
  );
});
test("each owner DM uses the canonical token but its own verified recipient and source", async () => {
  const a = await fixture(),
    b = await fixture(a.workspace);
  await connect(a);
  await connect(b);
  await rotateSlackOne(config, async () => refreshed());
  await job(a);
  await job(b);
  const recipients: string[] = [],
    messages: string[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer synthetic-canonical-access",
    );
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("conversations.open")) {
      recipients.push(body.users);
      return Response.json({
        ok: true,
        channel: { id: `D${body.users.slice(1)}` },
      });
    }
    messages.push(body.text);
    return Response.json({
      ok: true,
      channel: body.channel,
      ts: "1234567890.123456",
    });
  };
  await deliverAgentChannelOne(config, "https://orbyn.example", request);
  await deliverAgentChannelOne(config, "https://orbyn.example", request);
  assert.deepEqual(recipients, [a.actor, b.actor]);
  assert.equal(messages.length, 2);
  assert.ok(messages[0].includes(`Private ${a.actor}`));
  assert.ok(!messages[0].includes(b.actor));
  assert.ok(messages[1].includes(`Private ${b.actor}`));
  assert.ok(!messages[1].includes(a.actor));
});
test("unlinking the OAuth installer preserves other owners; deleting the last owner erases the pair without provider HTTP", async () => {
  const a = await fixture(),
    b = await fixture(a.workspace);
  await connect(a);
  await connect(b);
  await disconnectSlackInstallation(b.binding, { expected_version: 1 });
  assert.ok((await vault(a)).credentials_encrypted);
  assert.equal((await readSlackChannel(a.binding))?.version, 1);
  let calls = 0;
  await rotateSlackOne(config, async () => {
    calls++;
    return refreshed();
  });
  assert.equal(calls, 1);
  const id = (await vault(a)).id;
  await pool.query("DELETE FROM users WHERE id=$1", [a.binding.userId]);
  const current = (
    await pool.query("SELECT * FROM agent_channel_bot_vaults WHERE id=$1", [id])
  ).rows[0];
  assert.equal(current.credentials_encrypted, null);
  assert.equal(current.refresh_state, "reconnect");
  assert.equal(
    await rotateSlackOne(config, async () => {
      calls++;
      return refreshed();
    }),
    false,
  );
  assert.equal(calls, 1);
});
test("a changed scope set disables other DM consents and requires their own review", async () => {
  const a = await fixture(),
    b = await fixture(a.workspace);
  await connect(a);
  await connect(b, 0, ["chat:write", "im:write", "channels:read"]);
  const old = await readSlackChannel(a.binding);
  assert.equal(old?.dm_enabled, false);
  assert.equal(old?.version, 2);
  assert.equal(old?.token_state, "reconnect");
  await assert.rejects(
    setSlackDmPermission(
      a.binding,
      { expected_version: 2, dm_enabled: true },
      config,
    ),
    (e: unknown) => (e as { statusCode: number }).statusCode === 409,
  );
  assert.equal((await readSlackChannel(b.binding))?.dm_enabled, true);
});
test("uncertain shared redemption clears the pair and all recipient DM permissions without replay", async () => {
  const a = await fixture(),
    b = await fixture(a.workspace);
  await connect(a);
  await connect(b);
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    throw new Error("synthetic-secret");
  };
  await rotateSlackOne(config, request);
  assert.equal(calls, 1);
  for (const f of [a, b]) {
    const current = await readSlackChannel(f.binding);
    assert.equal(current?.dm_enabled, false);
    assert.equal(current?.token_state, "unknown");
    assert.equal(current?.version, 2);
  }
  assert.equal((await vault(a)).credentials_encrypted, null);
  assert.equal(await rotateSlackOne(config, request), false);
  assert.equal(calls, 1);
});
test("disconnecting the last recipient after redemption cannot publish or resurrect a new credential", async () => {
  const a = await fixture();
  await connect(a);
  // Run unlink after the guarded HTTP transaction releases its owner locks but
  // before publication, by holding the permission transaction in the fetch callback.
  const writer = await pool.connect();
  const pid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0]
    .pid;
  let unlink: Promise<unknown> | undefined;
  try {
    await rotateSlackOne(config, async () => {
      unlink = writer.query(
        "UPDATE agent_channel_installations SET dm_enabled=false,disconnected_at=now(),version=version+1 WHERE user_id=$1",
        [a.binding.userId],
      );
      let blocked = false;
      for (let i = 0; i < 200; i++) {
        if (
          (
            await pool.query(
              "SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",
              [pid],
            )
          ).rowCount
        ) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(blocked, true);
      return refreshed();
    });
    await unlink;
    const current = await vault(a);
    assert.equal(current.credentials_encrypted, null);
    assert.equal(current.refresh_state, "reconnect");
    assert.equal((await readSlackChannel(a.binding))?.disconnected, true);
  } finally {
    await unlink?.catch(() => undefined);
    writer.release();
  }
});

test("vault upgrade clears legacy competing credentials and invalidates pre-upgrade pending exchanges", async () => {
  const { readFile } = await import("node:fs/promises");
  const schema = `vault_upgrade_${randomUUID().replaceAll("-", "")}`;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    await db.query(
      "CREATE TABLE users(id uuid PRIMARY KEY); CREATE TABLE sessions(id uuid PRIMARY KEY)",
    );
    for (const file of [
      "241_agent_channel_installations.sql",
      "243_agent_channel_rotation.sql",
    ])
      await db.query(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    const a = randomUUID(),
      b = randomUUID(),
      session = randomUUID();
    await db.query("INSERT INTO users VALUES($1),($2)", [a, b]);
    await db.query("INSERT INTO sessions VALUES($1)", [session]);
    await db.query(
      `INSERT INTO agent_channel_installations(user_id,provider,app_id,workspace_id,workspace_name,external_user_id,bot_user_id,scopes,credentials_encrypted,dm_enabled)
   VALUES($1,'slack','AFIXTURE','TFIXTURE','Fixture','UA','UBOT',ARRAY['chat:write','im:write'],'synthetic-old-pair-a',true),
   ($2,'slack','AFIXTURE','TFIXTURE','Fixture','UB','UBOT',ARRAY['chat:write','im:write'],'synthetic-old-pair-b',true)`,
      [a, b],
    );
    await db.query(
      `UPDATE agent_channel_installations SET refresh_state='refreshing',refresh_claim=gen_random_uuid(),refresh_lease_until=now()+interval '1 minute',refresh_config_hash='fixture' WHERE user_id=$1`,
      [a],
    );
    await db.query(
      `INSERT INTO agent_channel_oauth_pending(user_id,session_id,state_hash,config_hash,state,installation_encrypted)
   VALUES($1,$2,repeat('a',64),repeat('b',64),'ready','synthetic-pending-pair')`,
      [a, session],
    );
    for (const file of [
      "244_agent_channel_bot_vault.sql",
      "245_agent_channel_vault_pending.sql",
    ])
      await db.query(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    const rows = (
      await db.query(
        "SELECT * FROM agent_channel_installations ORDER BY user_id",
      )
    ).rows;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.credentials_encrypted, null);
      assert.equal(row.dm_enabled, false);
      assert.equal(row.bot_vault_id, null);
      assert.equal(row.refresh_state, "reconnect");
      assert.equal(row.refresh_claim, null);
      assert.equal(row.version, 2);
    }
    const pending = (
      await db.query("SELECT * FROM agent_channel_oauth_pending")
    ).rows[0];
    assert.equal(pending.state, "failed");
    assert.equal(pending.installation_encrypted, null);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM agent_channel_bot_vaults",
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(
      db.query(
        "UPDATE agent_channel_installations SET credentials_encrypted='synthetic-secret' WHERE user_id=$1",
        [a],
      ),
      (e: unknown) => (e as { code: string }).code === "23514",
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("equivalent returned scope order does not change another owner permission or revision", async () => {
  const a = await fixture(),
    b = await fixture(a.workspace);
  await connect(a);
  await connect(b, 0, ["im:write", "chat:write"]);
  const current = await readSlackChannel(a.binding);
  assert.equal(current?.version, 1);
  assert.equal(current?.dm_enabled, true);
  assert.equal(current?.token_state, "ready");
  assert.deepEqual(current?.bot_scopes, ["chat:write", "im:write"]);
});
test("concurrent owner deletion erases only the last shared pair and leaves no owner credential copy", async () => {
  const a = await fixture(),
    b = await fixture(a.workspace),
    c = await fixture(a.workspace);
  for (const f of [a, b, c]) await connect(f);
  const id = (await vault(a)).id;
  await Promise.all(
    [a, b, c].map((f) =>
      pool.query("DELETE FROM users WHERE id=$1", [f.binding.userId]),
    ),
  );
  const current = (
    await pool.query("SELECT * FROM agent_channel_bot_vaults WHERE id=$1", [id])
  ).rows[0];
  assert.equal(current.credentials_encrypted, null);
  assert.equal(current.refresh_claim, null);
  assert.equal(current.refresh_state, "reconnect");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM agent_channel_installations WHERE bot_vault_id=$1",
        [id],
      )
    ).rows[0].n,
    0,
  );
});

async function pending(f: Awaited<ReturnType<typeof fixture>>) {
  const start = await beginSlackInstallation(f.binding, config),
    state = new URL(start.authorization_url).searchParams.get("state")!;
  await captureSlackInstallation(
    config,
    { state, code: "synthetic-code" },
    async () =>
      Response.json({
        ok: true,
        app_id: config.appId,
        token_type: "bot",
        access_token: `synthetic-pending-${f.actor}`,
        refresh_token: `synthetic-pending-refresh-${f.actor}`,
        expires_in: 120,
        bot_user_id: "UBOT",
        scope: "chat:write,im:write",
        authed_user: { id: f.actor },
        team: { id: f.workspace, name: "Shared fixture" },
        is_enterprise_install: false,
      }),
  );
  return {
    id: start.id,
    review: {
      workspace_id: f.workspace,
      external_user_id: f.actor,
      expected_bot_scopes: ["chat:write", "im:write"],
      expected_version: 0,
      dm_enabled: true,
    },
  };
}
test("a captured OAuth pair cannot replace a newer canonical rotation", async () => {
  const a = await fixture(),
    b = await fixture(a.workspace);
  await connect(a);
  const captured = await pending(b);
  const original = await vault(a);
  await rotateSlackOne(config, async () => refreshed());
  const current = await vault(a);
  assert.ok(
    BigInt(current.credential_generation) >
      BigInt(original.credential_generation),
  );
  await assert.rejects(
    confirmSlackInstallation(b.binding, captured.id, config, captured.review),
    (e: unknown) => (e as { statusCode: number }).statusCode === 409,
  );
  assert.equal(await readSlackChannel(b.binding), null);
  const pendingState = (
    await pool.query(
      "SELECT state,installation_encrypted FROM agent_channel_oauth_pending WHERE id=$1",
      [captured.id],
    )
  ).rows[0];
  assert.equal(pendingState.state, "failed");
  assert.equal(pendingState.installation_encrypted, null);
  assert.equal(
    (await vault(a)).credentials_encrypted,
    current.credentials_encrypted,
  );
  assert.equal((await readSlackChannel(a.binding))?.dm_enabled, true);
  assert.equal((await readSlackChannel(a.binding))?.version, 1);
});
test("a captured OAuth pair cannot replace another owner newer reviewed connection", async () => {
  const a = await fixture(),
    b = await fixture(a.workspace),
    c = await fixture(a.workspace);
  await connect(a);
  const captured = await pending(b);
  await connect(c);
  const current = await vault(a);
  await assert.rejects(
    confirmSlackInstallation(b.binding, captured.id, config, captured.review),
    (e: unknown) => (e as { statusCode: number }).statusCode === 409,
  );
  assert.equal(await readSlackChannel(b.binding), null);
  const pendingState = (
    await pool.query(
      "SELECT state,installation_encrypted FROM agent_channel_oauth_pending WHERE id=$1",
      [captured.id],
    )
  ).rows[0];
  assert.equal(pendingState.state, "failed");
  assert.equal(pendingState.installation_encrypted, null);
  assert.equal(
    (await vault(a)).credentials_encrypted,
    current.credentials_encrypted,
  );
  assert.equal(current.installer_external_user_id, c.actor);
});
