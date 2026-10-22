import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { defaultNightShift, HttpError } from "@orbyn/core";

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { claimAssistantJob } = await import("../src/modules/ai/agent/runner.js");
const { readAssistantBudget } =
  await import("../src/modules/assistant-workspace/budgets.js");
const { readAssistantProfiles } =
  await import("../src/modules/assistant-workspace/profiles.js");
const {
  handoffProducerEvidence,
  createRequestedAssistantHandoff,
  dispatchAssistantHandoff,
  readAssistantHandoff,
  assertReceivingHandoffCurrent,
  settleAssistantHandoff,
} = await import("../src/modules/assistant-workspace/handoffs.js");

const owners: string[] = [];
const provider = randomUUID();
let savedProvider: string | null = null;
let savedModel = "";
before(async () => {
  await migrate();
  const settings = (
    await pool.query<{ provider_id: string | null; model: string }>(
      "SELECT provider_id,model FROM ai_settings WHERE id=true",
    )
  ).rows[0];
  savedProvider = settings.provider_id;
  savedModel = settings.model;
  await pool.query(
    "INSERT INTO ai_providers(id,kind,name,enabled) VALUES($1,'openai_compatible','C3 fixture',true)",
    [provider],
  );
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='qa-model' WHERE id=true",
    [provider],
  );
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id=true",
    [savedProvider, savedModel],
  );
  await pool.query("DELETE FROM ai_providers WHERE id=$1", [provider]);
  await pool.end();
});

async function fixture(
  producerLane: "background" | "overnight" = "overnight",
  prepare?: (owner: string, job: string, doc: string) => Promise<void>,
) {
  const owner = randomUUID();
  owners.push(owner);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Handoff owner')",
    [owner, `c3-handoff-${owner}@example.test`],
  );
  await assistantPrincipal(
    { id: owner, name: "Handoff owner", role: "member" },
    { lane: "background" },
  );
  const chat = randomUUID();
  const job = randomUUID();
  const doc = randomUUID();
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Evidence')",
    [doc, owner],
  );
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Agent result',$3)",
    [chat, owner, producerLane === "overnight" ? "night" : "task"],
  );
  await pool.query(
    `INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,result,sources_checked,run_origin,run_state)
     VALUES($1,$2,$3,$4,'done',$5::jsonb,true,$7,$6::jsonb)`,
    [
      job,
      owner,
      chat,
      randomUUID(),
      JSON.stringify({ answer: "Review the evidence." }),
      JSON.stringify({
        version: 1,
        request: {
          automation: { kind: producerLane === "overnight" ? "night" : "task" },
        },
      }),
      producerLane === "overnight" ? "night" : "task",
    ],
  );
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [job, doc],
  );
  await prepare?.(owner, job, doc);
  const source = await handoffProducerEvidence(pool, owner, job);
  const handoff = await createRequestedAssistantHandoff(owner, {
    producer_job_id: job,
    expected_producer_revision: source.source.revision,
    recipient_lane: producerLane === "overnight" ? "background" : "overnight",
    title: "Review evidence",
    instruction: "Review the night result and identify the next step.",
  });
  return { owner, job, doc, handoff };
}

test("handoffs inherit retained binding context and reject later source-grant revocation", async () => {
  const { env } = await import("../src/config/env.js");
  const { transaction } = await import("../src/db/pool.js");
  const { openPersonalConversation } =
    await import("../src/modules/assistant-workspace/conversation-storage.js");
  const { bindConversationWork, publishConversationIntent } =
    await import("../src/modules/assistant-workspace/conversation-delivery.js");
  const { assistantJobSourcesVisible } =
    await import("../src/lib/assistant-job-sources.js");
  const previous = env.ASSISTANT_CONVERSATION_ENABLED;
  env.ASSISTANT_CONVERSATION_ENABLED = "true";
  let sourceGrant = "",
    entry = "";
  let fixtureOwner = "";
  try {
    const f = await fixture("overnight", async (owner, producer, doc) => {
      fixtureOwner = owner;
      const home = await transaction((db) =>
        openPersonalConversation(db, owner),
      );
      await pool.query(
        "INSERT INTO agent_settings(user_id,reminder_nudges) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET reminder_nudges=$2",
        [owner, { quiet_start: "00:00", quiet_end: "00:00" }],
      );
      sourceGrant = (
        await pool.query(
          "INSERT INTO agent_grants(user_id,kind,client_id,access,personal,team_ids) VALUES($1,'oauth','https://handoff-context.invalid','write',true,'{}') RETURNING id",
          [owner],
        )
      ).rows[0].id;
      const chat = randomUUID(),
        job = randomUUID();
      await pool.query(
        "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Selected source','task')",
        [chat, owner],
      );
      await pool.query(
        "INSERT INTO ai_jobs(id,user_id,chat_id,state,run_origin,sources_checked) VALUES($1,$2,$3,'queued','task',true)",
        [job, owner, chat],
      );
      await transaction((db) =>
        bindConversationWork(db, {
          ownerId: owner,
          work: { kind: "job", id: job },
          lane: "background",
          timezone: "UTC",
          destinationId: home.id,
          grantId: sourceGrant,
        }),
      );
      await pool.query(
        "UPDATE ai_jobs SET state='done',result=$2 WHERE id=$1",
        [job, { answer: "Selected finding" }],
      );
      const intent = (
        await pool.query(
          "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
          [job],
        )
      ).rows[0].id;
      await transaction((db) => publishConversationIntent(db, intent));
      entry = (
        await pool.query(
          "SELECT id FROM assistant_conversation_entries WHERE intent_id=$1",
          [intent],
        )
      ).rows[0].id;
      const binding = await transaction((db) =>
        bindConversationWork(db, {
          ownerId: owner,
          work: { kind: "job", id: producer },
          lane: "overnight",
          timezone: "UTC",
          destinationId: home.id,
          sourcesChecked: true,
          sources: [{ kind: "doc", id: doc }],
        }),
      );
      assert.ok(binding);
      await pool.query(
        "INSERT INTO assistant_delivery_entry_sources(binding_id,source_entry_id) VALUES($1,$2)",
        [binding, entry],
      );
    });
    assert.equal(await dispatchAssistantHandoff("background"), f.handoff);
    const receiver = (
      await pool.query(
        "SELECT h.recipient_job_id,j.chat_id,j.turn_id,j.run_state FROM assistant_handoffs h JOIN ai_jobs j ON j.id=h.recipient_job_id WHERE h.id=$1",
        [f.handoff],
      )
    ).rows[0];
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM assistant_turn_entry_sources WHERE chat_id=$1 AND turn_id=$2 AND source_entry_id=$3",
          [receiver.chat_id, receiver.turn_id, entry],
        )
      ).rowCount,
      1,
    );
    const { SWEEP_RULES } = await import("../src/lib/sweep.js");
    const rule = SWEEP_RULES.find((item) => item.key === "ai_jobs")!;
    await pool.query(
      "UPDATE ai_jobs SET created_at=now()-interval '2 days' WHERE id=ANY($1::uuid[])",
      [[f.job, receiver.recipient_job_id]],
    );
    assert.equal(
      (
        await pool.query(
          `SELECT id FROM ai_jobs WHERE id=$1 AND (${rule.where})`,
          [f.job],
        )
      ).rowCount,
      0,
      "An accepted handoff preserves its producing evidence",
    );
    const { captureChatSweepJob, completeChatMaintenance } =
      await import("../src/modules/ai/providers/chat-maintenance.js");
    const producerChat = (
      await pool.query("SELECT chat_id FROM ai_jobs WHERE id=$1", [f.job])
    ).rows[0].chat_id;
    const compaction = await transaction((db) =>
      captureChatSweepJob(db, f.owner, producerChat),
    );
    let providerCalls = 0;
    await assert.rejects(
      completeChatMaintenance(f.owner, compaction, [], {
        send: async () => {
          providerCalls++;
          return "{}";
        },
      }),
      /maintenance source changed/,
    );
    assert.equal(
      providerCalls,
      0,
      "Compaction must not transmit an active handoff's execution context",
    );
    await assertReceivingHandoffCurrent(
      f.owner,
      receiver.recipient_job_id,
      f.handoff,
      receiver.run_state.assistant_rules_revision,
    );
    await pool.query("UPDATE agent_grants SET revoked_at=now() WHERE id=$1", [
      sourceGrant,
    ]);
    assert.equal(
      (
        await pool.query(
          `SELECT j.id FROM ai_jobs j WHERE j.id=$2 AND ${assistantJobSourcesVisible("j", "$1", false)}`,
          [f.owner, receiver.recipient_job_id],
        )
      ).rowCount,
      0,
    );
    await assert.rejects(
      assertReceivingHandoffCurrent(
        f.owner,
        receiver.recipient_job_id,
        f.handoff,
        receiver.run_state.assistant_rules_revision,
      ),
      HttpError,
    );
    await pool.query("UPDATE ai_jobs SET state='failed' WHERE id=$1", [
      receiver.recipient_job_id,
    ]);
    assert.equal(
      (
        await pool.query(
          `SELECT id FROM ai_jobs WHERE id=$1 AND (${rule.where})`,
          [receiver.recipient_job_id],
        )
      ).rowCount,
      0,
      "A finished recipient survives until acknowledgement settles its handoff",
    );
  } finally {
    if (fixtureOwner)
      await pool.query("DELETE FROM users WHERE id=$1", [fixtureOwner]);
    env.ASSISTANT_CONVERSATION_ENABLED = previous;
  }
});

test("receiving worker queues separate source-linked work and settles its estimate", async () => {
  const { owner, job, doc, handoff } = await fixture();
  assert.equal(await dispatchAssistantHandoff("background"), handoff);
  const receipt = (
    await pool.query<{ recipient_job_id: string; status: string }>(
      "SELECT recipient_job_id,status FROM assistant_handoffs WHERE id=$1",
      [handoff],
    )
  ).rows[0];
  assert.equal(receipt.status, "accepted");
  assert.notEqual(receipt.recipient_job_id, job);
  const visibleReceipt = await readAssistantHandoff(pool, owner, handoff);
  assert.equal(visibleReceipt.recipient_job_id, receipt.recipient_job_id);
  assert.ok(visibleReceipt.recipient_chat_id);
  assert.deepEqual(
    (
      await pool.query(
        "SELECT source_kind,source_id FROM assistant_job_sources WHERE job_id=$1",
        [receipt.recipient_job_id],
      )
    ).rows,
    [{ source_kind: "doc", source_id: doc }],
  );
  const queued = (
    await pool.query<{ run_state: { assistant_rules_revision: number } }>(
      "SELECT run_state FROM ai_jobs WHERE id=$1 AND runtime_lane='background' AND sources_checked",
      [receipt.recipient_job_id],
    )
  ).rows[0];
  assert.ok(queued.run_state.assistant_rules_revision > 0);
  await assertReceivingHandoffCurrent(
    owner,
    receipt.recipient_job_id,
    handoff,
    queued.run_state.assistant_rules_revision,
  );
  const claimed = await claimAssistantJob("c3-worker", "background");
  assert.equal(claimed?.id, receipt.recipient_job_id);
  const during = await readAssistantBudget(pool, owner, "background");
  assert.ok(during.active_reserved_tokens > 0);
  await pool.query(
    `UPDATE ai_jobs SET state='done',run_state=NULL,
      result='{"answer":"Follow-up ready","assistant_run":{"token_estimate":1234}}'::jsonb
     WHERE id=$1`,
    [receipt.recipient_job_id],
  );
  assert.equal(await settleAssistantHandoff("background"), handoff);
  const settled = await readAssistantBudget(pool, owner, "background");
  assert.equal(settled.active_reserved_tokens, 0);
  assert.equal(
    (
      await pool.query("SELECT status FROM assistant_handoffs WHERE id=$1", [
        handoff,
      ])
    ).rows[0].status,
    "completed",
  );
  await pool.query(
    `INSERT INTO assistant_activity_streams(owner_id,runtime_lane,last_sequence)
     VALUES($1,'overnight',1)`,
    [owner],
  );
  await pool.query(
    `INSERT INTO assistant_activity_events(owner_id,runtime_lane,sequence,job_id,kind)
     VALUES($1,'overnight',1,$2,'done')`,
    [owner, job],
  );
  const output = (await readAssistantProfiles(pool, owner)).profiles[1]
    .outputs[0];
  assert.equal(output.handoff?.id, handoff);
  assert.equal(output.handoff?.status, "completed");
  assert.equal(
    output.handoff?.recipient_chat_id,
    visibleReceipt.recipient_chat_id,
  );
});

test("a changed source cannot authorize a queued receiving run", async () => {
  const { owner, job, handoff } = await fixture();
  assert.equal(await dispatchAssistantHandoff("background"), handoff);
  const receiver = (
    await pool.query<{
      recipient_job_id: string;
      run_state: { assistant_rules_revision: number };
    }>(
      `SELECT h.recipient_job_id,j.run_state FROM assistant_handoffs h
     JOIN ai_jobs j ON j.id=h.recipient_job_id WHERE h.id=$1`,
      [handoff],
    )
  ).rows[0];
  await pool.query("UPDATE ai_jobs SET result=$2::jsonb WHERE id=$1", [
    job,
    JSON.stringify({ answer: "Changed" }),
  ]);
  await assert.rejects(
    assertReceivingHandoffCurrent(
      owner,
      receiver.recipient_job_id,
      handoff,
      receiver.run_state.assistant_rules_revision,
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
});

test("overnight handoffs wait for their own enabled window and carry its deadline", async () => {
  const { owner, handoff } = await fixture("background");
  const now = new Date();
  const clock = (offsetMinutes: number) => {
    const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
    return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
  };
  const settings = {
    ...defaultNightShift({ timezone: "UTC" }),
    enabled: true,
    start: clock(-60),
    end: clock(60),
  };
  await pool.query(
    `INSERT INTO agent_settings(user_id,night_shift) VALUES($1,$2::jsonb)
     ON CONFLICT(user_id) DO UPDATE SET night_shift=excluded.night_shift`,
    [
      owner,
      JSON.stringify({
        ...settings,
        kinds: { ...settings.kinds, handed: false },
      }),
    ],
  );
  assert.equal(await dispatchAssistantHandoff("overnight"), null);
  await pool.query(
    "UPDATE agent_settings SET night_shift=$2::jsonb WHERE user_id=$1",
    [owner, JSON.stringify(settings)],
  );
  assert.equal(await dispatchAssistantHandoff("overnight"), handoff);
  const received = (
    await pool.query<{
      run_state: { request: { automation: { end_at: string } } };
    }>(
      `SELECT j.run_state FROM assistant_handoffs h JOIN ai_jobs j ON j.id=h.recipient_job_id
       WHERE h.id=$1 AND j.runtime_lane='overnight'`,
      [handoff],
    )
  ).rows[0];
  assert.ok(
    Date.parse(received.run_state.request.automation.end_at) > now.getTime(),
  );
});

test("handoffs keep an admitted origin and fail rather than reroute after its deletion", async () => {
  const { env } = await import("../src/config/env.js");
  const { transaction } = await import("../src/db/pool.js");
  const { openPersonalConversation, registerOriginConversation } =
    await import("../src/modules/assistant-workspace/conversation-storage.js");
  const { bindConversationWork } =
    await import("../src/modules/assistant-workspace/conversation-delivery.js");
  const previous = env.ASSISTANT_CONVERSATION_ENABLED;
  env.ASSISTANT_CONVERSATION_ENABLED = "true";
  try {
    for (const retired of [false, true]) {
      const f = await fixture();
      const home = await transaction((db) =>
        openPersonalConversation(db, f.owner),
      );
      const originChat = randomUUID();
      await pool.query(
        "INSERT INTO ai_chats(id,user_id,title) VALUES($1,$2,'Requested origin')",
        [originChat, f.owner],
      );
      const origin = await transaction((db) =>
        registerOriginConversation(db, f.owner, originChat),
      );
      await transaction((db) =>
        bindConversationWork(db, {
          ownerId: f.owner,
          work: { kind: "job", id: f.job },
          lane: "overnight",
          timezone: "UTC",
          destinationId: origin.id,
          sourcesChecked: true,
          sources: [{ kind: "doc", id: f.doc }],
        }),
      );
      if (retired)
        await pool.query("DELETE FROM ai_chats WHERE id=$1", [originChat]);
      assert.equal(await dispatchAssistantHandoff("background"), f.handoff);
      const receipt = (
        await pool.query(
          "SELECT status,failure,recipient_job_id FROM assistant_handoffs WHERE id=$1",
          [f.handoff],
        )
      ).rows[0];
      if (retired) {
        assert.equal(receipt.status, "failed");
        assert.equal(receipt.failure, "access");
        assert.equal(receipt.recipient_job_id, null);
      } else {
        assert.equal(receipt.status, "accepted");
        const binding = (
          await pool.query(
            "SELECT destination_id FROM assistant_delivery_bindings WHERE work_kind='job' AND work_id=$1",
            [receipt.recipient_job_id],
          )
        ).rows[0];
        assert.equal(binding.destination_id, origin.id);
        assert.notEqual(binding.destination_id, home.id);
        await pool.query("UPDATE ai_jobs SET state='failed' WHERE id=$1", [
          receipt.recipient_job_id,
        ]);
      }
    }
  } finally {
    env.ASSISTANT_CONVERSATION_ENABLED = previous;
  }
});
