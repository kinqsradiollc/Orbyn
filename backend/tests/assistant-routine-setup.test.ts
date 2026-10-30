import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { helpers, trapNetwork } from "./mcp-helpers.js";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApiService } = await import("../src/app.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { setupAgentRoutine } =
  await import("../src/modules/assistant-workspace/routine-setup.js");
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

async function fixture(withGrant = true) {
  const person = await h.register("routine-setup");
  owners.push(person.id);
  if (withGrant) await assistantPrincipal({ ...person, role: "member" });
  const call = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    payload?: unknown,
    token: string | null = person.token,
  ) => h.call(token, method, path, payload);
  const context = async () => {
    const response = await call("GET", "/me/agent-routines/setup-context");
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const input = async (allow_changes: string[] = []) => ({
    request_id: randomUUID(),
    expected_snapshot: (await context()).snapshot,
    routine: {
      instruction: "Review my saved task notes",
      rrule: "FREQ=DAILY",
      timezone: "UTC",
      next_run_at: new Date(Date.now() + 86400000).toISOString(),
      paused: false,
    },
    allow_changes,
  });
  const scopes = async () =>
    (
      await pool.query(
        "SELECT approval_scopes FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
        [person.id],
      )
    ).rows[0]?.approval_scopes;
  return { person, call, context, input, scopes };
}

test("routine setup is first-party and context never creates assistant authority", async () => {
  const f = await fixture(false);
  // A registration must not be assumed to mint an assistant grant.
  await pool.query(
    "DELETE FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
    [f.person.id],
  );
  const context = await f.context();
  assert.equal(context.can_preauthorize, false);
  assert.deepEqual(context.approval_scopes, {});
  assert.equal(context.max_run_tokens, 200000);
  assert.match(context.snapshot, /^[a-f0-9]{64}$/);
  assert.equal(await f.scopes(), undefined);
  const key = await f.call("POST", "/me/api-keys", {
    name: "Setup denial fixture",
  });
  assert.equal(key.statusCode, 201, key.body);
  const input = await f.input();
  for (const [method, path, payload] of [
    ["GET", "/me/agent-routines/setup-context", undefined],
    ["POST", "/me/agent-routines/setup", input],
  ] as const) {
    assert.equal((await f.call(method, path, payload, null)).statusCode, 401);
    assert.equal(
      (await f.call(method, path, payload, key.json().key)).statusCode,
      403,
    );
  }
  const disallowed = await f.call("POST", "/me/agent-routines/setup", {
    ...input,
    allow_changes: ["tasks"],
  });
  assert.equal(disallowed.statusCode, 409, disallowed.body);
  const saved = await f.call("POST", "/me/agent-routines/setup", input);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(await f.scopes(), undefined);
});

test("routine setup replaces only selected categories and serializes stale concurrent snapshots", async () => {
  const f = await fixture(),
    previousRoutine = randomUUID();
  const original = {
    tasks: "always",
    pages: { scope: "routine", id: previousRoutine },
    memory: "always",
  };
  await pool.query(
    "UPDATE agent_grants SET approval_scopes=$2 WHERE user_id=$1 AND kind='assistant'",
    [f.person.id, original],
  );
  const first = await f.input(["tasks", "sessions"]),
    second = { ...first, request_id: randomUUID() };
  const responses = await Promise.all([
    f.call("POST", "/me/agent-routines/setup", first),
    f.call("POST", "/me/agent-routines/setup", second),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
  const routine = responses.find((r) => r.statusCode === 200)!.json();
  assert.deepEqual(await f.scopes(), {
    ...original,
    tasks: { scope: "routine", id: routine.id },
    sessions: { scope: "routine", id: routine.id },
  });
  assert.equal(
    (
      await pool.query("SELECT id FROM agent_routines WHERE user_id=$1", [
        f.person.id,
      ])
    ).rowCount,
    1,
  );
});

test("routine setup request replay survives lost response, never regrants, and retains deletion tombstones", async () => {
  const f = await fixture(),
    input = await f.input(["pages"]);
  const responses = await Promise.all([
    f.call("POST", "/me/agent-routines/setup", input),
    f.call("POST", "/me/agent-routines/setup", input),
  ]);
  for (const response of responses)
    assert.equal(response.statusCode, 200, response.body);
  const id = responses[0].json().id;
  assert.equal(responses[1].json().id, id);
  await pool.query(
    "UPDATE agent_grants SET approval_scopes='{}' WHERE user_id=$1 AND kind='assistant'",
    [f.person.id],
  );
  const renamed = await f.call("PUT", `/me/agent-routines/${id}`, {
    instruction: "Updated by the person",
  });
  assert.equal(renamed.statusCode, 200, renamed.body);
  const replay = await f.call("POST", "/me/agent-routines/setup", input);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().instruction, "Updated by the person");
  assert.deepEqual(await f.scopes(), {});
  assert.equal(
    (
      await f.call("POST", "/me/agent-routines/setup", {
        ...input,
        allow_changes: ["tasks"],
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await f.call("DELETE", `/me/agent-routines/${id}`)).statusCode,
    200,
  );
  assert.equal(
    (await f.call("POST", "/me/agent-routines/setup", input)).statusCode,
    410,
  );
  const receipt = (
    await pool.query(
      "SELECT * FROM assistant_routine_setup_receipts WHERE owner_id=$1",
      [f.person.id],
    )
  ).rows;
  assert.equal(receipt.length, 1);
  assert.equal(receipt[0].routine_id, null);
  assert.equal(Object.hasOwn(receipt[0], "instruction"), false);
  assert.equal(
    (
      await pool.query("SELECT id FROM agent_routines WHERE user_id=$1", [
        f.person.id,
      ])
    ).rowCount,
    0,
  );
});

test("routine setup keeps routine, selected permissions and receipt invisible until one commit and rolls back together", async () => {
  const f = await fixture(),
    input = await f.input(["tasks"]),
    sentinel = new Error("rollback fixture");
  await assert.rejects(
    transaction(async (db) => {
      const routine = await setupAgentRoutine(db, f.person.id, input);
      assert.equal(
        (
          await pool.query("SELECT id FROM agent_routines WHERE id=$1", [
            routine.id,
          ])
        ).rowCount,
        0,
      );
      assert.deepEqual(await f.scopes(), {});
      assert.equal(
        (
          await pool.query(
            "SELECT request_id FROM assistant_routine_setup_receipts WHERE owner_id=$1",
            [f.person.id],
          )
        ).rowCount,
        0,
      );
      throw sentinel;
    }),
    (error) => error === sentinel,
  );
  assert.equal(
    (
      await pool.query("SELECT id FROM agent_routines WHERE user_id=$1", [
        f.person.id,
      ])
    ).rowCount,
    0,
  );
  assert.deepEqual(await f.scopes(), {});
  assert.equal(
    (
      await pool.query(
        "SELECT request_id FROM assistant_routine_setup_receipts WHERE owner_id=$1",
        [f.person.id],
      )
    ).rowCount,
    0,
  );
  const saved = await f.call("POST", "/me/agent-routines/setup", input);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(await f.scopes(), {
    tasks: { scope: "routine", id: saved.json().id },
  });
});

test("routine setup snapshots current grant authority and permits no-permission setup while paused", async () => {
  const f = await fixture(),
    stale = await f.input(["tasks"]);
  await pool.query(
    "UPDATE agent_grants SET suspended_at=now() WHERE user_id=$1 AND kind='assistant'",
    [f.person.id],
  );
  assert.equal(
    (await f.call("POST", "/me/agent-routines/setup", stale)).statusCode,
    409,
  );
  assert.equal((await f.context()).can_preauthorize, false);
  const paused = await f.input(["tasks"]);
  assert.equal(
    (await f.call("POST", "/me/agent-routines/setup", paused)).statusCode,
    409,
  );
  const saved = await f.call("POST", "/me/agent-routines/setup", {
    ...paused,
    allow_changes: [],
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(await f.scopes(), {});
  await pool.query(
    "UPDATE agent_grants SET suspended_at=NULL,trust='suggest' WHERE user_id=$1 AND kind='assistant'",
    [f.person.id],
  );
  assert.equal((await f.context()).can_preauthorize, false);
});

test("routine setup validation is strict, canonical save failures leave no grants, and legacy creation stays compatible", async () => {
  const f = await fixture(),
    input = await f.input(["tasks"]);
  for (const changed of [
    { ...input, allow_changes: ["tasks", "tasks"] },
    { ...input, allow_changes: ["unknown"] },
    { ...input, project_id: randomUUID() },
    { ...input, routine: { ...input.routine, allow_changes: ["pages"] } },
    { ...input, routine: { ...input.routine, timezone: "Not/A_Timezone" } },
  ]) {
    const response = await f.call("POST", "/me/agent-routines/setup", changed);
    assert.ok([400, 422].includes(response.statusCode), response.body);
  }
  assert.deepEqual(await f.scopes(), {});
  assert.equal(
    (
      await pool.query(
        "SELECT request_id FROM assistant_routine_setup_receipts WHERE owner_id=$1",
        [f.person.id],
      )
    ).rowCount,
    0,
  );
  const legacy = await f.call("POST", "/me/agent-routines", input.routine);
  assert.equal(legacy.statusCode, 201, legacy.body);
  assert.equal(Object.hasOwn(legacy.json(), "allow_changes"), false);
  assert.deepEqual(await f.scopes(), {});
});

test("setup captures explicit per-attempt bounds atomically without enabling recovery or expanding scopes", async () => {
  const f = await fixture();
  const input = {
    ...(await f.input()),
    run_limits: { token_limit: 1234, active_work_minutes: 1 },
  };
  const response = await f.call("POST", "/me/agent-routines/setup", input);
  assert.equal(response.statusCode, 200, response.body);
  const saved = response.json();
  const row = (
    await pool.query(
      "SELECT run_limits,retry_policy FROM agent_routines WHERE id=$1 AND user_id=$2",
      [saved.id, f.person.id],
    )
  ).rows[0];
  assert.deepEqual(row.run_limits, input.run_limits);
  assert.equal(row.retry_policy?.enabled ?? false, false);
  assert.deepEqual(await f.scopes(), {});
  const repeated = await f.call("POST", "/me/agent-routines/setup", input);
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal(repeated.json().id, saved.id);
  const changed = await f.call("POST", "/me/agent-routines/setup", {
    ...input,
    run_limits: { token_limit: 1235, active_work_minutes: 1 },
  });
  assert.equal(changed.statusCode, 409, changed.body);
  for (const limits of [
    { token_limit: 200001, active_work_minutes: 1 },
    { token_limit: 1234, active_work_minutes: 11 },
  ]) {
    const invalid = await f.call("POST", "/me/agent-routines/setup", {
      ...input,
      request_id: randomUUID(),
      run_limits: limits,
    });
    assert.ok([400, 422].includes(invalid.statusCode), invalid.body);
  }
});

test("background admission captures initial attempt bounds independently of retry opt-in", async () => {
  const { scanAssistantRoutines } =
    await import("../src/worker/assistant-routines.js");
  const { readRoutineRunLimits } =
    await import("../src/modules/assistant-workspace/routine-run-limits.js");
  for (const run_limits of [
    undefined,
    { token_limit: 1234, active_work_minutes: 1 },
  ]) {
    const f = await fixture();
    const input = {
      ...(await f.input()),
      ...(run_limits ? { run_limits } : {}),
    };
    const created = await f.call("POST", "/me/agent-routines/setup", input);
    assert.equal(created.statusCode, 200, created.body);
    const saved = created.json();
    let captured:
      | Parameters<
          typeof import("../src/modules/ai/agent/run.js").startAssistantAutomation
        >[0]
      | undefined;
    const result = await scanAssistantRoutines(
      new Date(Date.parse(input.routine.next_run_at) + 1),
      {
        only: [f.person.id],
        ai: {} as import("../src/modules/ai/providers/adapters.js").ResolvedAi,
        startAutomation: async (command) => {
          captured = command;
          return null;
        },
      },
    );
    assert.equal(
      result,
      0,
      "Read-only injected admission deliberately queues no job",
    );
    assert.ok(captured);
    const effective = run_limits ?? {
      token_limit: 200000,
      active_work_minutes: 10,
    };
    assert.equal(captured.automation.token_budget, effective.token_limit);
    assert.equal(
      captured.automation.max_active_work_ms,
      effective.active_work_minutes * 60000,
    );
    assert.equal(captured.automation.routine_recovery, undefined);
    assert.equal(captured.automation.end_at, undefined);
    assert.deepEqual(
      await readRoutineRunLimits(pool, f.person.id, saved.id),
      effective,
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
  }
});
