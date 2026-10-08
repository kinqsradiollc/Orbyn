import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, createHash, sign } from "node:crypto";
import { chatgptInferenceReceiptMessage } from "@orbyn/core";
import { createServer } from "node:http";
import { fork, type ChildProcess } from "node:child_process";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  queueChatgptInference,
  claimChatgptInference,
  finishChatgptInference,
  readChatgptInference,
  readChatgptOperation,
  beginChatgptFallback,
  finishChatgptFallback,
} = await import("../src/modules/auth/chatgpt-inference.js");
const owners: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function fixture(fallback = false, native = false) {
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
  const keys = native
      ? generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      : generateKeyPairSync("ed25519"),
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
  const selection = { connection_id: connection, executor_id: executor };
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,connection_id,executor_id,fallback_to_default) VALUES($1,'chatgpt',$2,$3,$4)",
    [owner, connection, executor, fallback],
  );
  const chat = (
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title) VALUES(gen_random_uuid(),$1,'Private fixture') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,turn_id,state,sources_checked,lease_until,run_state) VALUES($1,$2,gen_random_uuid(),'running',true,now()+interval '5 minutes',$3) RETURNING id",
      [owner, chat, { version: 1 }],
    )
  ).rows[0].id;
  const binding = { userId: owner, sessionId: session };
  return {
    owner,
    job,
    selection,
    binding,
    keys,
    receipt: (
      a: any,
      usage: {
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
      } | null = { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
    ) => {
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
          usage,
        },
      };
      return {
        receipt,
        signature: sign(
          native ? "sha256" : null,
          Buffer.from(chatgptInferenceReceiptMessage(receipt)),
          native
            ? { key: keys.privateKey, dsaEncoding: "ieee-p1363" }
            : keys.privateKey,
        ).toString("base64url"),
      };
    },
  };
}
const status = (code: number) => (error: any) => error.statusCode === code;

test("operation replay returns one assignment while distinct specialists can queue concurrently", async () => {
  const f = await fixture(),
    operation = randomUUID(),
    input = { instructions: "same", input: [] };
  const copies = await Promise.all(
    [1, 2].map(() =>
      queueChatgptInference(
        f.owner,
        f.job,
        f.selection,
        input,
        "fixture-model",
        1,
        operation,
      ),
    ),
  );
  assert.equal(copies[0].id, copies[1].id);
  const second = await queueChatgptInference(
    f.owner,
    f.job,
    f.selection,
    input,
    "fixture-model",
    1,
    randomUUID(),
  );
  assert.notEqual(second.id, copies[0].id);
  const firstClaim = await claimChatgptInference(
    f.binding,
    f.selection.executor_id,
  );
  const secondClaim = await claimChatgptInference(
    f.binding,
    f.selection.executor_id,
  );
  assert.ok(firstClaim && secondClaim);
  assert.notEqual(firstClaim.id, secondClaim.id);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM chatgpt_inference_requests WHERE job_id=$1",
        [f.job],
      )
    ).rows[0].n,
    2,
  );
});

test("parallel durable loops reach separate signed assignments and recover independently", async () => {
  const f = await fixture();
  const { resolveUserAi } =
    await import("../src/modules/ai/providers/user-choice.js");
  const { runAgent } = await import("../src/modules/ai/agent/loop.js");
  const ai = await resolveUserAi(f.owner, f.job, async () => {});
  assert.ok(ai);
  const controller = new AbortController();
  const saved: any[] = [];
  const results = Promise.all(
    [0, 1].map((index) =>
      runAgent(
        ai,
        {
          user: { id: f.owner, role: "member" },
          timezone: "UTC",
          intentText: "Read",
          actions: [],
          clarification: null,
        },
        `Independent task ${index}`,
        [],
        {},
        undefined,
        undefined,
        {
          signal: controller.signal,
          checkpoint: async (state) => {
            saved[index] = structuredClone(state);
          },
        },
      ),
    ),
  );
  void results.catch(() => {});
  try {
    const ids: string[] = [];
    for (let tries = 0; tries < 100 && ids.length < 2; tries++) {
      const assigned = await claimChatgptInference(
        f.binding,
        f.selection.executor_id,
      );
      if (!assigned) {
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }
      ids.push(assigned.id);
      await finishChatgptInference(f.binding, f.receipt(assigned));
    }
    assert.equal(new Set(ids).size, 2);
    assert.deepEqual(
      (await results).map((r) => r.summary),
      ["Private result", "Private result"],
    );
    assert.ok(saved.every((s) => s.finished_result));
    await Promise.all(
      saved.map((resume, index) =>
        runAgent(
          ai,
          {
            user: { id: f.owner, role: "member" },
            timezone: "UTC",
            intentText: "Read",
            actions: [],
            clarification: null,
          },
          `Independent task ${index}`,
          [],
          {},
          undefined,
          undefined,
          { resume },
        ),
      ),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM chatgpt_inference_requests WHERE job_id=$1",
          [f.job],
        )
      ).rows[0].n,
      2,
    );
  } finally {
    controller.abort();
    await results.catch(() => {});
  }
});

test("SIGKILL after accepted private output recovers the same assignment without a second charge", async () => {
  const f = await fixture();
  const children: ChildProcess[] = [];
  const start = (mode: string) => {
    const child = fork(
      new URL("./fixtures/chatgpt-loop-process.ts", import.meta.url),
      [f.owner, f.job, mode],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: process.env,
      },
    );
    children.push(child);
    return child;
  };
  const message = (child: ChildProcess, stage: string) =>
    new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out awaiting ${stage}`));
      }, 15000);
      const onMessage = (value: any) => {
        if (value.stage === "error") {
          cleanup();
          reject(new Error(value.message));
        } else if (value.stage === stage) {
          cleanup();
          resolve(value);
        }
      };
      const onExit = (code: number | null, signal: string | null) => {
        cleanup();
        reject(new Error(`Child exited before ${stage}: ${code}/${signal}`));
      };
      const cleanup = () => {
        clearTimeout(timeout);
        child.off("message", onMessage);
        child.off("exit", onExit);
      };
      child.on("message", onMessage);
      child.on("exit", onExit);
    });
  try {
    const first = start("hold_raw"),
      held = message(first, "raw_received");
    void held.catch(() => {});
    let assigned = null;
    for (let n = 0; n < 150 && !assigned; n++) {
      assigned = await claimChatgptInference(
        f.binding,
        f.selection.executor_id,
      );
      if (!assigned) await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(assigned);
    await finishChatgptInference(f.binding, f.receipt(assigned));
    await held;
    const killed = new Promise<string | null>((resolve) =>
      first.once("exit", (_code, signal) => resolve(signal)),
    );
    first.kill("SIGKILL");
    assert.equal(await killed, "SIGKILL");
    const state = (
      await pool.query("SELECT run_state FROM ai_jobs WHERE id=$1", [f.job])
    ).rows[0].run_state;
    assert.ok(state.loop.pending_provider.wire_messages);
    assert.equal(state.loop.pending_provider.raw_reply, undefined);
    await pool.query(
      "UPDATE chatgpt_executor_leases SET expires_at=now()-interval '1 second' WHERE executor_id=$1",
      [f.selection.executor_id],
    );
    const recovered = start("recover");
    const result = await message(recovered, "finished");
    assert.equal(result.summary, "Private result");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM chatgpt_inference_requests WHERE job_id=$1",
          [f.job],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM chatgpt_completed_usage WHERE user_id=$1",
          [f.owner],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
  }
});

test("accepted operation recovery reuses output even after the device goes offline", async () => {
  const f = await fixture(),
    operation = randomUUID(),
    input = { instructions: "", input: [] };
  const request = await queueChatgptInference(
    f.owner,
    f.job,
    f.selection,
    input,
    "fixture-model",
    1,
    operation,
  );
  const assigned = await claimChatgptInference(
    f.binding,
    f.selection.executor_id,
  );
  assert.ok(assigned);
  await finishChatgptInference(f.binding, f.receipt(assigned));
  await pool.query(
    "UPDATE chatgpt_executor_leases SET expires_at=now()-interval '1 second' WHERE executor_id=$1",
    [f.selection.executor_id],
  );
  const replay = await queueChatgptInference(
    f.owner,
    f.job,
    f.selection,
    input,
    "fixture-model",
    1,
    operation,
  );
  assert.equal(replay.id, request.id);
  assert.equal(
    (await readChatgptOperation(f.owner, f.job, operation))?.status,
    "completed",
  );
  await assert.rejects(
    queueChatgptInference(
      f.owner,
      f.job,
      f.selection,
      { instructions: "changed", input: [] },
      "fixture-model",
      1,
      operation,
    ),
    status(409),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM chatgpt_completed_usage WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    1,
  );
});

test("only undisclosed expired work can fallback; lost envelopes and uncertain fallbacks cannot restart", async () => {
  const f = await fixture(true),
    operation = randomUUID(),
    input = { instructions: "", input: [] };
  const request = await queueChatgptInference(
    f.owner,
    f.job,
    f.selection,
    input,
    "fixture-model",
    1,
    operation,
  );
  await pool.query(
    "UPDATE chatgpt_inference_requests SET expires_at=now()-interval '1 second' WHERE id=$1",
    [request.id],
  );
  const failed = await readChatgptOperation(f.owner, f.job, operation);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.status === "failed" && failed.phase, "admission");
  await beginChatgptFallback(f.owner, f.job, operation);
  await assert.rejects(
    beginChatgptFallback(f.owner, f.job, operation),
    status(409),
  );
  await assert.rejects(
    queueChatgptInference(
      f.owner,
      f.job,
      f.selection,
      input,
      "fixture-model",
      1,
      operation,
    ),
    status(409),
  );
  await finishChatgptFallback(
    f.owner,
    f.job,
    operation,
    "Recovered default reply",
    "recovery-fixture",
  );
  assert.equal(
    (await readChatgptOperation(f.owner, f.job, operation))?.status,
    "completed",
  );
  const recoveredTrace = (
    await pool.query(
      "SELECT c.trace FROM ai_chats c JOIN ai_jobs j ON j.chat_id=c.id WHERE j.id=$1",
      [f.job],
    )
  ).rows[0].trace;
  assert.equal(
    recoveredTrace.filter((e: any) => e.tool === `pf_c:${operation}`).length,
    1,
  );
  assert.ok(
    recoveredTrace.some(
      (e: any) => e.label === "Orbyn fallback · recovery-fixture · completed",
    ),
  );
  const uncertain = await fixture(true),
    slot = randomUUID();
  const claimed = await queueChatgptInference(
    uncertain.owner,
    uncertain.job,
    uncertain.selection,
    input,
    "fixture-model",
    1,
    slot,
  );
  await claimChatgptInference(
    uncertain.binding,
    uncertain.selection.executor_id,
  );
  await assert.rejects(
    beginChatgptFallback(uncertain.owner, uncertain.job, slot),
    status(409),
  );
  await pool.query("DELETE FROM chatgpt_inference_requests WHERE id=$1", [
    claimed.id,
  ]);
  await assert.rejects(
    queueChatgptInference(
      uncertain.owner,
      uncertain.job,
      uncertain.selection,
      input,
      "fixture-model",
      1,
      slot,
    ),
    status(409),
  );
});
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
  const trace = (
    await pool.query(
      "SELECT c.trace FROM ai_chats c JOIN ai_jobs j ON j.chat_id=c.id WHERE j.id=$1",
      [f.job],
    )
  ).rows[0].trace;
  assert.equal(trace.filter((e: any) => e.tool?.startsWith("pc_c:")).length, 1);
  assert.ok(
    trace.some((e: any) => e.label === "ChatGPT · fixture-model · completed"),
  );
  const { readCompletedChatgptUsage } =
    await import("../src/modules/auth/chatgpt-usage.js");
  const summary = await readCompletedChatgptUsage(f.binding);
  assert.equal(summary.completed_requests, 1);
  assert.equal(summary.total_tokens, "6");
  assert.equal(summary.recent[0].model, "fixture-model");
  assert.ok(!JSON.stringify(summary).includes("Private"));
  assert.deepEqual(
    await readChatgptInference(f.owner, f.job, request.id),
    publication.receipt.result,
  );
  await assert.rejects(
    finishChatgptInference(f.binding, publication),
    status(409),
  );
  assert.equal(
    (await readCompletedChatgptUsage(f.binding)).completed_requests,
    1,
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

test("unreported usage stays unknown, opted-out completions are not recorded, and request cleanup keeps measurements", async () => {
  const { readCompletedChatgptUsage } =
    await import("../src/modules/auth/chatgpt-usage.js");
  const f = await fixture();
  const request = await queueChatgptInference(f.owner, f.job, f.selection, {
    instructions: "",
    input: [],
  });
  const assignment = await claimChatgptInference(
    f.binding,
    f.selection.executor_id,
  );
  assert.ok(assignment);
  await finishChatgptInference(f.binding, f.receipt(assignment, null));
  await pool.query("DELETE FROM chatgpt_inference_requests WHERE id=$1", [
    request.id,
  ]);
  const summary = await readCompletedChatgptUsage(f.binding);
  assert.equal(summary.completed_requests, 1);
  assert.equal(summary.measured_requests, 0);
  assert.equal(summary.recent[0].usage, null);
  const other = await fixture();
  assert.equal(
    (await readCompletedChatgptUsage(other.binding)).completed_requests,
    0,
  );
  await pool.query("UPDATE users SET analytics_opt_out=true WHERE id=$1", [
    other.owner,
  ]);
  await queueChatgptInference(other.owner, other.job, other.selection, {
    instructions: "",
    input: [],
  });
  const next = await claimChatgptInference(
    other.binding,
    other.selection.executor_id,
  );
  assert.ok(next);
  await finishChatgptInference(other.binding, other.receipt(next));
  assert.equal(
    (await readCompletedChatgptUsage(other.binding)).recording_enabled,
    false,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM chatgpt_completed_usage WHERE user_id=$1",
        [other.owner],
      )
    ).rows[0].n,
    0,
  );
});

test("usage windows are bounded and aggregate bigint measurements without precision loss", async () => {
  const f = await fixture();
  const { readCompletedChatgptUsage } =
    await import("../src/modules/auth/chatgpt-usage.js");
  for (let n = 0; n < 12; n++)
    await pool.query(
      "INSERT INTO chatgpt_completed_usage(request_id,user_id,model,input_tokens,output_tokens,total_tokens) VALUES($1,$2,'fixture-model',9007199254740991,0,9007199254740991)",
      [randomUUID(), f.owner],
    );
  await pool.query(
    "INSERT INTO chatgpt_completed_usage(request_id,user_id,model,completed_at,input_tokens,output_tokens,total_tokens) VALUES($1,$2,'old-fixture',now()-interval '31 days',1,0,1)",
    [randomUUID(), f.owner],
  );
  const summary = await readCompletedChatgptUsage(f.binding);
  assert.equal(summary.completed_requests, 12);
  assert.equal(summary.recent.length, 10);
  assert.equal(summary.total_tokens, String(9007199254740991n * 12n));
  await assert.rejects(
    pool.query(
      "INSERT INTO chatgpt_completed_usage(request_id,user_id,model,input_tokens) VALUES($1,$2,'partial-fixture',1)",
      [randomUUID(), f.owner],
    ),
    (error: any) => error.code === "23514",
  );
  await assert.rejects(
    readCompletedChatgptUsage({ ...f.binding, sessionId: randomUUID() }),
    status(401),
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
    randomUUID(),
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
      const f = await fixture(fallback);
      const notices: string[] = [];
      const ai = await resolveUserAi(f.owner, f.job, async (m) => {
        notices.push(m);
      });
      assert.ok(ai?.textTransport);
      const abort = new AbortController();
      const output = ai.textTransport(
        [{ role: "user", content: "Question" }],
        abort.signal,
        randomUUID(),
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
          const trace = (
            await pool.query(
              "SELECT c.trace FROM ai_chats c JOIN ai_jobs j ON j.chat_id=c.id WHERE j.id=$1",
              [f.job],
            )
          ).rows[0].trace;
          assert.ok(
            trace.some(
              (e: any) =>
                e.tool?.startsWith("pf_c:") &&
                e.label === "Orbyn fallback · default-fixture · completed",
            ),
          );
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

test("ChatGPT-selected chat admission and capabilities work without a workspace provider", async () => {
  const { buildApp } = await import("../src/app.js");
  const { digest } = await import("../src/lib/auth.js");
  const f = await fixture(false);
  const token = randomUUID();
  await pool.query("UPDATE sessions SET token_hash=$2 WHERE id=$1", [
    f.binding.sessionId,
    digest(token),
  ]);
  const saved = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  await pool.query("UPDATE ai_settings SET provider_id=NULL,model='' WHERE id");
  const app = await buildApp();
  const headers = { authorization: `Bearer ${token}` };
  try {
    assert.equal(
      (await app.inject({ method: "GET", url: "/ai/capabilities" })).statusCode,
      401,
    );
    const capabilities = await app.inject({
      method: "GET",
      url: "/ai/capabilities",
      headers,
    });
    assert.equal(capabilities.statusCode, 200);
    assert.deepEqual(capabilities.json(), { enabled: true, tools: false });
    const payload = {
      message: "Reply with a short test answer.",
      timezone: "UTC",
      chat_id: randomUUID(),
      turn_id: randomUUID(),
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/ai/chat/start",
          headers,
          payload: { message: 12 },
        })
      ).statusCode,
      422,
    );
    const admitted = await app.inject({
      method: "POST",
      url: "/ai/chat/start",
      headers,
      payload,
    });
    assert.equal(admitted.statusCode, 202, admitted.body);
    const snapshot = (
      await pool.query(
        "SELECT provider_choice_snapshot FROM ai_jobs WHERE id=$1",
        [admitted.json().id],
      )
    ).rows[0].provider_choice_snapshot;
    assert.equal(snapshot.primary, "chatgpt");
    assert.equal(snapshot.fallback_to_default, false);
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/ai/chat/start",
        headers,
        payload,
      });
      if (response.statusCode === 429) {
        limited = true;
        break;
      }
      assert.equal(response.statusCode, 202, response.body);
      assert.equal(response.json().id, admitted.json().id);
    }
    assert.ok(limited, "personal routing retains the route rate limit");
    await pool.query("UPDATE users SET disabled=true WHERE id=$1", [f.owner]);
    assert.equal(
      (await app.inject({ method: "GET", url: "/ai/capabilities", headers }))
        .statusCode,
      403,
    );
  } finally {
    await app.close();
    await pool.query(
      "UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id",
      [saved.provider_id, saved.model],
    );
  }
});

test("bounded private calls require current output-limit capability before queue and claim", async () => {
  const f = await fixture();
  const operation = randomUUID();
  const input = {
    instructions: "bounded neutral fixture",
    input: [],
    max_output_tokens: 321,
  };
  await assert.rejects(
    queueChatgptInference(
      f.owner,
      f.job,
      f.selection,
      input,
      "fixture-model",
      1,
      operation,
    ),
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
  const capabilities = ["plan_inference_v1", "plan_inference_limits_v1"];
  await pool.query(
    "UPDATE chatgpt_executor_catalogs SET capabilities=$2 WHERE executor_id=$1",
    [f.selection.executor_id, JSON.stringify(capabilities)],
  );
  const queued = await queueChatgptInference(
    f.owner,
    f.job,
    f.selection,
    input,
    "fixture-model",
    1,
    operation,
  );
  await assert.rejects(
    queueChatgptInference(
      f.owner,
      f.job,
      f.selection,
      { ...input, max_output_tokens: 322 },
      "fixture-model",
      1,
      operation,
    ),
    status(409),
  );
  await pool.query(
    "UPDATE chatgpt_executor_catalogs SET capabilities='[\"plan_inference_v1\"]' WHERE executor_id=$1",
    [f.selection.executor_id],
  );
  await assert.rejects(
    claimChatgptInference(f.binding, f.selection.executor_id),
    status(503),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT state FROM chatgpt_inference_requests WHERE id=$1",
        [queued.id],
      )
    ).rows[0].state,
    "queued",
  );
  await pool.query(
    "UPDATE chatgpt_executor_catalogs SET capabilities=$2 WHERE executor_id=$1",
    [f.selection.executor_id, JSON.stringify(capabilities)],
  );
  const claimed = await claimChatgptInference(
    f.binding,
    f.selection.executor_id,
  );
  assert.ok(claimed);
  assert.equal(claimed.payload.max_output_tokens, 321);
  await finishChatgptInference(f.binding, f.receipt(claimed));
  assert.equal(
    (await readChatgptInference(f.owner, f.job, queued.id)).status,
    "completed",
  );
});

test("v2 digest receipts complete large results for desktop and native keys without weakening legacy verification", async () => {
  const { chatgptInferenceProofMessage } =
    await import("../src/modules/auth/chatgpt-executor-proof.js");
  for (const native of [false, true]) {
    const f = await fixture(false, native);
    await queueChatgptInference(
      f.owner,
      f.job,
      f.selection,
      { instructions: "fixture", input: [] },
      "fixture-model",
      1,
      randomUUID(),
    );
    const assignment = await claimChatgptInference(
      f.binding,
      f.selection.executor_id,
    );
    assert.ok(assignment);
    const publication = f.receipt(assignment);
    publication.receipt.result.text = "x".repeat(10000);
    const signature = sign(
      native ? "sha256" : null,
      Buffer.from(
        chatgptInferenceProofMessage(publication.receipt, "sha256_v2"),
      ),
      native
        ? { key: f.keys.privateKey, dsaEncoding: "ieee-p1363" }
        : f.keys.privateKey,
    ).toString("base64url");
    await assert.rejects(
      finishChatgptInference(f.binding, {
        receipt: publication.receipt,
        signature,
      }),
      status(400),
    );
    await finishChatgptInference(f.binding, {
      receipt: publication.receipt,
      signature,
      proof_format: "sha256_v2",
    });
    const result = await readChatgptInference(f.owner, f.job, assignment.id);
    assert.deepEqual(result, publication.receipt.result);
  }
});
