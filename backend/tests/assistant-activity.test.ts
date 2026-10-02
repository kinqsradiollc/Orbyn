import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assistantActivityCursor,
  assistantActivityQuery,
  assistantActivityPage,
  HttpError,
} from "@orbyn/core";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantActivity } =
  await import("../src/modules/assistant-workspace/activity.js");
const owners: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function person() {
  const id = randomUUID();
  owners.push(id);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Activity tester')",
    [id, `activity-${id}@example.test`],
  );
  return id;
}
async function job(owner: string, lane = "background", state = "queued") {
  const chat = randomUUID();
  const id = randomUUID();
  const origin =
    lane === "overnight" ? "night" : lane === "background" ? "task" : "person";
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Private activity',$3)",
    [chat, owner, origin],
  );
  await pool.query(
    `INSERT INTO ai_jobs(id,user_id,chat_id,state,sources_checked,run_origin,run_state)
    VALUES($1,$2,$3,$4,true,$5,$6)`,
    [
      id,
      owner,
      chat,
      state,
      origin,
      {
        version: 1,
        request: {
          ...(origin === "person" ? {} : { automation: { kind: origin } }),
        },
      },
    ],
  );
  return id;
}

test("execution transitions persist; presence and checkpoints are not activity", async () => {
  const owner = await person();
  const id = await job(owner);
  let page = await assistantActivity(pool, owner, "background", {});
  assert.deepEqual(
    page.events.map((e) => e.kind),
    ["queued"],
  );
  assert.equal(page.last_activity_at, null);
  await pool.query("UPDATE ai_jobs SET state='running' WHERE id=$1", [id]);
  await pool.query("UPDATE ai_jobs SET progress=$2 WHERE id=$1", [
    id,
    { step: "Checking" },
  ]);
  page = await assistantActivity(pool, owner, "background", {});
  const timestamp = page.last_activity_at;
  assert.ok(timestamp);
  await pool.query(
    "UPDATE ai_jobs SET heartbeat_at=now(),last_polled_at=now(),lease_until=now()+interval '1 minute',run_state=NULL WHERE id=$1",
    [id],
  );
  assert.deepEqual(
    await assistantActivity(pool, owner, "background", {}),
    page,
  );
  await pool.query("UPDATE ai_jobs SET state='waiting' WHERE id=$1", [id]);
  await pool.query("UPDATE ai_jobs SET state='queued' WHERE id=$1", [id]);
  await pool.query("UPDATE ai_jobs SET state='done',result=$2 WHERE id=$1", [
    id,
    { answer: "PRIVATE CONTENT" },
  ]);
  await pool.query("UPDATE ai_jobs SET apply_result=$2 WHERE id=$1", [
    id,
    { applied: true },
  ]);
  page = await assistantActivity(pool, owner, "background", {});
  assert.deepEqual(
    page.events.map((e) => e.kind),
    ["queued", "running", "progress", "waiting", "queued", "done", "outcome"],
  );
  assert.equal(JSON.stringify(page).includes("PRIVATE CONTENT"), false);
  assert.deepEqual(
    page.events.map((e) => e.sequence),
    ["1", "2", "3", "4", "5", "6", "7"],
  );
});

test("concurrent writes have ordered owner/lane streams and bounded replay", async () => {
  const owner = await person();
  const ids = await Promise.all(Array.from({ length: 8 }, () => job(owner)));
  await Promise.all(
    ids.map((id) =>
      pool.query("UPDATE ai_jobs SET state='running' WHERE id=$1", [id]),
    ),
  );
  const first = await assistantActivity(pool, owner, "background", {
    limit: 3,
  });
  assert.equal(first.has_more, true);
  assert.equal(first.cursor, "3");
  const rest = await assistantActivity(pool, owner, "background", {
    after: first.cursor,
  });
  assert.equal(rest.cursor, "16");
  assert.equal(rest.has_more, false);
  assert.equal(rest.events.length, 13);
  const other = await person();
  assert.equal(
    (await assistantActivity(pool, other, "background", {})).cursor,
    "0",
  );
  assert.equal(
    (await assistantActivity(pool, owner, "overnight", {})).cursor,
    "0",
  );
  await assert.rejects(
    assistantActivity(pool, other, "background", { after: "1" }),
    (e) => e instanceof HttpError && e.statusCode === 400,
  );
});

test("current source authorization hides live jobs; cursor advances over hidden events", async () => {
  const owner = await person();
  const id = await job(owner, "overnight");
  await pool.query("UPDATE ai_jobs SET state='running' WHERE id=$1", [id]);
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [id, randomUUID()],
  );
  const page = await assistantActivity(pool, owner, "overnight", {});
  assert.equal(page.cursor, "2");
  assert.deepEqual(page.events, []);
  assert.equal(page.last_activity_at, null);
});

test("job cleanup preserves content-free history; retention never resets cursors", async () => {
  const owner = await person();
  const id = await job(owner);
  await pool.query("UPDATE ai_jobs SET state='failed' WHERE id=$1", [id]);
  const before = await assistantActivity(pool, owner, "background", {});
  await pool.query("DELETE FROM ai_jobs WHERE id=$1", [id]);
  const deleted = await assistantActivity(pool, owner, "background", {});
  assert.equal(deleted.last_activity_at, before.last_activity_at);
  assert.ok(deleted.events.every((e) => e.job_id === null));
  await pool.query("DELETE FROM assistant_activity_events WHERE owner_id=$1", [
    owner,
  ]);
  assert.equal(
    (await assistantActivity(pool, owner, "background", {})).cursor,
    "2",
  );
  await job(owner);
  assert.equal(
    (await assistantActivity(pool, owner, "background", { after: "2" }))
      .events[0].sequence,
    "3",
  );
});

test("historical imported rows do not invent fresh activity", async () => {
  const owner = await person();
  await job(owner, "overnight", "done");
  assert.deepEqual(
    (await assistantActivity(pool, owner, "overnight", {})).events,
    [],
  );
});

test("the actual sweeper prunes old events while preserving stream identity", async () => {
  const { runSweep } = await import("../src/lib/sweep.js");
  const owner = await person();
  await job(owner);
  await pool.query(
    "UPDATE assistant_activity_events SET created_at=now()-interval '91 days' WHERE owner_id=$1",
    [owner],
  );
  await job(owner);
  assert.ok(await runSweep());
  const page = await assistantActivity(pool, owner, "background", {});
  assert.equal(page.cursor, "2");
  assert.deepEqual(
    page.events.map((event) => event.sequence),
    ["2"],
  );
});

test("cursor validation rejects overflow, malformed and unbounded queries", () => {
  for (const cursor of ["-1", "01", "1.5", "9223372036854775808", "1e3", ""])
    assert.equal(assistantActivityCursor.safeParse(cursor).success, false);
  assert.equal(
    assistantActivityCursor.parse("9223372036854775807"),
    "9223372036854775807",
  );
  for (const query of [
    { limit: 101 },
    { limit: 0 },
    { after: "0", owner_id: randomUUID() },
  ])
    assert.equal(assistantActivityQuery.safeParse(query).success, false);
  for (const cursor of ["1.5", "9223372036854775808"]) {
    assert.equal(
      assistantActivityPage.safeParse({
        lane: "background",
        cursor,
        has_more: false,
        last_activity_at: null,
        events: [],
      }).success,
      false,
    );
    assert.equal(
      assistantActivityPage.safeParse({
        lane: "background",
        cursor: "2",
        has_more: false,
        last_activity_at: null,
        events: [
          {
            sequence: cursor,
            job_id: null,
            kind: "done",
            created_at: new Date().toISOString(),
          },
        ],
      }).success,
      false,
    );
  }
});
