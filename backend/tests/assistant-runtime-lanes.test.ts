import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import "./setup.js";
import type { AssistantAutomation } from "../src/modules/ai/agent/run.js";

const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { initialAssistantRun } = await import("../src/modules/ai/agent/run.js");
const { claimAssistantJob } = await import("../src/modules/ai/agent/runner.js");
const { replaceAssistantBudget } =
  await import("../src/modules/assistant-workspace/budgets.js");
const { acquireAssistantRuntime } =
  await import("../src/modules/ai/agent/runtime-lanes.js");
let userId: string;
before(async () => {
  await migrate();
  userId = (
    await pool.query(
      "INSERT INTO users(email,password_hash,name) VALUES($1,'test','Runtime lanes') RETURNING id",
      [`runtime-${randomUUID()}@example.test`],
    )
  ).rows[0].id;
});
afterEach(async () => {
  await pool.query("DELETE FROM ai_jobs WHERE user_id=$1", [userId]);
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
});

async function enqueue(automation?: AssistantAutomation, owner = userId) {
  const chat = (
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title) VALUES(gen_random_uuid(),$1,'Runtime ownership') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const checkpoint = initialAssistantRun({
    chat_id: chat,
    turn_id: randomUUID(),
    message: "Review my plans",
    timezone: "UTC",
    history: [],
    scope: null,
    automation,
  });
  return (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,turn_id,state,run_state) VALUES($1,$2,$3,'queued',$4) RETURNING id,runtime_lane",
      [owner, chat, checkpoint.request.turn_id, JSON.stringify(checkpoint)],
    )
  ).rows[0] as { id: string; runtime_lane: string };
}

test("requeued exhausted work cannot block later owners in either automation lane", async () => {
  for (const lane of ["background", "overnight"] as const) {
    const other = (
      await pool.query<{ id: string }>(
        "INSERT INTO users(email,password_hash,name) VALUES($1,'test','Ready owner') RETURNING id",
        [`runtime-ready-${randomUUID()}@example.test`],
      )
    ).rows[0].id;
    try {
      await replaceAssistantBudget(userId, lane, {
        expected_revision: 1,
        daily_token_limit: 5000,
        hourly_start_limit: 5,
        per_run_token_limit: 2000,
      });
      const automation: AssistantAutomation =
        lane === "background" ? { kind: "idea" } : { kind: "night" };
      const exhausted = await enqueue(automation);
      assert.equal(
        (await claimAssistantJob(`initial-${lane}`, lane))?.id,
        exhausted.id,
      );
      await pool.query(
        `UPDATE ai_jobs SET state='queued',claimed_by=NULL,lease_until=NULL,
         created_at=now()-interval '1 hour',
         run_state=jsonb_set(run_state,'{state,token_estimate}','1200'::jsonb)
         WHERE id=$1`,
        [exhausted.id],
      );
      await replaceAssistantBudget(userId, lane, {
        expected_revision: 2,
        daily_token_limit: 5000,
        hourly_start_limit: 5,
        per_run_token_limit: 1000,
      });
      const ready = await enqueue(automation, other);
      const claims = await Promise.all([
        claimAssistantJob(`another-owner-${lane}-1`, lane),
        claimAssistantJob(`another-owner-${lane}-2`, lane),
      ]);
      assert.deepEqual(
        claims.map((row) => row?.id ?? null).sort(),
        [null, ready.id].sort(),
      );
      assert.equal(await claimAssistantJob(`again-${lane}`, lane), null);
      assert.equal(
        (
          await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [
            exhausted.id,
          ])
        ).rows[0].state,
        "queued",
      );
      assert.deepEqual(
        (
          await pool.query(
            "SELECT reserved_tokens,reported_tokens FROM assistant_work_reservations WHERE job_id=$1",
            [exhausted.id],
          )
        ).rows,
        [{ reserved_tokens: 2000, reported_tokens: 1200 }],
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [other]);
      await pool.query(
        "DELETE FROM assistant_lane_budget_settings WHERE user_id=$1 AND lane=$2",
        [userId, lane],
      );
    }
  }
});

test("new jobs derive ownership from the request, including night source kinds", async () => {
  assert.equal((await enqueue()).runtime_lane, "interactive");
  for (const kind of ["idea", "goal", "routine", "task"] as const)
    assert.equal((await enqueue({ kind })).runtime_lane, "background");
  assert.equal((await enqueue({ kind: "night" })).runtime_lane, "overnight");
  assert.equal(
    (
      await enqueue({
        kind: "goal",
        night_id: randomUUID(),
        source_kind: "goal",
      })
    ).runtime_lane,
    "overnight",
  );
});

test("ownership survives checkpoint cleanup and rejects explicit or implicit reassignment", async () => {
  const row = await enqueue({ kind: "night" });
  await assert.rejects(
    pool.query("UPDATE ai_jobs SET runtime_lane='background' WHERE id=$1", [
      row.id,
    ]),
    /ownership cannot change/,
  );
  await assert.rejects(
    pool.query(
      "UPDATE ai_jobs SET run_state=jsonb_set(run_state,'{request,automation}', '{\"kind\":\"idea\"}') WHERE id=$1",
      [row.id],
    ),
    /another runtime/,
  );
  await pool.query("UPDATE ai_jobs SET state='waiting' WHERE id=$1", [row.id]);
  await pool.query("UPDATE ai_jobs SET state='queued' WHERE id=$1", [row.id]);
  assert.equal(await claimAssistantJob("background-owner", "background"), null);
  assert.equal(
    (await claimAssistantJob("night-owner", "overnight"))?.id,
    row.id,
  );
  await pool.query(
    "UPDATE ai_jobs SET state='done',run_state=NULL WHERE id=$1",
    [row.id],
  );
  assert.equal(
    (await pool.query("SELECT runtime_lane FROM ai_jobs WHERE id=$1", [row.id]))
      .rows[0].runtime_lane,
    "overnight",
  );
});

test("busy automation lanes leave four chat slots, and replicas cannot exceed each lane", async () => {
  const ids = {
    interactive: new Set<string>(),
    background: new Set<string>(),
    overnight: new Set<string>(),
  };
  for (let i = 0; i < 8; i++) {
    ids.interactive.add((await enqueue()).id);
    ids.background.add((await enqueue({ kind: "idea" })).id);
    ids.overnight.add((await enqueue({ kind: "night" })).id);
  }
  for (const [lane, capacity] of [
    ["overnight", 2],
    ["background", 2],
    ["interactive", 4],
  ] as const) {
    const claims = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        claimAssistantJob(`${lane}-${i}`, lane),
      ),
    );
    const live = claims.filter((c) => c !== null);
    assert.equal(live.length, capacity);
    assert.ok(live.every((c) => ids[lane].has(c.id)));
    assert.equal(await claimAssistantJob(`${lane}-overflow`, lane), null);
  }
  const total = await pool.query(
    "SELECT count(*)::int n FROM ai_jobs WHERE user_id=$1 AND state='running'",
    [userId],
  );
  assert.equal(total.rows[0].n, 8);
});

test("a process cannot host background and overnight consumers together", () => {
  const release = acquireAssistantRuntime("background");
  const releaseReplica = acquireAssistantRuntime("background");
  try {
    assert.throws(
      () => acquireAssistantRuntime("overnight"),
      /already runs the background/,
    );
    release();
    assert.throws(
      () => acquireAssistantRuntime("interactive"),
      /already runs the background/,
    );
  } finally {
    release();
    releaseReplica();
  }
  acquireAssistantRuntime("overnight")();
});

test("migration assigns existing queued, waiting, terminal and linked night work correctly", async () => {
  const sql = await readFile(
    new URL("../migrations/206_assistant_runtime_lanes.sql", import.meta.url),
    "utf8",
  );
  await transaction(async (db) => {
    // A disposable pre-migration schema tests the actual upgrade SQL, with no
    // changes to the real test tables or their triggers.
    await db.query("CREATE SCHEMA runtime_upgrade_fixture");
    await db.query("SET LOCAL search_path TO runtime_upgrade_fixture, public");
    await db.query(`CREATE TABLE ai_jobs(id integer PRIMARY KEY, state text, run_state jsonb, run_origin text, created_at timestamptz DEFAULT now());
      CREATE TABLE assistant_night_runs(job_id integer);
      INSERT INTO ai_jobs(id,state,run_state,run_origin) VALUES
      (1,'queued','{"version":1,"request":{}}','person'),
      (2,'waiting','{"version":1,"request":{"automation":{"kind":"routine"}}}','routine'),
      (3,'queued','{"version":1,"request":{"automation":{"kind":"goal","night_id":"saved-night"}}}','goal'),
      (4,'done',NULL,'idea'), (5,'done',NULL,'night'), (6,'done',NULL,'person'),
      (7,'done',NULL,'person');
      INSERT INTO assistant_night_runs(job_id) VALUES(7);`);
    await db.query(sql);
    assert.deepEqual(
      (await db.query("SELECT runtime_lane FROM ai_jobs ORDER BY id")).rows.map(
        (r) => r.runtime_lane,
      ),
      [
        "interactive",
        "background",
        "overnight",
        "background",
        "overnight",
        "interactive",
        "overnight",
      ],
    );
    await db.query("DROP SCHEMA runtime_upgrade_fixture CASCADE");
  });
});

test("an isolated worker reports its own readiness and heartbeat without chat routes", async () => {
  const { buildAssistantWorker } =
    await import("../src/services/assistant-worker.js");
  const app = await buildAssistantWorker("background");
  try {
    await app.ready();
    let response = await app.inject("/ready");
    for (let i = 0; i < 50 && response.statusCode !== 200; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      response = await app.inject("/ready");
    }
    assert.equal(response.statusCode, 200, response.body);
    assert.equal((await app.inject("/ai/jobs/active")).statusCode, 404);
    const heartbeat = await pool.query(
      "SELECT last_seen_at > now()-interval '10 seconds' fresh FROM service_heartbeats WHERE service='assistant-background'",
    );
    assert.equal(heartbeat.rows[0]?.fresh, true);
  } finally {
    await app.close();
  }
});
