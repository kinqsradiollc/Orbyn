import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, createHash, sign } from "node:crypto";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { claimAssistantJob } = await import("../src/modules/ai/agent/runner.js");
const { initialAssistantRun } = await import("../src/modules/ai/agent/run.js");
const owners: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function fixture(kind: "task" | "night" = "task", fallback = false) {
  const owner = randomUUID(),
    session = randomUUID(),
    connection = randomUUID(),
    executor = randomUUID(),
    chat = randomUUID();
  owners.push(owner);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Queue fixture',true)",
    [owner, `${owner}@fixture.invalid`],
  );
  await pool.query(
    "INSERT INTO sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
    [session, owner, randomUUID()],
  );
  await pool.query(
    "INSERT INTO chatgpt_identity_connections(id,user_id,issuer,subject,client_id) VALUES($1,$2,'https://auth.openai.com',$3,'oaiapp_queue_fixture')",
    [connection, owner, randomUUID()],
  );
  const keys = generateKeyPairSync("ed25519");
  const key = keys.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64url");
  await pool.query(
    "INSERT INTO chatgpt_executor_enrollments(id,connection_id,host_id,session_id,public_key,public_key_fingerprint,epoch) VALUES($1,$2,$3,$4,$5,$6,1)",
    [
      executor,
      connection,
      randomUUID(),
      session,
      key,
      createHash("sha256")
        .update(Buffer.from(key, "base64url"))
        .digest("base64url"),
    ],
  );
  await pool.query(
    "INSERT INTO chatgpt_executor_leases(executor_id,enrollment_epoch,session_id,epoch,expires_at) VALUES($1,1,$2,1,now()-interval '1 second')",
    [executor, session],
  );
  await pool.query(
    "INSERT INTO chatgpt_executor_catalogs(executor_id,enrollment_epoch,lease_epoch,sequence,models,capabilities) VALUES($1,1,1,1,'[]','[\"plan_inference_v1\"]')",
    [executor],
  );
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,connection_id,executor_id,fallback_to_default) VALUES($1,'chatgpt',$2,$3,$4)",
    [owner, connection, executor, fallback],
  );
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Queue fixture','task')",
    [chat, owner],
  );
  const request = {
    chat_id: chat,
    turn_id: randomUUID(),
    message: "Queue fixture",
    timezone: "UTC",
    history: [],
    scope: null,
    automation: { kind },
  };
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,turn_id,state,run_state,sources_checked) VALUES($1,$2,$3,'queued',$4,true) RETURNING id",
      [owner, chat, request.turn_id, initialAssistantRun(request)],
    )
  ).rows[0].id;
  return {
    keys,
    owner,
    session,
    connection,
    executor,
    job,
    lane: kind === "night" ? ("overnight" as const) : ("background" as const),
  };
}
const finish = async (id: string) =>
  pool.query("UPDATE ai_jobs SET state='done',lease_until=NULL WHERE id=$1", [
    id,
  ]);
test("Background and Overnight private work stays queued offline and claims only with fresh supported device metadata", async () => {
  for (const kind of ["task", "night"] as const) {
    const f = await fixture(kind);
    assert.equal(await claimAssistantJob("offline", f.lane), null);
    const row = (
      await pool.query(
        "SELECT state,claimed_by,resume_count FROM ai_jobs WHERE id=$1",
        [f.job],
      )
    ).rows[0];
    assert.equal(row.state, "queued");
    assert.equal(row.claimed_by, null);
    assert.equal(row.resume_count, 0);
    await pool.query(
      "UPDATE chatgpt_executor_leases SET expires_at=now()+interval '5 minutes' WHERE executor_id=$1",
      [f.executor],
    );
    await pool.query(
      "UPDATE chatgpt_executor_catalogs SET published_at=now()-interval '6 minutes' WHERE executor_id=$1",
      [f.executor],
    );
    assert.equal(await claimAssistantJob("stale", f.lane), null);
    await pool.query(
      "UPDATE chatgpt_executor_catalogs SET published_at=now(),capabilities='[]' WHERE executor_id=$1",
      [f.executor],
    );
    assert.equal(await claimAssistantJob("legacy-device", f.lane), null);
    await pool.query(
      "UPDATE chatgpt_executor_catalogs SET capabilities='[\"plan_inference_v1\"]' WHERE executor_id=$1",
      [f.executor],
    );
    assert.equal((await claimAssistantJob("available", f.lane))?.id, f.job);
    await finish(f.job);
  }
});
test("explicit fallback and changed consent remain claimable for execution-time policy checks", async () => {
  const fallback = await fixture("task", true);
  assert.equal(
    (await claimAssistantJob("fallback", "background"))?.id,
    fallback.job,
  );
  await finish(fallback.job);
  const changed = await fixture();
  await pool.query(
    "UPDATE user_ai_provider_choice SET version=version+1 WHERE user_id=$1",
    [changed.owner],
  );
  assert.equal(
    (await claimAssistantJob("changed", "background"))?.id,
    changed.job,
  );
  await finish(changed.job);
  const disabled = await fixture();
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
    disabled.owner,
  ]);
  assert.equal(
    (await claimAssistantJob("disabled", "background"))?.id,
    disabled.job,
  );
  await finish(disabled.job);
});

test("an accepted signed reply can resume its Background job with the device offline", async () => {
  const { chatgptInferenceReceiptMessage } = await import("@orbyn/core");
  const {
    queueChatgptInference,
    claimChatgptInference,
    finishChatgptInference,
  } = await import("../src/modules/auth/chatgpt-inference.js");
  const f = await fixture();
  await pool.query(
    "UPDATE chatgpt_executor_leases SET expires_at=now()+interval '5 minutes' WHERE executor_id=$1",
    [f.executor],
  );
  await pool.query(
    "UPDATE chatgpt_executor_catalogs SET models=$2 WHERE executor_id=$1",
    [
      f.executor,
      JSON.stringify([{ slug: "fixture-model", display_name: "Fixture" }]),
    ],
  );
  await pool.query(
    "INSERT INTO chatgpt_model_preferences(connection_id,model) VALUES($1,'fixture-model')",
    [f.connection],
  );
  assert.equal((await claimAssistantJob("produce", "background"))?.id, f.job);
  const selection = { connection_id: f.connection, executor_id: f.executor };
  await queueChatgptInference(
    f.owner,
    f.job,
    selection,
    { instructions: "Fixture", input: [{ role: "user", content: "Fixture" }] },
    "fixture-model",
    1,
    randomUUID(),
  );
  const assignment = await claimChatgptInference(
    { userId: f.owner, sessionId: f.session },
    f.executor,
  );
  assert.ok(assignment);
  const receipt = {
    request_id: assignment.id,
    executor_id: assignment.executor_id,
    binding: assignment.binding,
    enrollment_epoch: assignment.enrollment_epoch,
    lease_epoch: assignment.lease_epoch,
    model: assignment.model,
    nonce: assignment.nonce,
    request_hash: assignment.request_hash,
    result: {
      status: "completed" as const,
      text: "Cached fixture",
      usage: null,
    },
  };
  const signature = sign(
    null,
    Buffer.from(chatgptInferenceReceiptMessage(receipt)),
    f.keys.privateKey,
  ).toString("base64url");
  await finishChatgptInference(
    { userId: f.owner, sessionId: f.session },
    { receipt, signature },
  );
  await pool.query(
    "UPDATE chatgpt_executor_leases SET expires_at=now()-interval '1 second' WHERE executor_id=$1",
    [f.executor],
  );
  await pool.query(
    "UPDATE ai_jobs SET state='queued',claimed_by=NULL,lease_until=NULL WHERE id=$1",
    [f.job],
  );
  assert.equal(
    (await claimAssistantJob("recover-cached", "background"))?.id,
    f.job,
  );
  await finish(f.job);
});

test("closed unreviewed night work and cancellation can be settled without waking a device", async () => {
  const cancelled = await fixture();
  await pool.query("UPDATE ai_jobs SET cancel_requested=true WHERE id=$1", [
    cancelled.job,
  ]);
  assert.equal(
    (await claimAssistantJob("cancelled", "background"))?.id,
    cancelled.job,
  );
  await finish(cancelled.job);
  const expired = await fixture("night");
  const night = (
    await pool.query(
      "INSERT INTO assistant_nights(user_id,local_day,status) VALUES($1,'2050-01-01','done') RETURNING id",
      [expired.owner],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_jobs SET run_state=jsonb_set(run_state,'{request,automation,night_id}',to_jsonb($2::text)) WHERE id=$1",
    [expired.job, night],
  );
  assert.equal(
    (await claimAssistantJob("settle-night", "overnight"))?.id,
    expired.job,
  );
  await finish(expired.job);
});
