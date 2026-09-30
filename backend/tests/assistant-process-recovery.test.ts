import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { defaultNightShift } from "@orbyn/core";
import type { ResolvedAi } from "../src/modules/ai/providers/adapters.js";

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { initialAssistantRun } = await import("../src/modules/ai/agent/run.js");
const { beginChatTurn } = await import("../src/modules/ai/chats.js");
const { scanNightShift } = await import("../src/worker/night-shift.js");
const children = new Set<ChildProcess>();
let user: import("../src/lib/auth.js").UserRow;
let providerId: string;
let previousSettings: { provider_id: string | null; model: string };
type Request = {
  tools?: { function?: { name?: string } }[];
  messages: { role: string; content: string | null }[];
};
type Reply = { name: string; arguments: Record<string, unknown> };
let respond: (request: Request) => Reply | Promise<Reply> = () => ({
  name: "finish",
  arguments: { answer: "Ready.", steps: [] },
});
const read = async (request: IncomingMessage) => {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text;
};
const provider = createServer(async (request, response) => {
  const result = await respond(JSON.parse(await read(request)));
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              {
                id: randomUUID(),
                type: "function",
                function: {
                  name: result.name,
                  arguments: JSON.stringify(result.arguments),
                },
              },
            ],
          },
        },
      ],
    }),
  );
});

before(async () => {
  await migrate();
  user = (
    await pool.query(
      "INSERT INTO users(email, password_hash, name, email_verified) VALUES($1, 'test', 'Process recovery tester', true) RETURNING *",
      [`process-${randomUUID()}@example.test`],
    )
  ).rows[0];
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  previousSettings = (
    await pool.query("SELECT provider_id, model FROM ai_settings WHERE id")
  ).rows[0];
  providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES('openai-compatible', 'Process recovery test', $1) RETURNING id",
      [`http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id = $1, model = 'process-test' WHERE id",
    [providerId],
  );
});
after(async () => {
  for (const child of children) await end(child, "SIGKILL");
  await pool.query("DELETE FROM users WHERE id = $1", [user.id]);
  await pool.query(
    "UPDATE ai_settings SET provider_id = $1, model = $2 WHERE id",
    [previousSettings.provider_id, previousSettings.model],
  );
  await pool.query("DELETE FROM ai_providers WHERE id = $1", [providerId]);
  await pool.end();
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
});

function message(child: ChildProcess, kind: string) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`No ${kind} event from test runner`));
    }, 8000);
    const heard = (value: unknown) => {
      if (
        value &&
        typeof value === "object" &&
        "kind" in value &&
        value.kind === kind
      ) {
        cleanup();
        resolve();
      }
    };
    const exited = () => {
      cleanup();
      reject(new Error(`Test runner exited before ${kind}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("message", heard);
      child.off("exit", exited);
    };
    child.on("message", heard);
    child.on("exit", exited);
  });
}
async function start(pauseAfterApply = false, checkpointPause?: string) {
  const child = fork(
    new URL("./helpers/assistant-runner-process.ts", import.meta.url),
    [],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      env: {
        ...process.env,
        RUNNER_TEST_PAUSE_AFTER_APPLY: pauseAfterApply ? "true" : "false",
        RUNNER_TEST_PAUSE_CHECKPOINT: checkpointPause ?? "",
      },
    },
  );
  children.add(child);
  await message(child, "ready");
  return child;
}
async function end(child: ChildProcess, signal: "SIGKILL" | "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) {
    children.delete(child);
    return;
  }
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill(signal);
  await exited;
  children.delete(child);
}
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean) {
  const deadline = Date.now() + 8000;
  let value: T;
  do {
    value = await read();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.fail(`Recovery state never arrived: ${JSON.stringify(value!)}`);
}
async function enqueue(text: string) {
  const chatId = randomUUID();
  const turnId = randomUUID();
  await beginChatTurn(user, {
    chatId,
    turnId,
    message: text,
    scope: null,
    legacyHistory: [],
  });
  const checkpoint = initialAssistantRun({
    chat_id: chatId,
    turn_id: turnId,
    message: text,
    scope: null,
    timezone: "UTC",
    history: [],
  });
  const id = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id, chat_id, turn_id, state, run_state) VALUES($1, $2, $3, 'queued', $4::jsonb) RETURNING id",
      [user.id, chatId, turnId, JSON.stringify(checkpoint)],
    )
  ).rows[0].id as string;
  return { id, chatId, turnId, checkpoint };
}
const job = async (id: string) =>
  (await pool.query("SELECT * FROM ai_jobs WHERE id = $1", [id])).rows[0];

test("SIGKILL mid-night resumes its specialist and continues the saved night list", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let projects = 0;
  let writers = 0;
  respond = async (request) => {
    const names = request.tools?.map((tool) => tool.function?.name) ?? [];
    const previous = [...request.messages]
      .reverse()
      .find((entry) => entry.role === "tool");
    if (names.includes("delegate")) {
      if (!previous)
        return {
          name: "delegate",
          arguments: {
            tasks: [
              {
                specialist: "projects",
                brief: "Create a task titled Process survives",
                want_options: false,
              },
              {
                specialist: "writer",
                brief: "Check a useful brief",
                want_options: false,
              },
            ],
          },
        };
      const steps = (
        JSON.parse(previous.content ?? "[]") as { staged_step_ids: string[] }[]
      ).flatMap((report) => report.staged_step_ids ?? []);
      return {
        name: "finish",
        arguments: { answer: "The process survived.", steps },
      };
    }
    if (names.includes("create_tasks")) {
      if (!previous) {
        projects++;
        return {
          name: "create_tasks",
          arguments: { tasks: [{ title: "Process survives", kind: "task" }] },
        };
      }
      const staged = JSON.parse(previous.content ?? "{}");
      return {
        name: "report",
        arguments: {
          status: "done",
          summary: "Task staged",
          findings: [],
          steps: [staged.step_id],
          open_questions: [],
        },
      };
    }
    writers++;
    if (writers === 1) await gate;
    return {
      name: "report",
      arguments: {
        status: "done",
        summary: "Brief checked",
        findings: [],
        steps: [],
        open_questions: [],
      },
    };
  };
  const run = await enqueue(
    "Add a task called Process survives and check its brief.",
  );
  await pool.query(
    "INSERT INTO agent_settings(user_id, night_shift) VALUES($1, $2::jsonb)",
    [
      user.id,
      JSON.stringify({
        ...defaultNightShift(),
        enabled: true,
        timezone: "UTC",
        start: "22:00",
        end: "08:00",
        wait_for_ok: false,
      }),
    ],
  );
  const nightId = (
    await pool.query(
      "INSERT INTO assistant_nights(user_id,local_day,runs,summary) VALUES($1,'2050-01-02',1,$2::jsonb) RETURNING id",
      [
        user.id,
        JSON.stringify({
          candidates: [
            {
              kind: "tidy",
              title: "First night task",
              message: "Create Process survives",
            },
            {
              kind: "tidy",
              title: "Second night task",
              message: "Finish the second night task",
            },
          ],
          cursor: 1,
          end_at: "2050-01-03T08:00:00Z",
          not_done: [],
        }),
      ],
    )
  ).rows[0].id;
  run.checkpoint.request.automation = {
    kind: "night",
    night_id: nightId,
    night_kind: "tidy",
    wait_for_ok: false,
    end_at: "2050-01-03T08:00:00Z",
  };
  await pool.query("UPDATE ai_jobs SET run_state=$2::jsonb WHERE id=$1", [
    run.id,
    JSON.stringify(run.checkpoint),
  ]);
  await pool.query(
    "INSERT INTO assistant_night_runs(night_id,job_id,kind) VALUES($1,$2,'tidy')",
    [nightId, run.id],
  );
  const first = await start();
  try {
    await until(
      () => job(run.id),
      (row) => row.run_state?.state.pending_delegate?.reports.length === 1,
    );
    await end(first, "SIGKILL");
    release();
    await pool.query(
      "UPDATE ai_jobs SET lease_until = now() - interval '1 second' WHERE id = $1",
      [run.id],
    );
    const second = await start();
    const finished = await until(
      () => job(run.id),
      (row) => row.state === "done" || row.state === "failed",
    );
    assert.equal(finished.state, "done", JSON.stringify(finished));
    assert.equal(finished.resume_count, 1);
    assert.equal(projects, 1);
    assert.equal(writers, 2);
    assert.equal(
      (
        await pool.query(
          "SELECT id FROM items WHERE user_id = $1 AND title = 'Process survives'",
          [user.id],
        )
      ).rowCount,
      1,
    );
    assert.ok(
      finished.result.trace.some(
        (entry: { label: string }) =>
          entry.label === "Picking up where I left off",
      ),
    );
    respond = () => ({
      name: "finish",
      arguments: { answer: "Second night task complete.", steps: [] },
    });
    const now = new Date("2050-01-02T23:00:00Z");
    const options = { only: [user.id], ai: {} as ResolvedAi };
    assert.equal(await scanNightShift(now, options), 1);
    const nextJob = (
      await pool.query(
        "SELECT job_id FROM assistant_night_runs WHERE night_id=$1 AND job_id<>$2",
        [nightId, run.id],
      )
    ).rows[0].job_id;
    const next = await until(
      () => job(nextJob),
      (row) => row.state === "done" || row.state === "failed",
    );
    assert.equal(next.state, "done", JSON.stringify(next));
    assert.equal(await scanNightShift(now, options), 0);
    const night = (
      await pool.query(
        "SELECT status,runs,summary FROM assistant_nights WHERE id=$1",
        [nightId],
      )
    ).rows[0];
    assert.equal(night.status, "done");
    assert.equal(night.runs, 2);
    assert.equal(night.summary.cursor, 2);
    assert.equal(projects, 1);
    await end(second, "SIGTERM");
  } finally {
    release();
  }
});

test("SIGKILL after apply commits reuses its durable receipt even after client_ref expiry", async () => {
  const run = await enqueue("Add a task called Commit survives.");
  const step = {
    id: "s1",
    tool: "create_tasks" as const,
    args: { tasks: [{ title: "Commit survives", kind: "task" }] },
  };
  run.checkpoint.state.answer = "The committed task is ready.";
  run.checkpoint.state.plan = [step];
  run.checkpoint.state.selected_steps = [step];
  run.checkpoint.state.reports = [
    {
      specialist: "projects",
      task_id: "r1t1",
      status: "done",
      summary: "Staged the task",
      findings: [],
      steps: [step],
      open_questions: [],
    },
  ];
  await pool.query("UPDATE ai_jobs SET run_state = $2::jsonb WHERE id = $1", [
    run.id,
    JSON.stringify(run.checkpoint),
  ]);
  const first = await start(true);
  await message(first, "after-apply");
  const committed = await job(run.id);
  assert.equal(committed.state, "running");
  assert.equal(committed.apply_result.applied, true);
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM items WHERE user_id = $1 AND title = 'Commit survives'",
        [user.id],
      )
    ).rowCount,
    1,
  );
  await end(first, "SIGKILL");
  await pool.query(
    "UPDATE mcp_request_state SET expires_at = now() - interval '2 days' WHERE kind = 'client_ref' AND grant_id IN (SELECT id FROM agent_grants WHERE user_id = $1)",
    [user.id],
  );
  await pool.query(
    "UPDATE ai_jobs SET lease_until = now() - interval '1 second' WHERE id = $1",
    [run.id],
  );
  const second = await start();
  const finished = await until(
    () => job(run.id),
    (row) => row.state === "done" || row.state === "failed",
  );
  assert.equal(finished.state, "done", JSON.stringify(finished));
  assert.equal(
    finished.result.assistant_run.plan_job,
    committed.apply_result.structured.job,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM items WHERE user_id = $1 AND title = 'Commit survives'",
        [user.id],
      )
    ).rowCount,
    1,
  );
  const chat = (
    await pool.query("SELECT turns FROM ai_chats WHERE id = $1", [run.chatId])
  ).rows[0];
  assert.equal(
    chat.turns.filter(
      (turn: { role: string; turn_id: string }) =>
        turn.role === "assistant" && turn.turn_id === run.turnId,
    ).length,
    1,
  );
  await end(second, "SIGTERM");
});

test("a night claim and its chat roll back together when queueing fails", async () => {
  const { transaction } = await import("../src/db/pool.js");
  const { startAssistantAutomation } =
    await import("../src/modules/ai/agent/run.js");
  const before = (
    await pool.query(
      "SELECT count(*)::int AS n FROM ai_chats WHERE user_id = $1",
      [user.id],
    )
  ).rows[0].n;
  await assert.rejects(
    transaction(async (db) => {
      const night = (
        await db.query(
          "INSERT INTO assistant_nights(user_id, local_day) VALUES($1, '2099-01-01') RETURNING id",
          [user.id],
        )
      ).rows[0];
      await startAssistantAutomation({
        userId: user.id,
        message: "A night transaction",
        timezone: "UTC",
        automation: { kind: "night", night_id: night.id },
        db,
        onQueued: async () => {
          throw new Error("Simulated queue failure");
        },
      });
    }),
    /Simulated queue failure/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM ai_chats WHERE user_id = $1",
        [user.id],
      )
    ).rows[0].n,
    before,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM assistant_nights WHERE user_id = $1 AND local_day = '2099-01-01'",
        [user.id],
      )
    ).rows[0].n,
    0,
  );
});

test("night work waits in Review by default and ordinary private work applies when morning hold is off", async () => {
  for (const hold of [true, false]) {
    const title = `Night hold ${hold}-${randomUUID()}`;
    const run = await enqueue(`Create ${title}`);
    const nightId = (
      await pool.query(
        "INSERT INTO assistant_nights(user_id, local_day) VALUES($1, $2) RETURNING id",
        [user.id, hold ? "2099-01-02" : "2099-01-03"],
      )
    ).rows[0].id;
    run.checkpoint.request.automation = {
      kind: "night",
      night_id: nightId,
      night_kind: "tidy",
      wait_for_ok: hold,
    };
    const step = {
      id: "s1",
      tool: "create_tasks" as const,
      args: { tasks: [{ title, kind: "task" }] },
    };
    run.checkpoint.state.answer = "The night task is ready.";
    run.checkpoint.state.plan = [step];
    run.checkpoint.state.selected_steps = [step];
    run.checkpoint.state.reports = [
      {
        specialist: "projects",
        task_id: "night1",
        status: "done",
        summary: "Task staged",
        findings: [],
        steps: [step],
        open_questions: [],
      },
    ];
    await pool.query("UPDATE ai_jobs SET run_state = $2::jsonb WHERE id = $1", [
      run.id,
      JSON.stringify(run.checkpoint),
    ]);
    await pool.query(
      "INSERT INTO assistant_night_runs(night_id, job_id, kind) VALUES($1, $2, 'tidy')",
      [nightId, run.id],
    );
    const runner = await start();
    const completed = await until(
      () => job(run.id),
      (row) => row.state === "done" || row.state === "failed",
    );
    assert.equal(completed.state, "done", completed.error_message);
    assert.equal(
      completed.result.assistant_run.outcome,
      hold ? "pending" : "applied",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM items WHERE user_id = $1 AND title = $2",
          [user.id, title],
        )
      ).rows[0].n,
      hold ? 0 : 1,
    );
    if (hold) {
      const proposal =
        completed.apply_result.structured.proposal_id ??
        completed.apply_result.structured.pending?.proposal_id;
      assert.ok(proposal);
      assert.equal(
        (
          await pool.query(
            "SELECT status FROM proposals WHERE id = $1 AND user_id = $2",
            [String(proposal).replace(/^proposal:/, ""), user.id],
          )
        ).rows[0]?.status,
        "pending",
      );
    }
    await end(runner, "SIGTERM");
  }
});

test("a parked question survives runner replacement, accepts an answer and can be stopped from another server", async () => {
  let asked = 0;
  respond = (request) => {
    const answered = request.messages.some((entry) =>
      entry.content?.includes("The person answered your last question"),
    );
    if (!answered) {
      asked++;
      return {
        name: "ask_person",
        arguments: {
          question: "Which saved notes?",
          choices: ["Lecture 1", "Lecture 2"],
        },
      };
    }
    return {
      name: "finish",
      arguments: { answer: "Using your saved answer.", steps: [] },
    };
  };
  const run = await enqueue("Prepare my notes, and ask which ones.");
  const first = await start();
  const parked = await until(
    () => job(run.id),
    (row) => row.state === "waiting",
  );
  assert.equal(parked.run_state.state.waiting.question, "Which saved notes?");
  await end(first, "SIGKILL");
  const second = await start();
  const { buildApp } = await import("../src/app.js");
  const { issueSession } = await import("../src/lib/auth.js");
  const api = await buildApp();
  const session = await issueSession(user);
  const headers = { authorization: `Bearer ${session.token}` };
  try {
    const saved = await api.inject({
      method: "GET",
      url: `/ai/chat/${run.id}`,
      headers,
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().state, "waiting");
    assert.deepEqual(saved.json().waiting.choices, ["Lecture 1", "Lecture 2"]);
    assert.equal(
      asked,
      1,
      "replacement runners do not repeat a parked question",
    );
    const answer = await api.inject({
      method: "POST",
      url: `/ai/chat/${run.id}/answer`,
      headers,
      payload: {
        waiting_id:
          (
            await pool.query(
              "SELECT run_state->'state'->'waiting'->>'id' AS id FROM ai_jobs WHERE id=$1",
              [run.id],
            )
          ).rows[0]?.id ?? randomUUID(),
        answer: "Lecture 2",
      },
    });
    assert.equal(answer.statusCode, 202, answer.body);
    const finished = await until(
      () => job(run.id),
      (row) => row.state === "done" || row.state === "failed",
    );
    assert.equal(finished.state, "done", JSON.stringify(finished));
    const turns = (
      await pool.query("SELECT turns FROM ai_chats WHERE id=$1", [run.chatId])
    ).rows[0].turns;
    assert.equal(
      turns.filter(
        (turn: { role: string; text: string }) =>
          turn.role === "user" && turn.text === "Lecture 2",
      ).length,
      1,
    );
    const stoppedRun = await enqueue("Ask which notes again.");
    await until(
      () => job(stoppedRun.id),
      (row) => row.state === "waiting",
    );
    const stopped = await api.inject({
      method: "POST",
      url: `/ai/chat/${stoppedRun.id}/stop`,
      headers,
    });
    assert.equal(stopped.statusCode, 200, stopped.body);
    const stoppedJob = await job(stoppedRun.id);
    assert.equal(stoppedJob.state, "done");
    assert.equal(stoppedJob.result.assistant_run.outcome, "discarded");
    const lateAnswer = await api.inject({
      method: "POST",
      url: `/ai/chat/${stoppedRun.id}/answer`,
      headers,
      payload: {
        waiting_id:
          (
            await pool.query(
              "SELECT run_state->'state'->'waiting'->>'id' AS id FROM ai_jobs WHERE id=$1",
              [stoppedRun.id],
            )
          ).rows[0]?.id ?? randomUUID(),
        answer: "Lecture 1",
      },
    });
    assert.equal(lateAnswer.statusCode, 409, lateAnswer.body);
  } finally {
    await api.close();
    await end(second, "SIGTERM");
  }
});

test("Stop from a separate API process interrupts the runner's blocked provider request", async () => {
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const called = new Promise<void>((resolve) => {
    entered = resolve;
  });
  respond = async () => {
    entered();
    await blocked;
    return {
      name: "finish",
      arguments: { answer: "This late answer must not win.", steps: [] },
    };
  };
  const run = await enqueue("Wait for my stop request.");
  const runner = await start();
  await Promise.race([
    called,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Error("Provider was not called")), 8000),
    ),
  ]);
  assert.ok(
    String((await job(run.id)).claimed_by).startsWith(`${runner.pid}-`),
  );
  const { buildApp } = await import("../src/app.js");
  const { issueSession } = await import("../src/lib/auth.js");
  const api = await buildApp();
  const session = await issueSession(user);
  try {
    const stopped = await api.inject({
      method: "POST",
      url: `/ai/chat/${run.id}/stop`,
      headers: { authorization: `Bearer ${session.token}` },
    });
    assert.equal(stopped.statusCode, 200, stopped.body);
    const done = await until(
      () => job(run.id),
      (row) => row.state === "done" || row.state === "failed",
    );
    assert.equal(done.state, "done", JSON.stringify(done));
    assert.equal(done.result.assistant_run.outcome, "discarded");
    assert.ok(!String(done.result.answer).includes("late answer"));
    release();
    assert.equal((await job(run.id)).result.assistant_run.outcome, "discarded");
  } finally {
    release();
    await api.close();
    await end(runner, "SIGTERM");
  }
});

test("a full-trust night event with dynamic outside invites is staged in Review", async () => {
  const { assistantPrincipal } =
    await import("../src/modules/agents/assistant.js");
  const principal = await assistantPrincipal(user);
  await pool.query(
    "UPDATE agent_grants SET trust='full', acts_alone=ARRAY['people','publishing','teammates','bulk']::text[] WHERE id=$1",
    [principal.grant_id],
  );
  const title = `Night invite ${randomUUID()}`;
  const run = await enqueue(`Prepare ${title}`);
  const nightId = (
    await pool.query(
      "INSERT INTO assistant_nights(user_id, local_day) VALUES($1, '2099-01-04') RETURNING id",
      [user.id],
    )
  ).rows[0].id;
  run.checkpoint.request.automation = {
    kind: "night",
    night_id: nightId,
    night_kind: "meetings",
    wait_for_ok: false,
  };
  const step = {
    id: "s1",
    tool: "create_tasks" as const,
    args: {
      tasks: [
        {
          title,
          kind: "event",
          due_at: "2099-01-05T10:00:00Z",
          end_at: "2099-01-05T11:00:00Z",
          invite: ["disposable-invite@example.test"],
        },
      ],
    },
  };
  run.checkpoint.state.answer = "The event is prepared.";
  run.checkpoint.state.plan = [step];
  run.checkpoint.state.selected_steps = [step];
  await pool.query("UPDATE ai_jobs SET run_state=$2::jsonb WHERE id=$1", [
    run.id,
    JSON.stringify(run.checkpoint),
  ]);
  await pool.query(
    "INSERT INTO assistant_night_runs(night_id,job_id,kind) VALUES($1,$2,'meetings')",
    [nightId, run.id],
  );
  const runner = await start();
  try {
    const completed = await until(
      () => job(run.id),
      (row) => row.state === "done" || row.state === "failed",
    );
    assert.equal(completed.state, "done", completed.error_message);
    assert.equal(completed.result.assistant_run.outcome, "pending");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM items WHERE user_id=$1 AND title=$2",
          [user.id, title],
        )
      ).rows[0].n,
      0,
    );
    const proposal = String(completed.result.assistant_run.proposal_id).replace(
      /^proposal:/,
      "",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT status FROM proposals WHERE id=$1 AND user_id=$2",
          [proposal, user.id],
        )
      ).rows[0].status,
      "pending",
    );
  } finally {
    await end(runner, "SIGTERM");
  }
});

test("night planning moves a session at full trust when morning hold is off", async () => {
  const task = (
    await pool.query(
      "INSERT INTO items(user_id,title) VALUES($1,'Night session task') RETURNING id",
      [user.id],
    )
  ).rows[0];
  const block = (
    await pool.query(
      "INSERT INTO time_blocks(user_id,item_id,start_at,end_at,source) VALUES($1,$2,'2099-01-06T09:00:00Z','2099-01-06T10:00:00Z','manual') RETURNING id",
      [user.id, task.id],
    )
  ).rows[0];
  const run = await enqueue(
    "Move my unfinished session into tomorrow's free time.",
  );
  const nightId = (
    await pool.query(
      "INSERT INTO assistant_nights(user_id,local_day) VALUES($1,'2099-01-05') RETURNING id",
      [user.id],
    )
  ).rows[0].id;
  run.checkpoint.request.automation = {
    kind: "night",
    night_id: nightId,
    night_kind: "plan",
    wait_for_ok: false,
  };
  const step = {
    id: "s1",
    tool: "reschedule_sessions" as const,
    args: {
      changes: [
        {
          session: block.id,
          action: "move",
          start_at: "2099-01-07T09:00:00Z",
          end_at: "2099-01-07T10:00:00Z",
        },
      ],
    },
  };
  run.checkpoint.state.answer = "The session is moved.";
  run.checkpoint.state.plan = [step];
  run.checkpoint.state.selected_steps = [step];
  await pool.query("UPDATE ai_jobs SET run_state=$2::jsonb WHERE id=$1", [
    run.id,
    JSON.stringify(run.checkpoint),
  ]);
  await pool.query(
    "INSERT INTO assistant_night_runs(night_id,job_id,kind) VALUES($1,$2,'plan')",
    [nightId, run.id],
  );
  const runner = await start();
  try {
    const completed = await until(
      () => job(run.id),
      (row) => row.state === "done" || row.state === "failed",
    );
    assert.equal(completed.state, "done", completed.error_message);
    assert.equal(completed.result.assistant_run.outcome, "applied");
    assert.equal(
      (
        await pool.query("SELECT start_at FROM time_blocks WHERE id=$1", [
          block.id,
        ])
      ).rows[0].start_at.toISOString(),
      "2099-01-07T09:00:00.000Z",
    );
  } finally {
    await end(runner, "SIGTERM");
  }
});

test("a night plan with more than fifty private additions waits in Review even when bulk is allowed", async () => {
  const prefix = `Night bulk ${randomUUID()}`;
  const run = await enqueue("Prepare seventy-five private tasks.");
  const nightId = (
    await pool.query(
      "INSERT INTO assistant_nights(user_id,local_day) VALUES($1,'2099-01-06') RETURNING id",
      [user.id],
    )
  ).rows[0].id;
  run.checkpoint.request.automation = {
    kind: "night",
    night_id: nightId,
    night_kind: "tidy",
    wait_for_ok: false,
  };
  const steps = Array.from({ length: 3 }, (_, batch) => ({
    id: `s${batch}`,
    tool: "create_tasks" as const,
    args: {
      tasks: Array.from({ length: 25 }, (_, n) => ({
        title: `${prefix} ${batch * 25 + n}`,
        kind: "task",
      })),
    },
  }));
  run.checkpoint.state.answer = "The tasks are prepared.";
  run.checkpoint.state.plan = steps;
  run.checkpoint.state.selected_steps = steps;
  await pool.query("UPDATE ai_jobs SET run_state=$2::jsonb WHERE id=$1", [
    run.id,
    JSON.stringify(run.checkpoint),
  ]);
  await pool.query(
    "INSERT INTO assistant_night_runs(night_id,job_id,kind) VALUES($1,$2,'tidy')",
    [nightId, run.id],
  );
  const runner = await start();
  try {
    const completed = await until(
      () => job(run.id),
      (row) => row.state === "done" || row.state === "failed",
    );
    assert.equal(completed.state, "done", completed.error_message);
    assert.equal(completed.result.assistant_run.outcome, "pending");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM items WHERE user_id=$1 AND title LIKE $2",
          [user.id, `${prefix}%`],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await end(runner, "SIGTERM");
  }
});

for (const boundary of ["specialist", "delegate"])
  test(`SIGKILL after the ${boundary} receipt reuses staged work without another delegate`, async () => {
    const title = `Boundary ${boundary}-${randomUUID()}`;
    let stages = 0,
      reports = 0;
    respond = (request) => {
      const tools = request.tools?.map((tool) => tool.function?.name) ?? [];
      const last = [...request.messages]
        .reverse()
        .find((entry) => entry.role === "tool");
      if (tools.includes("delegate")) {
        if (!last)
          return {
            name: "delegate",
            arguments: {
              tasks: [
                {
                  specialist: "projects",
                  brief: `Create ${title}`,
                  want_options: false,
                },
              ],
            },
          };
        const results = JSON.parse(last.content ?? "[]");
        return {
          name: "finish",
          arguments: {
            answer: "Completed after recovery.",
            steps: results.flatMap(
              (row: { staged_step_ids?: string[] }) =>
                row.staged_step_ids ?? [],
            ),
          },
        };
      }
      if (!last) {
        stages++;
        return {
          name: "create_tasks",
          arguments: { tasks: [{ title, kind: "task" }] },
        };
      }
      reports++;
      return {
        name: "report",
        arguments: {
          status: "done",
          summary: "Prepared one task.",
          findings: [],
          steps: [JSON.parse(last.content ?? "{}").step_id],
          open_questions: [],
        },
      };
    };
    const run = await enqueue(`Create ${title}.`);
    const first = await start(false, boundary);
    await message(first, "checkpoint-boundary");
    const saved = await job(run.id);
    assert.ok(
      boundary === "delegate"
        ? saved.run_state.state.completed_delegate
        : Object.values(
            saved.run_state.state.pending_delegate.specialists,
          ).some(
            (row: unknown) =>
              !!(row as { completed_tool?: unknown }).completed_tool,
          ),
    );
    await end(first, "SIGKILL");
    await pool.query(
      "UPDATE ai_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [run.id],
    );
    const replacement = await start();
    const done = await until(
      () => job(run.id),
      (row) => ["done", "failed"].includes(row.state),
    );
    assert.equal(done.state, "done", done.error_message);
    assert.equal(stages, 1);
    assert.equal(reports, 1);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM items WHERE user_id=$1 AND title=$2",
          [user.id, title],
        )
      ).rows[0].n,
      1,
    );
    await end(replacement, "SIGTERM");
  });

test("disabling Night shift after queueing holds its prepared writes", async () => {
  const title = `Revoked night ${randomUUID()}`;
  const run = await enqueue(`Create ${title}`);
  const nightId = (
    await pool.query(
      "INSERT INTO assistant_nights(user_id,local_day) VALUES($1,'2099-01-09') RETURNING id",
      [user.id],
    )
  ).rows[0].id;
  run.checkpoint.request.automation = {
    kind: "night",
    night_id: nightId,
    night_kind: "tidy",
    wait_for_ok: false,
  };
  const step = {
    id: "s1",
    tool: "create_tasks" as const,
    args: { tasks: [{ title, kind: "task" }] },
  };
  run.checkpoint.state.answer = "Prepared";
  run.checkpoint.state.plan = [step];
  run.checkpoint.state.selected_steps = [step];
  await pool.query("UPDATE ai_jobs SET run_state=$2::jsonb WHERE id=$1", [
    run.id,
    JSON.stringify(run.checkpoint),
  ]);
  await pool.query(
    "UPDATE agent_settings SET night_shift=jsonb_set(night_shift,'{enabled}','false') WHERE user_id=$1",
    [user.id],
  );
  const runner = await start();
  const done = await until(
    () => job(run.id),
    (row) => ["done", "failed"].includes(row.state),
  );
  assert.equal(done.state, "failed");
  assert.match(done.error_message, /could not be completed|permission changed/);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM items WHERE user_id=$1 AND title=$2",
        [user.id, title],
      )
    ).rows[0].n,
    0,
  );
  await end(runner, "SIGTERM");
});
