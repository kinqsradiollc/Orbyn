import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";
const { buildApp } = await import("../src/app.js");
const { migrate } = await import("../src/db/migrate.js");
const { pool } = await import("../src/db/pool.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { createAgentProposal } =
  await import("../src/modules/proposals/service.js");
const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();
const users: string[] = [];
before(async () => {
  await migrate();
});
after(async () => {
  assert.deepEqual(network.calls, []);
  network.restore();
  await app.close();
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await pool.end();
});
async function person() {
  const user = await h.register("night-review");
  users.push(user.id);
  return user;
}
async function held(user: Person, nightId?: string) {
  const principal = await assistantPrincipal({
    id: user.id,
    name: user.name,
    role: "member",
  });
  const job = `plan_${randomUUID()}`;
  const steps = ["first", "second"].map((id) => ({
    id,
    tool: "create_tasks",
    args: { tasks: [{ title: `${job} ${id}` }] },
  }));
  const proposal = await createAgentProposal(pool, {
    userId: user.id,
    grantId: principal.grant_id!,
    clientName: "Orbyn",
    summary: "Night tasks",
    changes: [
      {
        type: "action",
        action: "plan.apply",
        target_id: null,
        title: "Night tasks",
        team_id: null,
        headline: "Night tasks",
        rows: [],
        input: {
          grant_id: principal.grant_id,
          job,
          summary: "Night tasks",
          steps,
        },
      },
    ],
  });
  const night =
    nightId ??
    (
      await pool.query(
        "INSERT INTO assistant_nights(user_id, local_day, status, runs) VALUES($1, '2050-01-01', 'done', 1) RETURNING id",
        [user.id],
      )
    ).rows[0].id;
  const queued = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id, state, result) VALUES($1, 'done', $2::jsonb) RETURNING id",
      [
        user.id,
        JSON.stringify({
          assistant_run: {
            outcome: "pending",
            proposal_id: `proposal:${proposal.id}`,
          },
        }),
      ],
    )
  ).rows[0].id;
  const run = (
    await pool.query(
      "INSERT INTO assistant_night_runs(night_id, job_id, kind, summary) VALUES($1, $2, 'handed', 'Prepared two tasks') RETURNING id",
      [night, queued],
    )
  ).rows[0].id;
  return { run, night, proposal: proposal.id, job };
}
test("only the signed-in owner can read or decide night work; malformed choices and bursts are refused", async () => {
  const me = await person();
  const other = await person();
  const fixture = await held(me);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/me/assistant/nights/runs/${fixture.run}/keep`,
        headers: {
          authorization: `Bearer ${me.token}`,
          "content-type": "application/json",
        },
        payload: "{",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await h.call(null, "GET", "/me/assistant/nights/latest")).statusCode,
    401,
  );
  assert.equal(
    (await h.call(other.token, "GET", "/me/assistant/nights/latest")).json(),
    null,
  );
  assert.equal(
    (
      await h.call(
        other.token,
        "POST",
        `/me/assistant/nights/runs/${fixture.run}/keep`,
        {},
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await h.call(
        me.token,
        "POST",
        `/me/assistant/nights/runs/${fixture.run}/keep`,
        { steps: [] },
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await h.call(
        me.token,
        "POST",
        "/me/assistant/nights/runs/not-a-uuid/keep",
        {},
      )
    ).statusCode,
    422,
  );
  const key = (
    await h.call(me.token, "POST", "/me/api-keys", { name: "Night test" })
  ).json().key;
  assert.equal(
    (await h.call(key, "GET", "/me/assistant/nights/latest")).statusCode,
    403,
  );
  const statuses: number[] = [];
  for (let n = 0; n < 31; n++)
    statuses.push(
      (
        await app.inject({
          method: "POST",
          url: `/me/assistant/nights/runs/${randomUUID()}/undo`,
          headers: { authorization: `Bearer ${me.token}` },
          payload: {},
          remoteAddress: "10.98.0.1",
        })
      ).statusCode,
    );
  assert.ok(statuses.includes(429));
});
test("selected held plan steps apply once and can be undone through the run after a fresh read", async () => {
  const me = await person();
  const fixture = await held(me);
  const before = await h.call(me.token, "GET", "/me/assistant/nights/latest");
  assert.match(
    before.json().runs[0].steps[0].title,
    new RegExp(`${fixture.job} first`),
  );
  assert.match(
    before.json().runs[0].steps[1].title,
    new RegExp(`${fixture.job} second`),
  );
  const kept = await h.call(
    me.token,
    "POST",
    `/me/assistant/nights/runs/${fixture.run}/keep`,
    { steps: ["first"] },
  );
  assert.equal(kept.statusCode, 200, kept.body);
  assert.equal(kept.json().status, "partly");
  const tasks = (
    await pool.query("SELECT title FROM items WHERE user_id = $1", [me.id])
  ).rows;
  assert.deepEqual(
    tasks.map((row) => row.title),
    [`${fixture.job} first`],
  );
  const latest = await h.call(me.token, "GET", "/me/assistant/nights/latest");
  assert.equal(
    new Date(latest.json().runs[0].proposal.expires_at).getTime() -
      new Date(latest.json().runs[0].proposal.created_at).getTime(),
    3 * 86400000,
  );
  assert.equal(latest.json().runs[0].status, "partly");
  const undone = await h.call(
    me.token,
    "POST",
    `/me/assistant/nights/runs/${fixture.run}/undo`,
    {},
  );
  assert.equal(undone.statusCode, 200, undone.body);
  assert.equal(undone.json().status, "undone");
  assert.equal(
    (await pool.query("SELECT 1 FROM items WHERE user_id = $1", [me.id]))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await h.call(
        me.token,
        "POST",
        `/me/assistant/nights/runs/${fixture.run}/undo`,
        {},
      )
    ).statusCode,
    200,
  );
});
test("partial activity Undo preserves other changes and rejects changes from another run", async () => {
  const me = await person();
  const fixture = await held(me);
  const kept = await h.call(
    me.token,
    "POST",
    `/me/assistant/nights/runs/${fixture.run}/keep`,
    {},
  );
  assert.equal(kept.statusCode, 200, kept.body);
  const changes = kept
    .json()
    .changes.filter((change: { undoable: boolean }) => change.undoable);
  assert.equal(changes.length, 2);
  const rejected = await h.call(
    me.token,
    "POST",
    `/me/assistant/nights/runs/${fixture.run}/undo`,
    { changes: ["999999999"] },
  );
  assert.equal(rejected.statusCode, 404, rejected.body);
  const undone = await h.call(
    me.token,
    "POST",
    `/me/assistant/nights/runs/${fixture.run}/undo`,
    { changes: [changes[0].id] },
  );
  assert.equal(undone.statusCode, 200, undone.body);
  assert.equal(undone.json().status, "partly");
  assert.equal(
    (await pool.query("SELECT 1 FROM items WHERE user_id = $1", [me.id]))
      .rowCount,
    1,
  );
});
test("bulk Keep rolls back earlier applications if another run expired; bulk Undo declines held work", async () => {
  const me = await person();
  const first = await held(me);
  const second = await held(me, first.night);
  await pool.query(
    "UPDATE proposals SET expires_at = now() - interval '1 second' WHERE id = $1",
    [first.proposal],
  );
  const keep = await h.call(
    me.token,
    "POST",
    `/me/assistant/nights/${first.night}/keep-all`,
    {},
  );
  assert.equal(keep.statusCode, 409, keep.body);
  assert.equal(
    (await pool.query("SELECT 1 FROM items WHERE user_id = $1", [me.id]))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query("SELECT status FROM proposals WHERE id = $1", [
        second.proposal,
      ])
    ).rows[0].status,
    "pending",
  );
  const undo = await h.call(
    me.token,
    "POST",
    `/me/assistant/nights/${first.night}/undo-all`,
    {},
  );
  assert.equal(undo.statusCode, 200, undo.body);
  assert.ok(
    undo
      .json()
      .runs.every((run: { status: string }) => run.status === "undone"),
  );
});

test("choosing a dependent plan step alone is refused without applying anything", async () => {
  const me = await person();
  const fixture = await held(me);
  const start = new Date(Date.now() + 86400000).toISOString();
  const end = new Date(Date.now() + 90000000).toISOString();
  const row = (
    await pool.query("SELECT changes FROM proposals WHERE id = $1", [
      fixture.proposal,
    ])
  ).rows[0];
  row.changes[0].input.steps[1] = {
    id: "second",
    tool: "book_sessions",
    args: {
      sessions: [{ task: "$first.ids[0]", start_at: start, end_at: end }],
    },
  };
  await pool.query("UPDATE proposals SET changes = $2::jsonb WHERE id = $1", [
    fixture.proposal,
    JSON.stringify(row.changes),
  ]);
  const response = await h.call(
    me.token,
    "POST",
    `/me/assistant/nights/runs/${fixture.run}/keep`,
    { steps: ["second"] },
  );
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(
    (await pool.query("SELECT 1 FROM items WHERE user_id = $1", [me.id]))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM assistant_night_runs WHERE id = $1",
        [fixture.run],
      )
    ).rows[0].status,
    "pending",
  );
});

test("Overnight exposes saved person questions only while the owned run is waiting", async () => {
  const user = await person();
  const fixture = await held(user);
  await pool.query(
    "UPDATE ai_jobs SET state='waiting',run_state=$2 WHERE id=(SELECT job_id FROM assistant_night_runs WHERE id=$1)",
    [
      fixture.run,
      JSON.stringify({
        state: {
          waiting: {
            kind: "person",
            question: "Which notes should I use?",
            choices: ["Lecture 1", "Lecture 2"],
          },
        },
      }),
    ],
  );
  const read = await h.call(user.token, "GET", "/me/assistant/nights/latest");
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json().runs[0].question, {
    text: "Which notes should I use?",
    choices: ["Lecture 1", "Lecture 2"],
  });
  await pool.query(
    "UPDATE ai_jobs SET state='done' WHERE id=(SELECT job_id FROM assistant_night_runs WHERE id=$1)",
    [fixture.run],
  );
  const done = await h.call(user.token, "GET", "/me/assistant/nights/latest");
  assert.equal(done.json().runs[0].question, null);
});

test("Overnight exposes live approval summaries and clears them after the decision", async () => {
  const user = await person();
  const fixture = await held(user);
  await pool.query(
    "UPDATE ai_jobs SET state='waiting',run_state=$2 WHERE id=(SELECT job_id FROM assistant_night_runs WHERE id=$1)",
    [
      fixture.run,
      JSON.stringify({
        state: {
          waiting: {
            kind: "approval",
            question: "Apply this plan?",
            summary: "Two sessions",
            detail: "Your approval is needed",
            steps: [],
          },
        },
      }),
    ],
  );
  const read = await h.call(user.token, "GET", "/me/assistant/nights/latest");
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json().runs[0].approval, {
    text: "Apply this plan?",
    summary: "Two sessions",
    detail: "Your approval is needed",
  });
  assert.equal(read.json().runs[0].question, null);
  await pool.query(
    "UPDATE ai_jobs SET state='done' WHERE id=(SELECT job_id FROM assistant_night_runs WHERE id=$1)",
    [fixture.run],
  );
  const done = await h.call(user.token, "GET", "/me/assistant/nights/latest");
  assert.equal(done.json().runs[0].approval, null);
});
