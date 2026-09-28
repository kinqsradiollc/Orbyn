import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { AGENT_TOOLSETS } from "@orbyn/core";
import "./setup.js";

type Reply = { name: string; arguments: Record<string, unknown> };
type Request = {
  tools?: { function?: { name?: string }; name?: string }[];
  messages: { role: string; name?: string; content: string | null }[];
};
type MockReply = Reply | { content: string };
let respond: (request: Request) => MockReply | Promise<MockReply> = () => ({
  content: "Done.",
});
const requests: Request[] = [];
let addressNumber = 0;
const nextAddress = () => {
  const value = addressNumber++;
  return `10.91.${Math.floor(value / 250) % 250}.${(value % 250) + 1}`;
};
const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });

const provider = createServer(async (req, res) => {
  const request = JSON.parse((await read(req)) || "{}") as Request;
  requests.push(request);
  const reply = await respond(request);
  const tool = "name" in reply;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: tool ? "tool_calls" : "stop",
          message: tool
            ? {
                content: null,
                tool_calls: [
                  {
                    id: `call_${requests.length}`,
                    type: "function",
                    function: {
                      name: reply.name,
                      arguments: JSON.stringify(reply.arguments),
                    },
                  },
                ],
              }
            : { content: reply.content },
        },
      ],
    }),
  );
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
const providerUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
process.env.SMTP_HOST = "";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { scanAssistantGoals, scanAssistantRoutines } =
  await import("../src/worker/assistant-automations.js");
const { scanAssistantIdeas } = await import("../src/worker/assistant-ideas.js");
const app = await buildApp();
const users: string[] = [];
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register() {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: nextAddress(),
    payload: {
      email: `assistant-run-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Run tester",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const { token, user } = response.json();
  users.push(user.id);
  return { token: token as string, id: user.id as string };
}

async function start(token: string, message: string) {
  const response = await app.inject({
    method: "POST",
    url: "/ai/chat/start",
    remoteAddress: nextAddress(),
    headers: auth(token),
    payload: { message, timezone: "UTC" },
  });
  assert.equal(response.statusCode, 202, response.body);
  return response.json() as { id: string; chat_id: string; turn_id: string };
}

async function poll(token: string, jobId: string, wanted: string[]) {
  let result: Record<string, any> = {};
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await app.inject({
      url: `/ai/chat/${jobId}`,
      remoteAddress: nextAddress(),
      headers: auth(token),
    });
    assert.equal(response.statusCode, 200, response.body);
    result = response.json();
    if (wanted.includes(result.state)) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const job = await pool.query(
    "SELECT state, progress, run_state FROM ai_jobs WHERE id = $1",
    [jobId],
  );
  assert.fail(
    `Assistant job stayed ${result.state ?? "unknown"}: ${JSON.stringify(job.rows[0] ?? null)}`,
  );
}

function toolNames(request: Request) {
  return (request.tools ?? []).map(
    (tool) => tool.function?.name ?? tool.name ?? "",
  );
}

function stepIds(content: string | null) {
  if (!content) return [];
  try {
    const value: unknown = JSON.parse(content);
    if (!Array.isArray(value)) return [];
    return value.flatMap((report) =>
      report &&
      typeof report === "object" &&
      Array.isArray((report as { staged_step_ids?: unknown }).staged_step_ids)
        ? (report as { staged_step_ids: unknown[] }).staged_step_ids.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
    );
  } catch {
    return [];
  }
}

before(async () => {
  await migrate();
  const providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES ('openai-compatible', 'Assistant run test', $1) RETURNING id",
      [providerUrl],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1, model='assistant-run-test' WHERE id",
    [providerId],
  );
});

test("assistant chat requires a signed-in person and a valid timezone", async () => {
  const anonymous = await app.inject({
    method: "POST",
    url: "/ai/chat",
    payload: { message: "Summarize today", timezone: "UTC" },
  });
  assert.equal(anonymous.statusCode, 401);

  const user = await register();
  const invalid = await app.inject({
    method: "POST",
    url: "/ai/chat/start",
    headers: auth(user.token),
    payload: { message: "Summarize today", timezone: "Not/A-Timezone" },
  });
  assert.equal(invalid.statusCode, 422);
});

after(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await pool.query(
    "UPDATE ai_settings SET provider_id=NULL, model='' WHERE id",
  );
  await pool.query("DELETE FROM ai_providers WHERE name='Assistant run test'");
  await app.close();
  await pool.end();
  provider.close();
});

test("the lead delegates, stages specialist work, and applies one checked plan", async () => {
  requests.length = 0;
  respond = (request) => {
    const names = toolNames(request);
    const previousTool = [...request.messages]
      .reverse()
      .find((message) => message.role === "tool");
    if (names.includes("delegate")) {
      if (!previousTool)
        return {
          name: "delegate",
          arguments: {
            tasks: [
              {
                specialist: "projects",
                brief: "Stage a task named Prepare launch checklist.",
                want_options: false,
              },
            ],
          },
        };
      const steps = stepIds(previousTool.content);
      assert.equal(steps.length, 1, "the lead receives the specialist step id");
      return {
        name: "finish",
        arguments: {
          answer: "I added the launch checklist task.",
          steps,
        },
      };
    }
    if (names.includes("report")) {
      if (!previousTool)
        return {
          name: "create_tasks",
          arguments: {
            tasks: [{ title: "Prepare launch checklist", kind: "task" }],
          },
        };
      const staged = JSON.parse(previousTool.content ?? "{}") as {
        step_id?: string;
      };
      assert.ok(staged.step_id);
      return {
        name: "report",
        arguments: {
          status: "done",
          summary: "Staged the requested launch checklist task.",
          findings: [],
          steps: [staged.step_id!],
          open_questions: [],
        },
      };
    }
    return { content: "The task is staged." };
  };

  const user = await register();
  const job = await start(user.token, "Add a launch checklist task.");
  const result = await poll(user.token, job.id, ["done", "failed", "waiting"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(result.assistant_run?.outcome, "applied");
  assert.match(result.answer, /launch checklist/i);
  assert.ok(
    requests.some((request) => toolNames(request).includes("delegate")),
    "the lead used its delegation tool",
  );
  assert.ok(
    requests.some((request) => toolNames(request).includes("create_tasks")),
    "the Projects specialist used a shared MCP capability",
  );
  const made = await pool.query<{ id: string }>(
    "SELECT id FROM items WHERE user_id = $1 AND title = 'Prepare launch checklist'",
    [user.id],
  );
  assert.equal(made.rowCount, 1, "the checked plan was applied once");
});

test("a lead question pauses the run and the person's answer resumes it", async () => {
  requests.length = 0;
  let answered = false;
  respond = (request) => {
    const names = toolNames(request);
    if (!answered && names.includes("ask_person"))
      return {
        name: "ask_person",
        arguments: {
          question: "Which launch should I use?",
          choices: ["Product", "Marketing"],
        },
      };
    if (names.includes("finish"))
      return {
        name: "finish",
        arguments: {
          answer: "I’ll use the product launch.",
          steps: [],
        },
      };
    return { content: "Done." };
  };

  const user = await register();
  const job = await start(user.token, "Prepare for the launch.");
  const waiting = await poll(user.token, job.id, ["waiting", "done", "failed"]);
  assert.equal(waiting.state, "waiting", JSON.stringify(waiting));
  assert.equal(waiting.waiting?.kind, "person");
  assert.equal(waiting.waiting?.question, "Which launch should I use?");

  answered = true;
  const response = await app.inject({
    method: "POST",
    url: `/ai/chat/${job.id}/answer`,
    headers: auth(user.token),
    payload: { answer: "Product" },
  });
  assert.equal(response.statusCode, 202, response.body);
  const done = await poll(user.token, job.id, ["done", "failed"]);
  assert.equal(done.state, "done", JSON.stringify(done));
  assert.match(done.answer, /product launch/i);
  assert.ok(
    requests.length >= 2,
    "the resumed lead made another provider call",
  );
});

test("a read-only request cannot stage a change even if a specialist tries", async () => {
  requests.length = 0;
  respond = (request) => {
    const names = toolNames(request);
    const previousTool = [...request.messages]
      .reverse()
      .find((message) => message.role === "tool");
    if (names.includes("delegate"))
      return previousTool
        ? {
            name: "finish",
            arguments: { answer: "Your project is on track.", steps: [] },
          }
        : {
            name: "delegate",
            arguments: {
              tasks: [
                {
                  specialist: "projects",
                  brief: "Check the project status.",
                  want_options: false,
                },
              ],
            },
          };
    if (names.includes("report"))
      return previousTool
        ? {
            name: "report",
            arguments: {
              status: "done",
              summary: "The project is on track.",
              findings: [],
              steps: [],
              open_questions: [],
            },
          }
        : {
            name: "create_tasks",
            arguments: {
              tasks: [{ title: "Unrequested task", kind: "task" }],
            },
          };
    return { content: "Done." };
  };

  const user = await register();
  const job = await start(user.token, "What is my project status?");
  const result = await poll(user.token, job.id, ["done", "failed", "waiting"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(result.assistant_run?.outcome, "info");
  const projectRequest = requests.find((request) =>
    toolNames(request).includes("report"),
  );
  assert.ok(projectRequest);
  assert.ok(
    !toolNames(projectRequest).includes("create_tasks"),
    "write tools are not offered for a question",
  );
  const made = await pool.query(
    "SELECT 1 FROM items WHERE user_id = $1 AND title = 'Unrequested task'",
    [user.id],
  );
  assert.equal(made.rowCount, 0);
});

test("lowered assistant trust asks before applying the checked plan", async () => {
  requests.length = 0;
  respond = (request) => {
    const names = toolNames(request);
    const previousTool = [...request.messages]
      .reverse()
      .find((message) => message.role === "tool");
    if (names.includes("delegate"))
      return previousTool
        ? {
            name: "finish",
            arguments: {
              answer: "I prepared the requested task.",
              steps: stepIds(previousTool.content),
            },
          }
        : {
            name: "delegate",
            arguments: {
              tasks: [
                {
                  specialist: "projects",
                  brief: "Stage a task named Review the release notes.",
                  want_options: false,
                },
              ],
            },
          };
    if (names.includes("report"))
      return previousTool
        ? {
            name: "report",
            arguments: {
              status: "done",
              summary: "Prepared the task.",
              findings: [],
              steps: [
                (
                  JSON.parse(previousTool.content ?? "{}") as {
                    step_id: string;
                  }
                ).step_id,
              ],
              open_questions: [],
            },
          }
        : {
            name: "create_tasks",
            arguments: {
              tasks: [{ title: "Review the release notes", kind: "task" }],
            },
          };
    return { content: "Done." };
  };

  const user = await register();
  await pool.query(
    `INSERT INTO agent_grants
       (user_id, kind, name, client_name, access, team_ids, personal,
        toolsets, flags, trust)
     VALUES ($1, 'assistant', 'Orbyn Assistant', 'Orbyn Assistant', 'write',
       NULL, true, $2::text[], '{}'::jsonb, 'ask')`,
    [user.id, [...AGENT_TOOLSETS]],
  );
  const job = await start(
    user.token,
    "Add a task to review the release notes.",
  );
  const waiting = await poll(user.token, job.id, ["waiting", "done", "failed"]);
  assert.equal(waiting.state, "waiting", JSON.stringify(waiting));
  assert.equal(waiting.waiting?.kind, "approval");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM items WHERE user_id = $1 AND title = 'Review the release notes'",
        [user.id],
      )
    ).rowCount,
    0,
    "the staged task is not written before approval",
  );

  const approved = await app.inject({
    method: "POST",
    url: `/ai/chat/${job.id}/approve`,
    headers: auth(user.token),
    payload: { approved: true, scope: "once" },
  });
  assert.equal(approved.statusCode, 202, approved.body);
  const done = await poll(user.token, job.id, ["done", "failed"]);
  assert.equal(done.state, "done", JSON.stringify(done));
  assert.equal(done.assistant_run?.outcome, "applied");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM items WHERE user_id = $1 AND title = 'Review the release notes'",
        [user.id],
      )
    ).rowCount,
    1,
    "approval applies the whole checked plan once",
  );
});

test("get_context returns the private Memory topic index and filters kept-out sources", async () => {
  const user = await register();
  const project = await app.inject({
    method: "POST",
    url: "/projects",
    headers: auth(user.token),
    payload: { name: "Memory source kept out" },
  });
  assert.equal(project.statusCode, 201, project.body);
  await pool.query("UPDATE projects SET assistant_off = true WHERE id = $1", [
    project.json().id,
  ]);

  const { transaction } = await import("../src/db/pool.js");
  const { rememberMemory } = await import("../src/modules/memory/service.js");
  const { registry } = await import("../src/capabilities/index.js");
  const { execute } = await import("../src/capabilities/execute.js");
  await transaction(async (db) => {
    await rememberMemory(
      db,
      user.id,
      "Visible preference",
      ["Likes clear plans"],
      [],
    );
    await rememberMemory(
      db,
      user.id,
      "Kept-out project note",
      ["Private project detail"],
      [{ type: "project", id: project.json().id, label: "Hidden project" }],
    );
  });
  const person = (
    await pool.query<{ name: string; role: "member" }>(
      "SELECT name, role FROM users WHERE id = $1",
      [user.id],
    )
  ).rows[0];
  const principal = await assistantPrincipal({ ...person, id: user.id });
  const internal = await execute(registry, principal, "get_context", {});
  assert.equal(internal.result.isError, undefined);
  const topics = internal.result.structuredContent?.memory as string[];
  assert.ok(topics.includes("Visible preference"));
  assert.ok(!topics.includes("Kept-out project note"));

  const external = await execute(
    registry,
    { ...principal, personal: false },
    "get_context",
    {},
  );
  assert.equal(external.result.isError, undefined);
  assert.deepEqual(external.result.structuredContent?.memory, []);
});

test("assistant search excludes a project the person kept out", async () => {
  requests.length = 0;
  const user = await register();
  const project = await app.inject({
    method: "POST",
    url: "/projects",
    headers: auth(user.token),
    payload: { name: "ZEBRA_PRIVATE_PROJECT" },
  });
  assert.equal(project.statusCode, 201, project.body);
  await pool.query("UPDATE projects SET assistant_off = true WHERE id = $1", [
    project.json().id,
  ]);
  const hiddenItem = (
    await pool.query<{ id: string }>(
      `INSERT INTO items (user_id, kind, title, due_at, project_id)
       VALUES ($1, 'task', 'ZEBRA_PRIVATE_TASK', now(), $2) RETURNING id`,
      [user.id, project.json().id],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO time_blocks (item_id, user_id, start_at, end_at)
     VALUES ($1, $2, now() + interval '1 hour', now() + interval '2 hours')`,
    [hiddenItem, user.id],
  );

  respond = (request) => {
    const previousTool = [...request.messages]
      .reverse()
      .find((message) => message.role === "tool");
    return previousTool
      ? {
          name: "finish",
          arguments: {
            answer: "I found no accessible matching project.",
            steps: [],
          },
        }
      : { name: "search", arguments: { query: "private project" } };
  };

  const job = await start(user.token, "What is in my private project?");
  const result = await poll(user.token, job.id, ["done", "failed", "waiting"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.ok(
    requests.every((request) =>
      request.messages.every(
        (message) => !message.content?.includes("ZEBRA_PRIVATE_"),
      ),
    ),
    "the hidden project's task and schedule are absent from every model message",
  );
  const toolReplies = requests.flatMap((request) =>
    request.messages.filter((message) => message.role === "tool"),
  );
  assert.ok(toolReplies.length > 0);
  assert.ok(
    toolReplies.every(
      (message) => !message.content?.includes("ZEBRA_PRIVATE_PROJECT"),
    ),
    "the shared search capability does not return hidden project content",
  );
});

test("goal, routine, and idea scanners queue only eligible daily or weekly runs", async () => {
  requests.length = 0;
  respond = () => ({ content: "The scheduled review is complete." });
  const user = await register();
  const person = (
    await pool.query<{ name: string; role: "member" }>(
      "SELECT name, role FROM users WHERE id = $1",
      [user.id],
    )
  ).rows[0];
  await assistantPrincipal({ ...person, id: user.id });

  const goalId = (
    await pool.query<{ id: string }>(
      `INSERT INTO goals (user_id, title, target)
       VALUES ($1, 'Ship the capstone', 'Submit the final project') RETURNING id`,
      [user.id],
    )
  ).rows[0].id;
  const now = new Date();
  const routineId = (
    await pool.query<{ id: string }>(
      `INSERT INTO agent_routines
         (user_id, instruction, rrule, timezone, next_run_at)
       VALUES ($1, 'Review capstone tasks', 'FREQ=DAILY', 'UTC', $2)
       RETURNING id`,
      [user.id, new Date(now.getTime() - 24 * 60 * 60 * 1000)],
    )
  ).rows[0].id;

  assert.equal(await scanAssistantGoals(now, { only: [user.id] }), 1);
  const checkin = (
    await pool.query<{ job_id: string; week_of: string }>(
      "SELECT job_id, week_of::text FROM goals_checkins WHERE goal_id = $1",
      [goalId],
    )
  ).rows[0];
  assert.ok(checkin.job_id);
  assert.equal(
    (await poll(user.token, checkin.job_id, ["done", "failed", "waiting"]))
      .state,
    "done",
  );
  assert.equal(await scanAssistantGoals(now, { only: [user.id] }), 0);

  assert.equal(await scanAssistantRoutines(now, { only: [user.id] }), 1);
  const routine = (
    await pool.query<{
      current_job_id: string | null;
      next_run_at: Date;
      paused: boolean;
    }>(
      "SELECT current_job_id, next_run_at, paused FROM agent_routines WHERE id = $1",
      [routineId],
    )
  ).rows[0];
  assert.ok(routine.current_job_id);
  assert.ok(new Date(routine.next_run_at).getTime() > now.getTime());
  assert.equal(routine.paused, false);
  assert.equal(
    (
      await poll(user.token, routine.current_job_id!, [
        "done",
        "failed",
        "waiting",
      ])
    ).state,
    "done",
  );
  assert.equal(await scanAssistantRoutines(now, { only: [user.id] }), 0);
  const completedRoutine = (
    await pool.query<{ current_job_id: string | null; last_result: unknown }>(
      "SELECT current_job_id, last_result FROM agent_routines WHERE id = $1",
      [routineId],
    )
  ).rows[0];
  assert.equal(completedRoutine.current_job_id, null);
  assert.equal(
    (completedRoutine.last_result as { summary?: string }).summary,
    "The scheduled review is complete.",
  );

  assert.equal(await scanAssistantIdeas(now, { only: [user.id] }), 1);
  assert.equal(await scanAssistantIdeas(now, { only: [user.id] }), 0);
  let finishedAt: Date | null = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    finishedAt =
      (
        await pool.query<{ finished_at: Date | null }>(
          `SELECT finished_at FROM assistant_idea_days
          WHERE user_id = $1 AND local_day = $2::date`,
          [user.id, now.toISOString().slice(0, 10)],
        )
      ).rows[0]?.finished_at ?? null;
    if (finishedAt) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(
    finishedAt,
    "the daily idea claim is completed by the assistant job",
  );
});

test("a plain question is answered by the lead without delegation", async () => {
  requests.length = 0;
  respond = () => ({ content: "Your next exam is Biology on Friday." });
  const user = await register();
  const job = await start(user.token, "When is my next exam?");
  const result = await poll(user.token, job.id, ["done", "failed", "waiting"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.match(result.answer, /Biology/);
  assert.equal(result.assistant_run?.reports.length, 0);
});

test("exam revision checks Study and the calendar, asks about session length, then applies and undoes one plan", async () => {
  requests.length = 0;
  let studyRuns = 0;
  let resumed = false;
  let revisionMinutes = 0;
  respond = (request) => {
    const names = toolNames(request);
    const previousTool = [...request.messages]
      .reverse()
      .find((message) => message.role === "tool");
    const answered = request.messages.some(
      (message) =>
        message.role === "system" &&
        message.content?.includes("The person answered your last question"),
    );

    if (names.includes("delegate")) {
      if (answered) resumed = true;
      if (!previousTool)
        return {
          name: "delegate",
          arguments: {
            tasks: answered
              ? [
                  {
                    specialist: "study",
                    brief:
                      "Use the person's chosen 50-minute sessions for revision.",
                    want_options: false,
                  },
                ]
              : [
                  {
                    specialist: "study",
                    brief:
                      "Review the Biology final and offer useful revision options.",
                    want_options: true,
                  },
                  {
                    specialist: "planner",
                    brief: "Check free working time before the Biology final.",
                    want_options: false,
                  },
                ],
          },
        };
      if (!answered)
        return {
          name: "ask_person",
          arguments: {
            question:
              "Would you prefer focused 25-minute sessions or longer 50-minute blocks?",
            choices: ["25-minute sessions", "50-minute blocks"],
          },
        };
      const ids = stepIds(previousTool.content);
      return {
        name: "finish",
        arguments: {
          answer:
            "I checked your Biology notes and calendar, then scheduled the 50-minute revision blocks you chose.",
          steps: ids,
        },
      };
    }

    if (names.includes("report") && names.includes("get_study")) {
      if (!previousTool) {
        studyRuns++;
        return { name: "get_study", arguments: {} };
      }
      const previous = JSON.parse(previousTool.content ?? "{}") as Record<
        string,
        unknown
      >;
      if (studyRuns === 1)
        return {
          name: "report",
          arguments: {
            status: "needs_choice",
            summary:
              "The Biology final is in 10 days; either session length fits before it.",
            findings: ["The Study deck has Biology revision cards."],
            steps: [],
            options: ["25-minute sessions", "50-minute blocks"],
            open_questions: ["Which session length would you prefer?"],
          },
        };
      if (Array.isArray(previous.exams)) {
        const exam = (previous.exams as { key: string; title: string }[]).find(
          (entry) => entry.title === "Biology final",
        );
        assert.ok(exam, "Study returned the requested exam");
        revisionMinutes = 50;
        return {
          name: "plan_revision",
          arguments: { exam: exam.key, minutes: revisionMinutes },
        };
      }
      if (typeof previous.plan_token === "string") {
        assert.ok(
          (previous.sessions as unknown[] | undefined)?.length,
          "revision has free sessions before the exam",
        );
        return {
          name: "schedule_sessions",
          arguments: { plan_token: previous.plan_token },
        };
      }
      const staged = previous as { step_id?: string };
      assert.ok(staged.step_id, "the planner change is staged for the lead");
      return {
        name: "report",
        arguments: {
          status: "done",
          summary: "Scheduled the chosen revision plan for Biology.",
          findings: ["The sessions fit the available time before the exam."],
          steps: [staged.step_id],
          open_questions: [],
        },
      };
    }

    if (names.includes("get_calendar") && names.includes("report")) {
      if (!previousTool)
        return {
          name: "get_calendar",
          arguments: { days: 14, free_minutes: 30 },
        };
      return {
        name: "report",
        arguments: {
          status: "done",
          summary: "Checked calendar availability before the exam.",
          findings: ["There is free working time for revision."],
          steps: [],
          open_questions: [],
        },
      };
    }

    if (answered) resumed = true;
    return { content: "The exam preparation is ready." };
  };

  const user = await register();
  await pool.query(
    `INSERT INTO agent_settings (user_id, name, persona)
     VALUES ($1, 'Muse', 'A careful planning partner.')`,
    [user.id],
  );
  const prefs = await app.inject({
    method: "PUT",
    url: "/planner/prefs",
    headers: auth(user.token),
    payload: {
      timezone: "UTC",
      work_days: [0, 1, 2, 3, 4, 5, 6],
      work_start: "09:00",
      work_end: "17:00",
    },
  });
  assert.equal(prefs.statusCode, 200, prefs.body);
  const doc = await app.inject({
    method: "POST",
    url: "/docs",
    headers: auth(user.token),
    payload: {
      title: "Biology revision notes",
      content: [
        {
          type: "paragraph",
          text: "What does DNA encode? :: Genetic instructions",
        },
      ],
    },
  });
  assert.equal(doc.statusCode, 201, doc.body);
  const docId = doc.json().id as string;
  await pool.query(
    `INSERT INTO study_cards (user_id, doc_id, card_key, question, answer)
     VALUES ($1, $2, 'biology-dna', 'What does DNA encode?', 'Genetic instructions')`,
    [user.id, docId],
  );
  const examKey = `own:${randomUUID()}`;
  const examDate = new Date(Date.now() + 10 * 86_400_000);
  await pool.query(
    `INSERT INTO study_exams
       (user_id, exam_key, title, starts_at, all_day, own, doc_ids, target)
     VALUES ($1, $2, 'Biology final', $3, true, true, $4::uuid[], '80%')`,
    [user.id, examKey, examDate, [docId]],
  );

  const job = await start(
    user.token,
    "Plan revision for my Biology final in 10 days using my notes and calendar.",
  );
  const waiting = await poll(user.token, job.id, ["waiting", "done", "failed"]);
  assert.equal(waiting.state, "waiting", JSON.stringify(waiting));
  assert.equal(waiting.waiting?.kind, "person");
  assert.deepEqual(waiting.waiting?.choices, [
    "25-minute sessions",
    "50-minute blocks",
  ]);
  const answer = await app.inject({
    method: "POST",
    url: `/ai/chat/${job.id}/answer`,
    remoteAddress: nextAddress(),
    headers: auth(user.token),
    payload: { answer: "50-minute blocks" },
  });
  assert.equal(answer.statusCode, 202, answer.body);
  const result = await poll(user.token, job.id, ["done", "failed"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(resumed, true);
  assert.equal(result.assistant_run?.outcome, "applied");
  assert.match(result.answer, /50-minute/i);
  assert.equal(revisionMinutes, 50, "the answer controls the session length");
  const task = (
    await pool.query<{ id: string }>(
      "SELECT id FROM items WHERE user_id = $1 AND title = 'Revise for Biology final'",
      [user.id],
    )
  ).rows[0];
  assert.ok(task, "the one checked plan created the revision task");
  const blocks = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM time_blocks WHERE user_id = $1 AND item_id = $2",
    [user.id, task.id],
  );
  assert.ok(
    blocks.rows[0].count > 0,
    "the selected sessions are on the calendar",
  );
  const planJob = result.assistant_run?.plan_job as string;
  assert.ok(planJob, "the applied revision plan has one undoable job id");
  const connected = await app.inject({
    method: "GET",
    url: "/me/agents",
    headers: auth(user.token),
  });
  assert.equal(connected.statusCode, 200, connected.body);
  const grant = connected
    .json()
    .grants.find(
      (entry: { id: string; kind: string }) => entry.kind === "assistant",
    );
  assert.ok(grant);
  assert.equal(grant.name, "Muse", "Connected agents uses the named agent");
  const activity = await app.inject({
    method: "GET",
    url: `/me/agents/${grant.id}/activity`,
    headers: auth(user.token),
  });
  assert.equal(activity.statusCode, 200, activity.body);
  assert.ok(
    activity
      .json()
      .some(
        (entry: { job: string | null; undoable: boolean }) =>
          entry.job === planJob && entry.undoable,
      ),
    "the assistant's checked plan appears in Connected agents activity",
  );
  const via = await pool.query<{ client_name: string }>(
    `SELECT DISTINCT client_name FROM agent_activity
      WHERE grant_id = $1 AND request_id = $2`,
    [grant.id, planJob],
  );
  assert.ok(via.rows.length > 0);
  assert.ok(via.rows.every((row) => row.client_name === "Muse"));
  const undone = await app.inject({
    method: "POST",
    url: `/me/agents/${grant.id}/jobs/${planJob}/undo`,
    headers: auth(user.token),
  });
  assert.equal(undone.statusCode, 200, undone.body);
  assert.ok(undone.json().undone > 0);
  assert.equal(
    (await pool.query("SELECT 1 FROM items WHERE id = $1", [task.id])).rowCount,
    0,
    "one undo removes the revision task and its sessions",
  );
});

test("the lead stops after two delegation rounds without new findings", async () => {
  requests.length = 0;
  let completedRounds = 0;
  let sawStagnantLimit = false;
  let delegateAttempts = 0;
  respond = (request) => {
    const names = toolNames(request);
    const previousTool = [...request.messages]
      .reverse()
      .find((message) => message.role === "tool");
    if (names.includes("delegate")) {
      if (
        previousTool?.content?.includes(
          "Two delegation rounds made no progress",
        )
      ) {
        sawStagnantLimit = true;
        return {
          name: "finish",
          arguments: { answer: "I have no new findings to add.", steps: [] },
        };
      }
      delegateAttempts++;
      return {
        name: "delegate",
        arguments: {
          tasks: [
            {
              specialist: "memory",
              brief: `Check whether private Memory has a useful priority preference, round ${delegateAttempts}.`,
              want_options: false,
            },
          ],
        },
      };
    }
    if (names.includes("report")) {
      completedRounds++;
      return {
        name: "report",
        arguments: {
          status: "done",
          summary: "No additional priority preference was found.",
          findings: [],
          steps: [],
          open_questions: [],
        },
      };
    }
    return { content: "No new preference was found." };
  };

  const user = await register();
  const job = await start(user.token, "Help me think through my priorities.");
  const result = await poll(user.token, job.id, ["done", "failed", "waiting"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(completedRounds, 2);
  assert.equal(result.assistant_run?.reports.length, 2);
  assert.equal(
    sawStagnantLimit,
    true,
    "the lead receives the code-enforced no-progress limit",
  );
});

test("a lead cannot start more than 12 specialist runs", async () => {
  requests.length = 0;
  let reports = 0;
  let delegateCalls = 0;
  let sawRunLimit = false;
  respond = (request) => {
    const names = toolNames(request);
    const previousTool = [...request.messages]
      .reverse()
      .find((message) => message.role === "tool");
    if (names.includes("delegate")) {
      if (
        previousTool?.content?.includes("allows at most 12 specialist runs")
      ) {
        sawRunLimit = true;
        return {
          name: "finish",
          arguments: {
            answer: "I stopped at the specialist run limit.",
            steps: [],
          },
        };
      }
      delegateCalls++;
      return {
        name: "delegate",
        arguments: {
          tasks: Array.from(
            { length: delegateCalls <= 4 ? 3 : 1 },
            (_, index) => ({
              specialist: "memory",
              brief: `Check one priority preference, round ${delegateCalls}, task ${index + 1}.`,
              want_options: false,
            }),
          ),
        },
      };
    }
    if (names.includes("report")) {
      reports++;
      return {
        name: "report",
        arguments: {
          status: "done",
          summary: "Checked one priority preference.",
          findings: [`Distinct finding ${reports}`],
          steps: [],
          open_questions: [],
        },
      };
    }
    return { content: "The run limit is reached." };
  };

  const user = await register();
  const job = await start(user.token, "Help me review all my priorities.");
  const result = await poll(user.token, job.id, ["done", "failed", "waiting"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(reports, 12);
  assert.equal(result.assistant_run?.reports.length, 12);
  assert.ok(
    delegateCalls >= 5,
    "the lead attempts another delegation after 12 reports",
  );
  assert.equal(
    sawRunLimit,
    true,
    "the lead receives the code-enforced total specialist limit",
  );
});

test("the combined checker reports duplicate task changes before any apply", async () => {
  requests.length = 0;
  let checkerFeedback = false;
  let taskId = "";
  respond = (request) => {
    const names = toolNames(request);
    const previousTool = [...request.messages]
      .reverse()
      .find((message) => message.role === "tool");
    if (names.includes("delegate")) {
      if (!previousTool)
        return {
          name: "delegate",
          arguments: {
            tasks: [
              {
                specialist: "projects",
                brief: "Rename the existing task to Draft the biology summary.",
                want_options: false,
              },
              {
                specialist: "projects",
                brief: "Complete the same existing task.",
                want_options: false,
              },
            ],
          },
        };
      const content = previousTool.content ?? "";
      checkerFeedback = /conflicting .* changes to the same item/i.test(
        content,
      );
      return {
        name: "finish",
        arguments: {
          answer: checkerFeedback
            ? "I held both changes because they target the same task."
            : "I could not safely check the combined plan.",
          steps: [],
        },
      };
    }
    if (names.includes("report")) {
      if (!previousTool) {
        const requestText = request.messages.at(-1)?.content ?? "";
        if (/Rename the existing task/.test(requestText))
          return {
            name: "update_tasks",
            arguments: {
              changes: [
                {
                  id: `task:${taskId}`,
                  version: 1,
                  title: "Draft the biology summary",
                },
              ],
            },
          };
        return {
          name: "complete_tasks",
          arguments: {
            tasks: [{ id: `task:${taskId}`, version: 1, done: true }],
          },
        };
      }
      const staged = JSON.parse(previousTool.content ?? "{}") as {
        step_id?: string;
      };
      return {
        name: "report",
        arguments: {
          status: "done",
          summary: "Staged the requested task change.",
          findings: [],
          steps: staged.step_id ? [staged.step_id] : [],
          open_questions: [],
        },
      };
    }
    return { content: "The task changes need review." };
  };

  const user = await register();
  const created = await app.inject({
    method: "POST",
    url: "/items",
    headers: auth(user.token),
    payload: { title: "Review the biology chapter", kind: "task" },
  });
  assert.equal(created.statusCode, 201, created.body);
  taskId = created.json().id as string;
  const job = await start(
    user.token,
    "Rename my biology review task and complete it.",
  );
  const result = await poll(user.token, job.id, ["done", "failed", "waiting"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(checkerFeedback, true);
  assert.ok(
    result.assistant_run.reports.every(
      (report: { status: string }) => report.status === "blocked",
    ),
  );
  assert.ok(
    result.assistant_run.reports.some((report: { findings: string[] }) =>
      report.findings.some((finding) =>
        /conflicting .* changes to the same item/i.test(finding),
      ),
    ),
  );
  const unchanged = await pool.query<{ title: string; status: string }>(
    "SELECT title, status FROM items WHERE id = $1",
    [taskId],
  );
  assert.equal(unchanged.rows[0].title, "Review the biology chapter");
  assert.equal(unchanged.rows[0].status, "todo");
});

test("stopping while the assistant waits for approval leaves staged changes unapplied", async () => {
  requests.length = 0;
  respond = (request) => {
    const names = toolNames(request);
    const previousTool = [...request.messages]
      .reverse()
      .find((message) => message.role === "tool");
    if (!names.length)
      return { content: "I stopped while approval was pending." };
    if (names.includes("delegate"))
      return previousTool
        ? {
            name: "finish",
            arguments: {
              answer: "The task is ready for your approval.",
              steps: stepIds(previousTool.content),
            },
          }
        : {
            name: "delegate",
            arguments: {
              tasks: [
                {
                  specialist: "projects",
                  brief: "Stage a task named Review the draft chapters.",
                  want_options: false,
                },
              ],
            },
          };
    if (names.includes("report"))
      return previousTool
        ? {
            name: "report",
            arguments: {
              status: "done",
              summary: "Staged the draft chapter review task.",
              findings: [],
              steps: [
                (
                  JSON.parse(previousTool.content ?? "{}") as {
                    step_id: string;
                  }
                ).step_id,
              ],
              open_questions: [],
            },
          }
        : {
            name: "create_tasks",
            arguments: {
              tasks: [{ title: "Review the draft chapters", kind: "task" }],
            },
          };
    return { content: "Approval is required." };
  };

  const user = await register();
  await pool.query(
    `INSERT INTO agent_grants
       (user_id, kind, name, client_name, access, team_ids, personal,
        toolsets, flags, trust)
     VALUES ($1, 'assistant', 'Orbyn Assistant', 'Orbyn Assistant', 'write',
       NULL, true, $2::text[], '{}'::jsonb, 'ask')`,
    [user.id, [...AGENT_TOOLSETS]],
  );
  const job = await start(
    user.token,
    "Add a task to review the draft chapters.",
  );
  const waiting = await poll(user.token, job.id, ["waiting", "done", "failed"]);
  assert.equal(waiting.state, "waiting", JSON.stringify(waiting));
  assert.equal(waiting.waiting?.kind, "approval");
  const stopped = await app.inject({
    method: "POST",
    url: `/ai/chat/${job.id}/stop`,
    remoteAddress: nextAddress(),
    headers: auth(user.token),
  });
  assert.equal(stopped.statusCode, 200, stopped.body);
  const result = await poll(user.token, job.id, ["done", "failed"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(result.assistant_run?.outcome, "discarded");
  assert.match(result.answer, /stopped|approval/i);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM items WHERE user_id = $1 AND title = 'Review the draft chapters'",
        [user.id],
      )
    ).rowCount,
    0,
  );
});

test("stopping a running provider call finishes the job without staged changes", async () => {
  requests.length = 0;
  let enteredProvider!: () => void;
  let releaseProvider: ((reply: MockReply) => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    enteredProvider = resolve;
  });
  respond = (request) => {
    if (toolNames(request).includes("delegate")) {
      enteredProvider();
      return new Promise<MockReply>((resolve) => {
        releaseProvider = resolve;
      });
    }
    return { content: "I stopped before any changes were staged." };
  };

  const user = await register();
  const job = await start(
    user.token,
    "Review my priorities and suggest next steps.",
  );
  await entered;
  const stopped = await app.inject({
    method: "POST",
    url: `/ai/chat/${job.id}/stop`,
    remoteAddress: nextAddress(),
    headers: auth(user.token),
  });
  assert.equal(stopped.statusCode, 200, stopped.body);
  releaseProvider?.({ content: "A late provider response." });

  const result = await poll(user.token, job.id, ["done", "failed"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(result.assistant_run?.outcome, "discarded");
  assert.match(result.answer, /stopped/i);
});

test("stopping at a person question preserves completed work for approval", async () => {
  requests.length = 0;
  respond = (request) => {
    const names = toolNames(request);
    const previousTool = [...request.messages]
      .reverse()
      .find((message) => message.role === "tool");
    if (names.includes("delegate"))
      return previousTool
        ? {
            name: "ask_person",
            arguments: {
              question: "Should I add a review date to this task?",
              choices: ["Yes", "No"],
            },
          }
        : {
            name: "delegate",
            arguments: {
              tasks: [
                {
                  specialist: "projects",
                  brief: "Stage a task named Check chapter references.",
                  want_options: false,
                },
              ],
            },
          };
    if (names.includes("report")) {
      if (!previousTool)
        return {
          name: "create_tasks",
          arguments: {
            tasks: [{ title: "Check chapter references", kind: "task" }],
          },
        };
      const staged = JSON.parse(previousTool.content ?? "{}") as {
        step_id?: string;
      };
      return {
        name: "report",
        arguments: {
          status: "done",
          summary: "Staged the chapter reference check.",
          findings: [],
          steps: staged.step_id ? [staged.step_id] : [],
          open_questions: [],
        },
      };
    }
    return { content: "The run stopped with staged work." };
  };

  const user = await register();
  await pool.query(
    `INSERT INTO agent_grants
       (user_id, kind, name, client_name, access, team_ids, personal,
        toolsets, flags, trust)
     VALUES ($1, 'assistant', 'Orbyn Assistant', 'Orbyn Assistant', 'write',
       NULL, true, $2::text[], '{}'::jsonb, 'ask')`,
    [user.id, [...AGENT_TOOLSETS]],
  );
  const job = await start(
    user.token,
    "Add a task to check chapter references.",
  );
  const question = await poll(user.token, job.id, [
    "waiting",
    "done",
    "failed",
  ]);
  assert.equal(question.state, "waiting", JSON.stringify(question));
  assert.equal(question.waiting?.kind, "person");
  const saved = await pool.query<{
    run_state: { state?: { plan?: unknown[] } };
  }>("SELECT run_state FROM ai_jobs WHERE id = $1", [job.id]);
  assert.equal(saved.rows[0].run_state.state?.plan?.length, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM items WHERE user_id = $1 AND title = 'Check chapter references'",
        [user.id],
      )
    ).rowCount,
    0,
    "staged work is still unapplied before approval",
  );

  const stopped = await app.inject({
    method: "POST",
    url: `/ai/chat/${job.id}/stop`,
    remoteAddress: nextAddress(),
    headers: auth(user.token),
  });
  assert.equal(stopped.statusCode, 200, stopped.body);
  const approval = await poll(user.token, job.id, [
    "waiting",
    "done",
    "failed",
  ]);
  assert.equal(approval.state, "waiting", JSON.stringify(approval));
  assert.equal(approval.waiting?.kind, "approval");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM items WHERE user_id = $1 AND title = 'Check chapter references'",
        [user.id],
      )
    ).rowCount,
    0,
  );
  const approved = await app.inject({
    method: "POST",
    url: `/ai/chat/${job.id}/approve`,
    remoteAddress: nextAddress(),
    headers: auth(user.token),
    payload: { approved: true, scope: "once" },
  });
  assert.equal(approved.statusCode, 202, approved.body);
  const result = await poll(user.token, job.id, ["done", "failed"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(result.assistant_run?.outcome, "applied");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM items WHERE user_id = $1 AND title = 'Check chapter references'",
        [user.id],
      )
    ).rowCount,
    1,
  );
});

test("a specialist stops at its configured tool-loop limit without reporting changes", async () => {
  requests.length = 0;
  respond = (request) => {
    const names = toolNames(request);
    if (names.includes("report"))
      return {
        name: "search",
        arguments: { query: `limit-check-${requests.length}` },
      };
    return { content: "Searching is still in progress." };
  };
  const user = await register();
  const person = (
    await pool.query<{ name: string; role: "member" }>(
      "SELECT name, role FROM users WHERE id = $1",
      [user.id],
    )
  ).rows[0];
  const principal = await assistantPrincipal({ ...person, id: user.id });
  const { resolveAi } = await import("../src/modules/ai/providers/resolve.js");
  const { runSpecialist } =
    await import("../src/modules/ai/agent/specialist.js");
  const ai = await resolveAi();
  assert.ok(ai);
  const report = await runSpecialist({
    ai,
    principal,
    task: {
      id: "limit-test",
      specialist: "memory",
      brief: "Check whether Memory has a useful priority preference.",
      want_options: false,
    },
    timezone: "UTC",
    identity: { name: "Orbyn", persona: "" },
    memory: "",
    priorSteps: [],
    allowChanges: false,
    maxSteps: 2,
  });
  assert.equal(report.status, "partial");
  assert.match(report.summary, /step limit/i);
  assert.equal(report.steps.length, 0);
  assert.equal(requests.length, 2);
});
