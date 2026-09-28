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
  tool_choice?: unknown;
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
const { cachedSettings } = await import("../src/lib/settings.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { scanAssistantIdeas } = await import("../src/worker/assistant-ideas.js");
const { scanAssistantGoals } = await import("../src/worker/assistant-goals.js");
const { scanAssistantRoutines } =
  await import("../src/worker/assistant-routines.js");
const { assistantRunLimits, failStaleAssistantJobs, startAssistantAutomation } =
  await import("../src/modules/ai/agent/run.js");
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

async function poll(
  token: string,
  jobId: string,
  wanted: string[],
  attempts = 100,
) {
  let result: Record<string, any> = {};
  for (let attempt = 0; attempt < attempts; attempt++) {
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
  const saved = await app.inject({
    url: `/ai/chats/${job.chat_id}`,
    headers: auth(user.token),
  });
  assert.equal(
    saved
      .json()
      .turns.find(
        (turn: { role: string; turn_id: string }) =>
          turn.role === "assistant" && turn.turn_id === job.turn_id,
      ).changes_job,
    result.assistant_run.plan_job,
  );
  const receipt = (
    await pool.query("SELECT apply_result FROM ai_jobs WHERE id = $1", [job.id])
  ).rows[0].apply_result;
  assert.equal(receipt.applied, true);
  // A committed apply can outlive the general client_ref cache during an outage.
  await pool.query(
    "UPDATE mcp_request_state SET expires_at = now() - interval '2 days' WHERE kind = 'client_ref' AND grant_id IN (SELECT id FROM agent_grants WHERE user_id = $1)",
    [user.id],
  );
  const { initialAssistantRun } =
    await import("../src/modules/ai/agent/run.js");
  const checkpoint = initialAssistantRun({
    message: "Add a launch checklist task.",
    history: [],
    timezone: "UTC",
    chat_id: job.chat_id,
    turn_id: job.turn_id,
    scope: null,
  });
  checkpoint.state.answer = "I added the launch checklist task.";
  checkpoint.state.selected_steps = [
    {
      id: "s1",
      tool: "create_tasks",
      args: { tasks: [{ title: "Prepare launch checklist", kind: "task" }] },
    },
  ];
  checkpoint.state.plan = checkpoint.state.selected_steps;
  const providerCalls = requests.length;
  await pool.query(
    "UPDATE ai_jobs SET state = 'queued', run_state = $2::jsonb, claimed_by = NULL, lease_until = NULL WHERE id = $1",
    [job.id, JSON.stringify(checkpoint)],
  );
  const resumed = await poll(user.token, job.id, ["done", "failed"]);
  assert.equal(resumed.state, "done", JSON.stringify(resumed));
  assert.equal(resumed.assistant_run.plan_job, result.assistant_run.plan_job);
  assert.equal(
    requests.length,
    providerCalls,
    "the completed lead was not rerun",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM items WHERE user_id = $1 AND title = 'Prepare launch checklist'",
        [user.id],
      )
    ).rowCount,
    1,
  );
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

test("the idea scanner claims and finishes up to three daily slots", async () => {
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

  const now = new Date();
  assert.equal(await scanAssistantIdeas(now, { only: [user.id] }), 3);
  assert.equal(await scanAssistantIdeas(now, { only: [user.id] }), 0);
  let finished = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    finished =
      (
        await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM assistant_idea_days
          WHERE user_id = $1 AND local_day = $2::date AND finished_at IS NOT NULL`,
          [user.id, now.toISOString().slice(0, 10)],
        )
      ).rows[0]?.count ?? 0;
    if (finished === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(finished, 3, "all three daily idea slots are completed");
});

test("an idea run that stages a change files it in Review and records it for Today", async () => {
  requests.length = 0;
  respond = stageTask("Idea review task", () => ({
    name: "finish",
    arguments: { answer: "One idea: add the review task.", steps: [] },
  }));
  const user = await register();
  const jobId = await startAssistantAutomation({
    userId: user.id,
    message: "Suggest one useful next step as a task named Idea review task.",
    timezone: "UTC",
    automation: { kind: "idea", local_day: "2026-09-28", slot: 1 },
  });
  assert.ok(jobId);
  await poll(user.token, jobId, ["done", "failed"]);
  assert.equal(await itemCount(user.id, "Idea review task"), 0);
  const idea = (
    await pool.query<{
      proposal_id: string | null;
      title: string;
      summary: string;
    }>(
      "SELECT proposal_id, title, summary FROM assistant_ideas WHERE user_id = $1",
      [user.id],
    )
  ).rows[0];
  assert.ok(idea?.proposal_id, "the idea points at its Review proposal");
  assert.equal(idea.title, "One idea: add the review task.");
  assert.doesNotMatch(idea.summary, /put these changes in Review/);
  assert.equal(
    idea.summary,
    idea.title,
    "a one-sentence idea repeats its title",
  );
  const listed = await app.inject({
    method: "GET",
    url: "/ai/chats",
    remoteAddress: nextAddress(),
    headers: auth(user.token),
  });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(
    (listed.json() as unknown[]).length,
    0,
    "an idea run's chat stays out of the chat list",
  );
});

test("the weekly goal scanner claims one local week and excludes kept-out work", async () => {
  requests.length = 0;
  respond = () => ({ content: "The weekly goal review is complete." });
  const user = await register();
  const person = (
    await pool.query<{ name: string; role: "member" }>(
      "SELECT name, role FROM users WHERE id = $1",
      [user.id],
    )
  ).rows[0];
  await assistantPrincipal({ ...person, id: user.id });
  await pool.query(
    `INSERT INTO planner_prefs (user_id, timezone) VALUES ($1, 'Australia/Melbourne')
     ON CONFLICT (user_id) DO UPDATE SET timezone = EXCLUDED.timezone`,
    [user.id],
  );
  const hiddenProject = await app.inject({
    method: "POST",
    url: "/projects",
    headers: auth(user.token),
    payload: { name: "Weekly review private project" },
  });
  assert.equal(hiddenProject.statusCode, 201, hiddenProject.body);
  await pool.query("UPDATE projects SET assistant_off = true WHERE id = $1", [
    hiddenProject.json().id,
  ]);
  const visibleGoal = (
    await pool.query<{ id: string }>(
      `INSERT INTO goals (user_id, title, target)
       VALUES ($1, 'Visible weekly goal', 'Complete its target') RETURNING id`,
      [user.id],
    )
  ).rows[0].id;
  const hiddenGoal = (
    await pool.query<{ id: string }>(
      `INSERT INTO goals (user_id, title, project_id)
       VALUES ($1, 'PRIVATE_WEEKLY_GOAL', $2) RETURNING id`,
      [user.id, hiddenProject.json().id],
    )
  ).rows[0].id;

  const now = new Date("2026-09-27T14:30:00.000Z");
  assert.equal(await scanAssistantGoals(now, { only: [user.id] }), 1);
  assert.equal(await scanAssistantGoals(now, { only: [user.id] }), 0);
  const checkin = (
    await pool.query<{
      job_id: string | null;
      status: string;
      week_of: string;
    }>(
      `SELECT job_id, status, week_of::text FROM goals_checkins WHERE goal_id = $1`,
      [visibleGoal],
    )
  ).rows[0];
  assert.equal(checkin.week_of, "2026-09-28");
  assert.ok(checkin.job_id);
  const result = await poll(user.token, checkin.job_id!, ["done", "failed"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  const completed = (
    await pool.query<{ status: string; summary: string }>(
      "SELECT status, summary FROM goals_checkins WHERE goal_id = $1",
      [visibleGoal],
    )
  ).rows[0];
  assert.equal(completed.status, "done");
  assert.match(completed.summary, /weekly goal review/i);
  assert.equal(
    (
      await pool.query("SELECT 1 FROM goals_checkins WHERE goal_id = $1", [
        hiddenGoal,
      ])
    ).rowCount,
    0,
  );
  assert.ok(
    requests.every((request) =>
      request.messages.every(
        (message) => !message.content?.includes("PRIVATE_WEEKLY_GOAL"),
      ),
    ),
    "kept-out goal content never reaches the assistant provider",
  );
});

test("routines validate ownership and approval scopes, then run once when due", async () => {
  requests.length = 0;
  respond = () => ({ content: "The scheduled routine is complete." });
  const user = await register();
  const person = (
    await pool.query<{ name: string; role: "member" }>(
      "SELECT name, role FROM users WHERE id = $1",
      [user.id],
    )
  ).rows[0];
  const principal = await assistantPrincipal({ ...person, id: user.id });
  const anonymous = await app.inject({
    url: "/me/agent-routines",
    remoteAddress: nextAddress(),
  });
  assert.equal(anonymous.statusCode, 401);

  const invalid = await app.inject({
    method: "POST",
    url: "/me/agent-routines",
    remoteAddress: nextAddress(),
    headers: auth(user.token),
    payload: {
      instruction: "Review my priorities",
      rrule: "FREQ=NEVER",
      timezone: "UTC",
      next_run_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
  });
  assert.equal(invalid.statusCode, 422, invalid.body);

  const created = await app.inject({
    method: "POST",
    url: "/me/agent-routines",
    remoteAddress: nextAddress(),
    headers: auth(user.token),
    payload: {
      instruction: "Review my priorities",
      rrule: "FREQ=DAILY",
      timezone: "Australia/Melbourne",
      next_run_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const other = await register();
  const hidden = await app.inject({
    method: "PUT",
    url: `/me/agent-routines/${created.json().id}`,
    remoteAddress: nextAddress(),
    headers: auth(other.token),
    payload: { paused: true },
  });
  assert.equal(hidden.statusCode, 404, hidden.body);

  const scopes = await app.inject({
    url: "/me/assistant/approval-scopes",
    remoteAddress: nextAddress(),
    headers: auth(user.token),
  });
  assert.equal(scopes.statusCode, 200, scopes.body);
  assert.deepEqual(scopes.json(), {});
  const savedScopes = await app.inject({
    method: "PUT",
    url: "/me/assistant/approval-scopes",
    remoteAddress: nextAddress(),
    headers: auth(user.token),
    payload: { tasks: { scope: "routine", id: created.json().id } },
  });
  assert.equal(savedScopes.statusCode, 200, savedScopes.body);
  assert.deepEqual(savedScopes.json(), {
    tasks: { scope: "routine", id: created.json().id },
  });
  const invalidScopes = await app.inject({
    method: "PUT",
    url: "/me/assistant/approval-scopes",
    remoteAddress: nextAddress(),
    headers: auth(user.token),
    payload: { tasks: { scope: "routine", id: "not-a-uuid" } },
  });
  assert.equal(invalidScopes.statusCode, 422, invalidScopes.body);

  const settings = cachedSettings();
  const previousLimit = settings.rate_limit_per_minute;
  settings.rate_limit_per_minute = 1;
  try {
    const fromOneAddress = () =>
      app.inject({
        url: "/me/agent-routines",
        remoteAddress: "10.254.0.10",
        headers: auth(user.token),
      });
    assert.equal((await fromOneAddress()).statusCode, 200);
    const limited = await fromOneAddress();
    assert.equal(limited.statusCode, 429, limited.body);
  } finally {
    settings.rate_limit_per_minute = previousLimit;
  }

  const now = new Date();
  const retryAt = new Date(now.getTime() - 60_000);
  const retryRoutine = (
    await pool.query<{ id: string }>(
      `INSERT INTO agent_routines (user_id, instruction, rrule, timezone, next_run_at)
       VALUES ($1, 'Retry after a queue failure', 'FREQ=DAILY', 'Australia/Melbourne', $2)
       RETURNING id`,
      [user.id, retryAt],
    )
  ).rows[0].id;
  assert.equal(
    await scanAssistantRoutines(now, {
      only: [user.id],
      startAutomation: async () => {
        throw new Error("simulated queue failure");
      },
    }),
    0,
  );
  const failedQueue = (
    await pool.query<{
      current_job_id: string | null;
      claimed_at: Date | null;
      next_run_at: Date;
    }>(
      "SELECT current_job_id, claimed_at, next_run_at FROM agent_routines WHERE id = $1",
      [retryRoutine],
    )
  ).rows[0];
  assert.equal(failedQueue.current_job_id, null);
  assert.equal(failedQueue.claimed_at, null);
  assert.equal(
    failedQueue.next_run_at.getTime(),
    retryAt.getTime(),
    "a failed queue attempt leaves the due occurrence available for retry",
  );
  assert.equal(await scanAssistantRoutines(now, { only: [user.id] }), 1);
  const retried = (
    await pool.query<{ current_job_id: string; next_run_at: Date }>(
      "SELECT current_job_id, next_run_at FROM agent_routines WHERE id = $1",
      [retryRoutine],
    )
  ).rows[0];
  assert.ok(retried.current_job_id);
  assert.ok(retried.next_run_at > now);
  const retriedResult = await poll(user.token, retried.current_job_id, [
    "done",
    "failed",
  ]);
  assert.equal(retriedResult.state, "done", JSON.stringify(retriedResult));

  const due = (
    await pool.query<{ id: string }>(
      `INSERT INTO agent_routines (user_id, instruction, rrule, timezone, next_run_at)
       VALUES ($1, 'Send me a weekly review', 'FREQ=DAILY', 'Australia/Melbourne', $2)
       RETURNING id`,
      [user.id, new Date(now.getTime() - 60_000)],
    )
  ).rows[0].id;
  assert.equal(await scanAssistantRoutines(now, { only: [user.id] }), 1);
  assert.equal(await scanAssistantRoutines(now, { only: [user.id] }), 0);
  const job = (
    await pool.query<{ current_job_id: string; next_run_at: Date }>(
      "SELECT current_job_id, next_run_at FROM agent_routines WHERE id = $1",
      [due],
    )
  ).rows[0];
  assert.ok(job.current_job_id);
  assert.ok(
    job.next_run_at > now,
    "the recurrence advances when the job queues",
  );
  const result = await poll(user.token, job.current_job_id, ["done", "failed"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  const completed = (
    await pool.query<{ current_job_id: string | null; last_result: unknown }>(
      "SELECT current_job_id, last_result FROM agent_routines WHERE id = $1",
      [due],
    )
  ).rows[0];
  assert.equal(completed.current_job_id, null);
  assert.match(
    JSON.stringify(completed.last_result),
    /scheduled routine is complete/i,
  );
  assert.ok(principal.grant_id);
});

test("the Assistant ideas feed hides proposals that reference kept-out work", async () => {
  const user = await register();
  const project = await app.inject({
    method: "POST",
    url: "/projects",
    headers: auth(user.token),
    payload: { name: "Private idea source" },
  });
  assert.equal(project.statusCode, 201, project.body);
  await pool.query("UPDATE projects SET assistant_off = true WHERE id = $1", [
    project.json().id,
  ]);
  const hiddenItem = (
    await pool.query<{ id: string }>(
      `INSERT INTO items (user_id, kind, title, due_at, project_id)
       VALUES ($1, 'task', 'Private task', now(), $2) RETURNING id`,
      [user.id, project.json().id],
    )
  ).rows[0].id;
  const { createAgentProposal } =
    await import("../src/modules/proposals/service.js");
  const hiddenProposal = await createAgentProposal(pool, {
    userId: user.id,
    grantId: null,
    clientName: "Orbyn assistant",
    summary: "Private idea",
    kind: "idea",
    changes: [
      {
        type: "task.update",
        item_id: hiddenItem,
        version: 1,
        title: "Private task",
        team_id: null,
        patch: { title: "Private task" },
        before: { title: "Private task" },
      },
    ],
  });
  const visibleProposal = await createAgentProposal(pool, {
    userId: user.id,
    grantId: null,
    clientName: "Orbyn assistant",
    summary: "Visible idea",
    kind: "idea",
    changes: [
      {
        type: "task.create",
        title: "Visible task",
        team_id: null,
        data: { title: "Visible task" },
      },
    ],
  });
  await pool.query(
    `INSERT INTO assistant_ideas (user_id, local_day, slot, title, summary, proposal_id)
     VALUES ($1, current_date, 1, 'Private idea', 'Private task', $2),
            ($1, current_date, 2, 'Visible idea', 'Visible task', $3)`,
    [user.id, hiddenProposal.id, visibleProposal.id],
  );

  const response = await app.inject({
    url: "/me/assistant/ideas",
    headers: auth(user.token),
  });
  assert.equal(response.statusCode, 200, response.body);
  const ideas = response.json() as { title: string }[];
  assert.ok(ideas.some((idea) => idea.title === "Visible idea"));
  assert.ok(!ideas.some((idea) => idea.title === "Private idea"));
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
  assert.equal(result.answer, "Stopped. Nothing was changed.");
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

test("stopping at a person question discards the staged work", async () => {
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
  const result = await poll(user.token, job.id, ["done", "failed"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(result.assistant_run?.outcome, "discarded");
  assert.equal(result.answer, "Stopped. Nothing was changed.");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM items WHERE user_id = $1 AND title = 'Check chapter references'",
        [user.id],
      )
    ).rowCount,
    0,
    "a Stop never applies the staged work",
  );
  const again = await app.inject({
    method: "POST",
    url: `/ai/chat/${job.id}/approve`,
    remoteAddress: nextAddress(),
    headers: auth(user.token),
    payload: { approved: true, scope: "once" },
  });
  assert.equal(again.statusCode, 409, again.body);
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

// --- Stop, deadline, approval races, stale jobs and lead limits ------------

/** Provider calls held open until the test releases them. */
const held: ((reply: MockReply) => void)[] = [];
function hold(entered?: () => void) {
  entered?.();
  return new Promise<MockReply>((resolve) => held.push(resolve));
}
function releaseHeld() {
  for (const resolve of held.splice(0))
    resolve({ content: "A late provider response." });
}

const lastToolMessage = (request: Request) =>
  [...request.messages].reverse().find((message) => message.role === "tool");

/**
 * The lead delegates one Projects task that stages a task called `title`;
 * `afterReport` answers the lead's next call.
 */
function stageTask(
  title: string,
  afterReport: (
    request: Request,
    steps: string[],
  ) => MockReply | Promise<MockReply>,
) {
  return (request: Request): MockReply | Promise<MockReply> => {
    const names = toolNames(request);
    const previousTool = lastToolMessage(request);
    if (names.includes("delegate"))
      return previousTool
        ? afterReport(request, stepIds(previousTool.content))
        : {
            name: "delegate",
            arguments: {
              tasks: [
                {
                  specialist: "projects",
                  brief: `Stage a task named ${title}.`,
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
              summary: `Staged ${title}.`,
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
            arguments: { tasks: [{ title, kind: "task" }] },
          };
    return { content: "Done." };
  };
}

async function itemCount(userId: string, title: string) {
  return (
    await pool.query("SELECT 1 FROM items WHERE user_id = $1 AND title = $2", [
      userId,
      title,
    ])
  ).rowCount;
}

async function askFirst(userId: string) {
  await pool.query(
    `INSERT INTO agent_grants
       (user_id, kind, name, client_name, access, team_ids, personal,
        toolsets, flags, trust)
     VALUES ($1, 'assistant', 'Orbyn Assistant', 'Orbyn Assistant', 'write',
       NULL, true, $2::text[], '{}'::jsonb, 'ask')`,
    [userId, [...AGENT_TOOLSETS]],
  );
}

async function answerCard(token: string, jobId: string, approved: boolean) {
  return app.inject({
    method: "POST",
    url: `/ai/chat/${jobId}/approve`,
    remoteAddress: nextAddress(),
    headers: auth(token),
    payload: { approved, scope: "once" },
  });
}

test("a full-trust Stop with staged work applies nothing, and the heartbeat keeps beating", async () => {
  requests.length = 0;
  let entered!: () => void;
  const inLead = new Promise<void>((resolve) => (entered = resolve));
  respond = stageTask("Stop-safe task", () => hold(entered));
  assistantRunLimits.heartbeatMs = 40;
  try {
    const user = await register();
    const job = await start(user.token, "Add a task named Stop-safe task.");
    await inLead;
    const beat = async () =>
      (
        await pool.query<{ heartbeat_at: Date }>(
          "SELECT heartbeat_at FROM ai_jobs WHERE id = $1",
          [job.id],
        )
      ).rows[0].heartbeat_at.getTime();
    const before = await beat();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(
      (await beat()) > before,
      "the heartbeat moves during a long provider call",
    );
    const saved = await pool.query<{
      run_state: { state?: { plan?: unknown[] } };
    }>("SELECT run_state FROM ai_jobs WHERE id = $1", [job.id]);
    assert.equal(saved.rows[0].run_state.state?.plan?.length, 1);

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
    assert.equal(result.answer, "Stopped. Nothing was changed.");
    assert.equal(await itemCount(user.id, "Stop-safe task"), 0);
  } finally {
    assistantRunLimits.heartbeatMs = 10_000;
    releaseHeld();
  }
});

test("the time limit parks staged work on an approval card instead of applying it", async () => {
  requests.length = 0;
  respond = stageTask("Deadline task", () => hold());
  assistantRunLimits.maxRunMs = 2000;
  try {
    const user = await register();
    const job = await start(user.token, "Add a task named Deadline task.");
    const waiting = await poll(
      user.token,
      job.id,
      ["waiting", "done", "failed"],
      400,
    );
    assert.equal(waiting.state, "waiting", JSON.stringify(waiting));
    assert.equal(waiting.waiting?.kind, "approval");
    assert.match(waiting.waiting?.question, /ran out of time/i);
    assert.equal(waiting.waiting?.steps.length, 1);
    assert.equal(await itemCount(user.id, "Deadline task"), 0);

    const declined = await answerCard(user.token, job.id, false);
    assert.equal(declined.statusCode, 202, declined.body);
    const result = await poll(user.token, job.id, ["done", "failed"]);
    assert.equal(result.assistant_run?.outcome, "discarded");
    assert.equal(await itemCount(user.id, "Deadline task"), 0);
  } finally {
    assistantRunLimits.maxRunMs = 600_000;
    releaseHeld();
  }
});

test("an idea run that hits the time limit drops its staged work: nobody watches its chat", async () => {
  requests.length = 0;
  respond = stageTask("Idea deadline task", () => hold());
  assistantRunLimits.maxRunMs = 2000;
  try {
    const user = await register();
    const jobId = await startAssistantAutomation({
      userId: user.id,
      message:
        "Suggest one useful next step as a task named Idea deadline task.",
      timezone: "UTC",
      automation: { kind: "idea", local_day: "2026-09-28", slot: 1 },
    });
    assert.ok(jobId);
    const ended = await poll(
      user.token,
      jobId,
      ["waiting", "done", "failed"],
      400,
    );
    assert.notEqual(
      ended.state,
      "waiting",
      "no question is left in the idea's chat",
    );
    assert.equal(await itemCount(user.id, "Idea deadline task"), 0);
  } finally {
    assistantRunLimits.maxRunMs = 600_000;
    releaseHeld();
  }
});

test("a simultaneous Approve and Decline: exactly one wins and the chat says what happened", async () => {
  requests.length = 0;
  respond = stageTask("Race task", (_request, steps) => ({
    name: "finish",
    arguments: { answer: "The race task is ready for approval.", steps },
  }));
  const user = await register();
  await askFirst(user.id);
  const job = await start(user.token, "Add a task named Race task.");
  const waiting = await poll(user.token, job.id, ["waiting", "done", "failed"]);
  assert.equal(waiting.waiting?.kind, "approval", JSON.stringify(waiting));

  const [approve, decline] = await Promise.all([
    answerCard(user.token, job.id, true),
    answerCard(user.token, job.id, false),
  ]);
  assert.deepEqual(
    [approve.statusCode, decline.statusCode].sort(),
    [202, 409],
    `${approve.body} ${decline.body}`,
  );
  const loser = approve.statusCode === 409 ? approve : decline;
  assert.match(loser.body, /Already answered/);
  const result = await poll(user.token, job.id, ["done", "failed"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  const approvedWon = approve.statusCode === 202;
  assert.equal(
    result.assistant_run?.outcome,
    approvedWon ? "applied" : "discarded",
  );
  assert.equal(await itemCount(user.id, "Race task"), approvedWon ? 1 : 0);
  const turns = (
    await pool.query<{ turns: { role: string; text: string }[] }>(
      "SELECT turns FROM ai_chats WHERE id = $1",
      [job.chat_id],
    )
  ).rows[0].turns;
  const last = turns.filter((turn) => turn.role === "assistant").at(-1);
  assert.equal(last?.text, result.answer);
  assert.match(
    result.answer,
    approvedWon ? /Done — you can undo this change/ : /Nothing was applied/,
  );
});

test("a plan the checker refuses blocks its reports, so the retry cannot reselect them", async () => {
  requests.length = 0;
  let taskId = "";
  let retries = 0;
  respond = (request) => {
    const names = toolNames(request);
    const previousTool = lastToolMessage(request);
    if (names.includes("delegate")) {
      const message = request.messages.at(-1)?.content ?? "";
      if (/Review the blocked report/.test(message) && !previousTool) {
        retries++;
        return {
          name: "finish",
          arguments: {
            answer: "The rename was refused, so I changed nothing.",
            steps: [],
          },
        };
      }
      return previousTool
        ? {
            name: "finish",
            arguments: {
              answer: "I renamed the task.",
              steps: stepIds(previousTool.content),
            },
          }
        : {
            name: "delegate",
            arguments: {
              tasks: [
                {
                  specialist: "projects",
                  brief: "Rename the existing task to Stale rename.",
                  want_options: false,
                },
              ],
            },
          };
    }
    if (names.includes("report"))
      return previousTool
        ? {
            name: "report",
            arguments: {
              status: "done",
              summary: "Staged the rename.",
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
            name: "update_tasks",
            arguments: {
              changes: [
                { id: `task:${taskId}`, version: 99, title: "Stale rename" },
              ],
            },
          };
    return { content: "Done." };
  };

  const user = await register();
  const created = await app.inject({
    method: "POST",
    url: "/items",
    headers: auth(user.token),
    payload: { title: "Original checker title", kind: "task" },
  });
  assert.equal(created.statusCode, 201, created.body);
  taskId = created.json().id as string;
  const job = await start(user.token, "Rename my task to Stale rename.");
  const result = await poll(user.token, job.id, ["done", "failed", "waiting"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(retries, 1, "the retry finishes without the refused steps");
  assert.equal(result.assistant_run?.outcome, "info");
  const projects = result.assistant_run.reports.find(
    (report: { specialist: string }) => report.specialist === "projects",
  );
  assert.equal(projects.status, "blocked");
  assert.deepEqual(projects.step_ids, []);
  assert.equal(
    (await pool.query("SELECT title FROM items WHERE id = $1", [taskId]))
      .rows[0].title,
    "Original checker title",
  );
});

test("the lead stops at eight steps with one last answer", async () => {
  requests.length = 0;
  let leadCalls = 0;
  respond = (request) => {
    if (!toolNames(request).includes("delegate")) return { content: "Done." };
    leadCalls++;
    if (/tools are now off/.test(request.messages.at(-1)?.content ?? ""))
      return { content: "Here is what I found so far." };
    return {
      name: "search",
      arguments: { query: `lead-limit-${leadCalls}` },
    };
  };
  const user = await register();
  const job = await start(user.token, "What have I written about lead limits?");
  const result = await poll(user.token, job.id, ["done", "failed", "waiting"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(leadCalls, 8);
  assert.match(result.answer, /Here is what I found so far/);
});

test("the token budget counts new input and output, and ends with one answer without tools", async () => {
  requests.length = 0;
  const { runAgent } = await import("../src/modules/ai/agent/loop.js");
  const { resolveAi } = await import("../src/modules/ai/providers/resolve.js");
  const ai = await resolveAi();
  assert.ok(ai);
  let calls = 0;
  let finalChoice: unknown = null;
  respond = (request) => {
    calls++;
    if (/tools are now off/.test(request.messages.at(-1)?.content ?? "")) {
      finalChoice = request.tool_choice;
      return { content: "Final answer within the budget." };
    }
    return { name: "search", arguments: { query: `budget-${calls}` } };
  };
  const budget = { used: 0, limit: 6000 };
  const result = await runAgent(
    ai,
    {
      user: { id: randomUUID(), role: "member" },
      identity: { name: "Orbyn", persona: "" },
      timezone: "UTC",
      intentText: "Look this up.",
      actions: [],
      clarification: null,
    },
    "Look this up.",
    [],
    {},
    undefined,
    undefined,
    {
      systemPrompt: "Answer with the search tool.",
      tools: [
        {
          name: "search",
          description: "Search.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ],
      executeTool: async () => ({ content: "x".repeat(8000), isError: false }),
      maxSteps: 8,
      maxToolCallsPerStep: 1,
      forceToolLoop: true,
      tokenBudget: budget,
    },
  );
  // Each 8,000-character result is ~2,000 tokens: three calls fit in 6,000
  // when only new input counts (re-counting whole prompts fit two).
  assert.equal(calls, 4);
  assert.equal(finalChoice, "none");
  assert.equal(result.partial, true);
  assert.match(result.summary, /Final answer within the budget/);
});

test("a partial report leads to a second delegation round that stages the work", async () => {
  requests.length = 0;
  let sawPartial = false;
  respond = (request) => {
    const names = toolNames(request);
    const previousTool = lastToolMessage(request);
    const brief = request.messages.find((m) => m.role === "user")?.content;
    if (names.includes("delegate")) {
      if (!previousTool)
        return {
          name: "delegate",
          arguments: {
            tasks: [
              {
                specialist: "projects",
                brief: "Look over the launch work first.",
                want_options: false,
              },
            ],
          },
        };
      const reports = JSON.parse(previousTool.content ?? "[]") as {
        status: string;
      }[];
      if (reports[0]?.status === "partial") {
        sawPartial = true;
        return {
          name: "delegate",
          arguments: {
            tasks: [
              {
                specialist: "projects",
                brief: "Now stage a task named Second round task.",
                want_options: false,
              },
            ],
          },
        };
      }
      return {
        name: "finish",
        arguments: {
          answer: "I added the second round task.",
          steps: stepIds(previousTool.content),
        },
      };
    }
    if (names.includes("report")) {
      if (/Look over the launch work first/.test(brief ?? ""))
        return {
          name: "report",
          arguments: {
            status: "partial",
            summary: "The launch work needs a follow-up task.",
            findings: ["No follow-up task exists yet."],
            steps: [],
            open_questions: [],
          },
        };
      if (!previousTool)
        return {
          name: "create_tasks",
          arguments: { tasks: [{ title: "Second round task", kind: "task" }] },
        };
      return {
        name: "report",
        arguments: {
          status: "done",
          summary: "Staged the follow-up task.",
          findings: [],
          steps: [
            (JSON.parse(previousTool.content ?? "{}") as { step_id: string })
              .step_id,
          ],
          open_questions: [],
        },
      };
    }
    return { content: "Done." };
  };
  const user = await register();
  const job = await start(user.token, "Add a follow-up task for the launch.");
  const result = await poll(user.token, job.id, ["done", "failed", "waiting"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(sawPartial, true);
  assert.deepEqual(
    result.assistant_run.reports.map((r: { status: string }) => r.status),
    ["partial", "done"],
  );
  assert.equal(result.assistant_run?.outcome, "applied");
  assert.equal(await itemCount(user.id, "Second round task"), 1);
});

test("a specialist's options become the person's choice, and the answer resumes the lead", async () => {
  requests.length = 0;
  let resumedWith = "";
  respond = (request) => {
    const names = toolNames(request);
    const previousTool = lastToolMessage(request);
    const system = request.messages[0]?.content ?? "";
    if (names.includes("delegate")) {
      const answered = /The person answered your last question: (.*)/.exec(
        system,
      );
      if (answered) {
        resumedWith = answered[1];
        return {
          name: "finish",
          arguments: { answer: `I will plan ${answered[1]} sessions.` },
        };
      }
      if (!previousTool)
        return {
          name: "delegate",
          arguments: {
            tasks: [
              {
                specialist: "planner",
                brief: "Suggest focus session lengths.",
                want_options: true,
              },
            ],
          },
        };
      const reports = JSON.parse(previousTool.content ?? "[]") as {
        options?: string[];
      }[];
      return {
        name: "ask_person",
        arguments: {
          question: "How long should each focus session be?",
          choices: reports[0]?.options ?? [],
        },
      };
    }
    if (names.includes("report"))
      return {
        name: "report",
        arguments: {
          status: "needs_choice",
          summary: "Two session lengths fit the calendar.",
          findings: [],
          steps: [],
          options: ["30 minutes", "60 minutes"],
          open_questions: ["Which session length do you prefer?"],
        },
      };
    return { content: "Done." };
  };
  const user = await register();
  const job = await start(user.token, "How long should my focus sessions be?");
  const question = await poll(user.token, job.id, [
    "waiting",
    "done",
    "failed",
  ]);
  assert.equal(question.waiting?.kind, "person", JSON.stringify(question));
  assert.deepEqual(question.waiting?.choices, ["30 minutes", "60 minutes"]);
  const answered = await app.inject({
    method: "POST",
    url: `/ai/chat/${job.id}/answer`,
    remoteAddress: nextAddress(),
    headers: auth(user.token),
    payload: { answer: "60 minutes" },
  });
  assert.equal(answered.statusCode, 202, answered.body);
  const result = await poll(user.token, job.id, ["done", "failed", "waiting"]);
  assert.equal(result.state, "done", JSON.stringify(result));
  assert.equal(resumedWith, "60 minutes");
  assert.match(result.answer, /60 minutes sessions/);
});

test("a paused assistant refuses to run, and new grants leave booking out", async () => {
  const user = await register();
  const principal = await assistantPrincipal({
    id: user.id,
    name: "Run tester",
    role: "member",
  });
  assert.ok(!principal.toolsets.includes("booking"));
  assert.ok(principal.toolsets.includes("core"));
  await pool.query(
    "UPDATE agent_grants SET suspended_at = now() WHERE id = $1",
    [principal.grant_id],
  );
  respond = () => ({ content: "This should not run." });
  const job = await start(user.token, "Summarize my day.");
  const result = await poll(user.token, job.id, ["done", "failed"]);
  assert.equal(result.state, "failed", JSON.stringify(result));
  assert.equal(result.message, "Your assistant is paused in Connected agents.");
});

test("stale running jobs and week-old cards fail and free their automations", async () => {
  const user = await register();
  const insertJob = async (state: string, age: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO ai_jobs (user_id, state, heartbeat_at)
         VALUES ($1, $2, now() - $3::interval) RETURNING id`,
        [user.id, state, age],
      )
    ).rows[0].id;
  const crashed = await insertJob("running", "10 minutes");
  const alive = await insertJob("running", "5 seconds");
  const expired = await insertJob("waiting", "8 days");
  const recent = await insertJob("waiting", "1 day");
  const routine = (
    await pool.query<{ id: string }>(
      `INSERT INTO agent_routines (user_id, instruction, rrule, next_run_at, current_job_id, claimed_at)
       VALUES ($1, 'Check my week', 'FREQ=DAILY', now(), $2, now()) RETURNING id`,
      [user.id, crashed],
    )
  ).rows[0].id;
  const goal = (
    await pool.query<{ id: string }>(
      "INSERT INTO goals (user_id, title) VALUES ($1, 'Stale goal') RETURNING id",
      [user.id],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO goals_checkins (goal_id, user_id, week_of, summary, status, job_id)
     VALUES ($1, $2, '2026-09-21', 'Weekly review in progress', 'running', $3)`,
    [goal, user.id, expired],
  );

  const ended = await failStaleAssistantJobs();
  assert.ok(ended.includes(crashed));
  assert.ok(ended.includes(expired));
  assert.ok(!ended.includes(alive));
  assert.ok(!ended.includes(recent));
  const states = (
    await pool.query<{ id: string; state: string; error_message: string }>(
      "SELECT id, state, error_message FROM ai_jobs WHERE id = ANY($1::uuid[])",
      [[crashed, alive, expired, recent]],
    )
  ).rows;
  const stateOf = (id: string) => states.find((row) => row.id === id)!;
  assert.equal(stateOf(crashed).state, "failed");
  assert.equal(
    stateOf(crashed).error_message,
    "The assistant was interrupted by a server restart. Please ask again.",
  );
  assert.equal(stateOf(expired).state, "failed");
  assert.equal(stateOf(alive).state, "running");
  assert.equal(stateOf(recent).state, "waiting");
  assert.equal(
    (
      await pool.query(
        "SELECT current_job_id FROM agent_routines WHERE id = $1",
        [routine],
      )
    ).rows[0].current_job_id,
    null,
  );
  assert.equal(
    (
      await pool.query("SELECT status FROM goals_checkins WHERE goal_id = $1", [
        goal,
      ])
    ).rows[0].status,
    "failed",
  );
  const polled = await app.inject({
    url: `/ai/chat/${crashed}`,
    remoteAddress: nextAddress(),
    headers: auth(user.token),
  });
  assert.equal(polled.json().state, "failed");
  assert.ok(!(await failStaleAssistantJobs()).includes(crashed));
});

test("a dropped client reattaches to the same run and saves its reply once", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  respond = async () => {
    await gate;
    return {
      name: "finish",
      arguments: { answer: "Tomorrow is ready.", steps: [] },
    };
  };
  const user = await register();
  const { OrbynClient } = await import("@orbyn/api-client");
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const response = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST",
      url: url.pathname + url.search,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(init?.body ? { payload: String(init.body) } : {}),
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new OrbynClient({
    baseUrl: "http://orbyn.test",
    getToken: () => user.token,
    fetch: transport,
  });
  const disconnect = new AbortController();
  let jobId = "";
  try {
    await assert.rejects(
      client.chat(
        "Plan tomorrow",
        "UTC",
        [],
        null,
        {},
        (progress) => {
          jobId = progress.job_id;
          disconnect.abort();
        },
        disconnect.signal,
      ),
      { name: "AbortError" },
    );
    assert.ok(jobId);
    const active = await app.inject({
      url: "/ai/jobs/active",
      headers: auth(user.token),
    });
    const job = active.json().find((row: { id: string }) => row.id === jobId);
    assert.ok(job);
    const reopened = await client.aiChat(job.chat_id);
    assert.equal(reopened.active_job?.id, jobId);
    assert.equal(
      reopened.turns.filter((turn) => turn.role === "user").length,
      1,
    );
    release();
    const freshClient = new OrbynClient({
      baseUrl: "http://orbyn.test",
      getToken: () => user.token,
      fetch: transport,
    });
    const result = await freshClient.pollAssistantRun(jobId, {
      chatId: job.chat_id,
      turnId: job.turn_id,
    });
    assert.equal(result.answer, "Tomorrow is ready.");
    const finished = await freshClient.aiChat(job.chat_id);
    assert.equal(finished.active_job, null);
    assert.equal(
      finished.turns.filter(
        (turn) => turn.role === "assistant" && turn.turn_id === job.turn_id,
      ).length,
      1,
    );
    assert.equal(
      (
        await pool.query("SELECT id FROM ai_jobs WHERE chat_id = $1", [
          job.chat_id,
        ])
      ).rowCount,
      1,
    );
  } finally {
    release();
  }
});

test("an expired specialist run resumes completed reports without rerunning or duplicating changes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let projectsRuns = 0;
  let writerRuns = 0;
  respond = async (request) => {
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
                brief: "Create a task titled Durable checklist",
                want_options: false,
              },
              {
                specialist: "writer",
                brief: "Investigate a useful brief",
                want_options: false,
              },
            ],
          },
        };
      return {
        name: "finish",
        arguments: {
          answer: "The checklist is ready.",
          steps: stepIds(previousTool.content),
        },
      };
    }
    if (names.includes("create_tasks")) {
      if (!previousTool) {
        projectsRuns++;
        return {
          name: "create_tasks",
          arguments: { tasks: [{ title: "Durable checklist", kind: "task" }] },
        };
      }
      const staged = JSON.parse(previousTool.content ?? "{}");
      return {
        name: "report",
        arguments: {
          status: "done",
          summary: "Checklist staged",
          findings: [],
          steps: [staged.step_id],
          open_questions: [],
        },
      };
    }
    writerRuns++;
    if (writerRuns === 1) await gate;
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
  const user = await register();
  const job = await start(
    user.token,
    "Add a durable checklist task and investigate its brief.",
  );
  try {
    let checkpoint: any;
    for (let attempt = 0; attempt < 200; attempt++) {
      checkpoint = (
        await pool.query("SELECT run_state FROM ai_jobs WHERE id = $1", [
          job.id,
        ])
      ).rows[0]?.run_state;
      if (
        checkpoint?.state.pending_delegate?.reports.some(
          (report: { specialist: string }) => report.specialist === "projects",
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(checkpoint?.state.pending_delegate?.reports.length, 1);
    assert.equal(checkpoint.state.specialist_runs, 2);
    assert.ok(checkpoint.checkpoint_step > 0);
    assert.ok(Buffer.byteLength(JSON.stringify(checkpoint)) < 200_000);
    await pool.query(
      "UPDATE ai_jobs SET lease_until = now() - interval '1 second' WHERE id = $1",
      [job.id],
    );
    const result = await poll(user.token, job.id, ["done", "failed"], 300);
    assert.equal(result.state, "done", JSON.stringify(result));
    assert.equal(result.assistant_run.outcome, "applied");
    assert.equal(projectsRuns, 1, "the completed specialist report was reused");
    assert.equal(
      writerRuns,
      2,
      "only the interrupted specialist was run again",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT id FROM items WHERE user_id = $1 AND title = 'Durable checklist'",
          [user.id],
        )
      ).rowCount,
      1,
    );
    assert.ok(
      result.trace.some(
        (entry: { label: string }) =>
          entry.label === "Picking up where I left off",
      ),
    );
    assert.equal(
      (
        await pool.query("SELECT resume_count FROM ai_jobs WHERE id = $1", [
          job.id,
        ])
      ).rows[0].resume_count,
      1,
    );
  } finally {
    release();
  }
});
