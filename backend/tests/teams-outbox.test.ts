import "./setup.js";
import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { encryptSecret } = await import("../src/lib/secrets.js");
const { teamsOAuthConfigDigest } =
  await import("../src/modules/agent-channels/teams-oauth.js");
const { queueTeamsJobUpdate, queueTeamsNightUpdate, deliverTeamsChannelOne } =
  await import("../src/modules/agent-channels/teams-outbox.js");
const config = {
  clientId: randomUUID(),
  clientSecret: "fixture-user-oauth-secret",
  botAppId: randomUUID(),
  redirectUri: "https://orbyn.example/api/agent-channels/teams/callback",
};
const bot = {
  appId: config.botAppId,
  tenantId: randomUUID(),
  clientSecret: "fixture-bot-app-secret",
};
const owners: string[] = [];
before(() => migrate());
afterEach(async () => {
  await pool.query(
    "DELETE FROM agent_channel_teams_outbox WHERE user_id=ANY($1::uuid[])",
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
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Teams outbox tester',true)",
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
    [chat, owner, project, kind],
  );
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,state,run_state,run_origin,sources_checked) VALUES($1,$2,$3,$4,$5,true) RETURNING id",
      [
        owner,
        chat,
        state,
        JSON.stringify({
          version: 1,
          request: { automation: { kind } },
          state: {
            waiting:
              state === "waiting"
                ? { kind: "person", id: waitingId, question: "Question" }
                : null,
          },
        }),
        kind,
      ],
    )
  ).rows[0].id;
  const target = {
    serviceUrl: "https://smba.trafficmanager.net/teams/",
    tenantId: randomUUID(),
    conversationId: "private-conversation",
    userId: "29:human",
    objectId: randomUUID(),
    botId: `28:${bot.appId}`,
  };
  const serialized = JSON.stringify(target),
    encrypted = await encryptSecret(serialized);
  const connection = (
    await pool.query(
      `INSERT INTO agent_channel_teams_installations(user_id,bot_app_id,tenant_id,object_id,display_name,config_hash,dm_enabled,conversation_encrypted,conversation_hash)
 VALUES($1,$2,$3,$4,'Fixture',$5,true,$6,$7) RETURNING id`,
      [
        owner,
        bot.appId,
        target.tenantId,
        target.objectId,
        teamsOAuthConfigDigest(config),
        encrypted,
        createHash("sha256").update(serialized).digest("hex"),
      ],
    )
  ).rows[0].id;
  return { owner, chat, project, job, waitingId, target, connection };
}
const receipt = async (owner: string) =>
  (
    await pool.query(
      "SELECT * FROM agent_channel_teams_outbox WHERE user_id=$1",
      [owner],
    )
  ).rows[0];
const delivered = async (send: Parameters<typeof deliverTeamsChannelOne>[3]) =>
  deliverTeamsChannelOne(config, bot, "https://orbyn.example", send);
test("Background transition commits one intent and sends with current owned conversation and identity", async () => {
  const f = await fixture();
  await Promise.all(
    Array.from({ length: 4 }, () => queueTeamsJobUpdate(pool, f.job, "done")),
  );
  let calls = 0;
  await delivered(async (c, target, text) => {
    calls++;
    assert.deepEqual(c, bot);
    assert.deepEqual(target, f.target);
    assert.match(text, /^Fern · Background/);
    assert.match(text, /Private work/);
    return { state: "sent", activityId: "sent-fixture" };
  });
  assert.equal(calls, 1);
  assert.equal((await receipt(f.owner)).state, "sent");
  assert.equal((await receipt(f.owner)).activity_id, "sent-fixture");
  assert.equal(
    await delivered(async () => {
      throw Error("No replay");
    }),
    false,
  );
});
test("hidden idea and per-job Overnight transitions never enter Teams outbox", async () => {
  for (const kind of ["idea", "night"]) {
    const f = await fixture(kind);
    await queueTeamsJobUpdate(pool, f.job, "done");
    assert.equal(await receipt(f.owner), undefined);
  }
});
test("revoked consent, owner, project, grant, configuration and conversation prevent send", async () => {
  for (const change of [
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query(
        "UPDATE agent_channel_teams_installations SET dm_enabled=false,version=version+1 WHERE id=$1",
        [f.connection],
      ),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query("UPDATE users SET disabled=true WHERE id=$1", [f.owner]),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
        f.project,
      ]),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query(
        "UPDATE agent_grants SET suspended_at=now() WHERE user_id=$1",
        [f.owner],
      ),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query(
        "UPDATE agent_channel_teams_installations SET config_hash=repeat('0',64) WHERE id=$1",
        [f.connection],
      ),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      pool.query(
        "UPDATE agent_channel_teams_installations SET object_id=$2 WHERE id=$1",
        [f.connection, randomUUID()],
      ),
  ]) {
    const f = await fixture();
    await queueTeamsJobUpdate(pool, f.job, "done");
    await change(f);
    await delivered(async () => {
      assert.fail("No unauthorized send");
    });
    assert.equal((await receipt(f.owner)).state, "cancelled");
    await pool.query(
      "DELETE FROM agent_channel_teams_outbox WHERE user_id=$1",
      [f.owner],
    );
  }
});
test("unknown transport outcome and expired dispatch claims never return to queued", async () => {
  const f = await fixture();
  await queueTeamsJobUpdate(pool, f.job, "done");
  await delivered(async () => ({ state: "unknown" }));
  assert.equal((await receipt(f.owner)).state, "unknown");
  assert.equal(
    await delivered(async () => {
      assert.fail("No uncertain replay");
    }),
    false,
  );
  const expired = await fixture();
  await queueTeamsJobUpdate(pool, expired.job, "done");
  await pool.query(
    "UPDATE agent_channel_teams_outbox SET state='dispatching',claim_id=gen_random_uuid(),lease_until=now()-interval '1 second' WHERE user_id=$1",
    [expired.owner],
  );
  assert.equal(
    await delivered(async () => {
      assert.fail("No abandoned replay");
    }),
    false,
  );
  assert.equal((await receipt(expired.owner)).state, "unknown");
});
test("explicit rate limits schedule bounded attempts and eventually fail", async () => {
  const f = await fixture();
  await queueTeamsJobUpdate(pool, f.job, "done");
  let calls = 0;
  for (let i = 1; i <= 3; i++) {
    await delivered(async () => {
      calls++;
      return { state: "rate_limited", retryAfterSeconds: 15 };
    });
    const row = await receipt(f.owner);
    assert.equal(row.attempts, i);
    assert.equal(row.state, i === 3 ? "failed" : "queued");
    if (i < 3)
      await pool.query(
        "UPDATE agent_channel_teams_outbox SET available_at=now() WHERE user_id=$1",
        [f.owner],
      );
  }
  assert.equal(calls, 3);
});
test("stale displayed waiting ID cancels instead of sending another question notification", async () => {
  const f = await fixture("goal", "waiting");
  await queueTeamsJobUpdate(pool, f.job, "waiting", f.waitingId);
  await pool.query(
    "UPDATE ai_jobs SET run_state=jsonb_set(run_state,'{state,waiting,id}',to_jsonb($2::text)) WHERE id=$1",
    [f.job, randomUUID()],
  );
  await delivered(async () => {
    assert.fail("No stale prompt");
  });
  assert.equal((await receipt(f.owner)).state, "cancelled");
});
test("Overnight sends only one generic morning result after the window and keeps its identity separate", async () => {
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
  await queueTeamsNightUpdate(pool, night, f.owner);
  assert.equal(await receipt(f.owner), undefined);
  await pool.query("UPDATE assistant_nights SET summary=$2 WHERE id=$1", [
    night,
    JSON.stringify({ end_at: new Date(Date.now() - 60000).toISOString() }),
  ]);
  await Promise.all(
    Array.from({ length: 3 }, () =>
      queueTeamsNightUpdate(pool, night, f.owner),
    ),
  );
  let calls = 0;
  await delivered(async (_bot, _target, text) => {
    calls++;
    assert.match(text, /^Luna · Overnight/);
    assert.doesNotMatch(text, /Private work/);
    return { state: "sent", activityId: "morning-fixture" };
  });
  assert.equal(calls, 1);
  await queueTeamsNightUpdate(pool, night, f.owner);
  assert.equal(
    await delivered(async () => {
      assert.fail("No duplicate morning");
    }),
    false,
  );
});
