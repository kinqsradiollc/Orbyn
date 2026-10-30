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
const { startAssistantAutomation } =
  await import("../src/modules/ai/agent/run.js");
const { recordRoutineRun } =
  await import("../src/modules/assistant-workspace/routine-runs.js");
const { saveAgentRoutine } =
  await import("../src/modules/assistant-workspace/routines.js");
const {
  prepareRoutineRecovery,
  assertRoutineRecoveryCurrent,
  readRoutineRecovery,
} = await import("../src/modules/assistant-workspace/routine-recovery.js");
const { settleRoutineRecoveries } =
  await import("../src/worker/routine-recovery.js");
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
  const person = await h.register("routine-recovery-domain");
  owners.push(person.id);
  await assistantPrincipal({
    id: person.id,
    name: person.name,
    role: "member",
  });
  const routine = (
    await pool.query(
      "INSERT INTO agent_routines(user_id,instruction,rrule,next_run_at) VALUES($1,'Read my saved notes','FREQ=DAILY',now()+interval '1 day') RETURNING id,next_run_at::text AS scheduled_for",
      [person.id],
    )
  ).rows[0];
  const request = (
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
    token = person.token,
  ) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    });
  const policyPath = `/me/agent-routines/${routine.id}/retry-policy`;
  const enable = async () => {
    const response = await request("PUT", policyPath, {
      request_id: randomUUID(),
      expected_revision: 1,
      policy: {
        enabled: true,
        max_attempts: 3,
        token_limit: 1000,
        max_elapsed_minutes: 180,
        backoff_seconds: 5,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  return { person, routine, request, policyPath, enable };
}
async function admission(
  f: Awaited<ReturnType<typeof fixture>>,
  final = false,
) {
  await f.enable();
  const prepared = await transaction((db) =>
    prepareRoutineRecovery(
      db,
      f.person.id,
      f.routine.id,
      "background",
      f.routine.scheduled_for,
      { nextScheduledFor: final ? null : new Date(Date.now() + 86400000) },
    ),
  );
  assert.ok(prepared);
  const job = await startAssistantAutomation({
    userId: f.person.id,
    message: prepared.instruction,
    timezone: "UTC",
    automation: {
      kind: "routine",
      id: f.routine.id,
      routine_recovery: prepared.binding,
      token_budget: prepared.allocation,
      end_at: prepared.deadline,
    },
    onQueued: async (db, job) => {
      if (final)
        await db.query("UPDATE agent_routines SET paused=true WHERE id=$1", [
          f.routine.id,
        ]);
      await recordRoutineRun(
        db,
        f.person.id,
        f.routine.id,
        f.routine.scheduled_for,
        job,
        prepared,
      );
    },
  });
  assert.ok(job);
  const path = `/me/agent-routines/${f.routine.id}/runs/${prepared.occurrence_id}`;
  const check = () =>
    transaction(async (db) => {
      await db.query("SELECT id FROM ai_jobs WHERE id=$1 FOR UPDATE", [job]);
      return assertRoutineRecoveryCurrent(db, f.person.id, prepared.binding, {
        jobId: job,
        write: true,
      });
    });
  return { prepared, job, path, check };
}
test("routine retry policy is default off, first-party, versioned and idempotent without changing legacy DTOs", async () => {
  const f = await fixture(),
    initial = await f.request("GET", f.policyPath);
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().policy.enabled, false);
  assert.equal(initial.json().revision, 1);
  assert.equal(
    await transaction((db) =>
      prepareRoutineRecovery(
        db,
        f.person.id,
        f.routine.id,
        "background",
        f.routine.scheduled_for,
        { nextScheduledFor: null },
      ),
    ),
    null,
  );
  const key = await f.request("POST", "/me/api-keys", {
    name: "Routine retry denial fixture",
  });
  assert.equal(key.statusCode, 201, key.body);
  assert.equal(
    (await f.request("GET", f.policyPath, undefined, key.json().key))
      .statusCode,
    403,
  );
  const input = {
    request_id: randomUUID(),
    expected_revision: 1,
    policy: { enabled: true },
  };
  assert.equal(
    (await f.request("PUT", f.policyPath, input, key.json().key)).statusCode,
    403,
  );
  const saved = await f.request("PUT", f.policyPath, input);
  assert.equal(saved.statusCode, 200, saved.body);
  const replay = await f.request("PUT", f.policyPath, input);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().revision, saved.json().revision);
  assert.equal(
    (
      await f.request("PUT", f.policyPath, {
        ...input,
        policy: { enabled: false },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.request("PUT", f.policyPath, {
        ...input,
        request_id: randomUUID(),
      })
    ).statusCode,
    409,
  );
  const intentBefore = (
    await pool.query(
      "SELECT recovery_intent_version FROM agent_routines WHERE id=$1",
      [f.routine.id],
    )
  ).rows[0].recovery_intent_version;
  const unchangedInput = {
    request_id: randomUUID(),
    expected_revision: saved.json().revision,
    policy: saved.json().policy,
  };
  const unchanged = await f.request("PUT", f.policyPath, unchangedInput);
  assert.equal(unchanged.statusCode, 200, unchanged.body);
  assert.equal(unchanged.json().revision, saved.json().revision);
  const unchangedRow = (
    await pool.query(
      "SELECT recovery_intent_version,retry_policy_last_control FROM agent_routines WHERE id=$1",
      [f.routine.id],
    )
  ).rows[0];
  assert.equal(unchangedRow.recovery_intent_version, intentBefore);
  assert.equal(
    unchangedRow.retry_policy_last_control.id,
    unchangedInput.request_id,
  );
  const unchangedReplay = await f.request("PUT", f.policyPath, unchangedInput);
  assert.equal(unchangedReplay.statusCode, 200, unchangedReplay.body);
  assert.equal(unchangedReplay.json().revision, saved.json().revision);
  assert.equal(
    (
      await f.request("PUT", f.policyPath, {
        ...unchangedInput,
        request_id: randomUUID(),
        expected_revision: initial.json().revision,
      })
    ).statusCode,
    409,
  );
  const list = await f.request("GET", "/me/agent-routines");
  assert.equal(list.statusCode, 200, list.body);
  assert.ok(
    !("retry_policy" in list.json().find((r: any) => r.id === f.routine.id)),
  );
  assert.equal(
    (
      await f.request("PUT", `/me/agent-routines/${f.routine.id}`, {
        retry_policy: { enabled: true },
      })
    ).statusCode,
    422,
  );
});
test("final scheduled occurrence survives scheduler pause but manual intent invalidates its exact job binding", async () => {
  const f = await fixture(),
    r = await admission(f, true);
  const current = await r.check();
  assert.equal(current.schedule_exhausted, true);
  assert.equal(current.reserved_tokens, r.prepared.allocation);
  const details = await f.request("GET", `${r.path}/recovery`);
  assert.equal(details.statusCode, 200, details.body);
  assert.equal(details.json().visibility, "available");
  await transaction((db) =>
    saveAgentRoutine(db, f.person.id, f.routine.id, { paused: true }),
  );
  await assert.rejects(r.check, /changed/);
  // Even disabled policy preparation must reject an obsolete scheduler claim.
  await pool.query("UPDATE agent_routines SET retry_policy=NULL WHERE id=$1", [
    f.routine.id,
  ]);
  await assert.rejects(
    transaction((db) =>
      prepareRoutineRecovery(
        db,
        f.person.id,
        f.routine.id,
        "background",
        f.routine.scheduled_for,
        {
          nextScheduledFor: null,
          expectedIntentVersion: r.prepared.intent_version,
        },
      ),
    ),
    /changed/,
  );
});
test("recovery detail hides revoked or pruned evidence and owner-authorizes occurrence access", async () => {
  const f = await fixture(),
    r = await admission(f),
    other = await h.register("routine-recovery-other");
  owners.push(other.id);
  await pool.query("UPDATE ai_jobs SET result=$2 WHERE id=$1", [
    r.job,
    { answer: "Private routine recovery evidence" },
  ]);
  assert.equal(
    (await f.request("GET", `${r.path}/recovery`, undefined, other.token))
      .statusCode,
    404,
  );
  const visible = await f.request("GET", `${r.path}/recovery`);
  assert.equal(visible.statusCode, 200, visible.body);
  assert.ok(visible.body.includes("Private routine recovery evidence"));
  await pool.query("UPDATE ai_jobs SET sources_checked=false WHERE id=$1", [
    r.job,
  ]);
  const hidden = await f.request("GET", `${r.path}/recovery`);
  assert.equal(hidden.statusCode, 200, hidden.body);
  assert.equal(hidden.json().visibility, "restricted");
  assert.ok(!hidden.body.includes(r.job));
  assert.ok(!hidden.body.includes("Private routine recovery evidence"));
  assert.ok(!("attempts" in hidden.json()));
  await assert.rejects(r.check, /sources/);
  await pool.query("DELETE FROM ai_jobs WHERE id=$1", [r.job]);
  const pruned = await f.request("GET", `${r.path}/recovery`);
  assert.equal(pruned.statusCode, 200, pruned.body);
  assert.equal(pruned.json().visibility, "restricted");
  assert.equal(pruned.json().reserved_tokens, r.prepared.allocation);
});
async function secondAttempt(
  f: Awaited<ReturnType<typeof fixture>>,
  r: Awaited<ReturnType<typeof admission>>,
) {
  const terminal = {
    version: 1,
    job_id: r.job,
    cause: "provider_transient",
    effects: "none",
    retry: "eligible",
    observed_at: new Date().toISOString(),
  };
  await transaction(async (db) => {
    await db.query(
      "UPDATE ai_jobs SET state='failed',terminal_evidence=$2 WHERE id=$1",
      [r.job, terminal],
    );
    await db.query(
      "UPDATE assistant_routine_attempts SET settled_at=now(),settled_tokens=10,terminal_evidence=$2 WHERE id=$1",
      [r.prepared.attempt_id, terminal],
    );
    await db.query(
      "UPDATE assistant_routine_runs SET recovery_state='retry_scheduled',consumed_tokens=10,reserved_tokens=0,next_eligible_at=now(),revision=revision+1 WHERE id=$1",
      [r.prepared.occurrence_id],
    );
  });
  const attempt = randomUUID(),
    job = await startAssistantAutomation({
      userId: f.person.id,
      message: r.prepared.instruction,
      timezone: "UTC",
      automation: {
        kind: "routine",
        id: f.routine.id,
        routine_recovery: {
          occurrence_id: r.prepared.occurrence_id,
          attempt_id: attempt,
          generation: 1,
          ordinal: 2,
        },
        token_budget: 20,
        end_at: r.prepared.deadline,
      },
      onQueued: async (db, job) => {
        await db.query(
          "INSERT INTO assistant_routine_attempts(id,occurrence_id,owner_id,ordinal,parent_attempt_id,job_id,generation,allocated_tokens) VALUES($1,$2,$3,2,$4,$5,1,20)",
          [
            attempt,
            r.prepared.occurrence_id,
            f.person.id,
            r.prepared.attempt_id,
            job,
          ],
        );
        await db.query(
          "UPDATE assistant_routine_runs SET recovery_state='active',attempt_count=2,reserved_tokens=20,next_eligible_at=NULL,revision=revision+1 WHERE id=$1",
          [r.prepared.occurrence_id],
        );
      },
    });
  assert.ok(job);
  return { attempt, job };
}
test("occurrence Stop fences every admitted attempt, replays safely and settles cumulative accounting once", async () => {
  const f = await fixture(),
    r = await admission(f),
    next = await secondAttempt(f, r),
    before = (await readRoutineRecovery(
      pool,
      f.person.id,
      r.prepared.occurrence_id,
    ))!;
  const input = {
    request_id: randomUUID(),
    expected_revision: before.revision,
    generation: before.generation,
  };
  const stopped = await f.request("POST", `${r.path}/stop`, input);
  assert.equal(stopped.statusCode, 200, stopped.body);
  assert.equal(stopped.json().state, "stopped");
  assert.equal(stopped.json().generation, 2);
  assert.equal(stopped.json().attempt_count, 2);
  const job = (
    await pool.query(
      "SELECT state,cancel_requested,cancel_reason,terminal_evidence FROM ai_jobs WHERE id=$1",
      [next.job],
    )
  ).rows[0];
  assert.equal(job.cancel_requested, true);
  assert.equal(job.cancel_reason, "stopped");
  assert.equal(job.terminal_evidence.cause, "stopped");
  assert.equal(job.state, "done");
  const replay = await f.request("POST", `${r.path}/stop`, input);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().generation, 2);
  await settleRoutineRecoveries("background", new Date(), [f.person.id]);
  const settled = (await readRoutineRecovery(
    pool,
    f.person.id,
    r.prepared.occurrence_id,
  ))!;
  assert.equal(settled.reserved_tokens, 0);
  assert.ok(settled.consumed_tokens >= 10);
  await settleRoutineRecoveries("background", new Date(), [f.person.id]);
  assert.equal(
    (await readRoutineRecovery(pool, f.person.id, r.prepared.occurrence_id))!
      .consumed_tokens,
    settled.consumed_tokens,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT job_id FROM assistant_routine_runs WHERE id=$1",
        [r.prepared.occurrence_id],
      )
    ).rows[0].job_id,
    r.job,
  );
});
test("occurrence snapshots, predecessor and settled accounting remain immutable under attempted rewrites", async () => {
  const f = await fixture(),
    r = await admission(f);
  await secondAttempt(f, r);
  await assert.rejects(
    pool.query("UPDATE assistant_routine_runs SET job_id=$2 WHERE id=$1", [
      r.prepared.occurrence_id,
      randomUUID(),
    ]),
    /identity/,
  );
  await assert.rejects(
    pool.query(
      "UPDATE assistant_routine_runs SET config_hash='changed' WHERE id=$1",
      [r.prepared.occurrence_id],
    ),
    /identity/,
  );
  await assert.rejects(
    pool.query(
      "UPDATE assistant_routine_runs SET consumed_tokens=0 WHERE id=$1",
      [r.prepared.occurrence_id],
    ),
    /accounting/,
  );
  await assert.rejects(
    pool.query(
      "UPDATE assistant_routine_runs SET attempt_count=6 WHERE id=$1",
      [r.prepared.occurrence_id],
    ),
    /check constraint/,
  );
  await assert.rejects(
    pool.query(
      "UPDATE assistant_routine_attempts SET settled_tokens=11 WHERE id=$1",
      [r.prepared.attempt_id],
    ),
    /accounting/,
  );
  await assert.rejects(
    pool.query(
      "UPDATE assistant_routine_attempts SET parent_attempt_id=$2 WHERE occurrence_id=$1 AND ordinal=2",
      [r.prepared.occurrence_id, randomUUID()],
    ),
    /identity/,
  );
});
