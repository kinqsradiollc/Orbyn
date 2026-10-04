import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, createHash, sign } from "node:crypto";
import { chatgptInferenceReceiptMessage } from "@orbyn/core";
import { createServer } from "node:http";
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
    "INSERT INTO chatgpt_executor_catalogs(executor_id,enrollment_epoch,lease_epoch,sequence,models,capabilities) VALUES($1,1,1,1,$2,'[\"plan_inference_v1\"]')",
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
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,connection_id,executor_id) VALUES($1,'chatgpt',$2,$3)",
    [owner, connection, executor],
  );
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

test("provider edits fence queued disclosure and claimed result publication", async () => {
  const queued = await fixture();
  await queueChatgptInference(queued.owner, queued.job, queued.selection, {
    instructions: "",
    input: [{ role: "user", content: "private" }],
  });
  await pool.query(
    "UPDATE user_ai_provider_choice SET version=version+1 WHERE user_id=$1",
    [queued.owner],
  );
  await assert.rejects(
    claimChatgptInference(queued.binding, queued.selection.executor_id),
    status(409),
  );
  const claimed = await fixture();
  const request = await queueChatgptInference(
    claimed.owner,
    claimed.job,
    claimed.selection,
    {
      instructions: "",
      input: [{ role: "user", content: "private" }],
    },
  );
  const assignment = await claimChatgptInference(
    claimed.binding,
    claimed.selection.executor_id,
  );
  assert.ok(assignment);
  await pool.query(
    "UPDATE user_ai_provider_choice SET version=version+1 WHERE user_id=$1",
    [claimed.owner],
  );
  await assert.rejects(
    finishChatgptInference(claimed.binding, claimed.receipt(assignment)),
    status(409),
  );
  await assert.rejects(
    readChatgptInference(claimed.owner, claimed.job, request.id),
    status(409),
  );
});

test("legacy catalog-only devices remain readable but cannot receive private inference input", async () => {
  const f = await fixture();
  await pool.query(
    "UPDATE chatgpt_executor_catalogs SET capabilities='[]' WHERE executor_id=$1",
    [f.selection.executor_id],
  );
  const { readChatgptModelCatalog } =
    await import("../src/modules/auth/chatgpt-model-catalog.js");
  const catalog = await readChatgptModelCatalog(f.binding, f.selection);
  assert.equal(catalog.status, "ready");
  assert.equal(catalog.models[0].slug, "fixture-model");
  assert.ok(
    !("capabilities" in catalog),
    "existing strict catalog readers keep their response shape",
  );
  await assert.rejects(
    queueChatgptInference(f.owner, f.job, f.selection, {
      instructions: "private",
      input: [],
    }),
    status(503),
  );
  const { saveAiProviderChoice } =
    await import("../src/modules/auth/ai-provider-choice.js");
  await assert.rejects(
    saveAiProviderChoice(f.binding, {
      primary: "chatgpt",
      ...f.selection,
      fallback_to_default: false,
      expected_version: 1,
    }),
    status(503),
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

test("personal provider routing consumes the assigned model's signed completed result", async () => {
  const f = await fixture();
  const { resolveUserAi } =
    await import("../src/modules/ai/providers/user-choice.js");
  const notices: string[] = [];
  const ai = await resolveUserAi(f.owner, f.job, async (message) => {
    notices.push(message);
  });
  assert.ok(ai?.textTransport);
  const controller = new AbortController();
  const output = ai.textTransport(
    [
      { role: "system", content: "Private instructions" },
      { role: "user", content: "Private question" },
    ],
    controller.signal,
  );
  // Attach a rejection handler before waiting for the asynchronous enqueue.
  void output.catch(() => {});
  try {
    let assignment = null;
    for (let attempt = 0; attempt < 50 && !assignment; attempt++) {
      assignment = await claimChatgptInference(
        f.binding,
        f.selection.executor_id,
      );
      if (!assignment) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(assignment);
    assert.equal(assignment.model, "fixture-model");
    assert.equal(assignment.payload.instructions, "Private instructions");
    assert.deepEqual(assignment.payload.input, [
      { role: "user", content: "Private question" },
    ]);
    await finishChatgptInference(f.binding, f.receipt(assignment));
    assert.equal(await output, "Private result");
    assert.deepEqual(notices, []);
  } finally {
    controller.abort();
    await output.catch(() => {});
  }
});

test("fallback calls the configured provider only for explicit consent and confirmed admission failure", async () => {
  const original = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  const requests: unknown[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "Default result" },
            finish_reason: "stop",
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const provider = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai-compatible','Routing fixture',$1) RETURNING id",
      [`http://127.0.0.1:${port}/v1`],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='default-fixture' WHERE id",
    [provider],
  );
  const { resolveUserAi } =
    await import("../src/modules/ai/providers/user-choice.js");
  try {
    for (const [fallback, phase, expectedCalls] of [
      [false, "admission", 0],
      [true, "stream", 0],
      [true, "unknown", 0],
      [true, "admission", 1],
    ] as const) {
      const f = await fixture();
      await pool.query(
        "UPDATE user_ai_provider_choice SET fallback_to_default=$2 WHERE user_id=$1",
        [f.owner, fallback],
      );
      const notices: string[] = [];
      const ai = await resolveUserAi(f.owner, f.job, async (m) => {
        notices.push(m);
      });
      assert.ok(ai?.textTransport);
      const abort = new AbortController();
      const output = ai.textTransport(
        [{ role: "user", content: "Question" }],
        abort.signal,
      );
      void output.catch(() => {});
      try {
        let assignment = null;
        for (let i = 0; i < 50 && !assignment; i++) {
          assignment = await claimChatgptInference(
            f.binding,
            f.selection.executor_id,
          );
          if (!assignment) await new Promise((r) => setTimeout(r, 20));
        }
        assert.ok(assignment);
        const publication = f.receipt(assignment);
        const receipt = {
          ...publication.receipt,
          result: {
            status: "failed",
            reason: "usage_limit",
            phase,
            http_status: 429,
            provider_code: "subscription_sharing_usage_limit_exceeded",
          },
        };
        const signature = sign(
          null,
          Buffer.from(chatgptInferenceReceiptMessage(receipt)),
          f.keys.privateKey,
        ).toString("base64url");
        await finishChatgptInference(f.binding, { receipt, signature });
        if (expectedCalls) {
          assert.equal(await output, "Default result");
          assert.equal(notices.length, 1);
        } else {
          await assert.rejects(output, /usage limit/);
          assert.equal(notices.length, 0);
        }
        assert.equal(requests.length, expectedCalls);
      } finally {
        abort.abort();
        await output.catch(() => {});
      }
    }
    assert.equal((requests[0] as { model: string }).model, "default-fixture");
  } finally {
    await pool.query(
      "UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id",
      [original.provider_id, original.model],
    );
    await pool.query("DELETE FROM ai_providers WHERE id=$1", [provider]);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
