import "./setup.js";
import { before, after, afterEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { encryptSecret } = await import("../src/lib/secrets.js");
const { queueAgentJobUpdate, queueAgentNightUpdate, deliverAgentChannelOne } =
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
  await pool.query(
    "DELETE FROM agent_channel_outbox WHERE user_id=ANY($1::uuid[])",
    [owners],
  );
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function fixture(kind = "goal", state = "done") {
  const owner = randomUUID(),
    chat = randomUUID(),
    project = randomUUID(),
    waitingId = randomUUID();
  owners.push(owner);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Channel tester',true)",
    [owner, `${owner}@fixture.invalid`],
  );
  await pool.query(
    "INSERT INTO agent_grants(user_id,kind,access,team_ids) VALUES($1,'assistant','write',NULL)",
    [owner],
  );
  await pool.query(
    "INSERT INTO automation_agent_identities(user_id,lane,name) VALUES($1,'background','Fern'),($1,'overnight','Luna')",
    [owner],
  );
  await pool.query(
    "INSERT INTO projects(id,user_id,name) VALUES($1,$2,'Private project')",
    [project, owner],
  );
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,project_id,title,origin) VALUES($1,$2,$3,'Private work',$4)",
    [chat, owner, project, kind === "person" ? "person" : kind],
  );
  const runState = {
    version: 1,
    request: { ...(kind === "person" ? {} : { automation: { kind } }) },
    state: {
      waiting:
        state === "waiting"
          ? {
              kind: "person",
              id: waitingId,
              question: "Which option?",
              choices: ["A", "B"],
            }
          : null,
    },
  };
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,state,run_state,run_origin,sources_checked) VALUES($1,$2,$3,$4,$5,true) RETURNING id",
      [owner, chat, state, JSON.stringify(runState), kind],
    )
  ).rows[0].id as string;
  const actor = `U${owner.replaceAll("-", "").toUpperCase()}`,
    workspace = `T${owner.replaceAll("-", "").toUpperCase()}`;
  const credentials = await encryptSecret(
    JSON.stringify({
      appId: config.appId,
      workspaceId: workspace,
      workspaceName: "Fixture",
      userId: actor,
      botUserId: "UBOT",
      accessToken: "synthetic-bot-token",
      expiresAt: null,
      scopes: ["chat:write", "im:write"],
    }),
  );
  const connection = (
    await pool.query(
      `INSERT INTO agent_channel_installations(user_id,provider,app_id,workspace_id,workspace_name,external_user_id,bot_user_id,scopes,credentials_encrypted,dm_enabled)
    VALUES($1,'slack',$2,$3,'Fixture',$4,'UBOT',ARRAY['chat:write','im:write'],$5,true) RETURNING id`,
      [owner, config.appId, workspace, actor, credentials],
    )
  ).rows[0].id as string;
  return { owner, job, chat, connection, project, waitingId };
}
async function intent(
  f: Awaited<ReturnType<typeof fixture>>,
  event: "done" | "failed" | "waiting" = "done",
) {
  await queueAgentJobUpdate(
    pool,
    f.job,
    event,
    event === "waiting" ? f.waitingId : "",
  );
  return (
    await pool.query(
      "SELECT * FROM agent_channel_outbox WHERE user_id=$1 ORDER BY created_at",
      [f.owner],
    )
  ).rows;
}
async function receipt(owner: string) {
  return (
    await pool.query(
      "SELECT * FROM agent_channel_outbox WHERE user_id=$1 ORDER BY created_at",
      [owner],
    )
  ).rows[0];
}
function sender(
  last: () => Response = () =>
    Response.json({ ok: true, channel: "DFIXTURE", ts: "1234567890.123456" }),
) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return String(url).endsWith("conversations.open")
      ? Response.json({ ok: true, channel: { id: "DFIXTURE" } })
      : last();
  };
  return { calls, request };
}

test("Background intents commit once with transitions and dispatch an accessible current question", async () => {
  const f = await fixture("goal", "waiting");
  await Promise.all(Array.from({ length: 5 }, () => intent(f, "waiting")));
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM agent_channel_outbox WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].count,
    "1",
  );
  const s = sender();
  assert.equal(
    await deliverAgentChannelOne(config, "https://orbyn.example", s.request),
    true,
  );
  assert.equal((await receipt(f.owner)).state, "sent");
  assert.equal(s.calls.length, 2);
  assert.match(String(s.calls[1].body.text), /Which option\?/);
  assert.match(String(s.calls[1].body.text), /^Fern · Background/);
  assert.match(String(s.calls[1].body.text), /Private work/);
  assert.doesNotMatch(
    JSON.stringify(s.calls[1].body),
    /orbyn\.approve|synthetic-bot-token/,
  );
  assert.equal(
    await deliverAgentChannelOne(config, "https://orbyn.example", s.request),
    false,
  );
  assert.equal(s.calls.length, 2);
  assert.equal((await receipt(f.owner)).message_ts, "1234567890.123456");
});

test("Outbox insertion rolls back with the source transition", async () => {
  const f = await fixture();
  await assert.rejects(
    transaction(async (db) => {
      await queueAgentJobUpdate(db, f.job, "done");
      throw new Error("Rollback fixture");
    }),
  );
  assert.equal(await receipt(f.owner), undefined);
});

test("Interactive, hidden ideas and every individual Overnight job stay out of the DM queue", async () => {
  for (const kind of ["person", "idea", "night"]) {
    const f = await fixture(kind);
    assert.equal((await intent(f)).length, 0);
  }
});

test("Overnight sends one generic morning summary after its window ends", async () => {
  const f = await fixture("night"),
    night = randomUUID();
  await pool.query(
    "INSERT INTO assistant_nights(id,user_id,local_day,summary) VALUES($1,$2,current_date,$3)",
    [
      night,
      f.owner,
      JSON.stringify({ end_at: new Date(Date.now() + 60000).toISOString() }),
    ],
  );
  await queueAgentNightUpdate(pool, night, f.owner);
  assert.equal(await receipt(f.owner), undefined);
  await pool.query("UPDATE assistant_nights SET summary=$2 WHERE id=$1", [
    night,
    JSON.stringify({ end_at: new Date(Date.now() - 60000).toISOString() }),
  ]);
  await Promise.all(
    Array.from({ length: 5 }, () =>
      queueAgentNightUpdate(pool, night, f.owner),
    ),
  );
  const s = sender();
  await deliverAgentChannelOne(config, "https://orbyn.example", s.request);
  assert.equal((await receipt(f.owner)).state, "sent");
  assert.equal(s.calls.length, 2);
  assert.match(String(s.calls[1].body.text), /Overnight results/);
  assert.match(String(s.calls[1].body.text), /^Luna · Overnight/);
  assert.doesNotMatch(String(s.calls[1].body.text), /Private work/);
  await queueAgentNightUpdate(pool, night, f.owner);
  assert.equal(
    await deliverAgentChannelOne(config, "https://orbyn.example", s.request),
    false,
  );
});

test("Revoked consent, changed account, disabled owner, expired token and absent grant cancel before network", async () => {
  for (const change of [
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query(
        "UPDATE agent_channel_installations SET dm_enabled=false,version=version+1 WHERE id=$1",
        [f.connection],
      ),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query(
        "UPDATE agent_channel_installations SET external_user_id='UCHANGED',version=version+1 WHERE id=$1",
        [f.connection],
      ),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query("UPDATE users SET disabled=true WHERE id=$1", [f.owner]),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query(
        "UPDATE agent_channel_installations SET token_expires_at=now()-interval '1 second' WHERE id=$1",
        [f.connection],
      ),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query(
        "UPDATE agent_grants SET suspended_at=now() WHERE user_id=$1",
        [f.owner],
      ),
  ]) {
    const f = await fixture();
    await intent(f);
    await change(f);
    const s = sender();
    await deliverAgentChannelOne(config, "https://orbyn.example", s.request);
    assert.equal(s.calls.length, 0);
    assert.equal((await receipt(f.owner)).state, "cancelled");
  }
});

test("Lost project access, unchecked provenance and stale waiting IDs never disclose titles", async () => {
  for (const change of [
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
        f.project,
      ]),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query("UPDATE ai_jobs SET sources_checked=false WHERE id=$1", [
        f.job,
      ]),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query(
        "UPDATE ai_jobs SET run_state=jsonb_set(run_state,'{state,waiting,id}',to_jsonb($2::text)) WHERE id=$1",
        [f.job, randomUUID()],
      ),
  ]) {
    const f = await fixture("goal", "waiting");
    await intent(f, "waiting");
    await change(f);
    const s = sender();
    await deliverAgentChannelOne(config, "https://orbyn.example", s.request);
    assert.equal(s.calls.length, 0);
    assert.equal((await receipt(f.owner)).state, "cancelled");
  }
});

test("Unknown post result survives restart without another dispatch", async () => {
  const f = await fixture();
  await intent(f);
  const s = sender(() => {
    throw new Error("private upstream");
  });
  await deliverAgentChannelOne(config, "https://orbyn.example", s.request);
  assert.equal((await receipt(f.owner)).state, "unknown");
  await deliverAgentChannelOne(config, "https://orbyn.example", s.request);
  assert.equal(s.calls.length, 2);
  const other = await fixture();
  await intent(other);
  await pool.query(
    "UPDATE agent_channel_outbox SET state='dispatching',claim_id=gen_random_uuid(),lease_until=now()-interval '1 second' WHERE user_id=$1",
    [other.owner],
  );
  await deliverAgentChannelOne(config, "https://orbyn.example", s.request);
  assert.equal((await receipt(other.owner)).state, "unknown");
  assert.equal(s.calls.length, 2);
});

test("429 is explicitly delayed and capped at three refused dispatches", async () => {
  const f = await fixture();
  await intent(f);
  const s = sender(
    () =>
      new Response("private", {
        status: 429,
        headers: { "retry-after": "120" },
      }),
  );
  for (let attempt = 1; attempt <= 3; attempt++) {
    await deliverAgentChannelOne(config, "https://orbyn.example", s.request);
    const row = await receipt(f.owner);
    assert.equal(row.attempts, attempt);
    assert.equal(row.state, attempt === 3 ? "failed" : "queued");
    if (attempt < 3) {
      assert.ok(row.available_at.getTime() > Date.now() + 100000);
      assert.equal(
        await deliverAgentChannelOne(
          config,
          "https://orbyn.example",
          s.request,
        ),
        false,
      );
      await pool.query(
        "UPDATE agent_channel_outbox SET available_at=now() WHERE id=$1",
        [row.id],
      );
    }
  }
  assert.equal(s.calls.length, 6);
  assert.equal(
    await deliverAgentChannelOne(config, "https://orbyn.example", s.request),
    false,
  );
});

test("Concurrent workers share a single dispatch claim", async () => {
  const f = await fixture();
  await intent(f);
  const s = sender();
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      deliverAgentChannelOne(config, "https://orbyn.example", s.request),
    ),
  );
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(s.calls.length, 2);
  assert.equal((await receipt(f.owner)).state, "sent");
});

test("Busy source fence defers without spending an attempt or sending", async () => {
  const f = await fixture();
  await intent(f);
  const blocker = await pool.connect();
  await blocker.query("BEGIN");
  await blocker.query(
    "SELECT pg_advisory_xact_lock_shared(hashtextextended('agenda-sources:' || $1::text,0))",
    [f.owner],
  );
  const s = sender();
  try {
    await deliverAgentChannelOne(config, "https://orbyn.example", s.request);
    assert.equal(s.calls.length, 0);
    assert.equal((await receipt(f.owner)).state, "queued");
    assert.equal((await receipt(f.owner)).attempts, 0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
});

test("Source policy mutation cannot commit while its current content is dispatched", async () => {
  const f = await fixture();
  await intent(f);
  let mutation: Promise<unknown> | undefined,
    changed = false;
  const s = sender();
  const writer = await pool.connect();
  const pid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0]
    .pid;
  const request: typeof fetch = async (url, init) => {
    if (String(url).endsWith("chat.postMessage")) {
      mutation = writer
        .query("UPDATE projects SET assistant_off=true WHERE id=$1", [
          f.project,
        ])
        .then(() => {
          changed = true;
        });
      let blocked = false;
      const deadline = Date.now() + 2000;
      while (!blocked && !changed && Date.now() < deadline) {
        blocked =
          (
            await pool.query(
              "SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted",
              [pid],
            )
          ).rowCount! > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(
        blocked,
        true,
        "The source writer must be waiting on the actual source fence",
      );
      assert.equal(changed, false);
    }
    return s.request(url, init);
  };
  try {
    await deliverAgentChannelOne(config, "https://orbyn.example", request);
    await mutation;
  } finally {
    writer.release();
  }
  assert.equal(changed, true);
  assert.equal((await receipt(f.owner)).state, "sent");
  assert.equal(s.calls.length, 2);
});

test("A failed commit after remote acceptance remains unknown even for a lock-error code", async () => {
  const f = await fixture();
  await intent(f);
  let accepted = false,
    failOnce = true;
  const wrapped = new WeakSet<object>();
  const acquire = (connection: Awaited<ReturnType<typeof pool.connect>>) => {
    if (wrapped.has(connection)) return;
    wrapped.add(connection);
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
    return Response.json({
      ok: true,
      channel: "DFIXTURE",
      ts: "1234567890.123456",
    });
  });
  try {
    await deliverAgentChannelOne(config, "https://orbyn.example", s.request);
    assert.equal(accepted, true);
    assert.equal(failOnce, false);
    assert.equal((await receipt(f.owner)).state, "unknown");
    assert.equal((await receipt(f.owner)).attempts, 1);
    assert.equal(
      await deliverAgentChannelOne(config, "https://orbyn.example", s.request),
      false,
    );
    assert.equal(s.calls.length, 2);
  } finally {
    pool.off("acquire", acquire);
    mock.restoreAll();
  }
});

test("Current assistant personal/team scope and workspace identity fence delivery", async () => {
  for (const change of [
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query("UPDATE agent_grants SET personal=false WHERE user_id=$1", [
        f.owner,
      ]),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query(
        "UPDATE agent_grants SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [f.owner],
      ),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query(
        "UPDATE agent_channel_installations SET workspace_id='TOTHER' WHERE id=$1",
        [f.connection],
      ),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query(
        "UPDATE agent_channel_installations SET scopes=ARRAY['chat:write'] WHERE id=$1",
        [f.connection],
      ),
  ]) {
    const f = await fixture();
    await intent(f);
    await change(f);
    const s = sender();
    await deliverAgentChannelOne(config, "https://orbyn.example", s.request);
    assert.equal(s.calls.length, 0);
    assert.equal((await receipt(f.owner)).state, "cancelled");
  }
  for (const change of [
    "membership",
    "agent-policy",
    "assistant-policy",
    "grant-scope",
  ]) {
    const f = await fixture(),
      team = randomUUID();
    await pool.query(
      "INSERT INTO teams(id,name,created_by) VALUES($1,'Fixture team',$2)",
      [team, f.owner],
    );
    await pool.query(
      "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
      [team, f.owner],
    );
    await pool.query("UPDATE projects SET team_id=$2 WHERE id=$1", [
      f.project,
      team,
    ]);
    await intent(f);
    if (change === "membership")
      await pool.query(
        "DELETE FROM team_members WHERE team_id=$1 AND user_id=$2",
        [team, f.owner],
      );
    if (change === "agent-policy")
      await pool.query("UPDATE teams SET agent_access='off' WHERE id=$1", [
        team,
      ]);
    if (change === "assistant-policy")
      await pool.query("UPDATE teams SET assistant_allowed=false WHERE id=$1", [
        team,
      ]);
    if (change === "grant-scope")
      await pool.query(
        "UPDATE agent_grants SET team_ids='{}' WHERE user_id=$1",
        [f.owner],
      );
    const s = sender();
    await deliverAgentChannelOne(config, "https://orbyn.example", s.request);
    assert.equal(s.calls.length, 0);
    assert.equal((await receipt(f.owner)).state, "cancelled");
    await pool.query("DELETE FROM teams WHERE id=$1", [team]);
  }
});

test("a cold single-connection worker decrypts and sends without exhausting its pool", async () => {
  const f = await fixture();
  await intent(f);
  const script = `
    await import('./backend/tests/setup.ts');
    const { deliverAgentChannelOne } = await import('./backend/src/modules/agent-channels/outbox.ts');
    const { pool } = await import('./backend/src/db/pool.ts');
    let calls = 0;
    const request = async (url) => {
      calls++;
      return String(url).endsWith('conversations.open')
        ? Response.json({ ok: true, channel: { id: 'DFIXTURE' } })
        : Response.json({ ok: true, channel: 'DFIXTURE', ts: '1234567890.123456' });
    };
    try {
      const attempted = await deliverAgentChannelOne(${JSON.stringify(config)}, 'https://orbyn.example', request);
      process.stdout.write(JSON.stringify({ attempted, calls }));
    } finally { await pool.end(); }
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...process.env, DB_POOL_MAX: "1", SECRETS_KEY: "" },
      timeout: 15_000,
    },
  );
  assert.deepEqual(JSON.parse(stdout), { attempted: true, calls: 2 });
  assert.equal((await receipt(f.owner)).state, "sent");
});

test("fixed receipt retention keeps recent outcomes and bounds stale queues without configured Slack", async () => {
  const { SWEEP_RULES } = await import("../src/lib/sweep.js");
  const rule = SWEEP_RULES.find((rule) => rule.key === "agent_channel_outbox")!;
  assert.equal(rule.configurable, false);
  assert.equal(rule.where.includes("$1"), false);
  const f = await fixture();
  await intent(f);
  const eligible = async () =>
    (
      await pool.query(
        `SELECT id FROM agent_channel_outbox WHERE user_id=$1 AND (${rule.where})`,
        [f.owner],
      )
    ).rowCount;
  assert.equal(await eligible(), 0);
  await pool.query(
    "UPDATE agent_channel_outbox SET state='failed' WHERE user_id=$1",
    [f.owner],
  );
  assert.equal(await eligible(), 0);
  await pool.query(
    "UPDATE agent_channel_outbox SET updated_at=now()-interval '15 days' WHERE user_id=$1",
    [f.owner],
  );
  assert.equal(await eligible(), 1);
  await pool.query(
    "UPDATE agent_channel_outbox SET state='queued',expires_at=now()-interval '1 day' WHERE user_id=$1",
    [f.owner],
  );
  assert.equal(await eligible(), 1);
  await pool.query(
    "UPDATE agent_channel_outbox SET state='dispatching',claim_id=gen_random_uuid(),lease_until=now()-interval '1 day' WHERE user_id=$1",
    [f.owner],
  );
  assert.equal(await eligible(), 1);
  await pool.query(
    "UPDATE agent_channel_outbox SET lease_until=now()+interval '1 minute' WHERE user_id=$1",
    [f.owner],
  );
  assert.equal(await eligible(), 0);
  await pool.query(
    "UPDATE agent_channel_outbox SET state='queued',claim_id=NULL,lease_until=NULL,expires_at=now()+interval '1 day' WHERE user_id=$1",
    [f.owner],
  );
  assert.equal(await eligible(), 0);
});

test("the sweeper uses declared fixed retention instead of zero and retains fresh disconnected mappings", async () => {
  const { runSweep } = await import("../src/lib/sweep.js");
  const f = await fixture();
  await pool.query(
    "UPDATE agent_channel_installations SET disconnected_at=now(),dm_enabled=false,credentials_encrypted=NULL,token_expires_at=NULL WHERE id=$1",
    [f.connection],
  );
  assert.ok(await runSweep());
  const count = async () =>
    (
      await pool.query(
        "SELECT id FROM agent_channel_installations WHERE id=$1",
        [f.connection],
      )
    ).rowCount;
  assert.equal(await count(), 1);
  await pool.query(
    "UPDATE agent_channel_installations SET disconnected_at=now()-interval '31 days' WHERE id=$1",
    [f.connection],
  );
  assert.ok(await runSweep());
  assert.equal(await count(), 0);
});
