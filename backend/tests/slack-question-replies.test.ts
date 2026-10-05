import "./setup.js";
import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { encryptSecret } = await import("../src/lib/secrets.js");
const { initialAssistantRun } = await import("../src/modules/ai/agent/run.js");
const { queueAgentJobUpdate, deliverAgentChannelOne } =
  await import("../src/modules/agent-channels/outbox.js");
const { captureSlackQuestionReply, consumeSlackQuestionReplyOne } =
  await import("../src/modules/agent-channels/question-replies.js");
const { SlackInteractionError } =
  await import("../src/modules/agent-channels/slack-interactions.js");
const config = {
  clientId: "123.456",
  clientSecret: "fixture-client-secret",
  appId: "AFIXTURE",
  redirectUri: "https://orbyn.example/api/agent-channels/slack/callback",
};
const secret = "fixture-signing-secret";
const log = {
  info() {},
  warn() {},
  error() {},
  debug() {},
} as unknown as FastifyBaseLogger;
const owners: string[] = [];
before(() => migrate());
afterEach(async () => {
  await pool.query(
    "DELETE FROM agent_channel_reply_receipts WHERE user_id=ANY($1::uuid[])",
    [owners],
  );
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function fixture(thread = true) {
  const owner = randomUUID(),
    chat = randomUUID(),
    waiting = randomUUID(),
    project = randomUUID();
  owners.push(owner);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Reply tester',true)",
    [owner, `${owner}@fixture.invalid`],
  );
  await pool.query(
    "INSERT INTO agent_grants(user_id,kind,access,team_ids) VALUES($1,'assistant','write',NULL)",
    [owner],
  );
  await pool.query(
    "INSERT INTO projects(id,user_id,name) VALUES($1,$2,'Reply project')",
    [project, owner],
  );
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,project_id,title,origin) VALUES($1,$2,$3,'Private job','goal')",
    [chat, owner, project],
  );
  const run = initialAssistantRun({
    message: "Research",
    history: [],
    timezone: "UTC",
    chat_id: chat,
    turn_id: randomUUID(),
    scope: null,
    automation: { kind: "goal" },
  });
  run.state.waiting = {
    kind: "person",
    id: waiting,
    question: "Which source?",
    choices: ["First", "Second"],
  };
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,state,run_state,run_origin,sources_checked) VALUES($1,$2,'waiting',$3,'goal',true) RETURNING id",
      [owner, chat, JSON.stringify(run)],
    )
  ).rows[0].id as string;
  const actor = `U${owner.replaceAll("-", "").toUpperCase()}`,
    workspace = `T${owner.replaceAll("-", "").toUpperCase()}`;
  const scopes = ["chat:write", ...(thread ? ["im:history"] : []), "im:write"];
  const encrypted = await encryptSecret(
    JSON.stringify({
      appId: config.appId,
      workspaceId: workspace,
      workspaceName: "Fixture",
      userId: actor,
      botUserId: "UBOT",
      accessToken: "fixture-bot-token",
      expiresAt: null,
      scopes,
    }),
  );
  const vault = (
    await pool.query(
      "INSERT INTO agent_channel_bot_vaults(provider,app_id,workspace_id,bot_user_id,installer_external_user_id,scopes,credentials_encrypted) VALUES('slack',$1,$2,'UBOT',$3,$4,$5) RETURNING id",
      [config.appId, workspace, actor, scopes, encrypted],
    )
  ).rows[0].id as string;
  const connection = (
    await pool.query(
      "INSERT INTO agent_channel_installations(user_id,provider,app_id,workspace_id,workspace_name,external_user_id,bot_user_id,scopes,bot_vault_id,dm_enabled) VALUES($1,'slack',$2,$3,'Fixture',$4,'UBOT',$5,$6,true) RETURNING id",
      [owner, config.appId, workspace, actor, scopes, vault],
    )
  ).rows[0].id as string;
  await queueAgentJobUpdate(pool, job, "waiting", waiting);
  const calls: unknown[] = [];
  const sender: typeof fetch = async (url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return String(url).endsWith("conversations.open")
      ? Response.json({ ok: true, channel: { id: "DFIXTURE" } })
      : Response.json({ ok: true, channel: "DFIXTURE", ts: "1000.000001" });
  };
  await deliverAgentChannelOne(config, "https://orbyn.example", sender, true);
  const delivery = (
    await pool.query("SELECT * FROM agent_channel_outbox WHERE user_id=$1", [
      owner,
    ])
  ).rows[0];
  assert.equal(delivery.state, "sent");
  assert.ok(delivery.reply_question_digest);
  const common = {
    appId: config.appId,
    workspaceId: workspace,
    userId: actor,
    channelId: "DFIXTURE",
    messageTs: "1000.000001",
    actionTs: "1001.000001",
    requestDigest: createHash("sha256").update(randomUUID()).digest("hex"),
  };
  const choice = {
    ...common,
    action: "choice" as const,
    deliveryId: delivery.id as string,
    choice: 1,
  };
  const answer = {
    ...common,
    action: "answer" as const,
    eventId: "Ev123",
    answer: "Use another source",
  };
  return {
    owner,
    chat,
    project,
    waiting,
    job,
    connection,
    vault,
    delivery,
    choice,
    answer,
    calls,
  };
}
const receipt = async (owner: string) =>
  (
    await pool.query(
      "SELECT * FROM agent_channel_reply_receipts WHERE user_id=$1",
      [owner],
    )
  ).rows[0];
const state = async (job: string) =>
  (await pool.query("SELECT state,run_state FROM ai_jobs WHERE id=$1", [job]))
    .rows[0];
const refusal = (status: number) => (e: unknown) =>
  e instanceof SlackInteractionError && e.status === status;
test("choice receipt and answer commit once, clear encrypted data and preserve chat history", async () => {
  const f = await fixture();
  assert.deepEqual(await captureSlackQuestionReply(f.choice, config, secret), {
    received: true,
  });
  assert.equal((await state(f.job)).state, "waiting");
  assert.equal((await receipt(f.owner)).state, "queued");
  assert.ok(!(await receipt(f.owner)).reply_encrypted.includes("Second"));
  assert.equal(await consumeSlackQuestionReplyOne(config, secret, log), true);
  const result = await state(f.job);
  assert.equal(result.state, "queued");
  assert.equal(result.run_state.state.waiting, null);
  assert.equal(result.run_state.state.answer_to_person, "Second");
  assert.equal((await receipt(f.owner)).state, "accepted");
  assert.equal((await receipt(f.owner)).reply_encrypted, null);
  assert.deepEqual(await captureSlackQuestionReply(f.choice, config, secret), {
    received: true,
  });
  assert.equal(await consumeSlackQuestionReplyOne(config, secret, log), false);
  const turns = (
    await pool.query("SELECT turns FROM ai_chats WHERE id=$1", [f.chat])
  ).rows[0].turns;
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, "Second");
});
test("free answer is allowed only for reviewed thread-capable sent question", async () => {
  const f = await fixture();
  await captureSlackQuestionReply(f.answer, config, secret);
  await consumeSlackQuestionReplyOne(config, secret, log);
  assert.ok(
    (await state(f.job)).run_state.state.answer_to_person.startsWith(
      "Use another source",
    ),
  );
  const legacy = await fixture(false);
  await assert.rejects(
    captureSlackQuestionReply(legacy.answer, config, secret),
    refusal(403),
  );
  assert.equal(await receipt(legacy.owner), undefined);
  await captureSlackQuestionReply(legacy.choice, config, secret);
  await consumeSlackQuestionReplyOne(config, secret, log);
  assert.equal((await receipt(legacy.owner)).state, "accepted");
});
test("approval and unminted submit actions cannot acquire question authority", async () => {
  const f = await fixture();
  await assert.rejects(
    captureSlackQuestionReply(
      { ...f.choice, action: "approve" },
      config,
      secret,
    ),
    refusal(400),
  );
  await assert.rejects(
    captureSlackQuestionReply(
      { ...f.choice, action: "answer", answer: "Injected" },
      config,
      secret,
    ),
    refusal(400),
  );
  assert.equal(await receipt(f.owner), undefined);
});
test("wrong actor, workspace, message, app or option refuses without storing content", async () => {
  const f = await fixture();
  for (const change of [
    { userId: "UOTHER" },
    { workspaceId: "TOTHER" },
    { messageTs: "999.000001" },
    { appId: "AOTHER" },
    { deliveryId: randomUUID() },
  ])
    await assert.rejects(
      captureSlackQuestionReply({ ...f.choice, ...change }, config, secret),
      refusal(403),
    );
  await assert.rejects(
    captureSlackQuestionReply({ ...f.choice, choice: 4 }, config, secret),
    refusal(400),
  );
  assert.equal(await receipt(f.owner), undefined);
});
test("two decisions on one card persist only one receipt", async () => {
  const f = await fixture();
  await captureSlackQuestionReply(f.choice, config, secret);
  await assert.rejects(
    captureSlackQuestionReply(
      { ...f.answer, requestDigest: "a".repeat(64) },
      config,
      secret,
    ),
    refusal(409),
  );
  await consumeSlackQuestionReplyOne(config, secret, log);
  assert.equal((await state(f.job)).run_state.state.answer_to_person, "Second");
});
test("stale waiting ID and changed question contents refuse at capture and consumption", async () => {
  const f = await fixture();
  await pool.query(
    "UPDATE ai_jobs SET run_state=jsonb_set(run_state,'{state,waiting,id}',to_jsonb($2::text)) WHERE id=$1",
    [f.job, randomUUID()],
  );
  await assert.rejects(
    captureSlackQuestionReply(f.choice, config, secret),
    refusal(409),
  );
  const changed = await fixture();
  await captureSlackQuestionReply(changed.choice, config, secret);
  await pool.query(
    "UPDATE ai_jobs SET run_state=jsonb_set(run_state,'{state,waiting,question}',to_jsonb('Changed question'::text)) WHERE id=$1",
    [changed.job],
  );
  await consumeSlackQuestionReplyOne(config, secret, log);
  assert.equal((await receipt(changed.owner)).state, "refused");
  assert.equal((await state(changed.job)).state, "waiting");
});
test("DM consent, grant revocation, expiry and configuration rotation refuse queued replies", async () => {
  for (const change of ["consent", "grant", "expiry", "config"]) {
    const f = await fixture();
    await captureSlackQuestionReply(f.choice, config, secret);
    if (change === "consent")
      await pool.query(
        "UPDATE agent_channel_installations SET dm_enabled=false,version=version+1 WHERE id=$1",
        [f.connection],
      );
    if (change === "grant")
      await pool.query(
        "UPDATE agent_grants SET suspended_at=now() WHERE user_id=$1",
        [f.owner],
      );
    if (change === "expiry")
      await pool.query(
        "UPDATE agent_channel_reply_receipts SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [f.owner],
      );
    await consumeSlackQuestionReplyOne(
      config,
      change === "config" ? "rotated-signing-secret" : secret,
      log,
    );
    assert.equal((await receipt(f.owner)).state, "refused");
    assert.equal((await receipt(f.owner)).reply_encrypted, null);
    assert.equal((await state(f.job)).state, "waiting");
  }
});
test("expired processing claim recovers without replaying an accepted answer", async () => {
  const f = await fixture();
  await captureSlackQuestionReply(f.choice, config, secret);
  await pool.query(
    "UPDATE agent_channel_reply_receipts SET state='processing',claim_id=gen_random_uuid(),lease_until=now()-interval '1 second',attempts=1 WHERE user_id=$1",
    [f.owner],
  );
  await consumeSlackQuestionReplyOne(config, secret, log);
  assert.equal((await receipt(f.owner)).state, "accepted");
  assert.equal(await consumeSlackQuestionReplyOne(config, secret, log), false);
});
test("failed receipt write rolls back the job and chat answer as well", async () => {
  const f = await fixture();
  await captureSlackQuestionReply(f.choice, config, secret);
  await pool.query(`CREATE FUNCTION fixture_refuse_channel_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.state='accepted' THEN RAISE EXCEPTION 'Fixture receipt write failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER fixture_refuse_channel_receipt BEFORE UPDATE ON agent_channel_reply_receipts
    FOR EACH ROW EXECUTE FUNCTION fixture_refuse_channel_receipt()`);
  try {
    await consumeSlackQuestionReplyOne(config, secret, log);
  } finally {
    await pool.query(
      "DROP TRIGGER fixture_refuse_channel_receipt ON agent_channel_reply_receipts; DROP FUNCTION fixture_refuse_channel_receipt()",
    );
  }
  assert.equal((await state(f.job)).state, "waiting");
  assert.equal((await state(f.job)).run_state.state.waiting.id, f.waiting);
  assert.equal((await receipt(f.owner)).state, "refused");
  assert.deepEqual(
    (await pool.query("SELECT turns FROM ai_chats WHERE id=$1", [f.chat]))
      .rows[0].turns,
    [],
  );
});
test("already elapsed capture deadline cannot leave a receipt", async () => {
  const f = await fixture();
  await assert.rejects(
    captureSlackQuestionReply(f.choice, config, secret, Date.now() - 1),
    /deadline exceeded/,
  );
  assert.equal(await receipt(f.owner), undefined);
});

test("source visibility changes and canceled jobs cannot consume captured replies", async () => {
  for (const change of ["source", "cancel"]) {
    const f = await fixture();
    await captureSlackQuestionReply(f.choice, config, secret);
    if (change === "source")
      await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
        f.project,
      ]);
    else
      await pool.query("UPDATE ai_jobs SET cancel_requested=true WHERE id=$1", [
        f.job,
      ]);
    await consumeSlackQuestionReplyOne(config, secret, log);
    assert.equal((await receipt(f.owner)).state, "refused");
    assert.equal((await state(f.job)).state, "waiting");
  }
});
test("fixed retention erases expired answer content and bounds terminal receipts with Slack disabled", async () => {
  const { SWEEP_RULES } = await import("../src/lib/sweep.js");
  const rule = SWEEP_RULES.find(
    (r) => r.key === "agent_channel_reply_receipts",
  )!;
  assert.equal(rule.days, 14);
  assert.equal(rule.configurable, false);
  const completed = await fixture();
  await captureSlackQuestionReply(completed.choice, config, secret);
  await consumeSlackQuestionReplyOne(config, secret, log);
  await pool.query(
    "UPDATE agent_channel_reply_receipts SET updated_at=now()-interval '15 days' WHERE user_id=$1",
    [completed.owner],
  );
  const pending = await fixture();
  await captureSlackQuestionReply(pending.choice, config, secret);
  await pool.query(
    "UPDATE agent_channel_reply_receipts SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [pending.owner],
  );
  const fresh = await fixture();
  await captureSlackQuestionReply(fresh.choice, config, secret);
  await pool.query(
    `DELETE FROM agent_channel_reply_receipts WHERE ${rule.where}`,
  );
  assert.equal(await receipt(pending.owner), undefined);
  assert.equal(await receipt(completed.owner), undefined);
  assert.equal((await receipt(fresh.owner)).state, "queued");
});
