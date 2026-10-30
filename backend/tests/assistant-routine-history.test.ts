import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Queryable } from "../src/db/pool.js";
import { runtimeOutcome } from "../src/modules/ai/agent/outcome.js";
import { helpers, trapNetwork } from "./mcp-helpers.js";

const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { recordRoutineRun, readRoutineRuns } =
  await import("../src/modules/assistant-workspace/routine-runs.js");
const { buildApiService } = await import("../src/app.js");
const app = await buildApiService();
const h = helpers(app);
const network = await trapNetwork();
const owners: string[] = [];

before(() => migrate());
after(async () => {
  network.restore();
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
  assert.deepEqual(network.calls, []);
});

async function person() {
  const owner = await h.register("routine-history");
  owners.push(owner.id);
  return owner;
}

async function routine(owner: string) {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO agent_routines(user_id,instruction,rrule,next_run_at)
       VALUES($1,'Review the saved notes','FREQ=DAILY',now()+interval '1 day') RETURNING id`,
      [owner],
    )
  ).rows[0].id;
}

async function insertRun(
  db: Queryable,
  owner: string,
  routineId: string,
  scheduledFor: string,
) {
  const chat = randomUUID(),
    job = randomUUID(),
    turn = randomUUID();
  const receipt = runtimeOutcome({
    jobId: job,
    chatId: chat,
    turnId: turn,
    timedOut: true,
  });
  await db.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Routine result','routine')",
    [chat, owner],
  );
  await db.query(
    `INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,sources_checked,run_state,result)
     VALUES($1,$2,$3,$4,'queued',true,$5,$6)`,
    [
      job,
      owner,
      chat,
      turn,
      {
        version: 1,
        request: { automation: { kind: "routine", id: routineId } },
      },
      {
        answer: "A private partial report.",
        turn_id: turn,
        assistant_run: { execution_outcome: receipt },
      },
    ],
  );
  await recordRoutineRun(db, owner, routineId, scheduledFor, job);
  return { chat, job, receipt };
}

test("occurrence admission is atomic, unique and identity-bound; job transitions and recovery update metadata", async () => {
  const owner = await person();
  const id = await routine(owner.id);
  const scheduled = "2050-01-02T08:00:00.123456Z";
  const run = await transaction((db) => insertRun(db, owner.id, id, scheduled));
  assert.equal(
    (await readRoutineRuns(pool, owner.id, id, {})).runs[0].state,
    "queued",
  );
  for (const state of ["running", "waiting", "running", "done"] as const) {
    await pool.query("UPDATE ai_jobs SET state=$2 WHERE id=$1", [
      run.job,
      state,
    ]);
    assert.equal(
      (await readRoutineRuns(pool, owner.id, id, {})).runs[0].state,
      state,
    );
  }
  await pool.query("UPDATE ai_jobs SET resume_count=2 WHERE id=$1", [run.job]);
  const observed = (await readRoutineRuns(pool, owner.id, id, {})).runs[0];
  assert.equal(observed.resume_count, 2);
  assert.equal(observed.scheduled_for, scheduled);
  assert.equal(observed.visibility, "available");
  if (observed.visibility === "available")
    assert.deepEqual(observed.execution_outcome, run.receipt);

  const before = (
    await pool.query(
      "SELECT (SELECT count(*) FROM ai_jobs WHERE user_id=$1) AS jobs,(SELECT count(*) FROM ai_chats WHERE user_id=$1) AS chats",
      [owner.id],
    )
  ).rows[0];
  await assert.rejects(
    transaction((db) => insertRun(db, owner.id, id, scheduled)),
    /unique constraint/,
  );
  assert.deepEqual(
    (
      await pool.query(
        "SELECT (SELECT count(*) FROM ai_jobs WHERE user_id=$1) AS jobs,(SELECT count(*) FROM ai_chats WHERE user_id=$1) AS chats",
        [owner.id],
      )
    ).rows[0],
    before,
    "duplicate occurrence rolls back its job and chat too",
  );
  const other = await person();
  await assert.rejects(
    transaction((db) =>
      recordRoutineRun(db, other.id, id, "2050-01-03T08:00:00Z", run.job),
    ),
    /owner does not match/,
  );
  const differentRoutine = await routine(owner.id);
  await assert.rejects(
    transaction((db) =>
      recordRoutineRun(
        db,
        owner.id,
        differentRoutine,
        "2050-01-03T08:00:00Z",
        run.job,
      ),
    ),
    /does not match its execution/,
  );
  await assert.rejects(
    transaction(async (db) => {
      await db.query("UPDATE ai_jobs SET state='failed' WHERE id=$1", [
        run.job,
      ]);
      throw new Error("Rollback fixture");
    }),
    /Rollback fixture/,
  );
  assert.equal(
    (await readRoutineRuns(pool, owner.id, id, {})).runs[0].state,
    "done",
    "rolled-back job state cannot escape into history",
  );
});

test("history API authorizes routine, bounds and paginates with exact timestamps, and removes content and links on revoked access or retention", async () => {
  const owner = await person();
  const other = await person();
  const id = await routine(owner.id);
  const runs = [];
  for (const suffix of ["123455", "123456", "123457"]) {
    const run = await transaction((db) =>
      insertRun(db, owner.id, id, `2050-01-02T08:00:00.${suffix}Z`),
    );
    await pool.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [run.job]);
    runs.push(run);
  }
  const endpoint = `/me/agent-routines/${id}/runs`;
  const headers = { authorization: `Bearer ${owner.token}` };
  const visited: string[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: "1" });
    if (cursor) params.set("cursor", cursor);
    const response = await app.inject({
      method: "GET",
      url: `${endpoint}?${params}`,
      headers,
    });
    assert.equal(response.statusCode, 200, response.body);
    const page = response.json();
    assert.equal(page.routine_id, id);
    assert.equal(page.runs.length, 1);
    visited.push(page.runs[0].scheduled_for);
    cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(visited, [
    "2050-01-02T08:00:00.123457Z",
    "2050-01-02T08:00:00.123456Z",
    "2050-01-02T08:00:00.123455Z",
  ]);
  for (const query of ["limit=51", "limit=0", "cursor=invalid"]) {
    const invalid = await app.inject({
      method: "GET",
      url: `${endpoint}?${query}`,
      headers,
    });
    assert.equal(invalid.statusCode, 422, invalid.body);
  }
  const foreign = await app.inject({
    method: "GET",
    url: endpoint,
    headers: { authorization: `Bearer ${other.token}` },
  });
  assert.equal(foreign.statusCode, 404);
  const missing = await app.inject({
    method: "GET",
    url: `/me/agent-routines/${randomUUID()}/runs`,
    headers,
  });
  assert.equal(missing.statusCode, 404);

  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [runs[2].job, randomUUID()],
  );
  await pool.query("DELETE FROM ai_jobs WHERE id=$1", [runs[1].job]);
  await pool.query(
    "INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id) VALUES($1,$2,'doc',$3)",
    [runs[0].chat, randomUUID(), randomUUID()],
  );
  const hidden = await app.inject({ method: "GET", url: endpoint, headers });
  assert.equal(hidden.statusCode, 200, hidden.body);
  for (const row of hidden.json().runs) {
    assert.equal(row.visibility, "restricted");
    assert.deepEqual(Object.keys(row).sort(), [
      "id",
      "last_observed_at",
      "resume_count",
      "scheduled_for",
      "state",
      "visibility",
    ]);
  }
  assert.ok(!hidden.body.includes("private partial report"));
  for (const run of runs) {
    assert.ok(!hidden.body.includes(run.job));
    assert.ok(!hidden.body.includes(run.chat));
  }
  const retained = (
    await pool.query(
      "SELECT job_id,state,resume_count FROM assistant_routine_runs WHERE routine_id=$1 AND scheduled_for=$2",
      [id, "2050-01-02T08:00:00.123456Z"],
    )
  ).rows[0];
  assert.equal(retained.job_id, null);
  assert.equal(retained.state, "done");
  await pool.query("DELETE FROM agent_routines WHERE id=$1", [id]);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM assistant_routine_runs WHERE routine_id=$1",
        [id],
      )
    ).rows[0].count,
    0,
  );
});
