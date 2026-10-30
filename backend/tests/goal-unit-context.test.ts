import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { helpers, trapNetwork } from "./mcp-helpers.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApiService } = await import("../src/app.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { scanGoalExecutions } = await import("../src/worker/goal-executions.js");
const app = await buildApiService(),
  h = helpers(app),
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
  const person = await h.register("goal-unit-context");
  owners.push(person.id);
  await assistantPrincipal({ ...person, role: "member" });
  const request = (
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
  ) => h.call(person.token, method, url, payload);
  const goalResponse = await request("POST", "/me/goals", {
    title: "Live qualification — target supplied separately",
    target:
      "Fictional source: The paper kite is blue. Read only this sentence; do not change any workspace records.",
  });
  assert.equal(goalResponse.statusCode, 201, goalResponse.body);
  const goal = goalResponse.json();
  const criterion = {
    id: randomUUID(),
    kind: "person",
    text: "Read the supplied fictional sentence and return its colour in one line without workspace changes.",
  };
  const created = await request("POST", `/me/goals/${goal.id}/executions`, {
    request_id: randomUUID(),
    expected_goal_revision: goal.revision,
    criteria: [criterion],
    lane: "background",
    effect_ceiling: "suggest",
    limits: {
      max_attempts: 1,
      token_limit: 20000,
      deadline: new Date(Date.now() + 300000).toISOString(),
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  return { person, request, goal, criterion, execution: created.json() };
}
test("real bound goal job receives current authorized title/target even when criterion contains no source text", async () => {
  const f = await fixture();
  assert.equal(f.criterion.text.includes("paper kite"), false);
  assert.equal(
    await scanGoalExecutions("background", new Date(), {
      only: [f.person.id],
      ai: {} as import("../src/modules/ai/providers/adapters.js").ResolvedAi,
    }),
    1,
  );
  const rows = (
    await pool.query(
      "SELECT j.id,j.user_id,j.runtime_lane,j.state,j.run_state,j.work_source_kind,j.work_source_id,a.unit_id FROM assistant_goal_attempts a JOIN ai_jobs j ON j.id=a.job_id WHERE a.execution_id=$1 AND a.owner_id=$2",
      [f.execution.id, f.person.id],
    )
  ).rows;
  assert.equal(rows.length, 1);
  const job = rows[0];
  assert.equal(job.state, "queued");
  assert.equal(job.runtime_lane, "background");
  assert.equal(job.work_source_kind, "goal");
  assert.equal(job.work_source_id, f.goal.id);
  const request = job.run_state.request;
  assert.ok(request.message.includes(f.goal.title));
  assert.ok(request.message.includes(f.goal.target));
  assert.ok(request.message.includes(f.criterion.text));
  assert.ok(
    request.message.includes("selected criterion remains this unit's scope"),
  );
  assert.equal(request.automation.goal_execution.id, f.execution.id);
  assert.equal(request.automation.goal_execution.unit_id, job.unit_id);
  assert.equal(request.automation.goal_execution.criterion_id, f.criterion.id);
  assert.equal(request.automation.goal_execution.effect_ceiling, "suggest");
});
test("changing target after criteria capture holds admission without exposing the new context or queueing work", async () => {
  const f = await fixture();
  const changed = await f.request("PUT", `/me/goals/${f.goal.id}`, {
    expected_revision: f.goal.revision,
    target: "Changed target: this context was not captured by the execution.",
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(
    await scanGoalExecutions("background", new Date(), {
      only: [f.person.id],
      ai: {} as import("../src/modules/ai/providers/adapters.js").ResolvedAi,
    }),
    0,
  );
  const current = await f.request(
    "GET",
    `/me/goal-executions/${f.execution.id}`,
  );
  assert.equal(current.statusCode, 200, current.body);
  assert.equal(current.json().state, "held");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM assistant_goal_attempts WHERE execution_id=$1",
        [f.execution.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM ai_jobs WHERE user_id=$1",
        [f.person.id],
      )
    ).rows[0].n,
    0,
  );
});
