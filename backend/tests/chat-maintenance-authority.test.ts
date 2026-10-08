import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, createHash, sign } from "node:crypto";
import {
  chatgptInferenceReceiptMessage,
  type ChatgptInferenceAssignment,
} from "@orbyn/core";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { encryptSecret } = await import("../src/lib/secrets.js");
const { enqueueMemory, readMemory } =
  await import("../src/modules/memory/service.js");
const { drainMemoryQueue } = await import("../src/worker/memory.js");
const { sweepOldChats } = await import("../src/worker/chat-sweep.js");
const {
  completeChatMaintenance,
  releaseChatMaintenance,
  finishChatMaintenance,
} = await import("../src/modules/ai/providers/chat-maintenance.js");
const { claimChatgptInference, finishChatgptInference } =
  await import("../src/modules/auth/chatgpt-inference.js");
const owners: string[] = [];
const pending: Promise<unknown>[] = [];
let provider: string;
let original: any;
const fake = {
  kind: "openai-compatible",
  format: "openai",
  baseUrl: "https://fixture.invalid/v1",
  model: "fixture-model",
  apiKey: "inert",
  options: {},
  source: "database",
} as const;
before(async () => {
  await migrate();
  original = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  provider = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url,api_key_encrypted) VALUES('openai-compatible','Maintenance fixture','https://fixture.invalid/v1',$1) RETURNING id",
      [await encryptSecret("inert")],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='fixture-model' WHERE id",
    [provider],
  );
});
after(async () => {
  await Promise.allSettled(pending);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.query("UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id", [
    original.provider_id,
    original.model,
  ]);
  await pool.query("DELETE FROM ai_providers WHERE id=$1", [provider]);
  await pool.end();
});
async function person() {
  const id = randomUUID();
  owners.push(id);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Fixture',true)",
    [id, id + "@fixture.invalid"],
  );
  return id;
}
async function chat(owner: string, old = false) {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO ai_chats(id,user_id,title,origin,turns,last_used_at) VALUES($1,$2,\'Maintenance fixture\',\'person\',\'[{"role":"user","text":"Use my selected provider"}]\',now()-make_interval(days=>$3))',
    [id, owner, old ? 8 : 0],
  );
  return id;
}
async function queued(owner: string, id: string) {
  await enqueueMemory(pool, {
    userId: owner,
    chatId: id,
    turns: [{ role: "user", content: "Use my selected provider." }],
    sourceProjectId: null,
  });
  return (
    await pool.query(
      "SELECT id,maintenance_job_id FROM memory_queue WHERE user_id=$1 AND chat_id=$2 ORDER BY queued_at DESC LIMIT 1",
      [owner, id],
    )
  ).rows[0];
}
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
  operation: "memory" | "sweep",
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
      text: JSON.stringify(
        operation === "memory"
          ? {
              topics: [
                {
                  topic: "Private preference",
                  facts: ["Uses the selected private model"],
                },
              ],
            }
          : {
              asked: ["Use my selected private model"],
              decided: [],
              changed: [],
            },
      ),
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

for (const operation of ["memory", "sweep"] as const)
  test(`${operation} does not replace a ChatGPT-only choice with injected workspace AI`, async () => {
    const owner = await person(),
      id = await chat(owner, operation === "sweep");
    await pool.query(
      "INSERT INTO user_ai_provider_choice(user_id,primary_provider,fallback_to_default) VALUES($1,'chatgpt',false)",
      [owner],
    );
    let calls = 0;
    if (operation === "memory") {
      await queued(owner, id);
      await drainMemoryQueue({
        ai: fake,
        completeTurn: async () => {
          calls++;
          return JSON.stringify({ topics: [] });
        },
      });
    } else
      await sweepOldChats({
        ai: fake,
        compact: async () => {
          calls++;
          return JSON.stringify({ asked: [], decided: [], changed: [] });
        },
        budgetMs: 1000,
      });
    assert.equal(calls, 0);
  });

test("queued Memory cannot adopt a later owner provider choice", async () => {
  const owner = await person(),
    id = await chat(owner);
  const q = await queued(owner, id);
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider) VALUES($1,'chatgpt')",
    [owner],
  );
  let calls = 0;
  await drainMemoryQueue({
    ai: fake,
    completeTurn: async () => {
      calls++;
      return JSON.stringify({ topics: [] });
    },
  });
  assert.equal(calls, 0);
  assert.equal(
    (
      await pool.query(
        "SELECT provider_choice_snapshot->>'primary' AS primary FROM ai_jobs WHERE id=$1",
        [q.maintenance_job_id],
      )
    ).rows[0].primary,
    "default",
  );
});

test("changed managed selection rejects queued Memory before dispatch", async () => {
  const owner = await person(),
    id = await chat(owner);
  await queued(owner, id);
  await pool.query("UPDATE ai_settings SET model='changed-model' WHERE id");
  let calls = 0;
  await drainMemoryQueue({
    ai: fake,
    completeTurn: async () => {
      calls++;
      return JSON.stringify({ topics: [] });
    },
  });
  assert.equal(calls, 0);
  await pool.query("UPDATE ai_settings SET model='fixture-model' WHERE id");
});

test("an unknown maintenance failure is not replayed", async () => {
  const owner = await person(),
    id = await chat(owner),
    q = await queued(owner, id);
  let calls = 0;
  const options = {
    ai: fake,
    send: async () => {
      calls++;
      throw new Error("inert interrupted response");
    },
  };
  await assert.rejects(
    completeChatMaintenance(owner, q.maintenance_job_id, [], options),
  );
  await assert.rejects(
    completeChatMaintenance(owner, q.maintenance_job_id, [], options),
  );
  assert.equal(calls, 1);
});

test("a completed output is encrypted and reused for a write retry", async () => {
  const owner = await person(),
    id = await chat(owner),
    q = await queued(owner, id);
  let calls = 0;
  let claim = "";
  const options = {
    onClaim: (value: string) => {
      claim = value;
    },
    ai: fake,
    send: async () => {
      calls++;
      return "Reusable private output";
    },
  };
  assert.equal(
    await completeChatMaintenance(owner, q.maintenance_job_id, [], options),
    "Reusable private output",
  );
  await releaseChatMaintenance(owner, q.maintenance_job_id, claim);
  assert.equal(
    await completeChatMaintenance(owner, q.maintenance_job_id, [], options),
    "Reusable private output",
  );
  assert.equal(calls, 1);
  const row = (
    await pool.query("SELECT result FROM ai_jobs WHERE id=$1", [
      q.maintenance_job_id,
    ])
  ).rows[0];
  assert.ok(row.result.maintenance_output_encrypted);
  assert.ok(!JSON.stringify(row).includes("Reusable private output"));
  await transaction((db) =>
    finishChatMaintenance(db, owner, q.maintenance_job_id, claim),
  );
});

test("confirmed invalid JSON gets a fresh bounded operation, retaining the same captured choice", async () => {
  const owner = await person(),
    id = await chat(owner),
    q = await queued(owner, id);
  const operations: string[] = [];
  const completeTurn = async (ai: any) => {
    operations.push(ai.operationId);
    return operations.length === 1
      ? "not json"
      : JSON.stringify({ topics: [] });
  };
  await drainMemoryQueue({ ai: fake, completeTurn });
  await pool.query("UPDATE memory_queue SET claimed_at=NULL WHERE id=$1", [
    q.id,
  ]);
  await drainMemoryQueue({ ai: fake, completeTurn });
  assert.equal(operations.length, 2);
  assert.notEqual(operations[0], operations[1]);
});

test("source change during extraction cannot save generated Memory", async () => {
  const owner = await person(),
    id = await chat(owner),
    q = await queued(owner, id);
  await drainMemoryQueue({
    ai: fake,
    completeTurn: async () => {
      await pool.query(
        'UPDATE ai_chats SET turns=\'[{"role":"user","text":"Redacted source"}]\' WHERE id=$1',
        [id],
      );
      return JSON.stringify({
        topics: [{ topic: "Stale source", facts: ["Must not be saved"] }],
      });
    },
  });
  assert.equal(await readMemory(pool, owner, "Stale source"), null);
  assert.equal(
    (
      await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [
        q.maintenance_job_id,
      ])
    ).rows[0].state,
    "failed",
  );
});

test("forget removes pending maintenance authority without invalid job states", async () => {
  const owner = await person(),
    id = await chat(owner),
    q = await queued(owner, id);
  await pool.query("DELETE FROM memory_queue WHERE id=$1", [q.id]);
  assert.equal(
    (
      await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [
        q.maintenance_job_id,
      ])
    ).rows[0].state,
    "failed",
  );
});

for (const operation of ["memory", "sweep"] as const)
  test(`${operation} accepts a signed reply through the owner's selected ChatGPT model`, async () => {
    const f = await fixture(),
      id = await chat(f.owner, operation === "sweep");
    await pool.query("UPDATE ai_chats SET turns=$2 WHERE id=$1", [
      id,
      JSON.stringify([{ role: "user", text: "Use my selected private model" }]),
    ]);
    if (operation === "memory") await queued(f.owner, id);
    let managedCalls = 0;
    const run =
      operation === "memory"
        ? drainMemoryQueue({
            ai: fake,
            completeTurn: async () => {
              managedCalls++;
              throw Error("private transport bypassed");
            },
          })
        : sweepOldChats({
            ai: fake,
            compact: async () => {
              managedCalls++;
              throw Error("private transport bypassed");
            },
            budgetMs: 1000,
          });
    pending.push(run);
    const a = await assignment(f);
    assert.equal(a.model, "fixture-model");
    await publish(f, a, operation);
    await run;
    assert.equal(managedCalls, 0);
    if (operation === "memory")
      assert.equal(
        (await readMemory(pool, f.owner, "Private preference"))?.facts[0].text,
        "Uses the selected private model",
      );
    else
      assert.ok(
        (await pool.query("SELECT swept_at FROM ai_chats WHERE id=$1", [id]))
          .rows[0].swept_at,
      );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM managed_ai_usage WHERE user_id=$1",
          [f.owner],
        )
      ).rows[0].n,
      0,
    );
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

test("a stale worker cannot finish or release a replacement maintenance lease", async () => {
  const owner = await person(),
    id = await chat(owner),
    q = await queued(owner, id);
  let first = "",
    second = "",
    calls = 0;
  const send = async () => {
    calls++;
    return "Reusable output";
  };
  await completeChatMaintenance(owner, q.maintenance_job_id, [], {
    ai: fake,
    send,
    onClaim: (v) => {
      first = v;
    },
  });
  await pool.query(
    "UPDATE ai_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [q.maintenance_job_id],
  );
  await completeChatMaintenance(owner, q.maintenance_job_id, [], {
    ai: fake,
    send,
    onClaim: (v) => {
      second = v;
    },
  });
  assert.notEqual(first, second);
  await releaseChatMaintenance(owner, q.maintenance_job_id, first, true);
  await assert.rejects(
    transaction((db) =>
      finishChatMaintenance(db, owner, q.maintenance_job_id, first),
    ),
    (e: any) => e.statusCode === 409,
  );
  assert.equal(
    (
      await pool.query("SELECT claimed_by FROM ai_jobs WHERE id=$1", [
        q.maintenance_job_id,
      ])
    ).rows[0].claimed_by,
    second,
  );
  await transaction((db) =>
    finishChatMaintenance(db, owner, q.maintenance_job_id, second),
  );
  assert.equal(calls, 1);
});

test("concurrent maintenance claims expose only one model call without deadlocking", async () => {
  const owner = await person(),
    id = await chat(owner),
    q = await queued(owner, id);
  let begin!: () => void,
    unblock!: () => void,
    calls = 0,
    claim = "";
  const started = new Promise<void>((r) => {
      begin = r;
    }),
    blocked = new Promise<void>((r) => {
      unblock = r;
    });
  const run = completeChatMaintenance(owner, q.maintenance_job_id, [], {
    ai: fake,
    onClaim: (v) => {
      claim = v;
    },
    send: async () => {
      calls++;
      begin();
      await blocked;
      return "One output";
    },
  });
  pending.push(run);
  void run.catch(() => {});
  await started;
  try {
    await assert.rejects(
      completeChatMaintenance(owner, q.maintenance_job_id, [], {
        ai: fake,
        send: async () => {
          calls++;
          return "Duplicate";
        },
      }),
      (e: any) => e.statusCode === 409,
    );
  } finally {
    unblock();
  }
  await run;
  await transaction((db) =>
    finishChatMaintenance(db, owner, q.maintenance_job_id, claim),
  );
  assert.equal(calls, 1);
});

for (const operation of ["memory", "sweep"] as const)
  test(`${operation} waits for an offline personal executor without exhausting failure retries`, async () => {
    const f = await fixture(),
      id = await chat(f.owner, operation === "sweep");
    await pool.query("UPDATE ai_chats SET turns=$2 WHERE id=$1", [
      id,
      JSON.stringify([{ role: "user", text: "Keep my preference" }]),
    ]);
    const q = operation === "memory" ? await queued(f.owner, id) : null;
    await pool.query(
      "UPDATE chatgpt_executor_leases SET expires_at=now()-interval '1 second' WHERE executor_id=$1",
      [f.executor],
    );
    let calls = 0;
    if (operation === "memory")
      await drainMemoryQueue({
        ai: fake,
        completeTurn: async () => {
          calls++;
          return "not used";
        },
      });
    else
      await sweepOldChats({
        ai: fake,
        compact: async () => {
          calls++;
          return "not used";
        },
        budgetMs: 1000,
      });
    assert.equal(calls, 0);
    const state =
      operation === "memory"
        ? (
            await pool.query(
              "SELECT attempts,maintenance_job_id AS job FROM memory_queue WHERE id=$1",
              [q.id],
            )
          ).rows[0]
        : (
            await pool.query(
              "SELECT sweep_attempts AS attempts,sweep_job_id AS job FROM ai_chats WHERE id=$1",
              [id],
            )
          ).rows[0];
    assert.equal(state.attempts, 0);
    assert.equal(
      (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [state.job]))
        .rows[0].state,
      "queued",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM chatgpt_inference_requests WHERE user_id=$1",
          [f.owner],
        )
      ).rows[0].n,
      0,
    );
  });

test("a changed private model rejects publication and derived Memory", async () => {
  const f = await fixture(),
    id = await chat(f.owner),
    q = await queued(f.owner, id);
  const run = drainMemoryQueue({ ai: fake });
  pending.push(run);
  const a = await assignment(f);
  await pool.query(
    "UPDATE chatgpt_model_preferences SET version=version+1 WHERE connection_id=(SELECT connection_id FROM chatgpt_executor_enrollments WHERE id=$1)",
    [f.executor],
  );
  await assert.rejects(
    publish(f, a, "memory"),
    (e: any) => e.statusCode === 409,
  );
  await run;
  assert.equal(await readMemory(pool, f.owner, "Private preference"), null);
  assert.equal(
    (
      await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [
        q.maintenance_job_id,
      ])
    ).rows[0].state,
    "failed",
  );
});

test("maintenance recovery identity survives the actual finished-job retention rule", async () => {
  const { SWEEP_RULES } = await import("../src/lib/sweep.js");
  const rule = SWEEP_RULES.find((r) => r.key === "ai_jobs")!;
  const owner = await person(),
    id = await chat(owner),
    q = await queued(owner, id);
  await pool.query(
    "UPDATE ai_jobs SET state='failed',created_at=now()-interval '2 days' WHERE id=$1",
    [q.maintenance_job_id],
  );
  const { captureChatSweepJob } =
    await import("../src/modules/ai/providers/chat-maintenance.js");
  const old = await chat(owner, true),
    sweep = await transaction((db) => captureChatSweepJob(db, owner, old));
  await pool.query(
    "UPDATE ai_jobs SET state='failed',created_at=now()-interval '2 days' WHERE id=$1",
    [sweep],
  );
  assert.equal(
    (
      await pool.query(
        `SELECT 1 FROM ai_jobs WHERE id=ANY($1::uuid[]) AND (${rule.where})`,
        [[q.maintenance_job_id, sweep]],
      )
    ).rowCount,
    0,
  );
  await pool.query("DELETE FROM memory_queue WHERE id=$1", [q.id]);
  await pool.query("UPDATE ai_chats SET swept_at=now() WHERE id=$1", [old]);
  assert.equal(
    (
      await pool.query(
        `SELECT 1 FROM ai_jobs WHERE id=ANY($1::uuid[]) AND (${rule.where})`,
        [[q.maintenance_job_id, sweep]],
      )
    ).rowCount,
    2,
  );
});

test("maintenance dispatch uses the captured managed model and records measured usage", async (t) => {
  const owner = await person(),
    id = await chat(owner),
    q = await queued(owner, id);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    calls++;
    assert.equal(JSON.parse(init.body).model, "fixture-model");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                topics: [
                  {
                    topic: "Managed preference",
                    facts: ["Uses the chosen workspace model"],
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  });
  await drainMemoryQueue();
  assert.equal(calls, 1);
  assert.ok(await readMemory(pool, owner, "Managed preference"));
  assert.deepEqual(
    (
      await pool.query(
        "SELECT result->'feature_provider' AS provider FROM ai_jobs WHERE id=$1",
        [q.maintenance_job_id],
      )
    ).rows[0].provider,
    { source: "default", model: "fixture-model", fallback: false },
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM managed_ai_usage WHERE user_id=$1",
        [owner],
      )
    ).rows[0].n,
    1,
  );
});

test("an explicit offline fallback uses captured workspace authority and labels its actual source", async (t) => {
  const f = await fixture(),
    id = await chat(f.owner);
  await pool.query(
    "UPDATE user_ai_provider_choice SET fallback_to_default=true,version=version+1 WHERE user_id=$1",
    [f.owner],
  );
  const q = await queued(f.owner, id);
  await pool.query(
    "UPDATE chatgpt_executor_leases SET expires_at=now()-interval '1 second' WHERE executor_id=$1",
    [f.executor],
  );
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    calls++;
    assert.equal(JSON.parse(init.body).model, "fixture-model");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                topics: [
                  {
                    topic: "Explicit fallback",
                    facts: ["Used the authorized fallback"],
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  });
  await drainMemoryQueue();
  assert.equal(calls, 1);
  assert.ok(await readMemory(pool, f.owner, "Explicit fallback"));
  assert.deepEqual(
    (
      await pool.query(
        "SELECT result->'feature_provider' AS provider FROM ai_jobs WHERE id=$1",
        [q.maintenance_job_id],
      )
    ).rows[0].provider,
    { source: "default", model: "fixture-model", fallback: true },
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM managed_ai_usage WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    1,
  );
});

test("appending a later turn preserves the earlier queued Memory authority", async () => {
  const owner = await person(),
    id = await chat(owner),
    q = await queued(owner, id);
  await pool.query(
    "UPDATE ai_chats SET turns=turns||$2::jsonb,last_used_at=now() WHERE id=$1",
    [id, JSON.stringify([{ role: "user", text: "A later request" }])],
  );
  let calls = 0;
  await drainMemoryQueue({
    ai: fake,
    completeTurn: async () => {
      calls++;
      return JSON.stringify({
        topics: [
          {
            topic: "Earlier preference",
            facts: ["The earlier explicit preference remains useful"],
          },
        ],
      });
    },
  });
  assert.equal(calls, 1);
  assert.ok(await readMemory(pool, owner, "Earlier preference"));
  assert.equal(
    (
      await pool.query("SELECT runtime_lane,state FROM ai_jobs WHERE id=$1", [
        q.maintenance_job_id,
      ])
    ).rows[0].runtime_lane,
    "background",
  );
});

for (const action of ["reopen", "pin"] as const)
  test(`human ${action} during compaction does not consume a failure attempt or leave a running maintenance job`, async () => {
    const owner = await person(),
      id = await chat(owner, true);
    await sweepOldChats({
      ai: fake,
      budgetMs: 1000,
      compact: async (_ai, messages) => {
        if (messages[1].content.includes("Maintenance fixture"))
          await pool.query(
            action === "reopen"
              ? "UPDATE ai_chats SET last_used_at=now() WHERE id=$1"
              : "UPDATE ai_chats SET pinned=true WHERE id=$1",
            [id],
          );
        return JSON.stringify({
          asked: ["An earlier question"],
          decided: [],
          changed: [],
        });
      },
    });
    const row = (
      await pool.query(
        "SELECT sweep_attempts,swept_at,sweep_claimed_at,sweep_job_id FROM ai_chats WHERE id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(row.sweep_attempts, 0);
    assert.equal(row.swept_at, null);
    assert.equal(row.sweep_claimed_at, null);
    assert.equal(
      (
        await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [
          row.sweep_job_id,
        ])
      ).rows[0].state,
      "failed",
    );
  });
