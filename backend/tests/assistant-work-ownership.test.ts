import "./setup.js";
import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { claimAssistantJob } = await import("../src/modules/ai/agent/runner.js");
const owner = randomUUID();
const other = randomUUID();
before(async () => {
  await migrate();
  for (const id of [owner, other])
    await pool.query(
      "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Work owner')",
      [id, `work-${id}@example.test`],
    );
});
afterEach(() =>
  pool.query("DELETE FROM ai_jobs WHERE user_id=ANY($1::uuid[])", [
    [owner, other],
  ]),
);
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [owner, other],
  ]);
  await pool.end();
});
async function queued(
  source: string,
  lane: "background" | "overnight",
  kind = "task",
  user = owner,
) {
  const id = randomUUID();
  const automation =
    lane === "overnight"
      ? { kind: "night", source_kind: kind, id: source }
      : { kind, id: source };
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,state,run_state) VALUES($1,$2,'queued',$3)",
    [id, user, { version: 1, request: { automation } }],
  );
  return id;
}
const occupied = (error: unknown) =>
  (error as { code?: string }).code === "55P03";

test("assigned task identity is canonical and independent of the runtime lane", async () => {
  const source = randomUUID();
  const ids = [
    await queued(source.toUpperCase(), "background"),
    await queued(source, "overnight"),
  ];
  const rows = (
    await pool.query(
      "SELECT work_source_kind,work_source_id FROM ai_jobs WHERE id=ANY($1::uuid[])",
      [ids],
    )
  ).rows;
  assert.equal(rows.length, 2);
  for (const row of rows)
    assert.deepEqual(row, { work_source_kind: "task", work_source_id: source });
});

test("competing Background and Overnight claims acquire only one source owner", async () => {
  const source = randomUUID();
  await queued(source, "background");
  await queued(source, "overnight");
  const results = await Promise.all([
    claimAssistantJob("work-background", "background"),
    claimAssistantJob("work-overnight", "overnight"),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM ai_jobs WHERE user_id=$1 AND state='running'",
        [owner],
      )
    ).rows[0].count,
    1,
  );
});

test("waiting and expired leases retain source ownership until recovery or completion", async () => {
  const source = randomUUID();
  const first = await queued(source, "background");
  const second = await queued(source, "overnight");
  assert.equal(
    (await claimAssistantJob("work-owner", "background"))?.id,
    first,
  );
  await pool.query(
    "UPDATE ai_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [first],
  );
  assert.equal(await claimAssistantJob("next-owner", "overnight"), null);
  await pool.query(
    "UPDATE ai_jobs SET state='waiting',lease_until=NULL WHERE id=$1",
    [first],
  );
  assert.equal(await claimAssistantJob("next-owner", "overnight"), null);
  await pool.query(
    "UPDATE ai_jobs SET state='done',run_state=NULL WHERE id=$1",
    [first],
  );
  assert.equal(
    (await claimAssistantJob("next-owner", "overnight"))?.id,
    second,
  );
  assert.deepEqual(
    (
      await pool.query(
        "SELECT work_source_kind,work_source_id FROM ai_jobs WHERE id=$1",
        [first],
      )
    ).rows[0],
    { work_source_kind: "task", work_source_id: source },
  );
});

test("database guard rejects bypass claims and changes to persisted ownership", async () => {
  const source = randomUUID();
  const first = await queued(source, "background", "routine");
  const second = await queued(source, "overnight", "routine");
  await claimAssistantJob("routine-owner", "background");
  await assert.rejects(
    pool.query("UPDATE ai_jobs SET state='running' WHERE id=$1", [second]),
    occupied,
  );
  await assert.rejects(
    pool.query("UPDATE ai_jobs SET state='waiting' WHERE id=$1", [second]),
    occupied,
  );
  await assert.rejects(
    pool.query("UPDATE ai_jobs SET work_source_id=$2 WHERE id=$1", [
      first,
      randomUUID(),
    ]),
  );
  await assert.rejects(
    pool.query(
      "UPDATE ai_jobs SET run_state=jsonb_set(run_state,'{request,automation,id}',$2::jsonb) WHERE id=$1",
      [first, JSON.stringify(randomUUID())],
    ),
  );
  await assert.rejects(
    pool.query("UPDATE ai_jobs SET user_id=$2 WHERE id=$1", [first, other]),
  );
});

test("different assigned work kinds and different owners can run independently", async () => {
  const source = randomUUID();
  await queued(source, "background", "goal");
  await queued(source, "overnight", "routine");
  await queued(source, "overnight", "goal", other);
  assert.ok(await claimAssistantJob("goal-owner", "background"));
  assert.ok(await claimAssistantJob("routine-owner", "overnight"));
  assert.ok(await claimAssistantJob("other-goal-owner", "overnight"));
});

test("upgrade preserves existing overlapping work and blocks additional acquisition", async () => {
  const schema = `work_${randomUUID().replaceAll("-", "")}`;
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path TO ${schema}`);
    await db.query(
      "CREATE TABLE ai_jobs(id uuid PRIMARY KEY,user_id uuid NOT NULL,state text NOT NULL,run_state jsonb)",
    );
    const source = randomUUID();
    const legacy = [randomUUID(), randomUUID()];
    for (let i = 0; i < legacy.length; i++)
      await db.query("INSERT INTO ai_jobs VALUES($1,$2,$3,$4)", [
        legacy[i],
        owner,
        i ? "waiting" : "running",
        { request: { automation: { kind: "task", id: source } } },
      ]);
    await db.query(
      await readFile(
        new URL(
          "../migrations/209_assistant_work_ownership.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(
      (await db.query("SELECT state FROM ai_jobs ORDER BY state")).rows,
      [{ state: "running" }, { state: "waiting" }],
    );
    const next = randomUUID();
    await db.query(
      "INSERT INTO ai_jobs(id,user_id,state,run_state) VALUES($1,$2,'queued',$3)",
      [next, owner, { request: { automation: { kind: "task", id: source } } }],
    );
    await assert.rejects(
      db.query("UPDATE ai_jobs SET state='running' WHERE id=$1", [next]),
      occupied,
    );
    await db.query(
      "UPDATE ai_jobs SET state='done',run_state=NULL WHERE id=ANY($1::uuid[])",
      [legacy],
    );
    await db.query("UPDATE ai_jobs SET state='running' WHERE id=$1", [next]);
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  }
});
