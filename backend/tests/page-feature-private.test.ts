import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, createHash, sign } from "node:crypto";
import {
  chatgptInferenceReceiptMessage,
  type ChatgptInferenceAssignment,
  type AiFeatureProvider,
} from "@orbyn/core";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { completePageFeature } =
  await import("../src/modules/ai/providers/feature-call.js");
const { claimChatgptInference, finishChatgptInference } =
  await import("../src/modules/auth/chatgpt-inference.js");
const owners: string[] = [];
const pending: Promise<unknown>[] = [];
before(() => migrate());
after(async () => {
  await Promise.allSettled(pending);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function fixture() {
  const owner = randomUUID(),
    session = randomUUID(),
    connection = randomUUID(),
    executor = randomUUID();
  owners.push(owner);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Feature fixture',true)",
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
    "INSERT INTO chatgpt_executor_leases(executor_id,enrollment_epoch,session_id,epoch,expires_at) VALUES($1,1,$2,1,now()+interval '5 minutes')",
    [executor, session],
  );
  await pool.query(
    "INSERT INTO chatgpt_executor_catalogs(executor_id,enrollment_epoch,lease_epoch,sequence,models,capabilities) VALUES($1,1,1,1,'[]','[\"plan_inference_v1\"]')",
    [executor],
  );
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,connection_id,executor_id,fallback_to_default) VALUES($1,'chatgpt',$2,$3,$4)",
    [owner, connection, executor, false],
  );

  await pool.query(
    "UPDATE chatgpt_executor_catalogs SET models=$2 WHERE executor_id=$1",
    [
      executor,
      JSON.stringify([{ slug: "fixture-model", display_name: "Fixture" }]),
    ],
  );
  await pool.query(
    "INSERT INTO chatgpt_model_preferences(connection_id,model) VALUES($1,'fixture-model')",
    [connection],
  );
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title,content) VALUES($1,'Feature page','[]') RETURNING id,version",
      [owner],
    )
  ).rows[0];
  return { owner, session, executor, keys, doc };
}
async function assignment(f: Awaited<ReturnType<typeof fixture>>) {
  for (let n = 0; n < 100; n++) {
    const value = await claimChatgptInference(
      { userId: f.owner, sessionId: f.session },
      f.executor,
    );
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error("No feature assignment arrived");
}
async function publish(
  f: Awaited<ReturnType<typeof fixture>>,
  a: ChatgptInferenceAssignment,
) {
  const receipt = {
    request_id: a.id,
    executor_id: a.executor_id,
    binding: a.binding,
    enrollment_epoch: a.enrollment_epoch,
    lease_epoch: a.lease_epoch,
    model: a.model,
    nonce: a.nonce,
    request_hash: a.request_hash,
    result: {
      status: "completed" as const,
      text: "Signed feature answer",
      usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
    },
  };
  const signature = sign(
    null,
    Buffer.from(chatgptInferenceReceiptMessage(receipt)),
    f.keys.privateKey,
  ).toString("base64url");
  return finishChatgptInference(
    { userId: f.owner, sessionId: f.session },
    { receipt, signature },
  );
}
test("a first-party page call accepts a signed private reply and records measured usage", async () => {
  const f = await fixture();
  let provider: AiFeatureProvider | undefined;
  const answer = completePageFeature(
    f.owner,
    "doc_ask",
    [f.doc],
    [
      { role: "system", content: "Use page facts" },
      { role: "user", content: "Selected page input" },
    ],
    {
      timeoutMs: 5000,
      allowPersonal: true,
      onProvider: (value) => {
        provider = value;
      },
    },
  );
  pending.push(answer);
  void answer.catch(() => {});
  const a = await assignment(f);
  assert.equal(a.payload.input[0].content, "Selected page input");
  await publish(f, a);
  assert.equal(await answer, "Signed feature answer");
  assert.deepEqual(provider, {
    source: "chatgpt",
    model: "fixture-model",
    fallback: false,
  });
  const usage = (
    await pool.query(
      "SELECT model,total_tokens FROM chatgpt_completed_usage WHERE user_id=$1",
      [f.owner],
    )
  ).rows;
  assert.equal(usage.length, 1);
  assert.equal(usage[0].model, "fixture-model");
  assert.equal(Number(usage[0].total_tokens), 7);
  const job = (
    await pool.query(
      "SELECT state,chat_id,provider_choice_snapshot FROM ai_jobs WHERE user_id=$1",
      [f.owner],
    )
  ).rows[0];
  assert.equal(job.state, "done");
  assert.equal(job.chat_id, null);
  assert.equal(job.provider_choice_snapshot.primary, "chatgpt");
});

test("a signed feature reply cannot be accepted after its page revision changed", async () => {
  const f = await fixture();
  const answer = completePageFeature(
    f.owner,
    "doc_ask",
    [f.doc],
    [{ role: "user", content: "Old page facts" }],
    { timeoutMs: 5000, allowPersonal: true },
  );
  pending.push(answer);
  void answer.catch(() => {});
  const a = await assignment(f);
  await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [f.doc.id]);
  await assert.rejects(publish(f, a), (error: any) => error.statusCode === 409);
  await assert.rejects(answer);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM chatgpt_completed_usage WHERE user_id=$1",
        [f.owner],
      )
    ).rowCount,
    0,
  );
});

test("a feature caller without app-session authority cannot borrow the owner's plan", async () => {
  const f = await fixture();
  await assert.rejects(
    completePageFeature(
      f.owner,
      "doc_ask",
      [f.doc],
      [{ role: "user", content: "Unprivileged fixture" }],
    ),
    (error: any) => error.statusCode === 403,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM chatgpt_inference_requests WHERE user_id=$1",
        [f.owner],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (await pool.query("SELECT 1 FROM ai_jobs WHERE user_id=$1", [f.owner]))
      .rowCount,
    0,
  );
});
