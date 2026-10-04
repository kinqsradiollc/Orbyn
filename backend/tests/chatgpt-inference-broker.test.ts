import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, createHash, sign } from "node:crypto";
import { chatgptInferenceReceiptMessage } from "@orbyn/core";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  queueChatgptInference,
  claimChatgptInference,
  finishChatgptInference,
  readChatgptInference,
} = await import("../src/modules/auth/chatgpt-inference.js");
const owners: string[] = [];
before(() => migrate());
after(async () => {
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
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Fixture',true)",
    [owner, `${owner}@fixture.invalid`],
  );
  await pool.query(
    "INSERT INTO sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
    [session, owner, randomUUID()],
  );
  await pool.query(
    "INSERT INTO chatgpt_identity_connections(id,user_id,issuer,subject,client_id) VALUES($1,$2,'https://auth.openai.com',$3,'oaiapp_fixture')",
    [connection, owner, randomUUID()],
  );
  const keys = generateKeyPairSync("ed25519"),
    publicKey = keys.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url");
  const fingerprint = createHash("sha256")
    .update(Buffer.from(publicKey, "base64url"))
    .digest("base64url");
  await pool.query(
    "INSERT INTO chatgpt_executor_enrollments(id,connection_id,host_id,session_id,public_key,public_key_fingerprint,epoch) VALUES($1,$2,$3,$4,$5,$6,1)",
    [executor, connection, randomUUID(), session, publicKey, fingerprint],
  );
  await pool.query(
    "INSERT INTO chatgpt_executor_leases(executor_id,enrollment_epoch,session_id,epoch,expires_at) VALUES($1,1,$2,1,now()+interval '5 minutes')",
    [executor, session],
  );
  await pool.query(
    "INSERT INTO chatgpt_executor_catalogs(executor_id,enrollment_epoch,lease_epoch,sequence,models) VALUES($1,1,1,1,$2)",
    [
      executor,
      JSON.stringify([{ slug: "fixture-model", display_name: "Fixture" }]),
    ],
  );
  await pool.query(
    "INSERT INTO chatgpt_model_preferences(connection_id,model) VALUES($1,'fixture-model')",
    [connection],
  );
  const chat = (
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title) VALUES(gen_random_uuid(),$1,'Private fixture') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,state,sources_checked,lease_until,run_state) VALUES($1,$2,'running',true,now()+interval '5 minutes',$3) RETURNING id",
      [owner, chat, { version: 1 }],
    )
  ).rows[0].id;
  const selection = { connection_id: connection, executor_id: executor };
  const binding = { userId: owner, sessionId: session };
  return {
    owner,
    job,
    selection,
    binding,
    keys,
    receipt: (a: any) => {
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
          status: "completed",
          text: "Private result",
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        },
      };
      return {
        receipt,
        signature: sign(
          null,
          Buffer.from(chatgptInferenceReceiptMessage(receipt)),
          keys.privateKey,
        ).toString("base64url"),
      };
    },
  };
}
const status = (code: number) => (error: any) => error.statusCode === code;
test("assigned input is encrypted; only one claim and signed completed output are accepted", async () => {
  const f = await fixture();
  const request = await queueChatgptInference(f.owner, f.job, f.selection, {
    instructions: "Private instructions",
    input: [{ role: "user", content: "Private question" }],
  });
  const stored = (
    await pool.query(
      "SELECT payload_encrypted FROM chatgpt_inference_requests WHERE id=$1",
      [request.id],
    )
  ).rows[0].payload_encrypted;
  assert.ok(!stored.includes("Private question"));
  const assigned = await claimChatgptInference(
    f.binding,
    f.selection.executor_id,
  );
  assert.ok(assigned);
  assert.equal(assigned.payload.input[0].content, "Private question");
  assert.equal(
    await claimChatgptInference(f.binding, f.selection.executor_id),
    null,
  );
  const publication = f.receipt(assigned);
  await finishChatgptInference(f.binding, publication);
  assert.deepEqual(
    await readChatgptInference(f.owner, f.job, request.id),
    publication.receipt.result,
  );
  await assert.rejects(
    finishChatgptInference(f.binding, publication),
    status(409),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT payload_encrypted FROM chatgpt_inference_requests WHERE id=$1",
        [request.id],
      )
    ).rows[0].payload_encrypted,
    "",
  );
});
test("wrong sessions, forged output, replacement leases and inactive jobs are fenced", async () => {
  const f = await fixture();
  await queueChatgptInference(f.owner, f.job, f.selection, {
    instructions: "",
    input: [{ role: "user", content: "hello" }],
  });
  await assert.rejects(
    claimChatgptInference(
      { userId: f.owner, sessionId: randomUUID() },
      f.selection.executor_id,
    ),
    status(401),
  );
  const a = await claimChatgptInference(f.binding, f.selection.executor_id);
  assert.ok(a);
  const pub = f.receipt(a);
  const forged = structuredClone(pub);
  forged.receipt.result.text = "Tampered";
  await assert.rejects(finishChatgptInference(f.binding, forged), status(400));
  await pool.query(
    "UPDATE chatgpt_executor_leases SET epoch=2 WHERE executor_id=$1",
    [f.selection.executor_id],
  );
  await assert.rejects(finishChatgptInference(f.binding, pub), status(503));
  await pool.query(
    "UPDATE chatgpt_executor_leases SET epoch=1 WHERE executor_id=$1",
    [f.selection.executor_id],
  );
  await pool.query("UPDATE ai_jobs SET state='failed' WHERE id=$1", [f.job]);
  await assert.rejects(finishChatgptInference(f.binding, pub), status(409));
});

test("unverified job sources and another owner's job never reach a device", async () => {
  const f = await fixture();
  const other = await fixture();
  await assert.rejects(
    queueChatgptInference(other.owner, f.job, other.selection, {
      instructions: "",
      input: [],
    }),
    status(409),
  );
  await pool.query("UPDATE ai_jobs SET sources_checked=false WHERE id=$1", [
    f.job,
  ]);
  await assert.rejects(
    queueChatgptInference(f.owner, f.job, f.selection, {
      instructions: "",
      input: [],
    }),
    status(409),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_requests WHERE job_id=$1",
        [f.job],
      )
    ).rows[0].n,
    0,
  );
});
