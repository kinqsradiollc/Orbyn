import "./setup.js";
import { before, after, afterEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
const { initialAssistantRun } = await import("../src/modules/ai/agent/run.js");
const { captureTeamsQuestionReply, consumeTeamsQuestionReplyOne } =
  await import("../src/modules/agent-channels/teams-question-receipts.js");
const { TeamsQuestionReplyError } =
  await import("../src/modules/agent-channels/teams-question-reply.js");
const log = {
  info() {},
  warn() {},
  error() {},
  debug() {},
} as unknown as FastifyBaseLogger;
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { teamsConversationRouteDigest } =
  await import("../src/modules/agent-channels/teams-conversations.js");
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
async function fixture(choices = ["First", "Second"]) {
  const kind = "goal",
    state = "waiting";
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
  const run = initialAssistantRun({
    message: "Research",
    history: [],
    timezone: "UTC",
    chat_id: chat,
    turn_id: randomUUID(),
    scope: null,
    automation: { kind },
  });
  run.state.waiting = {
    kind: "person",
    id: waitingId,
    question: "Which source?",
    choices,
  };
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,state,run_state,run_origin,sources_checked) VALUES($1,$2,$3,$4,$5,true) RETURNING id",
      [owner, chat, state, JSON.stringify(run), kind],
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
      `INSERT INTO agent_channel_teams_installations(user_id,bot_app_id,tenant_id,object_id,display_name,config_hash,dm_enabled,conversation_encrypted,conversation_hash,conversation_route_hash,conversation_bound_at)
 VALUES($1,$2,$3,$4,'Fixture',$5,true,$6,$7,$8,now()) RETURNING id`,
      [
        owner,
        bot.appId,
        target.tenantId,
        target.objectId,
        teamsOAuthConfigDigest(config),
        encrypted,
        createHash("sha256").update(serialized).digest("hex"),
        teamsConversationRouteDigest(
          bot.appId,
          target.tenantId,
          target.conversationId,
        ),
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

async function sent(choices?: string[]) {
  const f = await fixture(choices);
  await queueTeamsJobUpdate(pool, f.job, "waiting", f.waitingId);
  let binding: any;
  await delivered(async (_bot, _target, _text, card) => {
    assert.ok(card);
    const body = card.attachment.content.body as any[];
    binding = body.at(-1).actions[0].data;
    return { state: "sent", activityId: "sent-question" };
  });
  const reply = {
    appId: bot.appId,
    tenantId: f.target.tenantId,
    objectId: f.target.objectId,
    externalUserId: f.target.userId,
    conversationId: f.target.conversationId,
    serviceUrl: f.target.serviceUrl,
    eventId: randomUUID(),
    deliveryId: binding.delivery_id,
    waitingId: binding.waiting_id,
    questionDigest: binding.question_digest,
    cardNonce: binding.card_nonce,
    choice: 0,
    requestDigest: createHash("sha256").update(randomUUID()).digest("hex"),
  };
  return { ...f, reply };
}
const replies = async (owner: string) =>
  (
    await pool.query(
      "SELECT * FROM agent_channel_teams_reply_receipts WHERE user_id=$1",
      [owner],
    )
  ).rows;
const consume = () => consumeTeamsQuestionReplyOne(config, bot, log);
const unavailable = (error: unknown) =>
  error instanceof TeamsQuestionReplyError;
test("Teams sent card stores only hashes; a receipt answers the exact question and retires atomically", async () => {
  const f = await sent();
  const delivery = await receipt(f.owner);
  assert.equal(
    delivery.reply_nonce_hash,
    createHash("sha256").update(f.reply.cardNonce).digest("hex"),
  );
  assert.equal(delivery.reply_question_digest, f.reply.questionDigest);
  assert.ok(delivery.reply_expires_at);
  assert.equal(JSON.stringify(delivery).includes(f.reply.cardNonce), false);
  await captureTeamsQuestionReply(f.reply, config, bot);
  const captured = (await replies(f.owner))[0];
  assert.ok(captured.reply_encrypted);
  assert.equal(captured.reply_encrypted.includes(f.reply.cardNonce), false);
  assert.equal(await consume(), true);
  assert.equal(await consume(), false);
  const job = (
    await pool.query("SELECT state,run_state FROM ai_jobs WHERE id=$1", [f.job])
  ).rows[0];
  assert.equal(job.state, "queued");
  assert.equal(job.run_state.state.waiting, null);
  assert.equal(job.run_state.state.answer_to_person, "First");
  const accepted = (await replies(f.owner))[0];
  assert.equal(accepted.state, "accepted");
  assert.equal(accepted.reply_encrypted, null);
  const turns = (
    await pool.query("SELECT turns FROM ai_chats WHERE id=$1", [f.chat])
  ).rows[0].turns;
  assert.equal(
    turns.filter((t: any) => t.role === "user" && t.text === "First").length,
    1,
  );
});
test("signed request replay acknowledges its receipt without granting a second answer", async () => {
  const f = await sent();
  await captureTeamsQuestionReply(f.reply, config, bot);
  await captureTeamsQuestionReply(f.reply, config, bot);
  assert.equal((await replies(f.owner)).length, 1);
  await assert.rejects(
    captureTeamsQuestionReply(
      {
        ...f.reply,
        choice: 1,
        requestDigest: createHash("sha256").update("other").digest("hex"),
      },
      config,
      bot,
    ),
    unavailable,
  );
  await consume();
  await captureTeamsQuestionReply(f.reply, config, bot);
  assert.equal(await consume(), false);
});
test("forged nonce, waiting question, digest, actor, tenant and conversation cannot capture", async () => {
  const changes = [
    { cardNonce: "a".repeat(43) },
    { waitingId: randomUUID() },
    { questionDigest: "a".repeat(64) },
    { objectId: randomUUID() },
    { tenantId: randomUUID() },
    { conversationId: "other" },
    { externalUserId: "29:other" },
    { serviceUrl: "https://smba.trafficmanager.net/amer/" },
  ];
  for (const changed of changes) {
    const f = await sent();
    await assert.rejects(
      captureTeamsQuestionReply({ ...f.reply, ...changed }, config, bot),
      unavailable,
    );
    assert.equal((await replies(f.owner)).length, 0);
  }
});
test("revocation, source visibility, changed question, stop and expiry fence captured replies again at consumption", async () => {
  for (const mutation of [
    "permission",
    "grant",
    "project",
    "question",
    "cancel",
    "expiry",
  ]) {
    const f = await sent();
    await captureTeamsQuestionReply(f.reply, config, bot);
    if (mutation === "permission")
      await pool.query(
        "UPDATE agent_channel_teams_installations SET dm_enabled=false,version=version+1 WHERE id=$1",
        [f.connection],
      );
    if (mutation === "grant")
      await pool.query(
        "UPDATE agent_grants SET suspended_at=now() WHERE user_id=$1",
        [f.owner],
      );
    if (mutation === "project")
      await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
        f.project,
      ]);
    if (mutation === "question")
      await pool.query(
        "UPDATE ai_jobs SET run_state=jsonb_set(run_state,'{state,waiting,question}','\"Changed?\"') WHERE id=$1",
        [f.job],
      );
    if (mutation === "cancel")
      await pool.query("UPDATE ai_jobs SET cancel_requested=true WHERE id=$1", [
        f.job,
      ]);
    if (mutation === "expiry")
      await pool.query(
        "UPDATE agent_channel_teams_reply_receipts SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [f.owner],
      );
    await consume();
    const result = (await replies(f.owner))[0];
    assert.equal(result.state, "refused", mutation);
    assert.equal(result.reply_encrypted, null);
    const row = (
      await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [f.job])
    ).rows[0];
    assert.equal(row.state, "waiting");
  }
});
test("configuration change and malformed ciphertext refuse without answering", async () => {
  for (const corrupt of [false, true]) {
    const f = await sent();
    await captureTeamsQuestionReply(f.reply, config, bot);
    if (corrupt)
      await pool.query(
        "UPDATE agent_channel_teams_reply_receipts SET reply_encrypted='malformed' WHERE user_id=$1",
        [f.owner],
      );
    await consumeTeamsQuestionReplyOne(
      config,
      {
        ...bot,
        clientSecret: corrupt ? bot.clientSecret : "different-bot-secret",
      },
      log,
    );
    assert.equal((await replies(f.owner))[0].state, "refused");
    assert.equal(
      (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [f.job]))
        .rows[0].state,
      "waiting",
    );
  }
});
test("expired processing leases recover durable receipts without replaying an accepted answer", async () => {
  const f = await sent();
  await captureTeamsQuestionReply(f.reply, config, bot);
  await pool.query(
    "UPDATE agent_channel_teams_reply_receipts SET state='processing',claim_id=gen_random_uuid(),lease_until=now()-interval '1 second',attempts=1 WHERE user_id=$1",
    [f.owner],
  );
  assert.equal(await consume(), true);
  assert.equal((await replies(f.owner))[0].state, "accepted");
  assert.equal(await consume(), false);
});
test("free text is bounded and saved through the same exact-question receipt", async () => {
  const f = await sent([]);
  const { choice, ...base } = f.reply;
  await captureTeamsQuestionReply(
    { ...base, answer: "  Third source  " },
    config,
    bot,
  );
  await consume();
  const state = (
    await pool.query("SELECT run_state FROM ai_jobs WHERE id=$1", [f.job])
  ).rows[0].run_state.state;
  assert.equal(state.answer_to_person, "Third source");
});

test("source fence contention defers before answering and resumes without spending an attempt", async () => {
  const f = await sent();
  await captureTeamsQuestionReply(f.reply, config, bot);
  const lock = await pool.connect();
  await lock.query("BEGIN");
  try {
    await lock.query(
      "SELECT pg_advisory_xact_lock_shared(hashtextextended('agenda-sources:' || $1::text,0))",
      [f.owner],
    );
    await consume();
    const r = (await replies(f.owner))[0];
    assert.equal(r.state, "queued");
    assert.equal(r.attempts, 0);
    assert.equal(
      (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [f.job]))
        .rows[0].state,
      "waiting",
    );
  } finally {
    await lock.query("ROLLBACK");
    lock.release();
  }
  await pool.query(
    "UPDATE agent_channel_teams_reply_receipts SET available_at=now() WHERE user_id=$1",
    [f.owner],
  );
  await consume();
  assert.equal((await replies(f.owner))[0].state, "accepted");
});
test("a chat update failure rolls back the answer and terminally erases the reply", async () => {
  const f = await sent();
  await captureTeamsQuestionReply(f.reply, config, bot);
  await pool.query(
    "CREATE FUNCTION teams_question_fixture_chat_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture chat failure'; END; $$",
  );
  await pool.query(
    `CREATE TRIGGER teams_question_fixture_chat_fail BEFORE UPDATE OF turns ON ai_chats FOR EACH ROW WHEN (NEW.user_id='${f.owner}'::uuid) EXECUTE FUNCTION teams_question_fixture_chat_fail()`,
  );
  try {
    await consume();
  } finally {
    await pool.query(
      "DROP TRIGGER teams_question_fixture_chat_fail ON ai_chats",
    );
    await pool.query("DROP FUNCTION teams_question_fixture_chat_fail()");
  }
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [f.job])).rows[0]
      .state,
    "waiting",
  );
  assert.equal(
    (await pool.query("SELECT turns FROM ai_chats WHERE id=$1", [f.chat]))
      .rows[0].turns.length,
    0,
  );
  const r = (await replies(f.owner))[0];
  assert.equal(r.state, "refused");
  assert.equal(r.reply_encrypted, null);
});
test("lost acknowledgement after atomic commit cannot queue or answer a second time", async () => {
  const f = await sent();
  await captureTeamsQuestionReply(f.reply, config, bot);
  const original = pool.connect.bind(pool);
  let lost = false;
  const patch = mock.method(pool, "connect", function (...args: any[]) {
    if (args.length) return (original as any)(...args);
    return original().then((client) => {
      const query = client.query.bind(client),
        release = client.release.bind(client);
      let accepted = false;
      client.query = async function (...q: any[]) {
        const sql = typeof q[0] === "string" ? q[0] : q[0]?.text;
        const result = await (query as any)(...q);
        if (
          sql?.includes("SET state='accepted'") &&
          sql.includes("agent_channel_teams_reply_receipts")
        )
          accepted = true;
        if (sql === "COMMIT" && accepted && !lost) {
          lost = true;
          throw Error("fixture lost commit acknowledgement");
        }
        return result;
      } as any;
      client.release = function (...r: any[]) {
        client.query = query as any;
        client.release = release;
        (release as any)(...r);
      };
      return client;
    });
  });
  try {
    await consume();
  } finally {
    patch.mock.restore();
  }
  assert.equal(lost, true);
  assert.equal((await replies(f.owner))[0].state, "accepted");
  assert.equal(await consume(), false);
  const turns = (
    await pool.query("SELECT turns FROM ai_chats WHERE id=$1", [f.chat])
  ).rows[0].turns;
  assert.equal(turns.filter((t: any) => t.text === "First").length, 1);
});
test("unproved or expired sent-card authority cannot create a receipt", async () => {
  for (const mutation of ["expiry", "nonces", "revision"]) {
    const f = await sent();
    if (mutation === "expiry")
      await pool.query(
        "UPDATE agent_channel_teams_outbox SET reply_expires_at=now()-interval '1 second' WHERE user_id=$1",
        [f.owner],
      );
    if (mutation === "nonces")
      await pool.query(
        "UPDATE agent_channel_teams_outbox SET reply_nonce_hash=NULL,reply_question_digest=NULL,reply_expires_at=NULL WHERE user_id=$1",
        [f.owner],
      );
    if (mutation === "revision")
      await pool.query(
        "UPDATE agent_channel_teams_installations SET version=version+1 WHERE id=$1",
        [f.connection],
      );
    await assert.rejects(
      captureTeamsQuestionReply(f.reply, config, bot),
      unavailable,
    );
    assert.equal((await replies(f.owner)).length, 0);
  }
});

test("signed HTTP card callbacks capture before their typed acknowledgement and enforce authentication, bounds and rate limits", async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { createService } = await import("../src/services/http.js");
  const { createTeamsActivityRoutes } =
    await import("../src/modules/agent-channels/teams-activity-routes.js");
  const { receiveTeamsActivity } =
    await import("../src/modules/agent-channels/teams-activity.js");
  const pair = await generateKeyPair("RS256");
  const key = {
    ...(await exportJWK(pair.publicKey)),
    kid: "receipt-http",
    endorsements: ["msteams"],
  };
  const app = await createService("api", [
    createTeamsActivityRoutes(
      (raw, headers, c) =>
        receiveTeamsActivity(raw, headers, c, async () => [key], bot),
      () => config,
    ),
  ]);
  try {
    const f = await sent();
    const jwt = await new SignJWT({ serviceUrl: f.target.serviceUrl })
      .setProtectedHeader({ alg: "RS256", kid: key.kid })
      .setIssuer("https://api.botframework.com")
      .setAudience(bot.appId)
      .setNotBefore(Math.floor(Date.now() / 1000) - 5)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
      .sign(pair.privateKey);
    const data = {
      delivery_id: f.reply.deliveryId,
      waiting_id: f.reply.waitingId,
      question_digest: f.reply.questionDigest,
      card_nonce: f.reply.cardNonce,
      choice: 0,
    };
    const body = {
      type: "invoke",
      name: "adaptiveCard/action",
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      channelId: "msteams",
      serviceUrl: f.target.serviceUrl,
      recipient: { id: f.target.botId },
      from: { id: f.target.userId, aadObjectId: f.target.objectId },
      conversation: {
        id: f.target.conversationId,
        conversationType: "personal",
        tenantId: f.target.tenantId,
      },
      channelData: { tenant: { id: f.target.tenantId } },
      value: {
        trigger: "manual",
        action: { type: "Action.Execute", verb: "orbyn.answer-question", data },
      },
    };
    let address = 1;
    const call = (
      payload: unknown = body,
      authorization: string | undefined = `Bearer ${jwt}`,
      url = "/agent-channels/teams/activities",
      remoteAddress = `10.89.0.${address++}`,
    ) =>
      app.inject({
        method: "POST",
        url,
        remoteAddress,
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        payload:
          typeof payload === "string" ? payload : JSON.stringify(payload),
      });
    assert.equal((await call(body, "")).statusCode, 401);
    assert.equal(
      (await call({ ...body, recipient: { id: `28:${randomUUID()}` } }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await call(
          body,
          `Bearer ${jwt}`,
          "/agent-channels/teams/activities?extra=1",
        )
      ).statusCode,
      422,
    );
    assert.equal((await call("{")).statusCode, 400);
    assert.equal((await call("x".repeat(65537))).statusCode, 413);
    const accepted = await call();
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.json().statusCode, 200);
    assert.equal(accepted.headers["cache-control"], "no-store");
    assert.equal((await replies(f.owner)).length, 1);
    assert.equal(
      (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [f.job]))
        .rows[0].state,
      "waiting",
    );
    const stale = await call({
      ...body,
      value: {
        ...body.value,
        action: {
          ...body.value.action,
          data: { ...data, waiting_id: randomUUID() },
        },
      },
    });
    assert.equal(stale.statusCode, 200);
    assert.equal(stale.json().statusCode, 400);
    const automatic = await call({
      ...body,
      value: { ...body.value, trigger: "automatic" },
    });
    assert.equal(automatic.json().statusCode, 400);
    for (let i = 0; i < 120; i++)
      assert.equal(
        (
          await call(
            body,
            `Bearer ${jwt}`,
            "/agent-channels/teams/activities",
            "10.89.1.1",
          )
        ).statusCode,
        200,
      );
    assert.equal(
      (
        await call(
          body,
          `Bearer ${jwt}`,
          "/agent-channels/teams/activities",
          "10.89.1.1",
        )
      ).statusCode,
      429,
    );
    assert.equal((await replies(f.owner)).length, 1);
    await consume();
    assert.equal((await replies(f.owner))[0].state, "accepted");
  } finally {
    await app.close();
  }
});

test("Teams reply retention is fixed and pending data expires even when transport is disabled", async () => {
  const { SWEEP_RULES, runSweep } = await import("../src/lib/sweep.js");
  const rule = SWEEP_RULES.find(
    (r) => r.key === "agent_channel_teams_reply_receipts",
  )!;
  assert.equal(rule.configurable, false);
  assert.equal(rule.days, 14);
  const f = await sent();
  await captureTeamsQuestionReply(f.reply, config, bot);
  await pool.query(
    "UPDATE agent_channel_teams_reply_receipts SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [f.owner],
  );
  await runSweep();
  assert.equal((await replies(f.owner)).length, 0);
});
