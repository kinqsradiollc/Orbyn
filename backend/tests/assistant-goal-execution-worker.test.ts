import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { goalExecutionDetails, type GoalExecutionDetails } from "@orbyn/core";
import { startTestAssistantRuntime } from "./helpers/assistant-runtime.js";

// Real Orbyn admission and runtime; every inference request terminates at this
// loopback fixture. Mutation scenarios use only local test-user task effects.
type ProviderRequest = {
  messages?: { role: string; content: string | null }[];
  tools?: { function?: { name?: string } }[];
};
type Reply = { name: string; arguments: Record<string, unknown> };
type Scenario = {
  project: string;
  task?: { id: string; version: number };
  badRepair: boolean;
  verifyReports: number;
  repairFinishes: number;
  rejected: boolean;
  questionBeforeWork?: boolean;
  answered?: boolean;
  questionAsked?: number;
  gate?: {
    entered: Promise<void>;
    enter: () => void;
    released: Promise<void>;
    release: () => void;
  };
};
const scenarios = new Map<string, Scenario>();
const requests: { criterion: string; mode: "work" | "verify" | "repair" }[] =
  [];
const providerErrors: string[] = [];
const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
function finishReply(
  criterion: string,
  mode: "work" | "verify" | "repair",
  decision: "ready" | "repair" | "blocked" = "ready",
  steps: string[] = [],
): Reply {
  return {
    name: "finish",
    arguments: {
      answer:
        mode === "verify"
          ? "The saved answer is ready for the person's criterion review."
          : "Prepared the requested answer: a concise outline.",
      steps,
      goal_result: {
        criterion_id: criterion,
        decision,
        note:
          mode === "verify"
            ? "Read-only check completed; only the person can accept."
            : "A useful answer is ready for a distinct verification unit.",
      },
    },
  };
}
function replyFor(
  body: ProviderRequest,
  criterion: string,
  mode: "work" | "verify" | "repair",
): Reply {
  const scenario = scenarios.get(criterion);
  if (!scenario) return finishReply(criterion, mode);
  const names = (body.tools ?? []).map((tool) => tool.function?.name);
  const previous = [...(body.messages ?? [])]
    .reverse()
    .find((message) => message.role === "tool");
  if (mode === "verify") {
    assert.ok(names.includes("finish"));
    return finishReply(
      criterion,
      mode,
      scenario.verifyReports++ === 0 ? "repair" : "ready",
    );
  }
  if (
    scenario.questionBeforeWork &&
    !scenario.answered &&
    mode === "work" &&
    names.includes("ask_person")
  ) {
    scenario.questionAsked = (scenario.questionAsked ?? 0) + 1;
    return {
      name: "ask_person",
      arguments: {
        question: "Which first task should I create?",
        choices: ["Product", "Marketing"],
      },
    };
  }
  if (names.includes("delegate")) {
    if (
      scenario.badRepair &&
      mode === "repair" &&
      scenario.repairFinishes > 0
    ) {
      scenario.rejected = true;
      return finishReply(criterion, mode, "blocked");
    }
    if (!previous)
      return {
        name: "delegate",
        arguments: {
          tasks: [
            {
              specialist: "projects",
              want_options: false,
              brief: `Work on criterion ${criterion}: ${mode === "work" ? "Create exactly one test task in the named project." : "Repair the existing task; do not create another object."} This is one ${mode} unit. Project project:${scenario.project}. Bound task ${JSON.stringify(scenario.task ?? null)}.`,
            },
          ],
        },
      };
    const reports = JSON.parse(previous.content ?? "[]") as {
      staged_step_ids?: string[];
    }[];
    const steps = reports.flatMap((report) => report.staged_step_ids ?? []);
    if (mode === "repair") scenario.repairFinishes++;
    if (!steps.length && scenario.badRepair) {
      scenario.rejected = true;
      return finishReply(criterion, mode, "blocked");
    }
    assert.equal(
      steps.length,
      1,
      `Exactly one checked specialist step reaches the lead: ${JSON.stringify(reports)}`,
    );
    return finishReply(criterion, mode, "ready", steps);
  }
  assert.ok(
    names.includes("report"),
    "Only Projects specialist or goal lead is expected",
  );
  if (!previous) {
    if (mode === "work" || scenario.badRepair)
      return {
        name: "create_tasks",
        arguments: {
          tasks: [
            {
              title:
                mode === "work"
                  ? "Goal bound task"
                  : "Forbidden duplicate task",
              kind: "task",
              project: `project:${scenario.project}`,
            },
          ],
        },
      };
    assert.ok(scenario.task, "Repair has a version-bound existing output");
    return {
      name: "update_tasks",
      arguments: {
        changes: [
          {
            id: `task:${scenario.task.id}`,
            version: scenario.task.version,
            title: "Goal task repaired",
          },
        ],
      },
    };
  }
  const staged = JSON.parse(previous.content ?? "{}") as { step_id?: string };
  if (!staged.step_id && scenario.badRepair) scenario.rejected = true;
  else assert.ok(staged.step_id, "Projects staged exactly one authorized step");
  return {
    name: "report",
    arguments: {
      status: staged.step_id ? "done" : "blocked",
      summary: staged.step_id
        ? "Staged the bounded task change."
        : "Repair creation was rejected.",
      findings: [],
      steps: staged.step_id ? [staged.step_id] : [],
      open_questions: [],
    },
  };
}
const provider = createServer(async (request, response) => {
  try {
    const body = JSON.parse(await readBody(request)) as ProviderRequest;
    const prompt = (body.messages ?? [])
      .map((message) => message.content ?? "")
      .join("\n");
    const scopePrompt =
      [...(body.messages ?? [])]
        .reverse()
        .find(
          (message) =>
            message.role === "user" &&
            message.content?.includes("Work on criterion"),
        )?.content ?? prompt;
    const criterion = [
      ...scopePrompt.matchAll(/Work on criterion ([0-9a-f-]{36}):/gi),
    ].at(-1)?.[1];
    assert.ok(criterion, "Provider must receive the exact scoped criterion");
    const mode = scopePrompt.includes("This is one repair unit")
      ? "repair"
      : scopePrompt.includes("This is one verify unit")
        ? "verify"
        : "work";
    requests.push({ criterion, mode });
    const gate = scenarios.get(criterion)?.gate;
    if (gate && mode === "work") {
      gate.enter();
      await gate.released;
    }
    const reply = replyFor(body, criterion, mode);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        usage: { prompt_tokens: 17, completion_tokens: 11, total_tokens: 28 },
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: `goal_call_${requests.length}`,
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
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error: "Local goal fixture could not match the request",
      }),
    );
  }
});

const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApiService, buildAiService } = await import("../src/app.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { controlGoalExecution } =
  await import("../src/modules/assistant-workspace/goal-executions.js");
const { scanGoalExecutions, settleGoalExecutions } =
  await import("../src/worker/goal-executions.js");
const app = await buildApiService();
const aiApp = await buildAiService();
const users: string[] = [];
let providerId: string | undefined;
let stopRuntime: (() => Promise<void>) | undefined;
let originalAi: { provider_id: string | null; model: string };
let address = 0;
const remoteAddress = () =>
  `10.77.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

before(async () => {
  await migrate();
  assert.ok(
    app.hasRoute({ method: "POST", url: "/me/goals/:id/executions" }),
    "API service must register the first-party execution route",
  );
  originalAi = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  const port = (provider.address() as { port: number }).port;
  providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai-compatible','Goal worker fixture',$1) RETURNING id",
      [`http://127.0.0.1:${port}/v1`],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='goal-worker-fixture' WHERE id",
    [providerId],
  );
  invalidateSettings();
});
after(async () => {
  await stopRuntime?.();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  if (originalAi)
    await pool.query(
      "UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id",
      [originalAi.provider_id, originalAi.model],
    );
  if (providerId)
    await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  invalidateSettings();
  await aiApp.close();
  await app.close();
  await new Promise<void>((resolve, reject) =>
    provider.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
  assert.deepEqual(providerErrors, []);
});

async function fixture(
  mutation = false,
  badRepair = false,
  review = false,
  lane: "background" | "overnight" = "background",
  independent = false,
) {
  const registered = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: remoteAddress(),
    payload: {
      email: `goal-worker-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Goal worker tester",
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
      remoteAddress: remoteAddress(),
      headers: { authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { payload }),
    });
  let project: string | undefined;
  if (mutation) {
    const madeProject = await request("POST", "/projects", {
      name: "Scoped goal project",
    });
    assert.equal(madeProject.statusCode, 201, madeProject.body);
    project = madeProject.json().id;
  }
  const made = await request("POST", "/me/goals", {
    title: mutation ? "Create and repair one task" : "Prepare an outline",
    target: mutation
      ? "One task, repaired in place and reviewed by the person"
      : "An outline the person can review",
    ...(project ? { project_id: project } : {}),
  });
  assert.equal(made.statusCode, 201, made.body);
  const goal = made.json();
  const criterion = randomUUID();
  if (mutation) {
    if (!review) {
      const permission = await request("PUT", "/me/assistant/approval-scopes", {
        tasks: { scope: "goal", id: goal.id },
      });
      assert.equal(permission.statusCode, 200, permission.body);
    }
    scenarios.set(criterion, {
      project: project!,
      badRepair,
      verifyReports: review ? 1 : 0,
      repairFinishes: 0,
      rejected: false,
    });
  }
  const secondCriterion = independent ? randomUUID() : null;
  if (secondCriterion && mutation && !review)
    scenarios.set(secondCriterion, {
      project: project!,
      badRepair: false,
      verifyReports: 1,
      repairFinishes: 0,
      rejected: false,
    });
  if (independent && mutation) scenarios.get(criterion)!.verifyReports = 1;
  const input = {
    request_id: randomUUID(),
    expected_goal_revision: goal.revision,
    criteria: [
      {
        id: criterion,
        text: mutation
          ? "Create exactly one task in the project and repair that same task for review"
          : "The answer contains a concise outline",
        kind: "person",
      },
      ...(secondCriterion
        ? [
            {
              id: secondCriterion,
              text: review
                ? "Produce an independent concise explanation for review"
                : "Create one independent task in the same project for review",
              kind: "person",
            },
          ]
        : []),
    ],
    lane,
    effect_ceiling: mutation && !review ? "existing_scopes" : "suggest",
    limits: {
      max_attempts: independent ? 8 : mutation ? 6 : 4,
      token_limit: independent ? 300000 : 100000,
      deadline: new Date(Date.now() + 86400000).toISOString(),
    },
  };
  const started = await request(
    "POST",
    `/me/goals/${goal.id}/executions`,
    input,
  );
  assert.equal(started.statusCode, 201, started.body);
  const execution = goalExecutionDetails.parse(started.json());
  return {
    user,
    token,
    goal,
    criterion,
    secondCriterion,
    input,
    request,
    execution,
    project,
  };
}
async function details(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await f.request(
    "GET",
    `/me/goal-executions/${f.execution.id}`,
  );
  assert.equal(response.statusCode, 200, response.body);
  return goalExecutionDetails.parse(response.json());
}
function available(value: GoalExecutionDetails) {
  assert.equal(value.visibility, "available");
  if (value.visibility !== "available")
    assert.fail("Expected current-access goal details");
  return value;
}
async function waitJob(id: string, requireDone = true) {
  for (let tick = 0; tick < 400; tick++) {
    const row = (
      await pool.query(
        "SELECT state,result,error_message,apply_result,apply_started_at FROM ai_jobs WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (row && ["done", "failed"].includes(row.state)) {
      if (requireDone) assert.equal(row.state, "done", JSON.stringify(row));
      return row;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const row = (
    await pool.query(
      "SELECT state,progress,run_state,error_message FROM ai_jobs WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.fail(`Goal job did not finish: ${JSON.stringify(row)}`);
}
async function scanOnce(f: Awaited<ReturnType<typeof fixture>>) {
  const counts = await Promise.all([
    scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
    scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
  ]);
  assert.equal(
    counts.reduce((sum, count) => sum + count, 0),
    1,
    "Concurrent scans admit exactly one bounded job",
  );
  const rows = (
    await pool.query(
      "SELECT * FROM assistant_goal_attempts WHERE execution_id=$1 ORDER BY ordinal",
      [f.execution.id],
    )
  ).rows;
  const job = rows.at(-1)?.job_id;
  assert.ok(job, "Admission uses the real startAssistantAutomation job");
  return { job: job as string, rows };
}

test("real scoped work and a distinct read-only verification require person acceptance; duplicate scans do not duplicate attempts", async () => {
  const f = await fixture();
  const first = await scanOnce(f);
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].mode, "work");
  stopRuntime = await startTestAssistantRuntime("background");
  try {
    const work = await waitJob(first.job);
    assert.deepEqual(work.result.assistant_run.goal_result, {
      criterion_id: f.criterion,
      decision: "ready",
      note: "A useful answer is ready for a distinct verification unit.",
    });
    await Promise.all([
      settleGoalExecutions("background", new Date(), [f.user.id]),
      settleGoalExecutions("background", new Date(), [f.user.id]),
    ]);
    const afterWork = available(await details(f));
    assert.equal(
      afterWork.state,
      "ready",
      JSON.stringify({
        state: afterWork.state,
        reason: afterWork.last_transition_reason,
        attempt_count: afterWork.attempt_count,
      }),
    );
    assert.equal(afterWork.units[0].stage, "verify");
    assert.equal(afterWork.acceptance, null);
    assert.equal(afterWork.can_accept, false);
    assert.equal(afterWork.attempt_count, 1);
    assert.ok(
      afterWork.consumed_tokens > 0,
      "First actual runtime usage settles cumulatively",
    );
    assert.equal(afterWork.reserved_tokens, 0);
    const verify = await scanOnce(f);
    assert.equal(verify.rows.length, 2);
    assert.equal(verify.rows[1].mode, "verify");
    assert.notEqual(verify.job, first.job);
    const checked = await waitJob(verify.job);
    assert.equal(
      checked.apply_result,
      null,
      "Verification stages no writes or proposal",
    );
    assert.equal(
      checked.apply_started_at,
      null,
      "Read-only verification never starts plan application",
    );
    assert.equal(checked.result.assistant_run.goal_result.decision, "ready");
    await settleGoalExecutions("background", new Date(), [f.user.id]);
    const review = available(await details(f));
    assert.equal(review.state, "awaiting_acceptance");
    assert.equal(review.units[0].stage, "ready_for_acceptance");
    assert.equal(review.can_accept, true);
    assert.equal(
      review.acceptance,
      null,
      "Model readiness never creates person acceptance",
    );
    assert.equal(review.reserved_tokens, 0);
    assert.ok(review.consumed_tokens > afterWork.consumed_tokens);
    assert.equal(
      await scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
      0,
      "Acceptance cannot be bypassed by more scheduler wakes",
    );
    const ledger = (
      await pool.query(
        "SELECT sum(settled_tokens)::int AS used,count(*)::int AS n FROM assistant_goal_attempts WHERE execution_id=$1",
        [f.execution.id],
      )
    ).rows[0];
    assert.equal(ledger.n, 2);
    assert.equal(
      ledger.used,
      review.consumed_tokens,
      "Settled usage persists without double charging duplicate settlement",
    );
    const acceptance = await f.request(
      "POST",
      `/me/goal-executions/${review.id}/accept`,
      {
        request_id: randomUUID(),
        expected_revision: review.revision,
        generation: review.generation,
        expected_criteria_hash: review.criteria_hash,
        expected_evidence_hash: review.evidence_hash,
        accepted_criterion_ids: [f.criterion],
      },
    );
    assert.equal(acceptance.statusCode, 200, acceptance.body);
    const accepted = available(goalExecutionDetails.parse(acceptance.json()));
    assert.equal(accepted.state, "completed");
    assert.equal(accepted.acceptance?.kind, "person");
    assert.deepEqual(accepted.acceptance?.criterion_ids, [f.criterion]);
    assert.equal(accepted.units[0].stage, "satisfied");
    assert.equal(accepted.consumed_tokens, review.consumed_tokens);
    assert.equal(
      await scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
      0,
    );
    assert.equal(
      requests.filter(
        (row) => row.criterion === f.criterion && row.mode === "work",
      ).length,
      1,
    );
    assert.equal(
      requests.filter(
        (row) => row.criterion === f.criterion && row.mode === "verify",
      ).length,
      1,
    );
  } finally {
    await stopRuntime?.();
    stopRuntime = undefined;
  }
});

test("stopping a queued scope generation prevents provider work, writes and duplicate wakes", async () => {
  const f = await fixture();
  const queued = await scanOnce(f);
  const beforeStop = await details(f);
  const stopped = await f.request(
    "POST",
    `/me/goal-executions/${beforeStop.id}/stop`,
    {
      request_id: randomUUID(),
      expected_revision: beforeStop.revision,
      generation: beforeStop.generation,
    },
  );
  assert.equal(stopped.statusCode, 200, stopped.body);
  const result = goalExecutionDetails.parse(stopped.json());
  assert.equal(result.state, "stopped");
  assert.ok(result.generation > beforeStop.generation);
  assert.deepEqual(
    await Promise.all([
      scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
      scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
    ]),
    [0, 0],
  );
  stopRuntime = await startTestAssistantRuntime("background");
  try {
    await waitJob(queued.job, false);
    await settleGoalExecutions("background", new Date(), [f.user.id]);
    const current = await details(f);
    assert.equal(current.state, "stopped");
    if (current.visibility === "available")
      assert.equal(current.acceptance, null);
    assert.equal(current.attempt_count, 1);
    const stoppedUsage = (
      await pool.query(
        "SELECT sum(settled_tokens)::int AS used,count(*) FILTER(WHERE settled_at IS NOT NULL)::int AS settled FROM assistant_goal_attempts WHERE execution_id=$1",
        [f.execution.id],
      )
    ).rows[0];
    assert.equal(
      stoppedUsage.settled,
      1,
      "Stopped queued work settles its admitted reservation exactly once",
    );
    assert.equal(
      current.reserved_tokens,
      0,
      "Stopped execution releases its outstanding reservation",
    );
    assert.equal(
      current.consumed_tokens,
      stoppedUsage.used,
      "Stopped execution persists actual settled usage",
    );
    await settleGoalExecutions("background", new Date(), [f.user.id]);
    assert.equal(
      (await details(f)).consumed_tokens,
      current.consumed_tokens,
      "Repeated settlement never double-charges stopped work",
    );

    assert.equal(
      requests.filter((row) => row.criterion === f.criterion).length,
      0,
      "Stopped generation never calls the provider",
    );
    const row = (
      await pool.query(
        "SELECT apply_result,apply_started_at FROM ai_jobs WHERE id=$1",
        [queued.job],
      )
    ).rows[0];
    assert.equal(row.apply_result, null);
    assert.equal(row.apply_started_at, null);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM items WHERE user_id=$1",
          [f.user.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM assistant_goal_attempts WHERE execution_id=$1",
          [f.execution.id],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await stopRuntime?.();
    stopRuntime = undefined;
  }
});

async function ownedTasks(f: Awaited<ReturnType<typeof fixture>>) {
  return (
    await pool.query<{
      id: string;
      title: string;
      version: number;
      project_id: string | null;
    }>(
      "SELECT id,title,version,project_id FROM items WHERE user_id=$1 ORDER BY created_at,id",
      [f.user.id],
    )
  ).rows;
}
async function finishUnit(f: Awaited<ReturnType<typeof fixture>>) {
  const admission = await scanOnce(f);
  const job = await waitJob(admission.job);
  await settleGoalExecutions("background", new Date(), [f.user.id]);
  return { id: admission.job, job, detail: available(await details(f)) };
}
async function createdTaskFixture(badRepair = false) {
  const f = await fixture(true, badRepair);
  const admission = await scanOnce(f);
  stopRuntime = await startTestAssistantRuntime("background");
  const work = await waitJob(admission.job);
  assert.equal(
    work.apply_result?.applied,
    true,
    "The real current runtime commits the initial checked creation",
  );
  const tasks = await ownedTasks(f);
  assert.equal(tasks.length, 1, "Initial work creates exactly one task");
  const task = tasks[0];
  assert.equal(
    task.project_id,
    f.project,
    "The saved goal-scoped permission applies only to its actual project",
  );
  const outputs = work.apply_result.goal_outputs;
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].kind, "task");
  assert.equal(
    outputs[0].id,
    task.id,
    "Committed output captures the raw created object identity",
  );
  assert.equal(outputs[0].version, String(task.version));
  assert.equal(outputs[0].producer_job_id, admission.job);
  const { goalEvidenceDigest } =
    await import("../src/modules/ai/agent/goal-execution.js");
  assert.equal(
    outputs[0].receipt_digest,
    goalEvidenceDigest(work.apply_result.structured),
    "Output receipt digest binds the actual committed structured apply result",
  );
  await settleGoalExecutions("background", new Date(), [f.user.id]);
  const afterWork = available(await details(f));
  assert.equal(afterWork.units[0].effects_applied, true);
  assert.equal(afterWork.units[0].stage, "verify");
  assert.deepEqual(afterWork.units[0].outputs, outputs);
  assert.equal(afterWork.acceptance, null);
  scenarios.get(f.criterion)!.task = { id: task.id, version: task.version };
  return { f, task, afterWork };
}

test("actual creation is repaired in place at its bound version, verified read-only and accepted by the person", async () => {
  try {
    const { f, task } = await createdTaskFixture();
    const firstVerify = await finishUnit(f);
    assert.equal(firstVerify.job.apply_result, null);
    assert.equal(firstVerify.job.apply_started_at, null);
    assert.equal(
      firstVerify.job.result.assistant_run.goal_result.decision,
      "repair",
    );
    assert.equal(firstVerify.detail.units[0].stage, "repair");
    assert.equal(firstVerify.detail.units[0].effects_applied, true);
    assert.equal(firstVerify.detail.can_accept, false);
    const repaired = await finishUnit(f);
    assert.equal(repaired.job.apply_result?.applied, true);
    const tasks = await ownedTasks(f);
    assert.equal(
      tasks.length,
      1,
      "Repair updates the existing task rather than recreating the unit's consumed output",
    );
    assert.equal(tasks[0].id, task.id);
    assert.equal(tasks[0].title, "Goal task repaired");
    assert.equal(
      tasks[0].version,
      task.version + 1,
      "Version-checked repair creates one new version",
    );
    assert.equal(repaired.job.apply_result.goal_outputs[0].id, task.id);
    assert.equal(
      repaired.job.apply_result.goal_outputs[0].version,
      String(task.version + 1),
    );
    assert.equal(repaired.detail.units[0].stage, "verify");
    assert.equal(repaired.detail.units[0].effects_applied, true);
    const finalVerify = await finishUnit(f);
    assert.equal(finalVerify.job.apply_result, null);
    assert.equal(finalVerify.job.apply_started_at, null);
    assert.equal(finalVerify.detail.state, "awaiting_acceptance");
    assert.equal(finalVerify.detail.units[0].stage, "ready_for_acceptance");
    assert.equal(finalVerify.detail.acceptance, null);
    assert.equal(finalVerify.detail.can_accept, true);
    const review = finalVerify.detail;
    const accepted = await f.request(
      "POST",
      `/me/goal-executions/${review.id}/accept`,
      {
        request_id: randomUUID(),
        expected_revision: review.revision,
        generation: review.generation,
        expected_criteria_hash: review.criteria_hash,
        expected_evidence_hash: review.evidence_hash,
        accepted_criterion_ids: [f.criterion],
      },
    );
    assert.equal(accepted.statusCode, 200, accepted.body);
    const completed = available(goalExecutionDetails.parse(accepted.json()));
    assert.equal(completed.state, "completed");
    assert.equal(completed.acceptance?.kind, "person");
    assert.equal(completed.units[0].stage, "satisfied");
    assert.equal(completed.attempt_count, 4);
    assert.equal(completed.reserved_tokens, 0);
    const charged = (
      await pool.query(
        "SELECT sum(settled_tokens)::int AS used FROM assistant_goal_attempts WHERE execution_id=$1",
        [f.execution.id],
      )
    ).rows[0].used;
    assert.equal(completed.consumed_tokens, charged);
    assert.equal((await ownedTasks(f)).length, 1);
    assert.equal(
      await scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
      0,
    );
  } finally {
    await stopRuntime?.();
    stopRuntime = undefined;
  }
});

test("a repair cannot create another task after the criterion's creation effect was consumed", async () => {
  try {
    const { f, task } = await createdTaskFixture(true);
    const verified = await finishUnit(f);
    assert.equal(verified.detail.units[0].stage, "repair");
    const rejected = await finishUnit(f);
    assert.equal(
      scenarios.get(f.criterion)?.rejected,
      true,
      "The adversarial fixture reached the actual staging/checker rejection path",
    );
    const tasks = await ownedTasks(f);
    assert.equal(
      tasks.length,
      1,
      "A fresh job/client_ref cannot duplicate the consumed creation effect",
    );
    assert.equal(tasks[0].id, task.id);
    assert.equal(tasks[0].version, task.version);
    assert.equal(rejected.job.apply_result, null);
    assert.equal(rejected.detail.state, "held");
    assert.equal(rejected.detail.units[0].stage, "blocked");
    assert.equal(rejected.detail.acceptance, null);
    assert.equal(rejected.detail.can_accept, false);
    assert.equal(
      await scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
      0,
    );
  } finally {
    await stopRuntime?.();
    stopRuntime = undefined;
  }
});

test("saved Review applies one existing plan and resolves waiting evidence before verification and acceptance", async () => {
  const f = await fixture(true, false, true);
  const admission = await scanOnce(f);
  stopRuntime = await startTestAssistantRuntime("background");
  try {
    const work = await waitJob(admission.job);
    assert.equal(work.apply_result?.applied, false);
    assert.equal(work.apply_result?.structured?.status, "pending_review");
    const proposalId = (
      work.apply_result.structured.pending.proposal_id as string
    )
      .split(":")
      .at(-1)!;
    const planJob = work.apply_result.structured.job as string;
    assert.ok(proposalId);
    assert.ok(planJob);
    assert.equal(
      (await ownedTasks(f)).length,
      0,
      "Suggest ceiling holds effects until Review",
    );
    await settleGoalExecutions("background", new Date(), [f.user.id]);
    const waiting = available(await details(f));
    assert.equal(waiting.state, "waiting");
    assert.equal(waiting.units[0].pending_proposal_id, proposalId);
    assert.equal(waiting.result?.execution_outcome?.outcome, "waiting");
    assert.equal(waiting.attempt_count, 1);
    assert.equal(waiting.acceptance, null);
    await settleGoalExecutions("background", new Date(), [f.user.id]);
    assert.equal(
      await scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
      0,
      "Pending Review admits no extra attempt",
    );
    const proposalCount = async () =>
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM proposals WHERE user_id=$1",
          [f.user.id],
        )
      ).rows[0].n;
    assert.equal(await proposalCount(), 1);
    const review = await f.request("GET", `/proposals/${proposalId}`);
    assert.equal(review.statusCode, 200, review.body);
    assert.equal(review.json().status, "pending");
    const applied = await f.request(
      "POST",
      `/proposals/${proposalId}/apply`,
      {},
    );
    assert.equal(applied.statusCode, 200, applied.body);
    const tasks = await ownedTasks(f);
    assert.equal(tasks.length, 1);
    const task = tasks[0];
    assert.equal(task.project_id, f.project);
    await settleGoalExecutions("background", new Date(), [f.user.id]);
    const afterReview = available(await details(f));
    assert.equal(afterReview.units[0].effects_applied, true);
    assert.equal(afterReview.units[0].pending_proposal_id, null);
    assert.equal(afterReview.units[0].stage, "verify");
    assert.equal(
      afterReview.attempt_count,
      1,
      "Human approval reuses the original saved work attempt",
    );
    assert.equal(
      afterReview.acceptance,
      null,
      "Review of effects never accepts the goal",
    );
    const output = afterReview.units[0].outputs.find(
      (output) => output.kind === "task",
    );
    assert.ok(output);
    assert.equal(output.id, task.id);
    assert.equal(output.version, String(task.version));
    assert.equal(output.producer_job_id, admission.job);
    const activity = (
      await pool.query(
        "SELECT target_ids FROM agent_activity WHERE user_id=$1 AND request_id=$2 AND outcome='ok'",
        [f.user.id, planJob],
      )
    ).rows;
    assert.ok(
      activity.some((row) =>
        row.target_ids.some((target: string) => target.includes(task.id)),
      ),
      "Same plan identity has committed activity targets",
    );
    assert.ok(afterReview.result?.execution_outcome);
    assert.notEqual(
      afterReview.result.execution_outcome.outcome,
      "waiting",
      "Latest result resolves the decided saved Review",
    );
    assert.notEqual(afterReview.result.execution_outcome.outcome, "completed");
    const history = await f.request(
      "GET",
      `/me/goal-executions/${f.execution.id}/attempts?limit=10`,
    );
    assert.equal(history.statusCode, 200, history.body);
    const previous = history.json().attempts;
    assert.equal(previous.length, 1);
    assert.equal(previous[0].visibility, "available");
    assert.ok(previous[0].execution_outcome);
    assert.notEqual(
      previous[0].execution_outcome.outcome,
      "waiting",
      "History projects the decided Review state",
    );
    assert.notEqual(previous[0].execution_outcome.outcome, "completed");
    const verified = await finishUnit(f);
    assert.equal(verified.job.apply_result, null);
    assert.equal(verified.job.apply_started_at, null);
    assert.equal(verified.detail.state, "awaiting_acceptance");
    assert.equal(verified.detail.can_accept, true);
    const current = verified.detail;
    const accepted = await f.request(
      "POST",
      `/me/goal-executions/${current.id}/accept`,
      {
        request_id: randomUUID(),
        expected_revision: current.revision,
        generation: current.generation,
        expected_criteria_hash: current.criteria_hash,
        expected_evidence_hash: current.evidence_hash,
        accepted_criterion_ids: [f.criterion],
      },
    );
    assert.equal(accepted.statusCode, 200, accepted.body);
    const completed = available(goalExecutionDetails.parse(accepted.json()));
    assert.equal(completed.state, "completed");
    assert.equal(completed.acceptance?.kind, "person");
    assert.equal(completed.attempt_count, 2);
    assert.equal((await ownedTasks(f)).length, 1);
    assert.equal(
      await proposalCount(),
      1,
      "No duplicate proposal is created after approval",
    );
    assert.equal(
      await scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
      0,
    );
  } finally {
    await stopRuntime?.();
    stopRuntime = undefined;
  }
});

test("Overnight scoped goals require consent and the current window, use the real night ledger and remain reviewable after distinct verification", async () => {
  const f = await fixture(false, false, false, "overnight");
  const now = new Date();
  const clock = (instant: Date) =>
    `${String(instant.getUTCHours()).padStart(2, "0")}:${String(instant.getUTCMinutes()).padStart(2, "0")}`;
  const settings = {
    enabled: false,
    start: clock(new Date(now.getTime() - 2 * 3600000)),
    end: clock(new Date(now.getTime() + 2 * 3600000)),
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
    wait_for_ok: true,
  };
  const save = async (value: typeof settings) => {
    const response = await f.request("PUT", "/me/assistant/night-shift", value);
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const scan = (at: Date) =>
    scanGoalExecutions("overnight", at, { only: [f.user.id] });
  await save(settings);
  assert.equal(
    await scan(now),
    0,
    "Explicit goal work does not enable a disabled Overnight lane",
  );
  await save({
    ...settings,
    enabled: true,
    kinds: { ...settings.kinds, follow_through: false },
  });
  assert.equal(
    await scan(now),
    0,
    "Night consent must include goal follow-through work",
  );
  await save({ ...settings, enabled: true });
  assert.equal(
    await scan(new Date(now.getTime() + 8 * 3600000)),
    0,
    "Enabled consent does not admit goal work outside the saved window",
  );
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
        "SELECT count(*)::int AS n FROM assistant_nights WHERE user_id=$1",
        [f.user.id],
      )
    ).rows[0].n,
    0,
    "Refused scans create no night or run rows",
  );
  const first = await Promise.all([scan(now), scan(now)]);
  assert.equal(
    first.reduce((sum, count) => sum + count, 0),
    1,
    "Concurrent in-window scans admit one Overnight attempt",
  );
  const mapping = (
    await pool.query(
      "SELECT r.id,r.job_id,r.night_id,r.kind,j.runtime_lane,n.runs,n.budget_used FROM assistant_night_runs r JOIN ai_jobs j ON j.id=r.job_id JOIN assistant_nights n ON n.id=r.night_id WHERE n.user_id=$1",
      [f.user.id],
    )
  ).rows;
  assert.equal(mapping.length, 1);
  assert.equal(mapping[0].kind, "goal");
  assert.equal(mapping[0].runtime_lane, "overnight");
  assert.equal(mapping[0].runs, 1);
  const nightId = mapping[0].night_id as string;
  const firstJob = mapping[0].job_id as string;
  stopRuntime = await startTestAssistantRuntime("overnight");
  try {
    const work = await waitJob(firstJob);
    assert.equal(
      work.result.assistant_run.goal_result.criterion_id,
      f.criterion,
    );
    await settleGoalExecutions("overnight", new Date(), [f.user.id]);
    const afterWork = available(await details(f));
    assert.equal(afterWork.state, "ready", afterWork.last_transition_reason);
    assert.equal(afterWork.units[0].stage, "verify");
    assert.equal(afterWork.acceptance, null);
    assert.equal(afterWork.can_accept, false);
    assert.equal(afterWork.reserved_tokens, 0);
    const firstNight = (
      await pool.query(
        "SELECT budget_used,runs FROM assistant_nights WHERE id=$1",
        [nightId],
      )
    ).rows[0];
    assert.ok(firstNight.budget_used > 0);
    assert.equal(
      firstNight.budget_used,
      work.result.assistant_run.token_estimate,
    );
    assert.equal(
      await scan(new Date()),
      1,
      "The next bounded attempt verifies the saved Overnight result",
    );
    const runs = (
      await pool.query(
        "SELECT r.job_id,r.night_id,r.kind FROM assistant_night_runs r JOIN assistant_nights n ON n.id=r.night_id WHERE n.user_id=$1 ORDER BY r.created_at,r.id",
        [f.user.id],
      )
    ).rows;
    assert.equal(runs.length, 2);
    assert.ok(
      runs.every((row) => row.night_id === nightId && row.kind === "goal"),
    );
    const verifyJob = runs.find((row) => row.job_id !== firstJob)!
      .job_id as string;
    const checked = await waitJob(verifyJob);
    assert.equal(checked.apply_result, null);
    assert.equal(checked.apply_started_at, null);
    await settleGoalExecutions("overnight", new Date(), [f.user.id]);
    const ready = available(await details(f));
    assert.equal(
      ready.state,
      "awaiting_acceptance",
      ready.last_transition_reason,
    );
    assert.equal(ready.can_accept, true);
    assert.equal(ready.acceptance, null);
    assert.equal(ready.attempt_count, 2);
    assert.equal(ready.reserved_tokens, 0);
    const finalNight = (
      await pool.query(
        "SELECT budget_used,runs FROM assistant_nights WHERE id=$1",
        [nightId],
      )
    ).rows[0];
    assert.equal(finalNight.runs, 2);
    assert.equal(
      finalNight.budget_used,
      work.result.assistant_run.token_estimate +
        checked.result.assistant_run.token_estimate,
    );
    const ledger = (
      await pool.query(
        "SELECT sum(settled_tokens)::int AS used FROM assistant_goal_attempts WHERE execution_id=$1",
        [f.execution.id],
      )
    ).rows[0];
    assert.equal(ready.consumed_tokens, ledger.used);
    const morning = await f.request("GET", "/me/assistant/nights/latest");
    assert.equal(morning.statusCode, 200, morning.body);
    const review = morning.json();
    assert.equal(review.id, nightId);
    assert.equal(review.budget_used, finalNight.budget_used);
    assert.equal(review.runs.length, 2);
    assert.deepEqual(
      new Set(review.runs.map((run: { job_id: string }) => run.job_id)),
      new Set([firstJob, verifyJob]),
    );
    for (const run of review.runs) {
      assert.equal(run.restricted, undefined);
      assert.equal(run.state, "done");
      assert.ok(run.summary);
      assert.notEqual(
        run.execution_outcome?.outcome,
        "completed",
        "Morning review cannot self-accept the goal",
      );
    }
    assert.equal(
      await scan(new Date()),
      0,
      "Overnight review readiness never admits an acceptance-bypassing attempt",
    );
    assert.equal(
      requests.filter(
        (row) => row.criterion === f.criterion && row.mode === "work",
      ).length,
      1,
    );
    assert.equal(
      requests.filter(
        (row) => row.criterion === f.criterion && row.mode === "verify",
      ).length,
      1,
    );
  } finally {
    await stopRuntime?.();
    stopRuntime = undefined;
  }
});

async function waitingQuestion(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
) {
  let last = "";
  for (let tick = 0; tick < 400; tick++) {
    const response = await aiApp.inject({
      method: "GET",
      url: `/ai/chat/${id}`,
      headers: { authorization: `Bearer ${f.token}` },
    });
    last = response.body;
    if (response.statusCode === 200 && response.json().state === "waiting") {
      const waiting = response.json().waiting;
      assert.equal(waiting.kind, "person");
      assert.ok(waiting.id);
      return waiting as { id: string; question: string };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Goal question did not park: ${last}`);
}
async function acceptScope(
  f: Awaited<ReturnType<typeof fixture>>,
  review: GoalExecutionDetails,
) {
  const current = available(review);
  return f.request("POST", `/me/goal-executions/${current.id}/accept`, {
    request_id: randomUUID(),
    expected_revision: current.revision,
    generation: current.generation,
    expected_criteria_hash: current.criteria_hash,
    expected_evidence_hash: current.evidence_hash ?? "0".repeat(64),
    accepted_criterion_ids: current.criteria.map((criterion) => criterion.id),
  });
}
async function parkedQuestionFixture() {
  const f = await fixture(true, false, false, "background", true);
  const scenario = scenarios.get(f.criterion)!;
  scenario.questionBeforeWork = true;
  scenario.answered = false;
  const first = await scanOnce(f);
  stopRuntime = await startTestAssistantRuntime("background");
  const question = await waitingQuestion(f, first.job);
  await settleGoalExecutions("background", new Date(), [f.user.id]);
  const parked = available(await details(f));
  assert.equal(parked.waiting_results.length, 1);
  assert.equal(parked.waiting_results[0].job_id, first.job);
  assert.equal(parked.waiting_results[0].criterion_id, f.criterion);
  assert.equal(parked.waiting_results[0].waiting_kind, "person");
  assert.equal(parked.can_accept, false);
  assert.ok(
    parked.reserved_tokens > 0,
    "A parked live question retains its original attempt reservation",
  );
  return { f, first, question, parked };
}

test("a real question parks one criterion while another creates and verifies, then the original job resumes without a duplicate attempt", async () => {
  try {
    const { f, first, question } = await parkedQuestionFixture();
    const independentWork = await finishUnit(f);
    assert.equal(
      independentWork.job.result.assistant_run.goal_result.criterion_id,
      f.secondCriterion,
    );
    const independentVerify = await finishUnit(f);
    assert.equal(
      independentVerify.job.result.assistant_run.goal_result.criterion_id,
      f.secondCriterion,
    );
    const whileWaiting = independentVerify.detail;
    assert.equal(
      whileWaiting.units.find((unit) => unit.criterion_id === f.secondCriterion)
        ?.stage,
      "ready_for_acceptance",
    );
    assert.equal(whileWaiting.waiting_results[0].job_id, first.job);
    assert.equal(whileWaiting.can_accept, false);
    assert.equal(
      (await ownedTasks(f)).length,
      1,
      "The unanswered unit has created nothing",
    );
    assert.equal(
      (await acceptScope(f, whileWaiting)).statusCode,
      409,
      "Independent readiness cannot accept an unanswered criterion",
    );
    const beforeAnswer = (
      await pool.query(
        "SELECT id,settled_at,processed_at FROM assistant_goal_attempts WHERE job_id=$1",
        [first.job],
      )
    ).rows[0];
    assert.equal(beforeAnswer.settled_at, null);
    assert.equal(beforeAnswer.processed_at, null);
    scenarios.get(f.criterion)!.answered = true;
    const answer = await aiApp.inject({
      method: "POST",
      url: `/ai/chat/${first.job}/answer`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { waiting_id: question.id, answer: "Product" },
    });
    assert.equal(answer.statusCode, 202, answer.body);
    await waitJob(first.job);
    await settleGoalExecutions("background", new Date(), [f.user.id]);
    const resumed = available(await details(f));
    assert.equal(
      resumed.attempt_count,
      3,
      "Answer resumes the original attempt instead of admitting a fresh job",
    );
    assert.equal(resumed.waiting_results.length, 0);
    assert.equal(
      resumed.units.find((unit) => unit.criterion_id === f.criterion)?.stage,
      "verify",
    );
    const same = (
      await pool.query(
        "SELECT id,settled_at,processed_at FROM assistant_goal_attempts WHERE job_id=$1",
        [first.job],
      )
    ).rows;
    assert.equal(same.length, 1);
    assert.equal(same[0].id, beforeAnswer.id);
    assert.ok(same[0].settled_at);
    assert.ok(same[0].processed_at);
    const verified = await finishUnit(f);
    assert.equal(verified.detail.state, "awaiting_acceptance");
    assert.equal(verified.detail.can_accept, true);
    assert.equal(verified.detail.waiting_results.length, 0);
    const tasks = await ownedTasks(f);
    assert.equal(tasks.length, 2, "Exactly one task exists for each criterion");
    const references = verified.detail.units.flatMap((unit) =>
      unit.outputs
        .filter((output) => output.kind === "task")
        .map((output) => output.id),
    );
    assert.equal(new Set(references).size, 2);
    assert.deepEqual(
      new Set(references),
      new Set(tasks.map((task) => task.id)),
    );
    const accepted = await acceptScope(f, verified.detail);
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().state, "completed");
    const usage = (
      await pool.query(
        "SELECT count(*)::int AS n,sum(settled_tokens)::int AS used FROM assistant_goal_attempts WHERE execution_id=$1",
        [f.execution.id],
      )
    ).rows[0];
    assert.equal(usage.n, 4);
    assert.equal(verified.detail.consumed_tokens, usage.used);
    assert.equal(verified.detail.reserved_tokens, 0);
    assert.equal(scenarios.get(f.criterion)?.questionAsked, 1);
  } finally {
    await stopRuntime?.();
    stopRuntime = undefined;
  }
});

test("a saved Review parks its original plan while an independent criterion reaches review readiness", async () => {
  const f = await fixture(true, false, true, "background", true);
  const admission = await scanOnce(f);
  stopRuntime = await startTestAssistantRuntime("background");
  try {
    const work = await waitJob(admission.job);
    const proposal = (
      work.apply_result.structured.pending.proposal_id as string
    )
      .split(":")
      .at(-1)!;
    await settleGoalExecutions("background", new Date(), [f.user.id]);
    const parked = available(await details(f));
    assert.equal(parked.waiting_results.length, 1);
    assert.equal(parked.waiting_results[0].waiting_kind, "review");
    assert.equal(parked.waiting_results[0].job_id, admission.job);
    const waitingAttempt = (
      await pool.query(
        "SELECT settled_at,processed_at FROM assistant_goal_attempts WHERE job_id=$1",
        [admission.job],
      )
    ).rows[0];
    assert.ok(waitingAttempt.settled_at);
    assert.equal(
      waitingAttempt.processed_at,
      null,
      "A charged Review attempt still has an unconsumed frontier decision",
    );
    await finishUnit(f);
    const independent = await finishUnit(f);
    assert.equal(
      independent.detail.units.find(
        (unit) => unit.criterion_id === f.secondCriterion,
      )?.stage,
      "ready_for_acceptance",
    );
    assert.equal(independent.detail.can_accept, false);
    assert.equal(independent.detail.waiting_results[0].job_id, admission.job);
    assert.equal((await ownedTasks(f)).length, 0);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM proposals WHERE user_id=$1",
          [f.user.id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal((await acceptScope(f, independent.detail)).statusCode, 409);
    const applied = await f.request("POST", `/proposals/${proposal}/apply`, {});
    assert.equal(applied.statusCode, 200, applied.body);
    await settleGoalExecutions("background", new Date(), [f.user.id]);
    const after = available(await details(f));
    assert.equal(after.waiting_results.length, 0);
    assert.equal(after.attempt_count, 3);
    assert.equal(
      after.units.find((unit) => unit.criterion_id === f.criterion)?.stage,
      "verify",
    );
    assert.equal((await ownedTasks(f)).length, 1);
    const verified = await finishUnit(f);
    assert.equal(verified.detail.state, "awaiting_acceptance");
    assert.equal(verified.detail.can_accept, true);
    const accepted = await acceptScope(f, verified.detail);
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().state, "completed");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM proposals WHERE user_id=$1",
          [f.user.id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal((await ownedTasks(f)).length, 1);
    assert.equal(verified.detail.attempt_count, 4);
    assert.equal(verified.detail.reserved_tokens, 0);
  } finally {
    await stopRuntime?.();
    stopRuntime = undefined;
  }
});

function providerGate() {
  let enter!: () => void, release!: () => void;
  return {
    entered: new Promise<void>((resolve) => (enter = resolve)),
    enter: () => enter(),
    released: new Promise<void>((resolve) => (release = resolve)),
    release: () => release(),
  };
}
test("Stop cancels parked and active criterion attempts and accounts both without letting an old answer wake work", async () => {
  let gate: ReturnType<typeof providerGate> | undefined;
  try {
    const { f, first, question } = await parkedQuestionFixture();
    gate = providerGate();
    scenarios.get(f.secondCriterion!)!.gate = gate;
    const other = await scanOnce(f);
    const entered = await Promise.race([
      gate.entered.then(() => true),
      new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 10000);
        timeout.unref();
      }),
    ]);
    assert.equal(
      entered,
      true,
      "Independent active attempt reaches the local provider gate",
    );
    const before = await details(f);
    const stop = await f.request(
      "POST",
      `/me/goal-executions/${before.id}/stop`,
      {
        request_id: randomUUID(),
        expected_revision: before.revision,
        generation: before.generation,
      },
    );
    assert.equal(stop.statusCode, 200, stop.body);
    assert.equal(stop.json().state, "stopped");
    gate.release();
    await Promise.all([waitJob(first.job, false), waitJob(other.job, false)]);
    await settleGoalExecutions("background", new Date(), [f.user.id]);
    const stopped = await details(f);
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.reserved_tokens, 0);
    const attempts = (
      await pool.query(
        "SELECT job_id,settled_at,processed_at,settled_tokens FROM assistant_goal_attempts WHERE execution_id=$1",
        [f.execution.id],
      )
    ).rows;
    assert.equal(attempts.length, 2);
    assert.ok(
      attempts.every((attempt) => attempt.settled_at && attempt.processed_at),
    );
    assert.equal(
      stopped.consumed_tokens,
      attempts.reduce((sum, attempt) => sum + attempt.settled_tokens, 0),
    );
    const jobs = (
      await pool.query(
        "SELECT state,apply_result FROM ai_jobs WHERE id=ANY($1::uuid[])",
        [[first.job, other.job]],
      )
    ).rows;
    assert.ok(
      jobs.every(
        (job) =>
          ["done", "failed"].includes(job.state) && job.apply_result === null,
      ),
    );
    assert.equal((await ownedTasks(f)).length, 0);
    scenarios.get(f.criterion)!.answered = true;
    const stale = await aiApp.inject({
      method: "POST",
      url: `/ai/chat/${first.job}/answer`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { waiting_id: question.id, answer: "Product" },
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(
      await scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
      0,
    );
    await settleGoalExecutions("background", new Date(), [f.user.id]);
    assert.equal((await details(f)).consumed_tokens, stopped.consumed_tokens);
  } finally {
    gate?.release();
    await stopRuntime?.();
    stopRuntime = undefined;
  }
});

async function enteredGate(gate: ReturnType<typeof providerGate>) {
  const entered = await Promise.race([
    gate.entered.then(() => true),
    new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 10000);
      timeout.unref();
    }),
  ]);
  assert.equal(
    entered,
    true,
    "The local fixture reaches its controlled provider barrier",
  );
}

test("answering A while B is running queues the same attempt behind B across two runtime replicas", async () => {
  let gate: ReturnType<typeof providerGate> | undefined;
  let secondRuntime: (() => Promise<void>) | undefined;
  try {
    const { f, first, question } = await parkedQuestionFixture();
    gate = providerGate();
    scenarios.get(f.secondCriterion!)!.gate = gate;
    const other = await scanOnce(f);
    await enteredGate(gate);
    secondRuntime = await startTestAssistantRuntime("background");
    const initialCalls = requests.filter(
      (request) => request.criterion === f.criterion,
    ).length;
    const originalAttempt = (
      await pool.query(
        "SELECT id FROM assistant_goal_attempts WHERE job_id=$1",
        [first.job],
      )
    ).rows[0].id;
    scenarios.get(f.criterion)!.answered = true;
    const answer = await aiApp.inject({
      method: "POST",
      url: `/ai/chat/${first.job}/answer`,
      headers: { authorization: `Bearer ${f.token}` },
      payload: { waiting_id: question.id, answer: "Product" },
    });
    assert.equal(answer.statusCode, 202, answer.body);
    for (let observation = 0; observation < 12; observation++) {
      const jobs = (
        await pool.query(
          "SELECT id,state FROM ai_jobs WHERE id=ANY($1::uuid[])",
          [[first.job, other.job]],
        )
      ).rows;
      assert.equal(
        jobs.find((job) => job.id === first.job)?.state,
        "queued",
        "Answered A waits behind the already-running independent job",
      );
      assert.equal(jobs.find((job) => job.id === other.job)?.state, "running");
      assert.equal(
        jobs.filter((job) => job.state === "running").length,
        1,
        "Replicas never claim two running jobs for one execution",
      );
      assert.equal(
        requests.filter((request) => request.criterion === f.criterion).length,
        initialCalls,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM assistant_goal_attempts WHERE execution_id=$1",
          [f.execution.id],
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      await scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
      0,
      "An answered queued unit cannot admit a replacement attempt",
    );
    gate.release();
    await Promise.all([waitJob(other.job), waitJob(first.job)]);
    for (let pass = 0; pass < 3; pass++)
      await settleGoalExecutions("background", new Date(), [f.user.id]);
    const settled = available(await details(f));
    assert.equal(settled.waiting_results.length, 0);
    assert.equal(settled.attempt_count, 2);
    assert.equal(settled.reserved_tokens, 0);
    assert.equal(
      (
        await pool.query(
          "SELECT id FROM assistant_goal_attempts WHERE job_id=$1",
          [first.job],
        )
      ).rows[0].id,
      originalAttempt,
    );
    assert.equal((await ownedTasks(f)).length, 2);
    await finishUnit(f);
    const final = await finishUnit(f);
    assert.equal(final.detail.state, "awaiting_acceptance");
    assert.equal(final.detail.can_accept, true);
    assert.equal(final.detail.attempt_count, 4);
    const accepted = await acceptScope(f, final.detail);
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().state, "completed");
    const usage = (
      await pool.query(
        "SELECT sum(settled_tokens)::int AS used FROM assistant_goal_attempts WHERE execution_id=$1",
        [f.execution.id],
      )
    ).rows[0];
    assert.equal(final.detail.consumed_tokens, usage.used);
    assert.equal(final.detail.reserved_tokens, 0);
    assert.equal((await ownedTasks(f)).length, 2);
  } finally {
    gate?.release();
    await secondRuntime?.();
    await stopRuntime?.();
    stopRuntime = undefined;
  }
});

test("more than forty unchanged parked questions and a saved Review cannot starve a newly terminal result", async () => {
  const old: Awaited<ReturnType<typeof fixture>>[] = [];
  // Synthetic waiting state is installed on real admitted, exactly bound jobs.
  // This avoids forty model calls; actual question parking is covered above.
  for (let index = 0; index < 41; index++) {
    const f = await fixture();
    old.push(f);
    const admitted = await scanOnce(f);
    await pool.query(
      "UPDATE ai_jobs SET state='waiting',sources_checked=true,run_state=jsonb_set(run_state,'{state,waiting}',$2::jsonb),heartbeat_at=now()-interval '1 hour' WHERE id=$1",
      [
        admitted.job,
        {
          kind: "person",
          id: randomUUID(),
          question: "Old fixture decision",
          choices: [],
        },
      ],
    );
    await settleGoalExecutions("background", new Date(), [f.user.id]);
  }
  const oldIds = old.map((f) => f.execution.id);
  const parked = (
    await pool.query(
      "SELECT count(*)::int AS n FROM assistant_goal_executions e JOIN assistant_goal_attempts a ON a.execution_id=e.id WHERE e.id=ANY($1::uuid[]) AND e.state='waiting' AND a.processed_at IS NULL AND a.settled_at IS NULL",
      [oldIds],
    )
  ).rows[0];
  assert.equal(parked.n, 41);
  const held = await fixture(true, false, true);
  const pending = await scanOnce(held);
  stopRuntime = await startTestAssistantRuntime("background");
  try {
    const pendingJob = await waitJob(pending.job);
    assert.equal(pendingJob.apply_result.structured.status, "pending_review");
    await settleGoalExecutions("background", new Date(), [held.user.id]);
    const waiting = available(await details(held));
    assert.equal(waiting.waiting_results[0].waiting_kind, "review");
    const fresh = await fixture();
    const admission = await scanOnce(fresh);
    await waitJob(admission.job);
    const changes = await settleGoalExecutions("background", new Date());
    assert.ok(
      changes >= 1,
      "Global observation reaches a new terminal producer despite the older parked backlog",
    );
    const result = available(await details(fresh));
    assert.equal(result.state, "ready", result.last_transition_reason);
    assert.equal(result.units[0].stage, "verify");
    assert.equal(result.reserved_tokens, 0);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM assistant_goal_attempts WHERE execution_id=ANY($1::uuid[]) AND processed_at IS NULL AND settled_at IS NULL",
          [oldIds],
        )
      ).rows[0].n,
      41,
      "Unchanged questions remain parked and are not falsely settled",
    );
    const stillWaiting = available(await details(held));
    assert.equal(
      stillWaiting.revision,
      waiting.revision,
      "An unchanged pending Review does not consume observation capacity or churn revisions",
    );
    assert.equal(stillWaiting.waiting_results[0].job_id, pending.job);
    assert.equal((await ownedTasks(held)).length, 0);
  } finally {
    await stopRuntime?.();
    stopRuntime = undefined;
  }
});

test("settlement recovers cancellation after a crash immediately following the committed Stop control", async () => {
  const { f, first, question } = await parkedQuestionFixture();
  await stopRuntime?.();
  stopRuntime = undefined;
  const other = await scanOnce(f);
  const before = await details(f);
  const providerCalls = requests.length;
  // Simulate process loss between domain control COMMIT and route-level stop calls.
  await transaction((db) =>
    controlGoalExecution(db, f.user.id, f.execution.id, "stop", {
      request_id: randomUUID(),
      expected_revision: before.revision,
      generation: before.generation,
    }),
  );
  const committed = (
    await pool.query(
      "SELECT state,cancel_requested FROM ai_jobs WHERE id=ANY($1::uuid[])",
      [[first.job, other.job]],
    )
  ).rows;
  assert.ok(committed.every((job) => job.cancel_requested));
  assert.ok(committed.some((job) => job.state === "waiting"));
  assert.ok(committed.some((job) => job.state === "queued"));
  await settleGoalExecutions("background", new Date(), [f.user.id]);
  const terminal = (
    await pool.query(
      "SELECT state,apply_result FROM ai_jobs WHERE id=ANY($1::uuid[])",
      [[first.job, other.job]],
    )
  ).rows;
  assert.ok(
    terminal.every(
      (job) =>
        ["done", "failed"].includes(job.state) && job.apply_result === null,
    ),
    "The normal settler finishes both cancellations without a worker wake",
  );
  await settleGoalExecutions("background", new Date(), [f.user.id]);
  const stopped = await details(f);
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.reserved_tokens, 0);
  const attempts = (
    await pool.query(
      "SELECT settled_at,processed_at,settled_tokens FROM assistant_goal_attempts WHERE execution_id=$1",
      [f.execution.id],
    )
  ).rows;
  assert.equal(attempts.length, 2);
  assert.ok(
    attempts.every((attempt) => attempt.settled_at && attempt.processed_at),
  );
  assert.equal(
    stopped.consumed_tokens,
    attempts.reduce((sum, attempt) => sum + attempt.settled_tokens, 0),
  );
  await settleGoalExecutions("background", new Date(), [f.user.id]);
  assert.equal((await details(f)).consumed_tokens, stopped.consumed_tokens);
  assert.equal(requests.length, providerCalls);
  assert.equal((await ownedTasks(f)).length, 0);
  assert.equal(
    await scanGoalExecutions("background", new Date(), { only: [f.user.id] }),
    0,
  );
  const stale = await aiApp.inject({
    method: "POST",
    url: `/ai/chat/${first.job}/answer`,
    headers: { authorization: `Bearer ${f.token}` },
    payload: { waiting_id: question.id, answer: "Product" },
  });
  assert.equal(stale.statusCode, 409, stale.body);
});
