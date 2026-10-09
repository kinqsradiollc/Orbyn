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

async function fixture(producerLane: "background" | "overnight" = "overnight") {
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
