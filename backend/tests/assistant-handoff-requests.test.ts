import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HttpError } from "@orbyn/core";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  handoffProducerEvidence,
  createRequestedAssistantHandoff,
  acknowledgeCompletedAssistantHandoff,
} = await import("../src/modules/assistant-workspace/handoffs.js");
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
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Handoff tester')",
    [id, `handoff-${id}@example.test`],
  );
  return id;
}
async function producer(
  owner: string,
  project: string | null = null,
  lane = "overnight",
  state = "done",
) {
  const chat = randomUUID();
  const job = randomUUID();
  const origin = lane === "overnight" ? "night" : "task";
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin,project_id) VALUES($1,$2,'Reflection result',$4,$3)",
    [chat, owner, project, origin],
  );
  await pool.query(
    `INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,result,sources_checked,run_origin,run_state)
    VALUES($1,$2,$3,$4,$8,$5,true,$7,$6)`,
    [
      job,
      owner,
      chat,
      randomUUID(),
      { answer: "Review the next step." },
      { version: 1, request: { automation: { kind: origin } } },
      origin,
      state,
    ],
  );
  return { job, chat };
}
async function request(owner: string, job: string) {
  const evidence = await handoffProducerEvidence(pool, owner, job);
  return {
    producer_job_id: job,
    expected_producer_revision: evidence.source.revision,
    recipient_lane: evidence.lane === "overnight" ? "background" : "overnight",
    title: "Review the next step",
    instruction: "Check the cited result and propose a follow-up.",
  };
}
const status = (expected: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === expected;

async function accepted(owner: string, project: string | null = null) {
  const producing = await producer(owner);
  const id = await createRequestedAssistantHandoff(
    owner,
    await request(owner, producing.job),
  );
  const receiving = await producer(owner, project, "background", "queued");
  await pool.query(
    "UPDATE assistant_handoffs SET revision=revision+1,delivery_attempts=1 WHERE id=$1",
    [id],
  );
  await pool.query(
    "UPDATE assistant_handoffs SET revision=revision+1,status='accepted',recipient_job_id=$2 WHERE id=$1",
    [id, receiving.job],
  );
  return { id, producing, receiving };
}

test("completion derives current receiving evidence and concurrent retries acknowledge once", async () => {
  const owner = await person();
  const { id, receiving } = await accepted(owner);
  await pool.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [
    receiving.job,
  ]);
  const results = await Promise.all([
    acknowledgeCompletedAssistantHandoff(owner, id, 3),
    acknowledgeCompletedAssistantHandoff(
      owner.toUpperCase(),
      id.toUpperCase(),
      3,
    ),
  ]);
  const evidence = await handoffProducerEvidence(pool, owner, receiving.job);
  assert.deepEqual(results, [evidence.source, evidence.source]);
  const receipt = (
    await pool.query(
      "SELECT status,revision,result FROM assistant_handoffs WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.deepEqual(receipt, {
    status: "completed",
    revision: 4,
    result: evidence.source,
  });
  const followup = await createRequestedAssistantHandoff(
    owner,
    await request(owner, receiving.job),
  );
  assert.deepEqual(
    (
      await pool.query(
        "SELECT parent_id,root_id,depth FROM assistant_handoffs WHERE id=$1",
        [followup],
      )
    ).rows[0],
    { parent_id: id, root_id: id, depth: 1 },
  );
  await pool.query("UPDATE ai_jobs SET result=$2 WHERE id=$1", [
    receiving.job,
    { answer: "Changed after acknowledgment." },
  ]);
  await assert.rejects(
    acknowledgeCompletedAssistantHandoff(owner, id, 3),
    status(409),
  );
});

test("acknowledgment rejects stale receipts, incomplete work and changed producing evidence", async () => {
  const owner = await person();
  const { id, producing, receiving } = await accepted(owner);
  await assert.rejects(
    acknowledgeCompletedAssistantHandoff(owner, id, 2),
    status(409),
  );
  await assert.rejects(
    acknowledgeCompletedAssistantHandoff(owner, id, 3),
    status(404),
  );
  await pool.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [
    receiving.job,
  ]);
  await pool.query("UPDATE ai_jobs SET apply_result=$2 WHERE id=$1", [
    producing.job,
    { changed: true },
  ]);
  await assert.rejects(
    acknowledgeCompletedAssistantHandoff(owner, id, 3),
    status(409),
  );
  assert.equal(
    (
      await pool.query("SELECT revision FROM assistant_handoffs WHERE id=$1", [
        id,
      ])
    ).rows[0].revision,
    3,
  );
});

test("acknowledgment checks owner and current receiving visibility before completion or replay", async () => {
  const owner = await person();
  const other = await person();
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name) VALUES($1,'Receiving evidence') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const { id, receiving } = await accepted(owner, project);
  await pool.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [
    receiving.job,
  ]);
  await assert.rejects(
    acknowledgeCompletedAssistantHandoff(other, id, 3),
    status(404),
  );
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    project,
  ]);
  await assert.rejects(
    acknowledgeCompletedAssistantHandoff(owner, id, 3),
    status(404),
  );
  await pool.query("UPDATE projects SET assistant_off=false WHERE id=$1", [
    project,
  ]);
  await acknowledgeCompletedAssistantHandoff(owner, id, 3);
  await pool.query("UPDATE ai_jobs SET sources_checked=false WHERE id=$1", [
    receiving.job,
  ]);
  await assert.rejects(
    acknowledgeCompletedAssistantHandoff(owner, id, 3),
    status(404),
  );
  await pool.query("UPDATE ai_jobs SET sources_checked=true WHERE id=$1", [
    receiving.job,
  ]);
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [owner]);
  await assert.rejects(
    acknowledgeCompletedAssistantHandoff(owner, id, 3),
    status(404),
  );
});

test("unaccepted and cancelled handoffs cannot acknowledge work", async () => {
  const owner = await person();
  const producing = await producer(owner);
  const id = await createRequestedAssistantHandoff(
    owner,
    await request(owner, producing.job),
  );
  await assert.rejects(
    acknowledgeCompletedAssistantHandoff(owner, id, 1),
    status(409),
  );
  await pool.query(
    "UPDATE assistant_handoffs SET status='cancelled',revision=revision+1 WHERE id=$1",
    [id],
  );
  await assert.rejects(
    acknowledgeCompletedAssistantHandoff(owner, id, 2),
    status(409),
  );
});

test("producer revision includes outcome changes but excludes presence writes", async () => {
  const owner = await person();
  const { job } = await producer(owner);
  const first = await handoffProducerEvidence(pool, owner, job);
  await pool.query(
    "UPDATE ai_jobs SET heartbeat_at=now(),last_polled_at=now() WHERE id=$1",
    [job],
  );
  assert.deepEqual(await handoffProducerEvidence(pool, owner, job), first);
  await pool.query("UPDATE ai_jobs SET apply_result=$2 WHERE id=$1", [
    job,
    { changed: true },
  ]);
  assert.notEqual(
    (await handoffProducerEvidence(pool, owner, job)).source.revision,
    first.source.revision,
  );
});

test("concurrent explicit requests deduplicate without creating receiving jobs", async () => {
  const owner = await person();
  const { job } = await producer(owner);
  const input = await request(owner, job);
  const ids = await Promise.all([
    createRequestedAssistantHandoff(owner, input),
    createRequestedAssistantHandoff(owner.toUpperCase(), {
      ...input,
      producer_job_id: input.producer_job_id.toUpperCase(),
    }),
  ]);
  assert.equal(ids[0], ids[1]);
  const row = (
    await pool.query("SELECT * FROM assistant_handoffs WHERE id=$1", [ids[0]])
  ).rows[0];
  assert.equal(row.status, "proposed");
  assert.equal(row.recipient_job_id, null);
  assert.equal(row.delivery_attempts, 0);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM ai_jobs WHERE user_id=$1",
        [owner],
      )
    ).rows[0].count,
    1,
  );
  await assert.rejects(
    createRequestedAssistantHandoff(owner, {
      ...input,
      instruction: "A different action.",
    }),
    status(409),
  );
});

test("stale outcomes and wrong receiving lanes cannot mint proposals", async () => {
  const owner = await person();
  const { job } = await producer(owner);
  const input = await request(owner, job);
  await assert.rejects(
    createRequestedAssistantHandoff(owner, {
      ...input,
      recipient_lane: "overnight",
    }),
    status(400),
  );
  await pool.query("UPDATE ai_jobs SET result=$2 WHERE id=$1", [
    job,
    { answer: "Updated outcome." },
  ]);
  await assert.rejects(
    createRequestedAssistantHandoff(owner, input),
    status(409),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM assistant_handoffs WHERE owner_id=$1",
        [owner],
      )
    ).rows[0].count,
    0,
  );
});

test("current project exclusion, job source checks and owner revocation apply before replay", async () => {
  const owner = await person();
  const other = await person();
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name) VALUES($1,'Handoff source') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const { job } = await producer(owner, project);
  const input = await request(owner, job);
  await createRequestedAssistantHandoff(owner, input);
  await assert.rejects(
    createRequestedAssistantHandoff(other, input),
    status(404),
  );
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    project,
  ]);
  await assert.rejects(
    createRequestedAssistantHandoff(owner, input),
    status(404),
  );
  await pool.query("UPDATE projects SET assistant_off=false WHERE id=$1", [
    project,
  ]);
  await pool.query("UPDATE ai_jobs SET sources_checked=false WHERE id=$1", [
    job,
  ]);
  await assert.rejects(handoffProducerEvidence(pool, owner, job), status(404));
  await pool.query("UPDATE ai_jobs SET sources_checked=true WHERE id=$1", [
    job,
  ]);
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [owner]);
  await assert.rejects(
    createRequestedAssistantHandoff(owner, input),
    status(404),
  );
});

test("deleted source containers and interactive or incomplete jobs provide no evidence", async () => {
  const owner = await person();
  const { job, chat } = await producer(owner);
  await pool.query("UPDATE ai_jobs SET state='waiting' WHERE id=$1", [job]);
  await assert.rejects(handoffProducerEvidence(pool, owner, job), status(404));
  await pool.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [job]);
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [chat]);
  await assert.rejects(handoffProducerEvidence(pool, owner, job), status(404));
  const interactive = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,state,sources_checked) VALUES($1,'done',true) RETURNING id",
      [owner],
    )
  ).rows[0].id;
  await assert.rejects(
    handoffProducerEvidence(pool, owner, interactive),
    status(404),
  );
});

test("reciprocal follow-ups preserve their acknowledged chain and cannot reset its depth", async () => {
  const owner = await person();
  const original = await producer(owner);
  const root = await createRequestedAssistantHandoff(
    owner,
    await request(owner, original.job),
  );
  let parent = root;
  for (let depth = 1; depth <= 4; depth++) {
    const row = (
      await pool.query(
        "SELECT recipient_lane FROM assistant_handoffs WHERE id=$1",
        [parent],
      )
    ).rows[0];
    const receiving = await producer(owner, null, row.recipient_lane, "queued");
    await pool.query(
      "UPDATE assistant_handoffs SET revision=revision+1,delivery_attempts=1 WHERE id=$1",
      [parent],
    );
    await pool.query(
      "UPDATE assistant_handoffs SET revision=revision+1,status='accepted',recipient_job_id=$2 WHERE id=$1",
      [parent, receiving.job],
    );
    await pool.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [
      receiving.job,
    ]);
    const input = await request(owner, receiving.job);
    await assert.rejects(
      createRequestedAssistantHandoff(owner, input),
      status(409),
    );
    assert.deepEqual(
      await acknowledgeCompletedAssistantHandoff(owner, parent, 3),
      {
        kind: "job",
        id: receiving.job,
        revision: input.expected_producer_revision,
      },
    );
    if (depth === 4) {
      await assert.rejects(
        createRequestedAssistantHandoff(owner, input),
        status(409),
      );
    } else {
      const child = await createRequestedAssistantHandoff(owner, input);
      const receipt = (
        await pool.query(
          "SELECT root_id,parent_id,depth FROM assistant_handoffs WHERE id=$1",
          [child],
        )
      ).rows[0];
      assert.deepEqual(receipt, { root_id: root, parent_id: parent, depth });
      parent = child;
    }
  }
  assert.equal(
    (
      await pool.query(
        "SELECT receipt_count FROM assistant_handoff_chains WHERE id=$1",
        [root],
      )
    ).rows[0].receipt_count,
    4,
  );
});

test("flattened source dependencies are rechecked even when the source chat remains visible", async () => {
  const owner = await person();
  const original = await producer(owner);
  const before = await handoffProducerEvidence(pool, owner, original.job);
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name) VALUES($1,'Evidence project') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,project_id,title) VALUES($1,$2,'Source evidence') RETURNING id",
      [owner, project],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [original.job, doc],
  );
  const input = await request(owner, original.job);
  assert.notEqual(input.expected_producer_revision, before.source.revision);
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    project,
  ]);
  await assert.rejects(
    createRequestedAssistantHandoff(owner, input),
    status(404),
  );
});
