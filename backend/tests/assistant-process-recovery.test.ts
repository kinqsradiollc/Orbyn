import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import "./setup.js";

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { initialAssistantRun } = await import("../src/modules/ai/agent/run.js");
const { beginChatTurn } = await import("../src/modules/ai/chats.js");
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
      "INSERT INTO users(email, password_hash, name) VALUES($1, 'test', 'Process recovery tester') RETURNING *",
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
async function start(pauseAfterApply = false) {
  const child = fork(
    new URL("./helpers/assistant-runner-process.ts", import.meta.url),
    [],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: {
        ...process.env,
        RUNNER_TEST_PAUSE_AFTER_APPLY: pauseAfterApply ? "true" : "false",
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

test("SIGKILL during a specialist resumes on a second process without rerunning a completed report", async () => {
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
