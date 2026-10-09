import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

// Exercise the exact migration in an isolated schema; no application tables or
// preview fixtures are changed. Minimal parents make the storage boundary clear.
const schema = `handoff_${randomUUID().replaceAll("-", "")}`;
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const owner = randomUUID();
const otherOwner = randomUUID();
before(async () => {
  await db.connect();
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET search_path TO ${schema}`);
  await db.query(`CREATE TABLE users(id uuid PRIMARY KEY);
    CREATE TABLE ai_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users, state text NOT NULL, runtime_lane text NOT NULL)`);
  await db.query("INSERT INTO users VALUES($1),($2)", [owner, otherOwner]);
  await db.query(
    await readFile(
      new URL("../migrations/208_assistant_handoffs.sql", import.meta.url),
      "utf8",
    ),
  );
});
after(async () => {
  await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await db.end();
});

async function job(lane = "overnight", state = "done", user = owner) {
  return (
    await db.query(
      "INSERT INTO ai_jobs(user_id,state,runtime_lane) VALUES($1,$2,$3) RETURNING id",
      [user, state, lane],
    )
  ).rows[0].id as string;
}
async function propose(producer?: string, revision = "r1", client = db) {
  producer ??= await job();
  const id = randomUUID();
  await client.query(
    `INSERT INTO assistant_handoffs(id,owner_id,root_id,depth,
    producer_lane,recipient_lane,producer_job_id,producer_revision,title,instruction,sources)
    VALUES($1,$2,$1,0,'overnight','background',$3,$4,'Follow-up','Review the outcome',$5)`,
    [
      id,
      owner,
      producer,
      revision,
      JSON.stringify([{ kind: "job", id: producer, revision }]),
    ],
  );
  return id;
}
async function attempt(id: string) {
  await db.query(
    "UPDATE assistant_handoffs SET revision=revision+1,delivery_attempts=delivery_attempts+1 WHERE id=$1",
    [id],
  );
}
async function accept(id: string, receiver?: string) {
  receiver ??= await job("background", "queued");
  await db.query(
    "UPDATE assistant_handoffs SET revision=revision+1,status='accepted',recipient_job_id=$2 WHERE id=$1",
    [id, receiver],
  );
  return receiver;
}

test("storage rejects cross-owner, wrong-lane and active producing work", async () => {
  for (const producer of [
    await job("overnight", "done", otherOwner),
    await job("background"),
    await job("overnight", "running"),
  ])
    await assert.rejects(propose(producer));
  const id = await propose();
  assert.equal(
    (await db.query("SELECT status FROM assistant_handoffs WHERE id=$1", [id]))
      .rows[0].status,
    "proposed",
  );
});

test("duplicate proposals are atomic across separate database clients", async () => {
  const producer = await job();
  const second = new pg.Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await second.connect();
  try {
    await second.query(`SET search_path TO ${schema}`);
    const results = await Promise.allSettled([
      propose(producer),
      propose(producer, "r1", second),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
    const rows = await db.query(
      "SELECT id FROM assistant_handoffs WHERE producer_job_id=$1",
      [producer],
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(
      (
        await db.query(
          "SELECT receipt_count FROM assistant_handoff_chains WHERE id=$1",
          [rows.rows[0].id],
        )
      ).rows[0].receipt_count,
      1,
    );
  } finally {
    await second.end();
  }
});

test("receipts preserve provenance and enforce revision and finite attempts", async () => {
  const id = await propose();
  await assert.rejects(
    db.query(
      "UPDATE assistant_handoffs SET title='Changed',revision=revision+1 WHERE id=$1",
      [id],
    ),
  );
  await assert.rejects(
    db.query("UPDATE assistant_handoffs SET delivery_attempts=1 WHERE id=$1", [
      id,
    ]),
  );
  await assert.rejects(accept(id));
  for (let i = 0; i < 3; i++) await attempt(id);
  await assert.rejects(attempt(id));
  await db.query(
    "UPDATE assistant_handoffs SET status='failed',failure='delivery',revision=revision+1 WHERE id=$1",
    [id],
  );
  await assert.rejects(attempt(id));
});

test("acceptance requires queued receiving work owned by the other runtime", async () => {
  const id = await propose();
  await attempt(id);
  for (const receiver of [
    await job("background", "queued", otherOwner),
    await job("overnight", "queued"),
    await job("background", "done"),
  ])
    await assert.rejects(accept(id, receiver));
  const receiver = await accept(id);
  await assert.rejects(accept(id, receiver));
  await assert.rejects(
    db.query(
      "UPDATE assistant_handoffs SET recipient_job_id=$2,revision=revision+1,status='failed',failure='execution' WHERE id=$1",
      [id, await job("background", "queued")],
    ),
  );
});

test("completion requires actual completed receiving work and a result revision", async () => {
  const id = await propose();
  await attempt(id);
  const receiver = await accept(id);
  const complete = (result: unknown) =>
    db.query(
      "UPDATE assistant_handoffs SET status='completed',result=$2,revision=revision+1 WHERE id=$1",
      [id, JSON.stringify(result)],
    );
  await assert.rejects(
    complete({ kind: "job", id: receiver, revision: "outcome-1" }),
  );
  await db.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [receiver]);
  await assert.rejects(complete({}));
  await assert.rejects(complete({ kind: "job", id: receiver }));
  await assert.rejects(complete({ kind: "job", id: receiver, revision: 123 }));
  await assert.rejects(
    complete({ kind: "job", id: receiver, revision: "r1", approved: true }),
  );
  await assert.rejects(
    complete({ kind: "job", id: randomUUID(), revision: "outcome-1" }),
  );
  await complete({ kind: "job", id: receiver, revision: "outcome-1" });
  await assert.rejects(
    db.query(
      "UPDATE assistant_handoffs SET revision=revision+1,status='cancelled',result=NULL WHERE id=$1",
      [id],
    ),
  );
});

test("child provenance derives from acknowledged receiving work and counts survive deletion", async () => {
  const root = await propose();
  await attempt(root);
  const receiver = await accept(root);
  await db.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [receiver]);
  await db.query(
    "UPDATE assistant_handoffs SET status='completed',result=$2,revision=revision+1 WHERE id=$1",
    [
      root,
      JSON.stringify({ kind: "job", id: receiver, revision: "outcome-1" }),
    ],
  );
  const child = randomUUID();
  const insert = (revision: string) =>
    db.query(
      `INSERT INTO assistant_handoffs(id,owner_id,root_id,parent_id,depth,
    producer_lane,recipient_lane,producer_job_id,producer_revision,title,instruction,sources)
    VALUES($1,$2,$3,$3,1,'background','overnight',$4,$5,'Continue','Review the result',$6)`,
      [
        child,
        owner,
        root,
        receiver,
        revision,
        JSON.stringify([{ kind: "job", id: receiver, revision }]),
      ],
    );
  await assert.rejects(insert("stale-result"));
  await db.query(
    "UPDATE assistant_handoff_chains SET receipt_count=20 WHERE id=$1",
    [root],
  );
  await assert.rejects(insert("outcome-1"));
  await db.query(
    "UPDATE assistant_handoff_chains SET receipt_count=1 WHERE id=$1",
    [root],
  );
  await insert("outcome-1");
  await db.query("DELETE FROM assistant_handoffs WHERE id=$1", [child]);
  assert.equal(
    (
      await db.query(
        "SELECT receipt_count FROM assistant_handoff_chains WHERE id=$1",
        [root],
      )
    ).rows[0].receipt_count,
    2,
  );
});
