import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, createHash, sign } from "node:crypto";
import { createServer } from "node:http";
import {
  chatgptInferenceReceiptMessage,
  type ChatgptInferenceAssignment,
} from "@orbyn/core";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { readAiProviderChoice } =
  await import("../src/modules/auth/ai-provider-choice.js");
const { completeAgendaFeature } =
  await import("../src/modules/ai/providers/agenda-call.js");
const { briefFor } = await import("../src/modules/ai/agenda-brief.js");
const { captureAgendaAiSnapshot, assertAgendaAiSnapshot } =
  await import("../src/modules/docs/agenda-ai-snapshot.js");
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
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Agenda fixture',true)",
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
    "INSERT INTO chatgpt_executor_catalogs(executor_id,enrollment_epoch,lease_epoch,sequence,models,capabilities) VALUES($1,1,1,1,'[]','[\"plan_inference_v1\",\"plan_inference_limits_v1\"]')",
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
  return { owner, session, connection, executor, keys, doc };
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

const now = new Date("2026-10-05T09:00:00Z");
async function start(
  f: Awaited<ReturnType<typeof fixture>>,
  sessionId = f.session,
) {
  const snapshot = await captureAgendaAiSnapshot(f.owner, now);
  const answer = completeAgendaFeature(
    { userId: f.owner, sessionId },
    snapshot,
    [
      { role: "system", content: "Use only Agenda facts" },
      { role: "user", content: JSON.stringify(snapshot.facts) },
    ],
  );
  pending.push(answer);
  void answer.catch(() => {});
  return { answer };
}
test("an app-authorized Agenda accepts one bounded signed reply and records measured usage", async () => {
  const f = await fixture();
  const { answer } = await start(f);
  const a = await assignment(f);
  assert.equal(a.payload.max_output_tokens, 512);
  assert.ok(!JSON.stringify(a.payload).includes(f.doc.id));
  await publish(f, a);
  assert.equal(await answer, "Signed feature answer");
  const row = (
    await pool.query("SELECT state,run_state,result FROM ai_jobs WHERE id=$1", [
      a.job_id,
    ])
  ).rows[0];
  assert.equal(row.state, "done");
  assert.equal(row.run_state.feature, "agenda_brief");
  assert.deepEqual(row.result.feature_provider, {
    source: "chatgpt",
    model: "fixture-model",
    fallback: false,
  });
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_completed_usage WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    1,
  );
});
test("Agenda publication waits for job authority before locking the inference request", async () => {
  const f = await fixture();
  const { answer } = await start(f);
  const a = await assignment(f);
  const held = await pool.connect();
  let publication: Promise<unknown> | undefined;
  try {
    await held.query("BEGIN");
    await held.query("SELECT id FROM ai_jobs WHERE id=$1 FOR SHARE", [
      a.job_id,
    ]);
    publication = publish(f, a);
    pending.push(publication);
    void publication.catch(() => {});
    let blocked = false;
    for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
      blocked = !!(
        await pool.query(
          `SELECT pid FROM pg_stat_activity WHERE datname=current_database()
         AND wait_event_type='Lock' AND
           (query LIKE '%SELECT j.id FROM ai_jobs j JOIN users%'
            OR query LIKE '%UPDATE ai_jobs SET result=coalesce%')`,
        )
      ).rowCount;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(
      blocked,
      "publication or its poll must be waiting on the held job",
    );
    // This NOWAIT probe fails on the old SHARE-to-UPDATE order: publication
    // has already acquired the request while awaiting its provenance job write.
    const request = await pool.query(
      "SELECT id FROM chatgpt_inference_requests WHERE id=$1 FOR UPDATE NOWAIT",
      [a.id],
    );
    assert.equal(
      request.rowCount,
      1,
      "blocked job authority must not hold the request",
    );
  } finally {
    await held.query("ROLLBACK");
    held.release();
  }
  await publication;
  assert.equal(await answer, "Signed feature answer");
});
test("an Agenda source changed after assignment rejects late signed output and accepted usage", async () => {
  const f = await fixture();
  const id = (
    await pool.query(
      "INSERT INTO items(user_id,title,kind,due_at) VALUES($1,'Current task','task',$2) RETURNING id",
      [f.owner, now],
    )
  ).rows[0].id;
  const { answer } = await start(f);
  const a = await assignment(f);
  await pool.query("UPDATE items SET version=version+1 WHERE id=$1", [id]);
  await assert.rejects(publish(f, a), (error: any) => error.statusCode === 409);
  await assert.rejects(answer);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_completed_usage WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    0,
  );
});
test("revoking the originating app session rejects Agenda output even while its executor session lives", async () => {
  const f = await fixture();
  const appSession = randomUUID();
  await pool.query(
    "INSERT INTO sessions(id,user_id,token_hash) VALUES($1,$2,$3)",
    [appSession, f.owner, randomUUID()],
  );
  const { answer } = await start(f, appSession);
  const a = await assignment(f);
  await pool.query("DELETE FROM sessions WHERE id=$1", [appSession]);
  await assert.rejects(publish(f, a));
  await assert.rejects(answer);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_completed_usage WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    0,
  );
});
test("forged Agenda facts with an unchanged digest fail before a physical operation exists", async () => {
  const f = await fixture();
  const snapshot = await captureAgendaAiSnapshot(f.owner, now);
  snapshot.facts.top_priorities = ["Forged task"];
  await assert.rejects(
    completeAgendaFeature({ userId: f.owner, sessionId: f.session }, snapshot, [
      { role: "user", content: "Not dispatched" },
    ]),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_operations WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    0,
  );
});
test("Agenda capture and validation use the supplied connection without another pool checkout", async () => {
  const f = await fixture();
  await pool.query(
    "INSERT INTO study_cards(user_id,doc_id,card_key,question,answer) VALUES($1,$2,'fixture-card','Question','Answer')",
    [f.owner, f.doc.id],
  );
  const db = await pool.connect();
  const query = pool.query;
  pool.query = (() => {
    throw new Error("Unexpected pool query inside Agenda transaction");
  }) as typeof pool.query;
  try {
    const snapshot = await captureAgendaAiSnapshot(f.owner, now, db);
    await assertAgendaAiSnapshot(f.owner, now, snapshot, db);
  } finally {
    pool.query = query;
    db.release();
  }
});

test("a changed captured ChatGPT model preference rejects signed Agenda output", async () => {
  const f = await fixture();
  const { answer } = await start(f);
  const a = await assignment(f);
  await pool.query(
    "UPDATE chatgpt_model_preferences SET version=version+1 WHERE connection_id=$1",
    [f.connection],
  );
  await assert.rejects(publish(f, a), (error: any) => error.statusCode === 409);
  await assert.rejects(answer);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_completed_usage WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    0,
  );
});
test("a provider change before job creation cannot retarget the requested Agenda", async () => {
  const f = await fixture();
  const snapshot = await captureAgendaAiSnapshot(f.owner, now);
  const choice = await readAiProviderChoice(pool, f.owner);
  await pool.query(
    "UPDATE user_ai_provider_choice SET version=version+1 WHERE user_id=$1",
    [f.owner],
  );
  await assert.rejects(
    completeAgendaFeature(
      { userId: f.owner, sessionId: f.session },
      snapshot,
      [{ role: "user", content: "Not dispatched" }],
      choice,
    ),
    (error: any) => error.statusCode === 409,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_operations WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    0,
  );
});

test("interactive Agenda reports an unavailable device without silently using the default", async () => {
  const f = await fixture();
  await pool.query("DELETE FROM chatgpt_executor_leases WHERE executor_id=$1", [
    f.executor,
  ]);
  const { readAgendaAiDay } = await import("../src/modules/docs/agenda.js");
  const day = await readAgendaAiDay(f.owner, now);
  const outcomes: any[] = [];
  assert.equal(
    await briefFor(
      day,
      now,
      f.owner,
      { userId: f.owner, sessionId: f.session },
      (outcome) => {
        outcomes.push(outcome);
      },
    ),
    null,
  );
  assert.deepEqual(outcomes, [
    {
      status: "failed",
      message:
        "Your ChatGPT device is unavailable. Reconnect it or review your provider choice.",
    },
  ]);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_operations WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    0,
  );
});

test("interactive Agenda exposes its accepted ChatGPT model to both clients", async () => {
  const f = await fixture();
  const { readAgendaAiDay } = await import("../src/modules/docs/agenda.js");
  const day = await readAgendaAiDay(f.owner, now);
  const outcomes: any[] = [];
  const answer = briefFor(
    day,
    now,
    f.owner,
    { userId: f.owner, sessionId: f.session },
    (outcome) => {
      outcomes.push(outcome);
    },
  );
  pending.push(answer);
  void answer.catch(() => {});
  await publish(f, await assignment(f));
  assert.equal(await answer, "Signed feature answer");
  assert.deepEqual(outcomes, [
    {
      status: "completed",
      provider: { source: "chatgpt", model: "fixture-model", fallback: false },
    },
  ]);
});

test("Agenda fallback requires consent and a confirmed pre-stream rejection, and preserves its actual provider", async () => {
  const original = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "Explicit fallback Agenda answer",
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const provider = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai-compatible','Agenda fallback fixture',$1) RETURNING id",
      [`http://127.0.0.1:${(server.address() as { port: number }).port}/v1`],
    )
  ).rows[0].id;
  try {
    await pool.query(
      "UPDATE ai_settings SET provider_id=$1,model='agenda-default' WHERE id",
      [provider],
    );
    for (const [consent, phase, accepted] of [
      [false, "admission", false],
      [true, "stream", false],
      [true, "unknown", false],
      [true, "admission", true],
    ] as const) {
      const f = await fixture();
      await pool.query(
        "UPDATE user_ai_provider_choice SET fallback_to_default=$2,version=version+1 WHERE user_id=$1",
        [f.owner, consent],
      );
      const before = requests.length;
      const { answer } = await start(f);
      const a = await assignment(f);
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
          status: "failed" as const,
          reason: "usage_limit" as const,
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
      await finishChatgptInference(
        { userId: f.owner, sessionId: f.session },
        { receipt, signature },
      );
      if (accepted) {
        assert.equal(await answer, "Explicit fallback Agenda answer");
        assert.equal(requests.length, before + 1);
        assert.equal(requests.at(-1).max_tokens, 512);
      } else {
        await assert.rejects(answer);
        assert.equal(requests.length, before);
      }
      const job = (
        await pool.query("SELECT state,result FROM ai_jobs WHERE id=$1", [
          a.job_id,
        ])
      ).rows[0];
      assert.equal(job.state, accepted ? "done" : "failed");
      if (accepted)
        assert.deepEqual(job.result.feature_provider, {
          source: "default",
          model: "agenda-default",
          fallback: true,
        });
      else assert.equal(job.result?.feature_provider, undefined);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM chatgpt_completed_usage WHERE user_id=$1",
            [f.owner],
          )
        ).rows[0].n,
        0,
      );
    }
  } finally {
    await pool.query(
      "UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id",
      [original.provider_id, original.model],
    );
    await pool.query("DELETE FROM ai_providers WHERE id=$1", [provider]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
