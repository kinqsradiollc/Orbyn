import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import {
  routineRecovery,
  routineRetryPolicyPage,
  assistantRoutineRunsPage,
  type RoutineRecovery,
  type RoutineRetryPolicy,
} from "@orbyn/core";
import { startTestAssistantRuntime } from "./helpers/assistant-runtime.js";
import { runtimeOutcome } from "../src/modules/ai/agent/outcome.js";

type Request = {
  messages?: { role: string; content: string | null }[];
  tools?: { function?: { name?: string } }[];
};
type Script = {
  mode: "fail" | "finish" | "create" | "question";
  calls: number;
  title: string;
  beforeFinish?: () => Promise<void>;
};
const scripts = new Map<string, Script>(),
  providerErrors: string[] = [];
const bodyOf = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
const provider = createServer(async (req, res) => {
  try {
    const body = JSON.parse(await bodyOf(req)) as Request,
      prompt = (body.messages ?? [])
        .map((message) => message.content ?? "")
        .join("\n");
    const marker = [...prompt.matchAll(/RoutineCase:([0-9a-f-]{36})/gi)].at(
      -1,
    )?.[1];
    assert.ok(marker, "Only a marked local routine may reach the fixture");
    const script = scripts.get(marker);
    assert.ok(script);
    script.calls++;
    if (script.mode === "fail") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "Temporary local fixture rejection" },
        }),
      );
      return;
    }
    const names = (body.tools ?? []).map((tool) => tool.function?.name),
      previous = [...(body.messages ?? [])]
        .reverse()
        .find((message) => message.role === "tool");
    let reply: { name: string; arguments: Record<string, unknown> };
    if (script.mode === "question")
      reply = {
        name: "ask_person",
        arguments: {
          question: "Which note should I summarize?",
          choices: ["First", "Second"],
        },
      };
    else if (script.mode === "create" && names.includes("delegate")) {
      if (!previous)
        reply = {
          name: "delegate",
          arguments: {
            tasks: [
              {
                specialist: "projects",
                want_options: false,
                brief: `RoutineCase:${marker} Create exactly one task titled ${script.title}.`,
              },
            ],
          },
        };
      else {
        const reports = JSON.parse(previous.content ?? "[]") as {
          staged_step_ids?: string[];
        }[];
        const steps = reports.flatMap((report) => report.staged_step_ids ?? []);
        assert.equal(steps.length, 1, JSON.stringify(reports));
        const beforeFinish = script.beforeFinish;
        script.beforeFinish = undefined;
        await beforeFinish?.();
        reply = {
          name: "finish",
          arguments: { answer: "Created the one requested task.", steps },
        };
      }
    } else if (script.mode === "create" && names.includes("report")) {
      if (!previous)
        reply = {
          name: "create_tasks",
          arguments: { tasks: [{ title: script.title, kind: "task" }] },
        };
      else {
        const staged = JSON.parse(previous.content ?? "{}");
        assert.ok(staged.step_id);
        reply = {
          name: "report",
          arguments: {
            status: "done",
            summary: "Staged one task.",
            findings: [],
            steps: [staged.step_id],
            open_questions: [],
          },
        };
      }
    } else
      reply = {
        name: "finish",
        arguments: {
          answer: "A concise local routine summary is ready for review.",
          steps: [],
        },
      };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        usage: { prompt_tokens: 17, completion_tokens: 11, total_tokens: 28 },
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: `routine_${script.calls}`,
                  type: "function",
                  function: {
                    name: reply.name,
                    arguments: JSON.stringify(reply.arguments),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  } catch (error) {
    providerErrors.push(String(error));
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Local routine fixture mismatch" }));
  }
});
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApiService } = await import("../src/app.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { scanAssistantRoutines } =
  await import("../src/worker/assistant-routines.js");
const { scanNightShift } = await import("../src/worker/night-shift.js");
const { settleRoutineRecoveries, scanRoutineRetries } =
  await import("../src/worker/routine-recovery.js");
const { stopRoutineRecovery } =
  await import("../src/modules/assistant-workspace/routine-recovery.js");
const { stopAssistantJob } = await import("../src/modules/ai/agent/run.js");
const app = await buildApiService(),
  users: string[] = [];
let providerId: string | undefined,
  original: { provider_id: string | null; model: string },
  stopRuntime: (() => Promise<void>) | undefined,
  address = 0;
const remote = () =>
  `10.78.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;
before(async () => {
  await migrate();
  original = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  const port = (provider.address() as { port: number }).port;
  providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai-compatible','Routine recovery fixture',$1) RETURNING id",
      [`http://127.0.0.1:${port}/v1`],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='routine-recovery-fixture' WHERE id",
    [providerId],
  );
  invalidateSettings();
});
after(async () => {
  await stopRuntime?.();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  if (original)
    await pool.query(
      "UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id",
      [original.provider_id, original.model],
    );
  if (providerId)
    await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  invalidateSettings();
  await app.close();
  await new Promise<void>((resolve, reject) =>
    provider.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
  assert.deepEqual(providerErrors, []);
});
const defaults: RoutineRetryPolicy = {
  enabled: true,
  max_attempts: 3,
  token_limit: 200000,
  max_elapsed_minutes: 180,
  backoff_seconds: 5,
};
async function fixture(
  options: {
    enabled?: boolean;
    policy?: Partial<RoutineRetryPolicy>;
    mode?: Script["mode"];
    final?: boolean;
    upfrontSetup?: boolean;
  } = {},
) {
  const registered = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: remote(),
    payload: {
      email: `routine-recovery-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Routine tester",
    },
  });
  assert.equal(registered.statusCode, 201, registered.body);
  const { user, token } = registered.json();
  users.push(user.id);
  await assistantPrincipal({ id: user.id, name: user.name, role: "member" });
  const request = (
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      remoteAddress: remote(),
      headers: { authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { payload }),
    });
  const marker = randomUUID(),
    script: Script = {
      mode: options.mode ?? "fail",
      calls: 0,
      title: `Routine task ${marker.slice(0, 8)}`,
    };
  scripts.set(marker, script);
  const due = new Date(Date.now() + 2000),
    until = new Date(due.getTime() + 60000)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const routineInput = {
    instruction: `RoutineCase:${marker} ${script.mode === "create" ? "Create exactly one personal task." : "Summarize my saved routine notes."}`,
    rrule: options.final ? `FREQ=DAILY;UNTIL=${until}` : "FREQ=DAILY",
    timezone: "UTC",
    next_run_at: due.toISOString(),
  };
  let made;
  if (options.upfrontSetup) {
    const existing = await request("PUT", "/me/assistant/approval-scopes", {
      pages: "always",
      study: { scope: "goal", id: randomUUID() },
    });
    assert.equal(existing.statusCode, 200, existing.body);
    const context = await request("GET", "/me/agent-routines/setup-context");
    assert.equal(context.statusCode, 200, context.body);
    assert.equal(context.json().can_preauthorize, true);
    made = await request("POST", "/me/agent-routines/setup", {
      request_id: randomUUID(),
      expected_snapshot: context.json().snapshot,
      routine: routineInput,
      allow_changes: ["tasks"],
    });
    assert.equal(made.statusCode, 200, made.body);
    const scopes = await request("GET", "/me/assistant/approval-scopes");
    assert.deepEqual(scopes.json(), {
      ...context.json().approval_scopes,
      tasks: { scope: "routine", id: made.json().id },
    });
  } else {
    made = await request("POST", "/me/agent-routines", routineInput);
    assert.equal(made.statusCode, 201, made.body);
  }
  const routine = made.json();
  if (script.mode === "create" && !options.upfrontSetup) {
    const scopes = await request("PUT", "/me/assistant/approval-scopes", {
      tasks: { scope: "routine", id: routine.id },
    });
    assert.equal(scopes.statusCode, 200, scopes.body);
  }
  const base = await request(
    "GET",
    `/me/agent-routines/${routine.id}/retry-policy`,
  );
  assert.equal(base.statusCode, 200, base.body);
  const initial = routineRetryPolicyPage.parse(base.json());
  assert.equal(initial.policy.enabled, false);
  if (options.enabled !== false) {
    const body = {
      request_id: randomUUID(),
      expected_revision: initial.revision,
      policy: { ...defaults, ...options.policy },
    };
    const saved = await request(
      "PUT",
      `/me/agent-routines/${routine.id}/retry-policy`,
      body,
    );
    assert.equal(saved.statusCode, 200, saved.body);
    const again = await request(
      "PUT",
      `/me/agent-routines/${routine.id}/retry-policy`,
      body,
    );
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().revision, saved.json().revision);
  }
  return { user, token, request, routine, due, script, marker };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function initial(f: Fixture) {
  const counts = await Promise.all([
    scanAssistantRoutines(new Date(f.due.getTime() + 1), { only: [f.user.id] }),
    scanAssistantRoutines(new Date(f.due.getTime() + 1), { only: [f.user.id] }),
  ]);
  assert.equal(
    counts.reduce((sum, count) => sum + count, 0),
    1,
  );
  const runs = (
    await pool.query(
      "SELECT * FROM assistant_routine_runs WHERE routine_id=$1",
      [f.routine.id],
    )
  ).rows;
  assert.equal(runs.length, 1);
  return runs[0] as { id: string; job_id: string; scheduled_for: Date };
}
async function view(f: Fixture, run: string) {
  const response = await f.request(
    "GET",
    `/me/agent-routines/${f.routine.id}/runs/${run}/recovery`,
  );
  assert.equal(response.statusCode, 200, response.body);
  return routineRecovery.parse(response.json());
}
function enabled(value: RoutineRecovery) {
  assert.equal(value.recovery, "enabled");
  if (value.recovery !== "enabled") assert.fail("Expected opted-in occurrence");
  return value;
}
async function waitJob(id: string, wanted = ["done", "failed"]) {
  for (let n = 0; n < 400; n++) {
    const row = (
      await pool.query(
        "SELECT state,result,apply_result,terminal_evidence,run_state,error_message FROM ai_jobs WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (row && wanted.includes(row.state)) return row;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Routine job ${id} did not reach ${wanted.join("/")}`);
}
async function rows(run: string) {
  return (
    await pool.query(
      "SELECT * FROM assistant_routine_attempts WHERE occurrence_id=$1 ORDER BY ordinal",
      [run],
    )
  ).rows;
}
async function failed(f: Fixture) {
  const run = await initial(f);
  stopRuntime = await startTestAssistantRuntime("background");
  const job = await waitJob(run.job_id);
  assert.equal(job.state, "failed", JSON.stringify(job));
  assert.ok(
    f.script.calls >= 2,
    "Runtime exhausts its own provider retries before occurrence recovery",
  );
  await settleRoutineRecoveries("background", new Date(), [f.user.id]);
  return { run, job, recovery: enabled(await view(f, run.id)) };
}
async function stopRuntimeNow() {
  await stopRuntime?.();
  stopRuntime = undefined;
}

async function admitSetup(f: Fixture, lane: "background" | "overnight") {
  if (lane === "background") return initial(f);
  const now = new Date(),
    clock = (date: Date) =>
      `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  const settings = await f.request("PUT", "/me/assistant/night-shift", {
    enabled: true,
    start: clock(new Date(now.getTime() - 3600000)),
    end: clock(new Date(now.getTime() + 3600000)),
    timezone: "UTC",
    kinds: {
      plan: false,
      deadlines: false,
      study: false,
      meetings: false,
      tidy: false,
      handed: false,
      follow_through: true,
      reflection: false,
    },
    wait_for_ok: false,
  });
  assert.equal(settings.statusCode, 200, settings.body);
  await pool.query(
    "UPDATE sessions SET last_seen_at=$2::timestamptz - interval '16 minutes' WHERE user_id=$1",
    [f.user.id, now],
  );
  assert.equal(
    await scanNightShift(new Date(f.due.getTime() + 1), { only: [f.user.id] }),
    1,
  );
  const run = (
    await pool.query(
      "SELECT id,job_id FROM assistant_routine_runs WHERE routine_id=$1",
      [f.routine.id],
    )
  ).rows;
  assert.equal(run.length, 1);
  return run[0] as { id: string; job_id: string };
}

test("upfront setup authorizes one actual scheduled Personal task in Background and Overnight without another approval", async () => {
  for (const lane of ["background", "overnight"] as const) {
    const f = await fixture({
      mode: "create",
      upfrontSetup: true,
      enabled: false,
    });
    const before = (
      await pool.query(
        "SELECT assistant_rules_revision,assistant_rules FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
        [f.user.id],
      )
    ).rows[0];
    const run = await admitSetup(f, lane);
    try {
      stopRuntime = await startTestAssistantRuntime(lane);
      const done = await waitJob(run.job_id, ["done", "failed", "waiting"]);
      assert.equal(done.state, "done", JSON.stringify(done));
      assert.equal(done.apply_result?.applied, true, JSON.stringify(done));
      assert.equal(done.apply_result.structured.status, "done");
      assert.match(done.apply_result.structured.job, /^plan_/);
      assert.equal(done.apply_result.structured.pending, null);
      assert.equal(done.terminal_evidence.effects, "applied");
      assert.equal(
        done.run_state,
        null,
        "Finished jobs prune their live plan state",
      );
      const items = (
        await pool.query(
          "SELECT id,team_id,user_id FROM items WHERE user_id=$1 AND title=$2",
          [f.user.id, f.script.title],
        )
      ).rows;
      assert.equal(items.length, 1);
      assert.equal(items[0].team_id, null);
      const identity = (
        await pool.query(
          "SELECT runtime_lane,work_source_kind,work_source_id,chat_id,turn_id,sources_checked FROM ai_jobs WHERE id=$1 AND user_id=$2",
          [run.job_id, f.user.id],
        )
      ).rows[0];
      assert.equal(identity.runtime_lane, lane);
      assert.equal(identity.work_source_kind, "routine");
      assert.equal(identity.work_source_id, f.routine.id);
      assert.ok(
        identity.chat_id && identity.turn_id && identity.sources_checked,
      );
      const sources = (
        await pool.query(
          "SELECT source_kind,source_id FROM assistant_job_sources WHERE job_id=$1 AND source_kind='routine' AND source_id=$2",
          [run.job_id, f.routine.id],
        )
      ).rows;
      assert.equal(sources.length, 1);
      const activity = (
        await pool.query(
          "SELECT target_ids,request_id FROM agent_activity WHERE user_id=$1 AND tool='apply_plan' AND request_id=$2",
          [f.user.id, done.apply_result.structured.job],
        )
      ).rows;
      assert.equal(activity.length, 1);
      assert.equal(activity[0].request_id, done.apply_result.structured.job);
      assert.ok(JSON.stringify(activity[0].target_ids).includes(items[0].id));
      assert.equal(
        (
          await pool.query(
            "SELECT request_id FROM assistant_routine_setup_receipts WHERE owner_id=$1 AND routine_id=$2",
            [f.user.id, f.routine.id],
          )
        ).rowCount,
        1,
      );
      assert.deepEqual(
        (
          await pool.query(
            "SELECT assistant_rules_revision,assistant_rules FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
            [f.user.id],
          )
        ).rows[0],
        before,
      );
      const scopes = (
        await f.request("GET", "/me/assistant/approval-scopes")
      ).json();
      assert.equal(scopes.pages, "always");
      assert.equal(scopes.study.scope, "goal");
      assert.deepEqual(scopes.tasks, { scope: "routine", id: f.routine.id });
      assert.equal(
        f.script.calls,
        4,
        "Delegate, stage, report and finish: no permission/replanning round",
      );
    } finally {
      await stopRuntimeNow();
    }
  }
});

test("upfront setup respects current ask rules added before accepted-plan apply", async () => {
  const f = await fixture({
    mode: "create",
    upfrontSetup: true,
    enabled: false,
  });
  const run = await admitSetup(f, "background");
  f.script.beforeFinish = async () => {
    const current = (await f.request("GET", "/me/assistant/rules")).json();
    const changed = await f.request("PUT", "/me/assistant/rules", {
      expected_revision: current.revision,
      rules: [
        ...current.rules,
        {
          id: randomUUID(),
          lane: "background",
          action: "create",
          scope: { kind: "personal" },
          decision: "ask",
        },
      ],
    });
    assert.equal(changed.statusCode, 200, changed.body);
  };
  try {
    stopRuntime = await startTestAssistantRuntime("background");
    const held = await waitJob(run.job_id, ["waiting", "done", "failed"]);
    assert.equal(held.state, "failed", JSON.stringify(held));
    assert.equal(held.apply_result, null);
    assert.equal(held.terminal_evidence.effects, "none");
    assert.deepEqual(
      (await f.request("GET", "/me/assistant/approval-scopes")).json().tasks,
      { scope: "routine", id: f.routine.id },
    );
    assert.equal(
      (
        await pool.query("SELECT id FROM items WHERE user_id=$1 AND title=$2", [
          f.user.id,
          f.script.title,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT id FROM agent_activity WHERE user_id=$1 AND tool='apply_plan'",
          [f.user.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await stopRuntimeNow();
  }
});

test("upfront setup does not bypass Stop after a real plan is staged and before any effect", async () => {
  const f = await fixture({
    mode: "create",
    upfrontSetup: true,
    enabled: false,
  });
  const run = await admitSetup(f, "background");
  f.script.beforeFinish = async () => {
    assert.equal(await stopAssistantJob(run.job_id, f.user, app.log), true);
  };
  try {
    stopRuntime = await startTestAssistantRuntime("background");
    const stopped = await waitJob(run.job_id);
    assert.equal(stopped.apply_result, null);
    assert.equal(stopped.terminal_evidence.cause, "stopped");
    assert.equal(stopped.terminal_evidence.effects, "none");
    assert.equal(
      (
        await pool.query("SELECT id FROM items WHERE user_id=$1 AND title=$2", [
          f.user.id,
          f.script.title,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT id FROM agent_activity WHERE user_id=$1 AND tool='apply_plan'",
          [f.user.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await stopRuntimeNow();
  }
});

test("a real transient failure retries one same occurrence after backoff; concurrent scans and settlement are idempotent", async () => {
  const f = await fixture();
  try {
    const { run, job, recovery } = await failed(f);
    assert.equal(job.terminal_evidence.cause, "provider_transient");
    assert.equal(job.terminal_evidence.effects, "none");
    assert.equal(job.terminal_evidence.retry, "eligible");
    assert.equal(recovery.state, "retry_scheduled", recovery.reason);
    assert.ok(recovery.next_retry_at);
    const schedule = (
      await pool.query("SELECT next_run_at FROM agent_routines WHERE id=$1", [
        f.routine.id,
      ])
    ).rows[0].next_run_at.toISOString();
    assert.equal(
      await scanRoutineRetries(
        "background",
        new Date(new Date(recovery.next_retry_at).getTime() - 1),
        { only: [f.user.id] },
      ),
      0,
    );
    f.script.mode = "finish";
    const at = new Date(recovery.next_retry_at);
    assert.equal(
      (
        await Promise.all([
          scanRoutineRetries("background", at, { only: [f.user.id] }),
          scanRoutineRetries("background", at, { only: [f.user.id] }),
        ])
      ).reduce((sum, count) => sum + count, 0),
      1,
    );
    const attempts = await rows(run.id);
    assert.equal(attempts.length, 2);
    assert.notEqual(attempts[0].job_id, attempts[1].job_id);
    assert.equal(attempts[1].parent_attempt_id, attempts[0].id);
    assert.equal((await waitJob(attempts[1].job_id)).state, "done");
    await Promise.all([
      settleRoutineRecoveries("background", new Date(), [f.user.id]),
      settleRoutineRecoveries("background", new Date(), [f.user.id]),
    ]);
    const done = enabled(await view(f, run.id));
    assert.equal(done.state, "completed", done.reason);
    assert.equal(done.attempt_count, 2);
    assert.equal(done.reserved_tokens, 0);
    assert.equal(
      done.consumed_tokens,
      (await rows(run.id)).reduce((sum, row) => sum + row.settled_tokens, 0),
    );
    assert.equal(
      (
        await pool.query("SELECT next_run_at FROM agent_routines WHERE id=$1", [
          f.routine.id,
        ])
      ).rows[0].next_run_at.toISOString(),
      schedule,
      "Retries never advance the authored schedule twice",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM assistant_routine_runs WHERE routine_id=$1",
          [f.routine.id],
        )
      ).rows[0].n,
      1,
    );
    const old = await f.request(
      "GET",
      `/me/agent-routines/${f.routine.id}/runs?limit=10`,
    );
    const legacy = assistantRoutineRunsPage.parse(old.json());
    assert.equal(
      legacy.runs[0].job_id,
      run.job_id,
      "The old strict history keeps the initial producer contract",
    );
    assert.equal(
      await scanRoutineRetries("background", at, { only: [f.user.id] }),
      0,
    );
  } finally {
    await stopRuntimeNow();
  }
});

test("default-off routines keep the legacy occurrence contract and never gain retry attempts", async () => {
  const f = await fixture({ enabled: false });
  const run = await initial(f);
  stopRuntime = await startTestAssistantRuntime("background");
  try {
    assert.equal((await waitJob(run.job_id)).state, "failed");
    await settleRoutineRecoveries("background", new Date(), [f.user.id]);
    assert.equal((await view(f, run.id)).recovery, "legacy");
    assert.equal((await rows(run.id)).length, 0);
    assert.equal(
      await scanRoutineRetries("background", new Date(Date.now() + 60000), {
        only: [f.user.id],
      }),
      0,
    );
  } finally {
    await stopRuntimeNow();
  }
});

test("synthetic unsafe or missing terminal evidence cannot authorize a fresh occurrence attempt", async () => {
  for (const kind of [
    "applied",
    "pending",
    "uncertain",
    "missing",
    "malformed",
    "token_cap",
  ] as const) {
    const f = await fixture();
    const run = await initial(f);
    const state = (
      await pool.query("SELECT chat_id,turn_id FROM ai_jobs WHERE id=$1", [
        run.job_id,
      ])
    ).rows[0];
    const terminal = {
      version: 1,
      job_id: run.job_id,
      cause:
        kind === "uncertain"
          ? "provider_dispatch_uncertain"
          : "provider_transient",
      effects:
        kind === "missing" || kind === "malformed" || kind === "token_cap"
          ? "none"
          : kind,
      retry:
        kind === "uncertain"
          ? "reconcile"
          : kind === "applied" || kind === "pending"
            ? "never"
            : "eligible",
      observed_at: new Date().toISOString(),
    };
    await pool.query(
      "UPDATE ai_jobs SET state='failed',sources_checked=true,result=$2::jsonb,terminal_evidence=$3::jsonb WHERE id=$1",
      [
        run.job_id,
        {
          chat_id: state.chat_id,
          turn_id: state.turn_id,
          assistant_run: {
            token_estimate: kind === "token_cap" ? defaults.token_limit : 1,
            execution_outcome: runtimeOutcome({
              jobId: run.job_id,
              chatId: state.chat_id,
              turnId: state.turn_id,
              failed: true,
            }),
          },
        },
        kind === "missing"
          ? null
          : kind === "malformed"
            ? { ...terminal, effects: "uncertain", retry: "eligible" }
            : terminal,
      ],
    );
    await settleRoutineRecoveries("background", new Date(), [f.user.id]);
    const held = enabled(await view(f, run.id));
    assert.equal(
      held.state,
      kind === "token_cap" ? "limited" : "held",
      `${kind}: ${held.reason}`,
    );
    assert.equal(
      await scanRoutineRetries("background", new Date(Date.now() + 60000), {
        only: [f.user.id],
      }),
      0,
    );
    assert.equal((await rows(run.id)).length, 1);
    assert.equal(f.script.calls, 0);
  }
});

test("policy changes and routine edits hold a previously qualified retry without replaying its work", async () => {
  for (const change of ["policy", "instruction"]) {
    const f = await fixture();
    try {
      const { run, recovery } = await failed(f);
      assert.equal(recovery.state, "retry_scheduled", recovery.reason);
      if (change === "policy") {
        const page = (
          await f.request(
            "GET",
            `/me/agent-routines/${f.routine.id}/retry-policy`,
          )
        ).json();
        const response = await f.request(
          "PUT",
          `/me/agent-routines/${f.routine.id}/retry-policy`,
          {
            request_id: randomUUID(),
            expected_revision: page.revision,
            policy: { ...page.policy, max_attempts: 4 },
          },
        );
        assert.equal(response.statusCode, 200, response.body);
      } else {
        const response = await f.request(
          "PUT",
          `/me/agent-routines/${f.routine.id}`,
          {
            instruction: `RoutineCase:${f.marker} Summarize a different note.`,
          },
        );
        assert.equal(response.statusCode, 200, response.body);
      }
      assert.equal(
        await scanRoutineRetries(
          "background",
          new Date(recovery.next_retry_at!),
          { only: [f.user.id] },
        ),
        0,
      );
      assert.equal(enabled(await view(f, run.id)).state, "held");
      assert.equal((await rows(run.id)).length, 1);
    } finally {
      await stopRuntimeNow();
    }
  }
});

test("attempt limits and an actual parked-question deadline stop recovery without a new job", async () => {
  const capped = await fixture({ policy: { max_attempts: 1 } });
  try {
    const { run, recovery } = await failed(capped);
    assert.equal(recovery.state, "limited", recovery.reason);
    assert.equal(
      await scanRoutineRetries("background", new Date(Date.now() + 60000), {
        only: [capped.user.id],
      }),
      0,
    );
    assert.equal((await rows(run.id)).length, 1);
  } finally {
    await stopRuntimeNow();
  }
  const f = await fixture({
    mode: "question",
    policy: { max_elapsed_minutes: 1 },
  });
  const run = await initial(f);
  stopRuntime = await startTestAssistantRuntime("background");
  try {
    await waitJob(run.job_id, ["waiting"]);
    const data = enabled(await view(f, run.id));
    await settleRoutineRecoveries(
      "background",
      new Date(new Date(data.deadline).getTime() + 1),
      [f.user.id],
    );
    await waitJob(run.job_id);
    await settleRoutineRecoveries("background", new Date(), [f.user.id]);
    const limited = enabled(await view(f, run.id));
    assert.equal(limited.state, "limited", limited.reason);
    assert.equal(limited.reserved_tokens, 0);
    const ended = await waitJob(run.job_id);
    assert.equal(ended.terminal_evidence.cause, "deadline");
    assert.equal(
      await scanRoutineRetries("background", new Date(Date.now() + 120000), {
        only: [f.user.id],
      }),
      0,
    );
  } finally {
    await stopRuntimeNow();
  }
});

test("Stop cancels backoff and settlement recovers a queued Stop committed before route cancellation", async () => {
  const backoff = await fixture();
  try {
    const { run, recovery } = await failed(backoff);
    const stop = await backoff.request(
      "POST",
      `/me/agent-routines/${backoff.routine.id}/runs/${run.id}/stop`,
      {
        request_id: randomUUID(),
        expected_revision: recovery.revision,
        generation: recovery.generation,
      },
    );
    assert.equal(stop.statusCode, 200, stop.body);
    assert.equal(stop.json().state, "stopped");
    assert.equal(
      await scanRoutineRetries(
        "background",
        new Date(recovery.next_retry_at!),
        { only: [backoff.user.id] },
      ),
      0,
    );
  } finally {
    await stopRuntimeNow();
  }
  const f = await fixture(),
    run = await initial(f),
    before = enabled(await view(f, run.id));
  await transaction((db) =>
    stopRoutineRecovery(db, f.user.id, f.routine.id, run.id, {
      request_id: randomUUID(),
      expected_revision: before.revision,
      generation: before.generation,
    }),
  );
  await settleRoutineRecoveries("background", new Date(), [f.user.id]);
  await waitJob(run.job_id);
  await settleRoutineRecoveries("background", new Date(), [f.user.id]);
  const stopped = enabled(await view(f, run.id));
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.reserved_tokens, 0);
  assert.equal(stopped.consumed_tokens, (await rows(run.id))[0].settled_tokens);
  await settleRoutineRecoveries("background", new Date(), [f.user.id]);
  assert.equal(
    enabled(await view(f, run.id)).consumed_tokens,
    stopped.consumed_tokens,
  );
  assert.equal(f.script.calls, 0);
});

test("a final UNTIL occurrence may retry after automatic pause, while an explicit manual pause blocks it", async () => {
  for (const manual of [false, true]) {
    const f = await fixture({ final: true });
    try {
      const { run, recovery } = await failed(f);
      assert.equal(recovery.state, "retry_scheduled", recovery.reason);
      const routine = (
        await pool.query("SELECT paused FROM agent_routines WHERE id=$1", [
          f.routine.id,
        ])
      ).rows[0];
      assert.equal(routine.paused, true, "The RRULE has no later occurrence");
      if (manual) {
        const response = await f.request(
          "PUT",
          `/me/agent-routines/${f.routine.id}`,
          { paused: true },
        );
        assert.equal(response.statusCode, 200, response.body);
      }
      f.script.mode = "finish";
      const count = await scanRoutineRetries(
        "background",
        new Date(recovery.next_retry_at!),
        { only: [f.user.id] },
      );
      assert.equal(count, manual ? 0 : 1);
      if (manual) {
        assert.equal(enabled(await view(f, run.id)).state, "held");
        assert.equal((await rows(run.id)).length, 1);
      } else {
        const attempts = await rows(run.id);
        assert.equal((await waitJob(attempts[1].job_id)).state, "done");
        await settleRoutineRecoveries("background", new Date(), [f.user.id]);
        assert.equal(enabled(await view(f, run.id)).state, "completed");
        assert.equal(attempts.length, 2);
      }
    } finally {
      await stopRuntimeNow();
    }
  }
});

test("Overnight retry respects the window, shares night accounting, and a committed task is never created twice", async () => {
  const f = await fixture({ mode: "create" });
  f.script.mode = "fail";
  const now = new Date(),
    clock = (date: Date) =>
      `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  const settings = {
    enabled: true,
    start: clock(new Date(now.getTime() - 3600000)),
    end: clock(new Date(now.getTime() + 120000)),
    timezone: "UTC",
    kinds: {
      plan: false,
      deadlines: false,
      study: false,
      meetings: false,
      tidy: false,
      handed: false,
      follow_through: true,
      reflection: false,
    },
    wait_for_ok: false,
  };
  const saved = await f.request("PUT", "/me/assistant/night-shift", settings);
  assert.equal(saved.statusCode, 200, saved.body);
  // This scheduled lane admits work only while the person is away. The
  // first-party setup requests above intentionally created an active session.
  await pool.query(
    "UPDATE sessions SET last_seen_at=$2::timestamptz - interval '16 minutes' WHERE user_id=$1",
    [f.user.id, now],
  );
  assert.equal(
    await scanNightShift(new Date(now.getTime() + 180000), {
      only: [f.user.id],
    }),
    0,
  );
  assert.equal(
    await scanNightShift(new Date(f.due.getTime() + 1), { only: [f.user.id] }),
    1,
  );
  const run = (
    await pool.query(
      "SELECT id,job_id FROM assistant_routine_runs WHERE routine_id=$1",
      [f.routine.id],
    )
  ).rows[0];
  stopRuntime = await startTestAssistantRuntime("overnight");
  try {
    assert.equal((await waitJob(run.job_id)).state, "failed");
    await settleRoutineRecoveries("overnight", new Date(), [f.user.id]);
    const retry = enabled(await view(f, run.id));
    assert.equal(retry.state, "retry_scheduled", retry.reason);

    f.script.mode = "create";
    assert.equal(
      await scanRoutineRetries("overnight", new Date(retry.next_retry_at!), {
        only: [f.user.id],
      }),
      1,
    );
    const attempts = await rows(run.id),
      done = await waitJob(attempts[1].job_id);
    assert.equal(done.state, "done", JSON.stringify(done));
    assert.equal(done.apply_result?.applied, true);
    await settleRoutineRecoveries("overnight", new Date(), [f.user.id]);
    const complete = enabled(await view(f, run.id));
    assert.equal(complete.state, "completed", complete.reason);
    assert.equal(complete.attempt_count, 2);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM items WHERE user_id=$1 AND title=$2",
          [f.user.id, f.script.title],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      await scanRoutineRetries("overnight", new Date(Date.now() + 60000), {
        only: [f.user.id],
      }),
      0,
    );
    const mapping = (
      await pool.query(
        "SELECT r.night_id,j.runtime_lane,n.budget_used FROM assistant_night_runs r JOIN ai_jobs j ON j.id=r.job_id JOIN assistant_nights n ON n.id=r.night_id WHERE j.id=ANY($1::uuid[])",
        [attempts.map((attempt) => attempt.job_id)],
      )
    ).rows;
    assert.equal(mapping.length, 2);
    assert.equal(new Set(mapping.map((row) => row.night_id)).size, 1);
    assert.ok(mapping.every((row) => row.runtime_lane === "overnight"));
    assert.ok(mapping[0].budget_used > 0);
    const morning = await f.request("GET", "/me/assistant/nights/latest");
    assert.equal(morning.statusCode, 200, morning.body);
    assert.equal(morning.json().runs.length, 2);
  } finally {
    await stopRuntimeNow();
  }
});
