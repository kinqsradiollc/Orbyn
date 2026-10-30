import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { helpers, trapNetwork } from "./mcp-helpers.js";
import { runtimeOutcome } from "../src/modules/ai/agent/outcome.js";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { buildApiService } = await import("../src/app.js");
const {
  goalExecutionRoutes,
  goalExecutionDigest,
  readGoalExecution,
  assertGoalExecutionCurrent,
} = await import("../src/modules/assistant-workspace/goal-executions.js");
const app = await buildApiService();
if (!app.hasRoute({ method: "POST", url: "/me/goals/:id/executions" }))
  await goalExecutionRoutes(app);
const h = helpers(app),
  network = await trapNetwork(),
  owners: string[] = [];
before(() => migrate());
after(async () => {
  network.restore();
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
  assert.deepEqual(network.calls, []);
});
async function fixture() {
  const person = await h.register("goal-execution");
  owners.push(person.id);
  await assistantPrincipal({
    id: person.id,
    name: person.name,
    role: "member",
  });
  const goal = (
    await pool.query(
      "INSERT INTO goals(user_id,title,target) VALUES($1,'Reviewed goal','Produce a useful result') RETURNING id,revision",
      [person.id],
    )
  ).rows[0];
  const input = {
    request_id: randomUUID(),
    expected_goal_revision: goal.revision,
    criteria: [
      {
        id: randomUUID(),
        text: "The result answers the question",
        kind: "person",
      },
    ],
    lane: "background",
    effect_ceiling: "existing_scopes",
    limits: {
      max_attempts: 4,
      token_limit: 1000,
      deadline: new Date(Date.now() + 86400000).toISOString(),
    },
  };
  const request = (
    method: string,
    url: string,
    payload?: unknown,
    token = person.token,
  ) =>
    app.inject({
      method: method as "GET" | "POST",
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    });
  const started = await request(
    "POST",
    `/me/goals/${goal.id}/executions`,
    input,
  );
  assert.equal(started.statusCode, 201, started.body);
  return { person, goal, input, request, execution: started.json() };
}
async function resultFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const row = (await readGoalExecution(pool, f.person.id, f.execution.id))!;
  const chat = randomUUID(),
    job = randomUUID(),
    turn = randomUUID(),
    attempt = randomUUID();
  const receipt = runtimeOutcome({ jobId: job, chatId: chat, turnId: turn });
  const result = {
    answer: "Private reviewed result",
    chat_id: chat,
    turn_id: turn,
    assistant_run: { execution_outcome: receipt },
  };
  await transaction(async (db) => {
    await db.query(
      "INSERT INTO ai_chats(id,user_id,title) VALUES($1,$2,'Goal result')",
      [chat, f.person.id],
    );
    await db.query(
      "INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,sources_checked,run_state,result) VALUES($1,$2,$3,$4,'queued',true,$5,$6)",
      [
        job,
        f.person.id,
        chat,
        turn,
        {
          version: 1,
          request: { automation: { kind: "goal", id: f.goal.id } },
        },
        result,
      ],
    );
    await db.query(
      "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'goal',$2)",
      [job, f.goal.id],
    );
    await db.query(
      "UPDATE ai_jobs SET state='done',terminal_evidence=$2 WHERE id=$1",
      [
        job,
        {
          version: 1,
          job_id: job,
          cause: "finished",
          effects: "none",
          retry: "never",
          observed_at: new Date().toISOString(),
        },
      ],
    );
    await db.query(
      `INSERT INTO assistant_goal_attempts(id,execution_id,owner_id,unit_id,ordinal,mode,relation,job_id,generation,input_frontier_revision,allocated_tokens,settled_tokens,state,result_digest,settled_at,processed_at) VALUES($1,$2,$3,$4,1,'work','initial',$5,1,1,20,10,'done',$6,now(),now())`,
      [
        attempt,
        row.id,
        f.person.id,
        row.units[0].id,
        job,
        goalExecutionDigest(result),
      ],
    );
    const units = row.units.map((u) => ({
      ...u,
      stage: "ready_for_acceptance",
      last_attempt_id: attempt,
      outputs: [
        {
          kind: "response",
          id: `${chat}:${turn}`,
          version: goalExecutionDigest(result),
          producer_job_id: job,
          receipt_digest: goalExecutionDigest(result),
        },
      ],
    }));
    await db.query(
      "UPDATE assistant_goal_executions SET state='awaiting_acceptance',units=$2,attempt_count=1,consumed_tokens=10,evidence_revision=1,revision=revision+1 WHERE id=$1",
      [row.id, JSON.stringify(units)],
    );
  });
  const details = (
    await f.request("GET", `/me/goal-executions/${row.id}`)
  ).json();
  return { job, chat, turn, attempt, result, details };
}
const control = (details: any, extra: Record<string, unknown> = {}) => ({
  request_id: randomUUID(),
  expected_revision: details.revision,
  generation: details.generation,
  ...extra,
});

test("explicit starts and controls are idempotent, revisioned and preserve planner/check-in intent", async () => {
  const f = await fixture(),
    path = `/me/goal-executions/${f.execution.id}`;
  assert.equal(f.execution.visibility, "available");
  assert.equal(f.execution.units[0].effects_applied, false);
  assert.equal(f.execution.can_accept, false);
  const again = await f.request(
    "POST",
    `/me/goals/${f.goal.id}/executions`,
    f.input,
  );
  assert.equal(again.statusCode, 201, again.body);
  assert.equal(again.json().id, f.execution.id);
  const changed = await f.request("POST", `/me/goals/${f.goal.id}/executions`, {
    ...f.input,
    effect_ceiling: "suggest",
  });
  assert.equal(changed.statusCode, 409);
  const duplicate = await f.request(
    "POST",
    `/me/goals/${f.goal.id}/executions`,
    { ...f.input, request_id: randomUUID() },
  );
  assert.equal(duplicate.statusCode, 409);
  const pause = control(f.execution),
    paused = await f.request("POST", `${path}/pause`, pause);
  assert.equal(paused.statusCode, 200, paused.body);
  assert.equal(paused.json().admissions_paused, true);
  const replay = await f.request("POST", `${path}/pause`, pause);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().revision, paused.json().revision);
  const stale = await f.request("POST", `${path}/stop`, control(f.execution));
  assert.equal(stale.statusCode, 409);
  const wrong = await f.request(
    "POST",
    `${path}/resume`,
    control(paused.json(), { expected_config_hash: "0".repeat(64) }),
  );
  assert.equal(wrong.statusCode, 409);
  const resumed = await f.request(
    "POST",
    `${path}/resume`,
    control(paused.json(), { expected_config_hash: f.execution.config_hash }),
  );
  assert.equal(resumed.statusCode, 200, resumed.body);
  await pool.query("UPDATE goals SET progress=$2 WHERE id=$1", [
    f.goal.id,
    { summary: "Worker progress" },
  ]);
  const row = (await readGoalExecution(pool, f.person.id, f.execution.id))!;
  await assertGoalExecutionCurrent(pool, f.person.id, row);
  await pool.query(
    "UPDATE agent_grants SET approval_scopes=$2 WHERE user_id=$1 AND kind='assistant'",
    [f.person.id, { tasks: { scope: "goal", id: f.goal.id } }],
  );
  await assertGoalExecutionCurrent(pool, f.person.id, row);
  const stopBody = control(resumed.json()),
    stopped = await f.request("POST", `${path}/stop`, stopBody);
  assert.equal(stopped.statusCode, 200, stopped.body);
  assert.equal(stopped.json().state, "stopped");
  assert.equal(stopped.json().generation, row.generation + 1);
  assert.equal(
    (await f.request("POST", `${path}/stop`, stopBody)).statusCode,
    200,
  );
  assert.equal(
    (await pool.query("SELECT status FROM goals WHERE id=$1", [f.goal.id]))
      .rows[0].status,
    "active",
  );
  assert.equal(
    (
      await pool.query("SELECT id FROM goals_checkins WHERE goal_id=$1", [
        f.goal.id,
      ])
    ).rowCount,
    0,
  );
});

test("owner reads are bounded and revoked sources return only restricted metadata", async () => {
  const f = await fixture(),
    r = await resultFixture(f),
    path = `/me/goal-executions/${f.execution.id}`;
  assert.equal(r.details.can_accept, true);
  const other = await h.register("goal-foreign");
  owners.push(other.id);
  assert.equal(
    (await f.request("GET", path, undefined, other.token)).statusCode,
    404,
  );
  assert.equal(
    (await f.request("GET", `/me/goals/${f.goal.id}/executions?limit=21`))
      .statusCode,
    422,
  );
  const page = await f.request(
    "GET",
    `/me/goals/${f.goal.id}/executions?limit=1`,
  );
  assert.equal(page.statusCode, 200);
  assert.equal(page.json().executions.length, 1);
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [r.job, randomUUID()],
  );
  const hidden = await f.request("GET", path);
  assert.equal(hidden.statusCode, 200, hidden.body);
  assert.equal(hidden.json().visibility, "restricted");
  for (const field of [
    "criteria",
    "units",
    "result",
    "current_job_id",
    "acceptance",
  ])
    assert.equal(hidden.json()[field], undefined);
  assert.ok(!hidden.body.includes(r.job));
  assert.ok(!hidden.body.includes("Private reviewed result"));
  const history = await f.request("GET", `${path}/attempts`);
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.json().attempts[0].visibility, "restricted");
  assert.equal(history.json().attempts[0].job_id, undefined);
});

test("only the signed-in person can accept fresh complete evidence; goal done never manufactures acceptance", async () => {
  const f = await fixture(),
    r = await resultFixture(f),
    path = `/me/goal-executions/${f.execution.id}`;
  const input = control(r.details, {
    expected_criteria_hash: r.details.criteria_hash,
    expected_evidence_hash: r.details.evidence_hash,
    accepted_criterion_ids: f.input.criteria.map((c) => c.id),
  });
  const key = await f.request("POST", "/me/api-keys", {
    name: "Goal acceptance denial fixture",
  });
  assert.equal(key.statusCode, 201, key.body);
  const denied = await f.request(
    "POST",
    `${path}/accept`,
    input,
    key.json().key,
  );
  assert.equal(denied.statusCode, 403, denied.body);
  assert.equal(
    (
      await f.request("POST", `${path}/accept`, {
        ...input,
        expected_evidence_hash: "0".repeat(64),
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.request("POST", `${path}/accept`, {
        ...input,
        accepted_criterion_ids: [randomUUID()],
      })
    ).statusCode,
    422,
  );
  await pool.query("UPDATE goals SET status='done' WHERE id=$1", [f.goal.id]);
  assert.equal((await f.request("GET", path)).json().acceptance, null);
  const accepted = await f.request("POST", `${path}/accept`, input);
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().state, "completed");
  assert.equal(accepted.json().acceptance.kind, "person");
  assert.equal(accepted.json().units[0].stage, "satisfied");
  const replay = await f.request("POST", `${path}/accept`, input);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().acceptance.id, accepted.json().acceptance.id);
  assert.equal(
    (await f.request("GET", `/me/goals/${f.goal.id}/checkins`)).json().length,
    0,
  );
});

test("questions, failed checks, uncertainty, criteria changes and exhausted allowance fail closed", async () => {
  const f = await fixture(),
    r = await resultFixture(f),
    path = `/me/goal-executions/${f.execution.id}`;
  for (const problem of ["question", "check", "uncertain"]) {
    const receipt = structuredClone(r.result.assistant_run.execution_outcome);
    if (problem === "question")
      receipt.open_questions = ["Unanswered question"];
    if (problem === "check")
      receipt.checks = [
        { id: "required", title: "Required check", status: "not_run" },
      ];
    if (problem === "uncertain") {
      receipt.outcome = "uncertain";
      receipt.reason = "dispatch_uncertain";
    }
    const changedResult = {
      ...r.result,
      assistant_run: { execution_outcome: receipt },
    };
    await pool.query("UPDATE ai_jobs SET result=$2 WHERE id=$1", [
      r.job,
      changedResult,
    ]);
    await pool.query(
      "UPDATE assistant_goal_attempts SET result_digest=$2 WHERE id=$1",
      [r.attempt, goalExecutionDigest(changedResult)],
    );
    await pool.query(
      "UPDATE assistant_goal_executions SET units=$2 WHERE id=$1",
      [
        f.execution.id,
        JSON.stringify(
          r.details.units.map((u: any) => ({
            ...u,
            outputs: u.outputs.map((out: any) => ({
              ...out,
              version: goalExecutionDigest(changedResult),
              receipt_digest: goalExecutionDigest(changedResult),
            })),
          })),
        ),
      ],
    );
    const details = (await f.request("GET", path)).json();
    assert.equal(details.visibility, "available");
    assert.equal(details.can_accept, false, problem);
    assert.equal(
      (
        await f.request(
          "POST",
          `${path}/accept`,
          control(details, {
            expected_criteria_hash: details.criteria_hash,
            expected_evidence_hash: details.evidence_hash,
            accepted_criterion_ids: f.input.criteria.map((c) => c.id),
          }),
        )
      ).statusCode,
      409,
    );
  }
  await pool.query("UPDATE ai_jobs SET result=$2 WHERE id=$1", [
    r.job,
    r.result,
  ]);
  await pool.query(
    "UPDATE assistant_goal_attempts SET result_digest=$2 WHERE id=$1",
    [r.attempt, goalExecutionDigest(r.result)],
  );
  await pool.query(
    "UPDATE assistant_goal_executions SET units=$2 WHERE id=$1",
    [f.execution.id, JSON.stringify(r.details.units)],
  );
  await pool.query(
    "UPDATE goals SET target='Changed requirement' WHERE id=$1",
    [f.goal.id],
  );
  assert.equal((await f.request("GET", path)).json().can_accept, false);
  const fresh = await fixture();
  await pool.query(
    "UPDATE assistant_goal_executions SET consumed_tokens=1000 WHERE id=$1",
    [fresh.execution.id],
  );
  const row = (await readGoalExecution(
    pool,
    fresh.person.id,
    fresh.execution.id,
  ))!;
  await assert.rejects(
    assertGoalExecutionCurrent(pool, fresh.person.id, row, { admit: true }),
    /allowance/,
  );
});
