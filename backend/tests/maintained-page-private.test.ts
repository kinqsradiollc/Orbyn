import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, createHash, sign } from "node:crypto";
import { defaultNightShift, chatgptInferenceReceiptMessage } from "@orbyn/core";
import Fastify from "fastify";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { createMaintainedPageBinding } =
  await import("../src/modules/docs/maintenance.js");
const { queueMaintainedPageRun } =
  await import("../src/modules/docs/maintenance-runs.js");
const { processMaintainedPageRun } =
  await import("../src/worker/maintained-pages.js");
const { claimChatgptInference, finishChatgptInference } =
  await import("../src/modules/auth/chatgpt-inference.js");
const owners: string[] = [];
const pending: Promise<unknown>[] = [];
const controllers: AbortController[] = [];
const app = Fastify({ logger: false });
before(() => migrate());
after(async () => {
  for (const controller of controllers) controller.abort();
  await Promise.allSettled(pending);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await app.close();
  await pool.end();
});
async function deviceFixture() {
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
  return { owner, session, executor, keys, doc };
}

async function fixture(night = false) {
  const f = await deviceFixture();
  const user = (await pool.query("SELECT * FROM users WHERE id=$1", [f.owner]))
    .rows[0];
  const principal = {
    ...(await assistantPrincipal(user)),
    assistant_lane: "background" as const,
  };
  await pool.query("UPDATE docs SET content=$2 WHERE id=$1", [
    f.doc.id,
    JSON.stringify([
      {
        id: "human",
        type: "paragraph",
        text: "Human unselected secret must stay private.",
      },
      { id: "summary", type: "paragraph", text: "Authorized selected source." },
    ]),
  ]);
  const doc = (
    await pool.query("SELECT version FROM docs WHERE id=$1", [f.doc.id])
  ).rows[0];
  const now = new Date();
  let nightOptions:
    { kind: "overnight"; nightId: string; endAt: Date } | undefined;
  if (night) {
    const clock = (offset: number) =>
      new Date(now.getTime() + offset * 60000).toISOString().slice(11, 16);
    const settings = {
      ...defaultNightShift(),
      enabled: true,
      wait_for_ok: false,
      start: clock(-60),
      end: clock(60),
    };
    await pool.query(
      "INSERT INTO agent_settings(user_id,night_shift) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET night_shift=excluded.night_shift",
      [f.owner, JSON.stringify(settings)],
    );
    const { assistantNightWindow } =
      await import("../src/worker/night-window.js");
    const window = assistantNightWindow(now, settings);
    assert.ok(window);
    const id = (
      await pool.query(
        "INSERT INTO assistant_nights(user_id,local_day) VALUES($1,$2) RETURNING id",
        [f.owner, window.localDay],
      )
    ).rows[0].id;
    nightOptions = {
      kind: "overnight",
      nightId: id,
      endAt: new Date(now.getTime() + 3600000),
    };
  }
  const binding = await transaction((db) =>
    createMaintainedPageBinding(db, user, principal, f.doc.id, {
      block_ids: ["summary"],
      expected_doc_version: doc.version,
      instruction: "Update this selected source only.",
      rrule: "FREQ=DAILY",
      timezone: "UTC",
      next_run_at: now.toISOString(),
      paused: false,
      token_budget: 10000,
    }),
  );
  const run = await transaction((db) =>
    queueMaintainedPageRun(
      db,
      user,
      principal,
      binding.id,
      now,
      nightOptions ?? {
        kind: "background",
      },
    ),
  );
  assert.ok(run);
  return { ...f, binding, run };
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
  throw new Error("No private page assignment arrived.");
}
function start(f: Awaited<ReturnType<typeof fixture>>) {
  const controller = new AbortController();
  controllers.push(controller);
  const work = processMaintainedPageRun(app.log, f.run.lane, {
    runId: f.run.id,
    signal: controller.signal,
  });
  pending.push(work);
  return work;
}
function publication(
  f: Awaited<ReturnType<typeof fixture>>,
  a: Awaited<ReturnType<typeof assignment>>,
) {
  const input = JSON.parse(a.payload.input.at(-1)!.content);
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
      text: JSON.stringify({
        expected_revision: input.expected_revision,
        replacements: [
          {
            id: "summary",
            type: "paragraph",
            text: "Signed bounded page update.",
          },
        ],
      }),
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    },
  };
  return {
    receipt,
    signature: sign(
      null,
      Buffer.from(chatgptInferenceReceiptMessage(receipt)),
      f.keys.privateKey,
    ).toString("base64url"),
  };
}
test("private page consumer sends selected blocks with an output limit and applies signed output once", async () => {
  const f = await fixture();
  const work = start(f);
  const a = await assignment(f);
  assert.ok(a.payload.max_output_tokens && a.payload.max_output_tokens <= 4096);
  assert.ok(JSON.stringify(a.payload).includes("Authorized selected source."));
  assert.ok(!JSON.stringify(a.payload).includes("Human unselected secret"));
  const { deferUndispatchedPrivatePage } =
    await import("../src/modules/docs/maintenance-inference.js");
  const reserved = (
    await pool.query(
      "SELECT lease_token,reserved_tokens FROM assistant_page_runs WHERE id=$1",
      [f.run.id],
    )
  ).rows[0];
  assert.ok(reserved.reserved_tokens > 0);
  assert.equal(
    await deferUndispatchedPrivatePage(f.owner, {
      runId: f.run.id,
      leaseToken: reserved.lease_token,
    }),
    false,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT reserved_tokens FROM assistant_page_runs WHERE id=$1",
        [f.run.id],
      )
    ).rows[0].reserved_tokens,
    reserved.reserved_tokens,
  );
  await finishChatgptInference(
    { userId: f.owner, sessionId: f.session },
    publication(f, a),
  );
  assert.equal((await work).state, "done");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM managed_ai_usage WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    0,
  );
  const content = (
    await pool.query("SELECT content FROM docs WHERE id=$1", [f.doc.id])
  ).rows[0].content;
  assert.equal(
    content.find((b: any) => b.id === "human").text,
    "Human unselected secret must stay private.",
  );
  assert.equal(
    content.find((b: any) => b.id === "summary").text,
    "Signed bounded page update.",
  );
  const jobs = await pool.query(
    "SELECT state,runtime_lane FROM ai_jobs WHERE maintenance_run_id=$1",
    [f.run.id],
  );
  assert.equal(jobs.rowCount, 1);
  assert.equal(jobs.rows[0].state, "done");
  assert.equal(jobs.rows[0].runtime_lane, "background");
  assert.equal(
    (await processMaintainedPageRun(app.log, "background", { runId: f.run.id }))
      .state,
    "idle",
  );
});
test("older private device defers a page before reserving or disclosing input", async () => {
  const f = await fixture();
  await pool.query(
    "UPDATE chatgpt_executor_catalogs SET capabilities='[\"plan_inference_v1\"]' WHERE executor_id=$1",
    [f.executor],
  );
  assert.equal((await start(f)).state, "deferred");
  const run = (
    await pool.query(
      "SELECT reserved_tokens,token_estimate,attempts FROM assistant_page_runs WHERE id=$1",
      [f.run.id],
    )
  ).rows[0];
  assert.equal(run.reserved_tokens, 0);
  assert.equal(run.token_estimate, 0);
  assert.equal(run.attempts, 0);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM ai_jobs WHERE maintenance_run_id=$1",
        [f.run.id],
      )
    ).rows[0].n,
    0,
  );
});

test("device loss after reservation defers only undispatched work and preserves its operation identity", async () => {
  const f = await fixture();
  const { complete } = await import("../src/modules/ai/providers/adapters.js");
  const result = await processMaintainedPageRun(app.log, "background", {
    runId: f.run.id,
    request: async (ai, messages, options) => {
      await pool.query(
        "UPDATE chatgpt_executor_leases SET expires_at=now()-interval '1 second' WHERE executor_id=$1",
        [f.executor],
      );
      return complete(ai, messages, options);
    },
  });
  assert.equal(result.state, "deferred");
  const held = (
    await pool.query(
      "SELECT state,reserved_tokens,token_estimate,model_key,attempts FROM assistant_page_runs WHERE id=$1",
      [f.run.id],
    )
  ).rows[0];
  assert.equal(held.state, "queued");
  assert.equal(held.reserved_tokens, 0);
  assert.equal(held.token_estimate, 0);
  assert.equal(held.model_key, null);
  assert.equal(held.attempts, 0);
  const child = (
    await pool.query(
      "SELECT id,run_state FROM ai_jobs WHERE maintenance_run_id=$1",
      [f.run.id],
    )
  ).rows[0];
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_operations WHERE job_id=$1",
        [child.id],
      )
    ).rows[0].n,
    0,
  );
  await pool.query(
    "UPDATE chatgpt_executor_leases SET expires_at=now()+interval '5 minutes' WHERE executor_id=$1",
    [f.executor],
  );
  await pool.query(
    "UPDATE assistant_page_runs SET retry_after=now() WHERE id=$1",
    [f.run.id],
  );
  const work = start(f);
  const a = await assignment(f);
  const resumed = (
    await pool.query(
      "SELECT id,run_state FROM ai_jobs WHERE maintenance_run_id=$1",
      [f.run.id],
    )
  ).rows[0];
  assert.equal(resumed.id, child.id);
  assert.equal(resumed.run_state.operation_id, child.run_state.operation_id);
  await finishChatgptInference(
    { userId: f.owner, sessionId: f.session },
    publication(f, a),
  );
  assert.equal((await work).state, "done");
});

test("cancelled page parent rejects signed private output and never changes the document", async () => {
  const f = await fixture();
  const work = start(f);
  const a = await assignment(f);
  await pool.query(
    "UPDATE assistant_page_runs SET state='cancelled',lease_token=NULL,lease_expires_at=NULL WHERE id=$1",
    [f.run.id],
  );
  await assert.rejects(
    finishChatgptInference(
      { userId: f.owner, sessionId: f.session },
      publication(f, a),
    ),
    (error: any) => error.statusCode === 409,
  );
  assert.equal((await work).state, "failed");
  const content = (
    await pool.query("SELECT content FROM docs WHERE id=$1", [f.doc.id])
  ).rows[0].content;
  assert.equal(
    content.find((b: any) => b.id === "summary").text,
    "Authorized selected source.",
  );
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

for (const kind of ["source", "provider", "model"] as const) {
  test(`private page acceptance rejects changed ${kind} authority without recorded usage`, async () => {
    const f = await fixture();
    const work = start(f);
    const a = await assignment(f);
    if (kind === "source")
      await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [
        f.doc.id,
      ]);
    else if (kind === "provider")
      await pool.query(
        "UPDATE user_ai_provider_choice SET version=version+1 WHERE user_id=$1",
        [f.owner],
      );
    else
      await pool.query(
        "UPDATE chatgpt_model_preferences SET version=version+1 WHERE connection_id=(SELECT connection_id FROM chatgpt_executor_enrollments WHERE id=$1)",
        [f.executor],
      );
    await assert.rejects(
      finishChatgptInference(
        { userId: f.owner, sessionId: f.session },
        publication(f, a),
      ),
      (error: any) => error.statusCode === 409,
    );
    assert.equal((await work).state, "failed");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM chatgpt_completed_usage WHERE user_id=$1",
          [f.owner],
        )
      ).rows[0].n,
      0,
    );
    const content = (
      await pool.query("SELECT content FROM docs WHERE id=$1", [f.doc.id])
    ).rows[0].content;
    assert.equal(
      content.find((b: any) => b.id === "summary").text,
      "Authorized selected source.",
    );
  });
}

test("native page resume uses PostgreSQL precision while injected clocks stay deterministic", async (t) => {
  const f = await fixture(true);
  const { claimMaintainedPageRun, releaseMaintainedPageRun } =
    await import("../src/modules/docs/maintenance-runs.js");
  const clock = new Date();
  await pool.query(
    "UPDATE assistant_page_runs SET retry_after=$2::timestamptz+interval '0.0005 seconds' WHERE id=$1",
    [f.run.id, clock],
  );
  t.mock.timers.enable({ apis: ["Date"], now: clock.getTime() });
  try {
    assert.equal(
      await transaction((db) =>
        claimMaintainedPageRun(db, "overnight", clock, f.run.id),
      ),
      null,
    );
    const claimed = await transaction((db) =>
      claimMaintainedPageRun(db, "overnight", undefined, f.run.id),
    );
    assert.ok(claimed?.lease_token);
    assert.equal(claimed.id, f.run.id);
    await transaction((db) =>
      releaseMaintainedPageRun(db, claimed.id, claimed.lease_token!, clock),
    );
  } finally {
    t.mock.timers.reset();
  }
});

test("private Overnight page charges only the parent budget and resumes its own undispatched companion", async () => {
  const f = await fixture(true);
  const { complete } = await import("../src/modules/ai/providers/adapters.js");
  const result = await processMaintainedPageRun(app.log, "overnight", {
    runId: f.run.id,
    request: async (ai, messages, options) => {
      await pool.query(
        "UPDATE chatgpt_executor_leases SET expires_at=now()-interval '1 second' WHERE executor_id=$1",
        [f.executor],
      );
      return complete(ai, messages, options);
    },
  });
  assert.equal(result.state, "deferred");
  assert.equal(
    (
      await pool.query("SELECT budget_used FROM assistant_nights WHERE id=$1", [
        f.run.night_id,
      ])
    ).rows[0].budget_used,
    0,
  );
  await pool.query(
    "UPDATE chatgpt_executor_leases SET expires_at=now()+interval '5 minutes' WHERE executor_id=$1",
    [f.executor],
  );
  await pool.query(
    "UPDATE assistant_page_runs SET retry_after=now() WHERE id=$1",
    [f.run.id],
  );
  const work = start(f);
  const a = await assignment(f);
  const run = (
    await pool.query(
      "SELECT reserved_tokens FROM assistant_page_runs WHERE id=$1",
      [f.run.id],
    )
  ).rows[0];
  assert.ok(run.reserved_tokens > 0);
  assert.equal(
    (
      await pool.query("SELECT budget_used FROM assistant_nights WHERE id=$1", [
        f.run.night_id,
      ])
    ).rows[0].budget_used,
    run.reserved_tokens,
  );
  await finishChatgptInference(
    { userId: f.owner, sessionId: f.session },
    publication(f, a),
  );
  assert.equal((await work).state, "done");
  const parent = (
    await pool.query(
      "SELECT token_estimate FROM assistant_page_runs WHERE id=$1",
      [f.run.id],
    )
  ).rows[0];
  assert.equal(
    (
      await pool.query("SELECT budget_used FROM assistant_nights WHERE id=$1", [
        f.run.night_id,
      ])
    ).rows[0].budget_used,
    parent.token_estimate,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT runtime_lane FROM ai_jobs WHERE maintenance_run_id=$1",
        [f.run.id],
      )
    ).rows[0].runtime_lane,
    "overnight",
  );
});

test("private page approval remains bound to its waiting card and applies offline without another model call", async () => {
  const f = await fixture();
  const { decideMaintainedPageRun } =
    await import("../src/modules/docs/maintenance-runs.js");
  await pool.query(
    "UPDATE agent_grants SET trust='ask' WHERE user_id=$1 AND kind='assistant'",
    [f.owner],
  );
  const work = start(f);
  const a = await assignment(f);
  await finishChatgptInference(
    { userId: f.owner, sessionId: f.session },
    publication(f, a),
  );
  assert.equal((await work).state, "waiting");
  const run = (
    await pool.query("SELECT waiting_id FROM assistant_page_runs WHERE id=$1", [
      f.run.id,
    ])
  ).rows[0];
  assert.ok(run.waiting_id);
  await pool.query(
    "UPDATE chatgpt_executor_leases SET expires_at=now()-interval '1 second' WHERE executor_id=$1",
    [f.executor],
  );
  await assert.rejects(
    transaction((db) =>
      decideMaintainedPageRun(db, f.owner, f.run.id, randomUUID(), true),
    ),
    (error: any) => error.statusCode === 409,
  );
  await assert.rejects(
    transaction((db) =>
      decideMaintainedPageRun(db, randomUUID(), f.run.id, run.waiting_id, true),
    ),
    (error: any) => error.statusCode === 404,
  );
  const result = await transaction((db) =>
    decideMaintainedPageRun(db, f.owner, f.run.id, run.waiting_id, true),
  );
  assert.equal(result.state, "done");
  await assert.rejects(
    transaction((db) =>
      decideMaintainedPageRun(db, f.owner, f.run.id, run.waiting_id, true),
    ),
    (error: any) => error.statusCode === 409,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_requests WHERE job_id=(SELECT id FROM ai_jobs WHERE maintenance_run_id=$1)",
        [f.run.id],
      )
    ).rows[0].n,
    1,
  );
});
