import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { claimAssistantJob } = await import("../src/modules/ai/agent/runner.js");
const { initialAssistantRun } = await import("../src/modules/ai/agent/run.js");
let userId: string;
before(async () => {
  await migrate();
  userId = (
    await pool.query(
      "INSERT INTO users(email, password_hash, name) VALUES($1, 'test', 'Runner test') RETURNING id",
      [`runner-${randomUUID()}@example.test`],
    )
  ).rows[0].id;
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
});
async function enqueue() {
  const chatId = (
    await pool.query(
      "INSERT INTO ai_chats(id, user_id, title) VALUES(gen_random_uuid(), $1, 'Runner test') RETURNING id",
      [userId],
    )
  ).rows[0].id;
  const request = {
    chat_id: chatId,
    turn_id: randomUUID(),
    message: "Plan tomorrow",
    timezone: "UTC",
    history: [],
    scope: null,
  };
  return (
    await pool.query(
      "INSERT INTO ai_jobs(user_id, chat_id, turn_id, state, run_state) VALUES($1, $2, $3, 'queued', $4::jsonb) RETURNING id",
      [
        userId,
        chatId,
        request.turn_id,
        JSON.stringify(initialAssistantRun(request)),
      ],
    )
  ).rows[0].id as string;
}
test("two runner copies claim a queued job exactly once with a sixty-second lease", async () => {
  const id = await enqueue();
  const claims = await Promise.all([
    claimAssistantJob("runner-a"),
    claimAssistantJob("runner-b"),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.find(Boolean)?.id, id);
  const job = (
    await pool.query(
      "SELECT state, claimed_by, lease_until > now() + interval '55 seconds' AS leased FROM ai_jobs WHERE id = $1",
      [id],
    )
  ).rows[0];
  assert.equal(job.state, "running");
  assert.ok(["runner-a", "runner-b"].includes(job.claimed_by));
  assert.equal(job.leased, true);
  assert.equal(await claimAssistantJob("runner-c"), null);
});
test("parked questions and finished jobs are never claimed as new work", async () => {
  const id = await enqueue();
  for (const state of ["waiting", "done", "failed"]) {
    await pool.query("UPDATE ai_jobs SET state = $2 WHERE id = $1", [
      id,
      state,
    ]);
    assert.equal(await claimAssistantJob("runner-a"), null);
  }
});

test("Stop discards a queued run before a worker can claim it", async () => {
  const id = await enqueue();
  const { stopAssistantJob } = await import("../src/modules/ai/agent/run.js");
  const user = (await pool.query("SELECT * FROM users WHERE id = $1", [userId]))
    .rows[0];
  const logger = {
    error: () => {},
  } as unknown as import("fastify").FastifyBaseLogger;
  assert.equal(await stopAssistantJob(id, user, logger), true);
  const job = (
    await pool.query("SELECT state, result FROM ai_jobs WHERE id = $1", [id])
  ).rows[0];
  assert.equal(job.state, "done");
  assert.equal(job.result.assistant_run.outcome, "discarded");
  assert.equal(await claimAssistantJob("runner-a"), null);
});

test("an expired lease requeues its checkpoint three times, then fails plainly", async () => {
  const id = await enqueue();
  await pool.query(
    "UPDATE ai_jobs SET run_state=jsonb_set(run_state,'{state,token_estimate}','321') WHERE id=$1",
    [id],
  );
  const night = (
    await pool.query(
      "INSERT INTO assistant_nights(user_id,local_day) VALUES($1,'2050-01-01') RETURNING id",
      [userId],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO assistant_night_runs(night_id,job_id,kind) VALUES($1,$2,'tidy')",
    [night, id],
  );
  const { failStaleAssistantJobs } =
    await import("../src/modules/ai/agent/run.js");
  const before = (
    await pool.query("SELECT run_state FROM ai_jobs WHERE id = $1", [id])
  ).rows[0].run_state;
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal((await claimAssistantJob(`runner-${attempt}`))?.id, id);
    await pool.query(
      "UPDATE ai_jobs SET lease_until = now() - interval '1 second' WHERE id = $1",
      [id],
    );
    assert.ok(!(await failStaleAssistantJobs()).includes(id));
    const job = (
      await pool.query(
        "SELECT state, run_state, resume_count FROM ai_jobs WHERE id = $1",
        [id],
      )
    ).rows[0];
    assert.equal(job.state, "queued");
    assert.equal(job.resume_count, attempt);
    assert.deepEqual(job.run_state, before);
  }
  assert.equal((await claimAssistantJob("runner-last"))?.id, id);
  await pool.query(
    "UPDATE ai_jobs SET lease_until = now() - interval '1 second' WHERE id = $1",
    [id],
  );
  assert.ok((await failStaleAssistantJobs()).includes(id));
  const job = (
    await pool.query(
      "SELECT state, error_message, resume_count FROM ai_jobs WHERE id = $1",
      [id],
    )
  ).rows[0];
  assert.equal(job.state, "failed");
  assert.equal(job.resume_count, 3);
  const savedNight = (
    await pool.query(
      "SELECT n.budget_used,r.summary FROM assistant_nights n JOIN assistant_night_runs r ON r.night_id=n.id WHERE n.id=$1",
      [night],
    )
  ).rows[0];
  assert.equal(savedNight.budget_used, 321);
  assert.equal(savedNight.summary, job.error_message);
  assert.equal(
    job.error_message,
    "This request was interrupted too many times. Please ask again.",
  );
  const chat = (
    await pool.query(
      "SELECT trace FROM ai_chats c JOIN ai_jobs j ON j.chat_id = c.id WHERE j.id = $1",
      [id],
    )
  ).rows[0];
  assert.ok(
    chat.trace.some(
      (entry: { label: string }) =>
        entry.label === "Picking up where I left off",
    ),
  );
});

test("a worker that lost its lease cannot checkpoint or apply under the old claim", async () => {
  const id = await enqueue();
  await claimAssistantJob("old-runner");
  const { assertAssistantLease, withAssistantLease, AssistantLeaseLost } =
    await import("../src/modules/ai/agent/lease.js");
  await withAssistantLease(id, "old-runner", () => assertAssistantLease(id));
  await pool.query(
    "UPDATE ai_jobs SET claimed_by = 'new-runner' WHERE id = $1",
    [id],
  );
  await assert.rejects(
    withAssistantLease(id, "old-runner", () => assertAssistantLease(id)),
    AssistantLeaseLost,
  );
  await withAssistantLease(id, "new-runner", () => assertAssistantLease(id));
});

test("shutdown checkpoints a blocked provider call and a second runner resumes it", async () => {
  const { createServer } = await import("node:http");
  const { startAssistantRunner } =
    await import("../src/modules/ai/agent/runner.js");
  await pool.query(
    "UPDATE ai_jobs SET state = 'failed' WHERE user_id = $1 AND state IN ('queued', 'running')",
    [userId],
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let called!: () => void;
  const entered = new Promise<void>((resolve) => {
    called = resolve;
  });
  let calls = 0;
  const provider = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Consume the provider request. */
    }
    calls++;
    if (calls === 1) {
      called();
      await gate;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: `finish-${calls}`,
                  type: "function",
                  function: {
                    name: "finish",
                    arguments: JSON.stringify({
                      answer: "The resumed run is ready.",
                      steps: [],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  const settings = (
    await pool.query("SELECT provider_id, model FROM ai_settings WHERE id")
  ).rows[0];
  const providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES('openai-compatible', 'Runner shutdown test', $1) RETURNING id",
      [`http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id = $1, model = 'runner-test' WHERE id",
    [providerId],
  );
  const logger = {
    warn: () => {},
    error: () => {},
  } as unknown as import("fastify").FastifyBaseLogger;
  let stopAgain: (() => Promise<void>) | undefined;
  const id = await enqueue();
  const stop = startAssistantRunner(logger, { shutdownMs: 50 });
  try {
    await Promise.race([
      entered,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Runner never called the provider")),
          3000,
        ),
      ),
    ]);
    const started = Date.now();
    await stop();
    assert.ok(
      Date.now() - started < 2000,
      "the configured shutdown grace is bounded",
    );
    const parked = (
      await pool.query(
        "SELECT state, run_state, lease_until <= now() AS released FROM ai_jobs WHERE id = $1",
        [id],
      )
    ).rows[0];
    assert.equal(parked.state, "running");
    assert.equal(parked.released, true);
    assert.ok(parked.run_state.checkpoint_step > 0);
    release();
    stopAgain = startAssistantRunner(logger);
    let finished: any;
    for (let attempt = 0; attempt < 150; attempt++) {
      finished = (
        await pool.query(
          "SELECT state, result, resume_count FROM ai_jobs WHERE id = $1",
          [id],
        )
      ).rows[0];
      if (finished.state === "done" || finished.state === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(finished.state, "done", JSON.stringify(finished));
    assert.equal(finished.result.answer, "The resumed run is ready.");
    assert.equal(finished.resume_count, 1);
    assert.equal(calls, 2);
    assert.ok(
      finished.result.trace.some(
        (entry: { label: string }) =>
          entry.label === "Picking up where I left off",
      ),
    );
  } finally {
    release();
    await stop();
    await stopAgain?.();
    await pool.query(
      "UPDATE ai_settings SET provider_id = $1, model = $2 WHERE id",
      [settings.provider_id, settings.model],
    );
    await pool.query("DELETE FROM ai_providers WHERE id = $1", [providerId]);
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("the sweeper retains durable checkpoints through a multi-day outage", async () => {
  const queued = await enqueue();
  const running = await enqueue();
  const legacy = await enqueue();
  const finished = await enqueue();
  await pool.query(
    "UPDATE ai_jobs SET created_at = now() - interval '2 days', heartbeat_at = now() - interval '2 days' WHERE id = ANY($1::uuid[])",
    [[queued, running, legacy, finished]],
  );
  await pool.query(
    "UPDATE ai_jobs SET state = 'running' WHERE id = ANY($1::uuid[])",
    [[running, legacy]],
  );
  await pool.query("UPDATE ai_jobs SET run_state = NULL WHERE id = $1", [
    legacy,
  ]);
  await pool.query("UPDATE ai_jobs SET state = 'done' WHERE id = $1", [
    finished,
  ]);
  const { runSweep } = await import("../src/lib/sweep.js");
  await runSweep();
  const remaining = (
    await pool.query("SELECT id FROM ai_jobs WHERE id = ANY($1::uuid[])", [
      [queued, running, legacy, finished],
    ])
  ).rows
    .map((row) => row.id)
    .sort();
  assert.deepEqual(remaining, [queued, running].sort());
});

test("interactive replicas share four reserved lease slots and recover an expired slot", async () => {
  const ids: string[] = [];
  try {
    const before = (
      await pool.query(
        "SELECT count(*)::int AS count FROM ai_jobs WHERE state='running' AND run_state->>'version'='1' AND lease_until > now()",
      )
    ).rows[0].count;
    for (let n = 0; n < 12; n++) ids.push(await enqueue());
    const claims = await Promise.all(
      ids.map((_, n) => claimAssistantJob(`replica-${n}`)),
    );
    const occupied = claims.filter((claim) => claim !== null);
    assert.equal(occupied.length, Math.max(0, 4 - before));
    assert.equal(await claimAssistantJob("fifth-replica"), null);
    assert.ok(occupied.length);
    await pool.query(
      "UPDATE ai_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [occupied[0]!.id],
    );
    assert.ok(await claimAssistantJob("replacement-replica"));
    assert.equal(await claimAssistantJob("still-bounded"), null);
  } finally {
    await pool.query("DELETE FROM ai_jobs WHERE id=ANY($1::uuid[])", [ids]);
  }
});

test("legacy chat serialization requests cancellation without erasing either run", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(
    new URL(
      "../migrations/196_assistant_legacy_chat_serialization.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const first = await enqueue();
  const second = await enqueue();
  const chat = (
    await pool.query("SELECT chat_id FROM ai_jobs WHERE id=$1", [first])
  ).rows[0].chat_id;
  await pool.query(
    "UPDATE ai_jobs SET chat_id=$2::uuid,run_state=jsonb_set(run_state,'{request,chat_id}',to_jsonb($2::uuid::text)),state='waiting' WHERE id=$1",
    [second, chat],
  );
  try {
    await pool.query(sql);
    await pool.query(sql);
    const rows = (
      await pool.query(
        "SELECT id,state,cancel_requested,run_state FROM ai_jobs WHERE id=ANY($1::uuid[]) ORDER BY created_at,id",
        [[first, second]],
      )
    ).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].cancel_requested, false);
    assert.equal(rows[1].cancel_requested, true);
    assert.equal(rows[1].state, "queued");
    assert.ok(rows.every((row) => row.run_state));
  } finally {
    await pool.query("DELETE FROM ai_jobs WHERE id=ANY($1::uuid[])", [
      [first, second],
    ]);
  }
});
