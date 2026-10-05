import "./setup.js";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, createHash, sign } from "node:crypto";
import {
  chatgptInferenceReceiptMessage,
  chatgptInferenceResult,
} from "@orbyn/core";
import type { z } from "zod";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");
const { writeTodaysAgenda } = await import("../src/modules/docs/agenda.js");
const { scanMorningAgendas } = await import("../src/worker/agenda.js");
const { assistantRuntimeHasRoom } =
  await import("../src/modules/ai/agent/runtime-slots.js");
const { enqueueScheduledAgenda, claimScheduledAgenda, applyScheduledAgenda } =
  await import("../src/modules/docs/agenda-summary-runs.js");
const { saveAgendaPrivatePermission } =
  await import("../src/modules/auth/agenda-private-permission.js");
const { claimScheduledAgendaWork } =
  await import("../src/worker/agenda-summaries.js");
const { claimChatgptInference, finishChatgptInference } =
  await import("../src/modules/auth/chatgpt-inference.js");
const app = await buildApp();
const owners: string[] = [],
  pending: Promise<unknown>[] = [];
before(() => migrate());
afterEach(async () => {
  // Each test owns its users and intentionally leaves some leases running to
  // assert recovery. Remove those fixtures before the next test measures the
  // real global capacity; retaining them would consume unrelated test slots.
  await Promise.allSettled(pending.splice(0));
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  owners.length = 0;
});
after(async () => {
  await Promise.allSettled(pending);
  await app.close();
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
    "INSERT INTO users(id,email,password_hash,name,email_verified) VALUES($1,$2,'fixture','Scheduled Agenda',true)",
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
    'INSERT INTO chatgpt_executor_catalogs(executor_id,enrollment_epoch,lease_epoch,sequence,models,capabilities) VALUES($1,1,1,1,$2,\'["plan_inference_v1","plan_inference_limits_v1"]\')',
    [
      executor,
      JSON.stringify([{ slug: "fixture-model", display_name: "Fixture" }]),
    ],
  );
  await pool.query(
    "INSERT INTO chatgpt_model_preferences(connection_id,model,version) VALUES($1,'fixture-model',1)",
    [connection],
  );
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,connection_id,executor_id,version) VALUES($1,'chatgpt',$2,$3,1)",
    [owner, connection, executor],
  );
  let offset = 6 - new Date().getUTCHours();
  if (offset < -12) offset += 24;
  const timezone =
    offset === 0
      ? "UTC"
      : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
  await pool.query(
    "INSERT INTO planner_prefs(user_id,timezone) VALUES($1,$2)",
    [owner, timezone],
  );
  const now = new Date();
  const page = await writeTodaysAgenda(owner, { now });
  return {
    owner,
    session,
    connection,
    executor,
    keys,
    timezone,
    now,
    page,
    binding: { userId: owner, sessionId: session },
  };
}
async function grant(f: Awaited<ReturnType<typeof fixture>>) {
  return saveAgendaPrivatePermission(f.binding, {
    enabled: true,
    expected_version: 0,
    expected_provider_choice_version: 1,
    expected_preference_version: 1,
  });
}
async function queue(f: Awaited<ReturnType<typeof fixture>>) {
  const id = await enqueueScheduledAgenda(
    f.owner,
    f.page.doc.id,
    f.now,
    f.timezone,
  );
  assert.ok(id);
  return id;
}
async function start(id: string) {
  const work = await claimScheduledAgendaWork(app.log, id);
  assert.ok(work);
  const run = work.run();
  pending.push(run);
  void run.catch(() => {});
  return { work, run };
}
async function assignment(f: Awaited<ReturnType<typeof fixture>>) {
  for (let n = 0; n < 100; n++) {
    const a = await claimChatgptInference(f.binding, f.executor);
    if (a) return a;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("No scheduled assignment arrived");
}
async function publish(
  f: Awaited<ReturnType<typeof fixture>>,
  a: Awaited<ReturnType<typeof assignment>>,
  result: z.output<typeof chatgptInferenceResult> = {
    status: "completed",
    text: "Your scheduled summary is ready.",
    usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
  },
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
    result,
  };
  const signature = sign(
    null,
    Buffer.from(chatgptInferenceReceiptMessage(receipt)),
    f.keys.privateKey,
  ).toString("base64url");
  return finishChatgptInference(f.binding, { receipt, signature });
}
test("scheduled summaries share Background capacity without consuming interactive slots", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f);
  const occupied = (
    await pool.query<{ id: string }>(
      `INSERT INTO ai_jobs(user_id,state,run_state,lease_until,runtime_lane)
       SELECT $1,'running','{"version":1,"request":{"automation":{"kind":"idea"}}}'::jsonb,now()+interval '60 seconds','background'
       FROM generate_series(1,2) RETURNING id`,
      [f.owner],
    )
  ).rows.map((row) => row.id);
  try {
    assert.equal(await claimScheduledAgenda(id), null);
    await transaction(async (db) => {
      assert.equal(await assistantRuntimeHasRoom(db, "background"), false);
      assert.equal(await assistantRuntimeHasRoom(db, "interactive"), true);
    });
    assert.equal(
      (
        await pool.query("SELECT state FROM agenda_summary_runs WHERE id=$1", [
          id,
        ])
      ).rows[0].state,
      "queued",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM ai_jobs WHERE agenda_summary_run_id=$1",
          [id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await pool.query("DELETE FROM ai_jobs WHERE id=ANY($1::uuid[])", [
      occupied,
    ]);
  }
  const claimed = await claimScheduledAgenda(id);
  assert.ok(claimed);
  await pool.query(
    "UPDATE agenda_summary_runs SET state='failed',reason='test_cleanup' WHERE id=$1",
    [id],
  );
});

test("morning producer recovers an untouched generated page once without executing inference", async () => {
  const f = await fixture();
  await grant(f);
  assert.equal(await scanMorningAgendas(f.now, { only: [f.owner] }), 0);
  assert.equal(await scanMorningAgendas(f.now, { only: [f.owner] }), 0);
  const rows = (
    await pool.query(
      "SELECT state,doc_id FROM agenda_summary_runs WHERE user_id=$1",
      [f.owner],
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "queued");
  assert.equal(rows[0].doc_id, f.page.doc.id);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM ai_jobs WHERE agenda_summary_run_id IN (SELECT id FROM agenda_summary_runs WHERE user_id=$1)",
        [f.owner],
      )
    ).rows[0].n,
    0,
  );
});

test("morning producer does not enroll a human-edited page for scheduled replacement", async () => {
  const f = await fixture();
  await grant(f);
  await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [
    f.page.doc.id,
  ]);
  assert.equal(await scanMorningAgendas(f.now, { only: [f.owner] }), 0);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM agenda_summary_runs WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    0,
  );
});

test("morning generation never grants private execution; reviewed scheduling queues only once", async () => {
  const f = await fixture();
  assert.equal(
    await enqueueScheduledAgenda(f.owner, f.page.doc.id, f.now, f.timezone),
    null,
  );
  await grant(f);
  const id = await queue(f);
  assert.equal(await queue(f), id);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM agenda_summary_runs WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    1,
  );
});
test("an offline device defers without a physical call and resumes the same bounded operation", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f);
  const initial = (
    await pool.query(
      "SELECT operation_id FROM agenda_summary_runs WHERE id=$1",
      [id],
    )
  ).rows[0].operation_id;
  await pool.query("DELETE FROM chatgpt_executor_leases WHERE executor_id=$1", [
    f.executor,
  ]);
  await (
    await start(id)
  ).run;
  assert.equal(
    (
      await pool.query("SELECT state FROM agenda_summary_runs WHERE id=$1", [
        id,
      ])
    ).rows[0].state,
    "waiting",
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
  const job = (
    await pool.query(
      "SELECT id,runtime_lane,state FROM ai_jobs WHERE agenda_summary_run_id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(job.runtime_lane, "background");
  assert.equal(job.state, "queued");
  await pool.query(
    "INSERT INTO chatgpt_executor_leases(executor_id,enrollment_epoch,session_id,epoch,expires_at) VALUES($1,1,$2,1,now()+interval '5 minutes')",
    [f.executor, f.session],
  );
  await pool.query(
    "UPDATE agenda_summary_runs SET next_attempt_at=now() WHERE id=$1",
    [id],
  );
  const { run } = await start(id);
  const a = await assignment(f);
  assert.equal(a.job_id, job.id);
  assert.equal(a.payload.max_output_tokens, 512);
  assert.ok(!JSON.stringify(a.payload).includes(f.page.doc.id));
  // An unrelated human Note is preserved; only the authorized paragraph changes.
  const current = (
    await pool.query("SELECT content FROM docs WHERE id=$1", [f.page.doc.id])
  ).rows[0].content;
  current.push({
    id: "human-note",
    type: "paragraph",
    text: "Human note stays.",
  });
  await pool.query(
    "UPDATE docs SET content=$2::jsonb,version=version+1 WHERE id=$1",
    [f.page.doc.id, JSON.stringify(current)],
  );
  await publish(f, a);
  await run;
  const done = (
    await pool.query(
      "SELECT state,operation_id,provider FROM agenda_summary_runs WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(done.state, "done");
  assert.equal(done.operation_id, initial);
  assert.deepEqual(done.provider, {
    source: "chatgpt",
    model: "fixture-model",
    fallback: false,
  });
  const content = (
    await pool.query("SELECT content FROM docs WHERE id=$1", [f.page.doc.id])
  ).rows[0].content;
  assert.equal(content[0].text, "Your scheduled summary is ready.");
  assert.deepEqual(content.slice(1), current.slice(1));
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
test("permission revoked while waiting prevents a model envelope", async () => {
  const f = await fixture();
  const permission = await grant(f);
  const id = await queue(f);
  await saveAgendaPrivatePermission(f.binding, {
    enabled: false,
    expected_version: permission.version,
    expected_provider_choice_version: 1,
  });
  assert.equal(await claimScheduledAgenda(id), null);
  assert.equal(
    (
      await pool.query("SELECT state FROM agenda_summary_runs WHERE id=$1", [
        id,
      ])
    ).rows[0].state,
    "failed",
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
test("a changed owned summary paragraph rejects a late signed reply without replacing it", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f);
  const { run } = await start(id);
  const a = await assignment(f);
  const content = (
    await pool.query("SELECT content FROM docs WHERE id=$1", [f.page.doc.id])
  ).rows[0].content;
  content[0].text = "My human opening.";
  await pool.query(
    "UPDATE docs SET content=$2::jsonb,version=version+1 WHERE id=$1",
    [f.page.doc.id, JSON.stringify(content)],
  );
  await assert.rejects(publish(f, a), (e: any) => e.statusCode === 409);
  await run;
  assert.equal(
    (await pool.query("SELECT content FROM docs WHERE id=$1", [f.page.doc.id]))
      .rows[0].content[0].text,
    "My human opening.",
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

test("an expired worker lease after device claim never issues a second model operation", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f);
  const { work, run } = await start(id);
  const a = await assignment(f);
  await pool.query(
    "UPDATE agenda_summary_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  assert.equal(await claimScheduledAgenda(id), null);
  const parent = (
    await pool.query(
      "SELECT state,reason FROM agenda_summary_runs WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(parent.state, "failed");
  assert.equal(parent.reason, "completion_unknown");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_operations WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(publish(f, a), (e: any) => e.statusCode === 409);
  work.stop();
  await run;
  assert.equal(await claimScheduledAgenda(id), null);
});

test("a task inserted during final summary application waits until the summary commits", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f);
  const claimed = await claimScheduledAgenda(id);
  assert.ok(claimed?.run.lease_token);
  await pool.query("UPDATE ai_jobs SET result=$2::jsonb WHERE id=$1", [
    claimed.jobId,
    JSON.stringify({
      feature_provider: {
        source: "chatgpt",
        model: "fixture-model",
        fallback: false,
      },
    }),
  ]);
  const writer = await pool.connect();
  await writer.query("BEGIN");
  const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid"))
    .rows[0].pid;
  const wrapped = new Map<
    import("pg").PoolClient,
    import("pg").PoolClient["query"]
  >();
  let mutation: Promise<unknown> | undefined,
    observed = false;
  const intercept = (client: import("pg").PoolClient) => {
    if (wrapped.has(client) || client === writer) return;
    const original = client.query,
      query = original.bind(client);
    wrapped.set(client, original);
    client.query = ((...args: any[]) => {
      if (
        !observed &&
        typeof args[0] === "string" &&
        args[0].startsWith("UPDATE docs SET content=") &&
        args[1]?.[0] === f.page.doc.id
      ) {
        observed = true;
        return (async () => {
          const guardPid = (await query("SELECT pg_backend_pid() AS pid"))
            .rows[0].pid;
          mutation = writer.query(
            "INSERT INTO items(user_id,title,kind,due_at) VALUES($1,'Inserted during apply','task',$2)",
            [f.owner, f.now],
          );
          void mutation.catch(() => undefined);
          const deadline = Date.now() + 2000;
          let blocked = false;
          do {
            const row = (
              await pool.query(
                "SELECT wait_event,$2::int=ANY(pg_blocking_pids(pid)) AS blocked FROM pg_stat_activity WHERE pid=$1",
                [writerPid, guardPid],
              )
            ).rows[0];
            if (row?.blocked && row.wait_event === "advisory") {
              blocked = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          } while (Date.now() < deadline);
          assert.equal(
            blocked,
            true,
            "New source cannot commit during final application",
          );
          return (query as any)(...args);
        })();
      }
      return (query as any)(...args);
    }) as typeof client.query;
  };
  pool.on("acquire", intercept);
  try {
    await applyScheduledAgenda(
      f.owner,
      id,
      claimed.run.lease_token,
      "Summary before the new task",
    );
    assert.equal(observed, true);
    await mutation;
    await writer.query("COMMIT");
  } finally {
    pool.off("acquire", intercept);
    for (const [client, original] of wrapped) client.query = original;
    await mutation?.catch(() => undefined);
    await writer.query("ROLLBACK").catch(() => undefined);
    writer.release();
  }
  const row = (
    await pool.query("SELECT content FROM docs WHERE id=$1", [f.page.doc.id])
  ).rows[0];
  assert.equal(row.content[0].text, "Summary before the new task");
  assert.equal(
    (
      await pool.query("SELECT state FROM agenda_summary_runs WHERE id=$1", [
        id,
      ])
    ).rows[0].state,
    "done",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM items WHERE user_id=$1 AND title='Inserted during apply'",
        [f.owner],
      )
    ).rows[0].n,
    1,
  );
});

test("a conflicting human page edit finishes while final application rejects without deadlocking", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f),
    claimed = await claimScheduledAgenda(id);
  assert.ok(claimed?.run.lease_token);
  const before = (
    await pool.query("SELECT content,version FROM docs WHERE id=$1", [
      f.page.doc.id,
    ])
  ).rows[0];
  const writer = await pool.connect();
  await writer.query("BEGIN");
  const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid"))
    .rows[0].pid;
  const wrapped = new Map<
    import("pg").PoolClient,
    import("pg").PoolClient["query"]
  >();
  let mutation: Promise<unknown> | undefined,
    observed = false;
  const intercept = (client: import("pg").PoolClient) => {
    if (wrapped.has(client) || client === writer) return;
    const original = client.query,
      query = original.bind(client);
    wrapped.set(client, original);
    client.query = ((...args: any[]) => {
      if (
        !observed &&
        typeof args[0] === "string" &&
        args[0].includes(" FOR SHARE OF d") &&
        args[1]?.[1] === f.page.doc.id
      ) {
        observed = true;
        return (async () => {
          const guardPid = (await query("SELECT pg_backend_pid() AS pid"))
            .rows[0].pid;
          mutation = writer.query(
            "UPDATE docs SET title='Human changed this page',version=version+1 WHERE id=$1",
            [f.page.doc.id],
          );
          void mutation.catch(() => undefined);
          const deadline = Date.now() + 2000;
          let blocked = false;
          do {
            const row = (
              await pool.query(
                "SELECT wait_event,$2::int=ANY(pg_blocking_pids(pid)) AS blocked FROM pg_stat_activity WHERE pid=$1",
                [writerPid, guardPid],
              )
            ).rows[0];
            if (row?.blocked && row.wait_event === "advisory") {
              blocked = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          } while (Date.now() < deadline);
          assert.equal(
            blocked,
            true,
            "Human holds the row while waiting on the source fence",
          );
          return (query as any)(...args);
        })();
      }
      return (query as any)(...args);
    }) as typeof client.query;
  };
  pool.on("acquire", intercept);
  try {
    await assert.rejects(
      applyScheduledAgenda(
        f.owner,
        id,
        claimed.run.lease_token,
        "Stale result",
      ),
      (error: any) => error.statusCode === 409,
    );
    assert.equal(observed, true);
    await mutation;
    await writer.query("COMMIT");
  } finally {
    pool.off("acquire", intercept);
    for (const [client, original] of wrapped) client.query = original;
    await mutation?.catch(() => undefined);
    await writer.query("ROLLBACK").catch(() => undefined);
    writer.release();
  }
  const page = (
    await pool.query("SELECT content,version,title FROM docs WHERE id=$1", [
      f.page.doc.id,
    ])
  ).rows[0];
  assert.deepEqual(page.content, before.content);
  assert.equal(page.version, before.version + 1);
  assert.equal(page.title, "Human changed this page");
  assert.equal(
    (
      await pool.query("SELECT state FROM agenda_summary_runs WHERE id=$1", [
        id,
      ])
    ).rows[0].state,
    "running",
  );
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [claimed.jobId]))
      .rows[0].state,
    "running",
  );
});

test("a lease expiring at final application rolls back page and transport completion", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f);
  const claimed = await claimScheduledAgenda(id);
  assert.ok(claimed?.run.lease_token);
  await pool.query("UPDATE ai_jobs SET result=$2::jsonb WHERE id=$1", [
    claimed.jobId,
    JSON.stringify({
      feature_provider: {
        source: "chatgpt",
        model: "fixture-model",
        fallback: false,
      },
    }),
  ]);
  const before = (
    await pool.query("SELECT content,version FROM docs WHERE id=$1", [
      f.page.doc.id,
    ])
  ).rows[0];
  const wrapped = new Map<
    import("pg").PoolClient,
    import("pg").PoolClient["query"]
  >();
  let expiredAtWrite = false;
  const intercept = (client: import("pg").PoolClient) => {
    if (wrapped.has(client)) return;
    const original = client.query;
    const query = original.bind(client);
    wrapped.set(client, original);
    client.query = ((...args: any[]) => {
      if (
        !expiredAtWrite &&
        typeof args[0] === "string" &&
        args[0].startsWith("UPDATE docs SET content=") &&
        args[1]?.[0] === f.page.doc.id
      ) {
        expiredAtWrite = true;
        return query(
          "UPDATE agenda_summary_runs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [id],
        ).then(() => (query as any)(...args));
      }
      return (query as any)(...args);
    }) as typeof client.query;
  };
  pool.on("acquire", intercept);
  try {
    await assert.rejects(
      applyScheduledAgenda(f.owner, id, claimed.run.lease_token, "Late result"),
      (error: any) => error.statusCode === 409,
    );
    assert.equal(expiredAtWrite, true);
  } finally {
    pool.off("acquire", intercept);
    for (const [client, original] of wrapped) client.query = original;
  }
  assert.deepEqual(
    (
      await pool.query("SELECT content,version FROM docs WHERE id=$1", [
        f.page.doc.id,
      ])
    ).rows[0],
    before,
  );
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [claimed.jobId]))
      .rows[0].state,
    "running",
  );
  assert.equal(
    (
      await pool.query("SELECT state FROM agenda_summary_runs WHERE id=$1", [
        id,
      ])
    ).rows[0].state,
    "running",
  );
});

test("the morning deadline terminates a queued summary without dispatch", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f);
  await pool.query(
    "UPDATE agenda_summary_runs SET expires_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  assert.equal(await claimScheduledAgenda(id), null);
  assert.deepEqual(
    (
      await pool.query(
        "SELECT state,reason FROM agenda_summary_runs WHERE id=$1",
        [id],
      )
    ).rows[0],
    {
      state: "failed",
      reason: "expired",
    },
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM ai_jobs WHERE agenda_summary_run_id=$1",
        [id],
      )
    ).rows[0].n,
    0,
  );
});

test("a replacement model preference invalidates an already queued scheduled grant", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f);
  await pool.query(
    "UPDATE chatgpt_model_preferences SET version=version+1 WHERE connection_id=$1",
    [f.connection],
  );
  assert.equal(await claimScheduledAgenda(id), null);
  assert.deepEqual(
    (
      await pool.query(
        "SELECT state,reason FROM agenda_summary_runs WHERE id=$1",
        [id],
      )
    ).rows[0],
    {
      state: "failed",
      reason: "authority_changed",
    },
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

test("a source task revised after assignment rejects the signed result and preserves the page", async () => {
  const f = await fixture();
  const task = (
    await pool.query(
      "INSERT INTO items(user_id,title,kind,due_at) VALUES($1,'Original task','task',$2) RETURNING id",
      [f.owner, f.now],
    )
  ).rows[0].id;
  await grant(f);
  const id = await queue(f);
  const before = (
    await pool.query("SELECT content FROM docs WHERE id=$1", [f.page.doc.id])
  ).rows[0].content;
  const { run } = await start(id);
  const a = await assignment(f);
  await pool.query(
    "UPDATE items SET title='Revised human task',version=version+1 WHERE id=$1",
    [task],
  );
  await assert.rejects(publish(f, a), (e: any) => e.statusCode === 409);
  await run;
  assert.deepEqual(
    (await pool.query("SELECT content FROM docs WHERE id=$1", [f.page.doc.id]))
      .rows[0].content,
    before,
  );
  assert.equal(
    (
      await pool.query("SELECT state FROM agenda_summary_runs WHERE id=$1", [
        id,
      ])
    ).rows[0].state,
    "failed",
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

async function stagedCall(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  const claimed = await claimScheduledAgenda(id);
  assert.ok(claimed);
  const { recordScheduledAgendaSources } =
    await import("../src/modules/docs/agenda-summary-runs.js");
  const { resolveUserAi } =
    await import("../src/modules/ai/providers/user-choice.js");
  const { complete } = await import("../src/modules/ai/providers/adapters.js");
  const { agendaSummaryMessages } =
    await import("../src/modules/ai/agenda-brief.js");
  await recordScheduledAgendaSources(claimed.run, claimed.jobId);
  const ai = await resolveUserAi(f.owner, claimed.jobId, async () => {}, true);
  assert.ok(ai);
  const abort = new AbortController();
  const result = complete(
    { ...ai, operationId: claimed.run.operation_id },
    agendaSummaryMessages(claimed.snapshot.facts),
    {
      signal: abort.signal,
      timeoutMs: 30_000,
      maxOutputTokens: 512,
    },
  );
  pending.push(result);
  void result.catch(() => {});
  return { claimed, result, abort };
}

test("a cached signed completion survives parent worker loss and an offline device without another call", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f);
  const { claimed, result } = await stagedCall(f, id);
  const a = await assignment(f);
  await publish(f, a);
  assert.equal(await result, "Your scheduled summary is ready.");
  await pool.query(
    "UPDATE agenda_summary_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  await pool.query("DELETE FROM chatgpt_executor_leases WHERE executor_id=$1", [
    f.executor,
  ]);
  const recovered = await start(id);
  await recovered.run;
  const parent = (
    await pool.query(
      "SELECT state,operation_id FROM agenda_summary_runs WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(parent.state, "done");
  assert.equal(parent.operation_id, claimed.run.operation_id);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_operations WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_requests WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    1,
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

test("cached output is not applied after the target paragraph receives a human edit", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f);
  const { result } = await stagedCall(f, id);
  const a = await assignment(f);
  await publish(f, a);
  await result;
  const content = (
    await pool.query("SELECT content FROM docs WHERE id=$1", [f.page.doc.id])
  ).rows[0].content;
  content[0].text = "The human edited this after completion.";
  await pool.query(
    "UPDATE docs SET content=$2::jsonb,version=version+1 WHERE id=$1",
    [f.page.doc.id, JSON.stringify(content)],
  );
  await pool.query(
    "UPDATE agenda_summary_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  assert.equal(await claimScheduledAgenda(id), null);
  assert.equal(
    (
      await pool.query("SELECT state FROM agenda_summary_runs WHERE id=$1", [
        id,
      ])
    ).rows[0].state,
    "failed",
  );
  assert.deepEqual(
    (await pool.query("SELECT content FROM docs WHERE id=$1", [f.page.doc.id]))
      .rows[0].content,
    content,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_requests WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    1,
  );
});

test("an undisclosed queued envelope resumes after worker loss with the same request and operation", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f);
  const claimed = await claimScheduledAgenda(id);
  assert.ok(claimed);
  const { recordScheduledAgendaSources } =
    await import("../src/modules/docs/agenda-summary-runs.js");
  const { queueChatgptInference } =
    await import("../src/modules/auth/chatgpt-inference.js");
  const { agendaSummaryMessages } =
    await import("../src/modules/ai/agenda-brief.js");
  await recordScheduledAgendaSources(claimed.run, claimed.jobId);
  const messages = agendaSummaryMessages(claimed.snapshot.facts);
  const queued = await queueChatgptInference(
    f.owner,
    claimed.jobId,
    { connection_id: f.connection, executor_id: f.executor },
    {
      instructions: messages[0].content,
      input: [{ role: "user", content: messages[1].content }],
      max_output_tokens: 512,
    },
    "fixture-model",
    1,
    claimed.run.operation_id,
  );
  await pool.query(
    "UPDATE agenda_summary_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  const recovered = await start(id);
  const a = await assignment(f);
  assert.equal(a.id, queued.id);
  assert.equal(a.job_id, claimed.jobId);
  await publish(f, a);
  await recovered.run;
  assert.equal(
    (
      await pool.query("SELECT state FROM agenda_summary_runs WHERE id=$1", [
        id,
      ])
    ).rows[0].state,
    "done",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_operations WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM chatgpt_inference_requests WHERE user_id=$1",
        [f.owner],
      )
    ).rows[0].n,
    1,
  );
});

test("a signed ChatGPT usage-limit rejection has truthful recovery status and no implicit fallback", async () => {
  const f = await fixture();
  await grant(f);
  const id = await queue(f);
  const { run } = await start(id);
  const a = await assignment(f);
  await publish(f, a, {
    status: "failed",
    reason: "usage_limit",
    phase: "admission",
    http_status: 429,
    provider_code: "subscription_sharing_usage_limit_exceeded",
  });
  await run;
  assert.deepEqual(
    (
      await pool.query(
        "SELECT state,reason FROM agenda_summary_runs WHERE id=$1",
        [id],
      )
    ).rows[0],
    { state: "failed", reason: "usage_limit" },
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
  const operation = (
    await pool.query(
      "SELECT state,fallback_result_encrypted FROM chatgpt_inference_operations WHERE user_id=$1",
      [f.owner],
    )
  ).rows;
  assert.equal(operation.length, 1);
  assert.equal(operation[0].state, "assigned");
  assert.equal(operation[0].fallback_result_encrypted, null);
  assert.equal(await claimScheduledAgenda(id), null);
});
