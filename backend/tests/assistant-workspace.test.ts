import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");
const { runTool } = await import("../src/modules/ai/agent/tools.js");
const { mayChange, pruneActions } = await import("../src/modules/ai/guards.js");
const { goalWeekStart, listGoals, readGoal, saveGoal } =
  await import("../src/modules/assistant-workspace/goals.js");
const { manageGoals } = await import("../src/capabilities/goals.js");

const app = await buildApp();
let token = "";
let userId = "";
let strangerId = "";
let strangerToken = "";
let projectId = "";

const register = async (name: string) =>
  (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `workspace-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name,
      },
    })
  ).json() as { token: string; user: { id: string } };

const ctxFor = (id: string, intentText = "") => ({
  user: { id, role: "member" as const },
  timezone: "UTC",
  intentText,
  actions: [],
  clarification: null,
  cited: new Map(),
  notes: [] as unknown[],
});

const run = async (name: string, args: unknown, id = userId) => {
  const result = await runTool(
    { id: "t", name, arguments: JSON.stringify(args) },
    ctxFor(id),
  );
  return { ...result, data: JSON.parse(result.content) };
};

const post = (url: string, payload: unknown) =>
  app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${token}` },
    payload: payload as object,
  });

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

before(async () => {
  await migrate();
  const me = await register("Planner");
  token = me.token;
  userId = me.user.id;
  const stranger = await register("Stranger");
  strangerId = stranger.user.id;
  strangerToken = stranger.token;
  projectId = (
    await post("/projects", { name: "Launch", deadline: inDays(3) })
  ).json().id;
  for (const item of [
    { title: "Overdue invoice", priority: "medium", due_at: inDays(-1) },
    { title: "Write the brief", priority: "high", due_at: inDays(2) },
    { title: "Tidy the drive", priority: "low" },
    { title: "Plan the offsite", priority: "high" },
  ])
    assert.equal((await post("/items", item)).statusCode, 201);
  const task = (await post("/items", { title: "Ship the page" })).json();
  await app.inject({
    method: "PUT",
    url: `/items/${task.id}/project`,
    headers: { authorization: `Bearer ${token}` },
    payload: { project_id: projectId },
  });
  await post("/work-records", {
    kind: "decision",
    title: "Launch on a Tuesday",
    project_id: projectId,
  });
});

after(async () => {
  await app.close();
  await pool.end();
});

test("asking what to do first is advice: no changes are allowed", () => {
  for (const message of [
    "You have the appropriate tools to view, just use it and help me prioritize on what task should I be completing first",
    "What should I do first?",
    "help me prioritise my week",
    "which task should I finish first",
  ])
    assert.equal(mayChange(message), false, message);
  // Naming a change as well still allows it.
  assert.equal(
    mayChange("help me prioritise and move the low ones to next week"),
    true,
  );
  const create = {
    operation: "create" as const,
    item_id: null,
    data: { title: "Team standup", kind: "task" as const, due_at: null },
  };
  assert.deepEqual(
    pruneActions([create as never], [], "help me prioritise my tasks"),
    [],
  );
});

test("rank_tasks orders open tasks by the app's score and says why", async () => {
  const { isError, data } = await run("rank_tasks", {});
  assert.equal(isError, false, JSON.stringify(data));
  const titles = data.tasks.map((t: { title: string }) => t.title);
  assert.equal(titles[0], "Overdue invoice");
  assert.ok(
    titles.indexOf("Write the brief") < titles.indexOf("Tidy the drive"),
  );
  const overdue = data.tasks[0];
  assert.ok(overdue.why.includes("overdue"));
  const undated = await run("rank_tasks", { only_undated: true });
  assert.deepEqual(
    undated.data.tasks.map((t: { title: string }) => t.title).sort(),
    ["Plan the offsite", "Ship the page", "Tidy the drive"],
  );
  assert.ok(
    undated.data.tasks.every((t: { why: string[] }) =>
      t.why.includes("no due date"),
    ),
  );
  // Someone else sees none of it.
  assert.equal((await run("rank_tasks", {}, strangerId)).data.total_open, 0);
});

test("search_items finds tasks with no due date and tasks in a project", async () => {
  const undated = await run("search_items", { no_due_date: true });
  assert.equal(undated.data.total, 3);
  const inProject = await run("search_items", { project_id: projectId });
  assert.deepEqual(
    inProject.data.items.map((i: { title: string; project: string }) => [
      i.title,
      i.project,
    ]),
    [["Ship the page", "Launch"]],
  );
  assert.equal(
    (await run("search_items", { project_id: "not-an-id" })).isError,
    true,
  );
});

test("projects: progress, risk, stages and decisions nothing delivers", async () => {
  const list = await run("list_projects", {});
  const launch = list.data.projects.find(
    (p: { id: string }) => p.id === projectId,
  );
  assert.equal(launch.tasks, "0 of 1 done");
  assert.equal(launch.at_risk, true);
  const detail = await run("get_project", { project_id: projectId });
  assert.equal(detail.isError, false, detail.content);
  assert.equal(
    detail.data.stages.flatMap(
      (stage: { open_tasks: { title: string }[] }) => stage.open_tasks,
    )[0].title,
    "Ship the page",
  );
  assert.match(detail.data.open_records[0].gap, /No task delivers/);
  assert.equal(
    (await run("get_project", { project_id: projectId }, strangerId)).isError,
    true,
  );
});

test("find_free_time and get_follow_through read without writing", async () => {
  const free = await run("find_free_time", { days: 7, min_minutes: 30 });
  assert.equal(free.isError, false, free.content);
  assert.ok(Array.isArray(free.data.free));
  assert.ok(free.data.free.every((s: { minutes: number }) => s.minutes >= 30));
  const waiting = await run("get_follow_through", {});
  assert.equal(waiting.isError, false, waiting.content);
  assert.deepEqual(
    waiting.data.decisions_without_a_task.map(
      (d: { title: string }) => d.title,
    ),
    ["Launch on a Tuesday"],
  );
  assert.equal(
    (await run("find_free_time", { start_date: "next week" })).isError,
    true,
  );
});

test("the overview carries a suggested order and undated tasks", async () => {
  const { data } = await run("get_overview", {});
  assert.equal(data.suggested_order[0].title, "Overdue invoice");
  assert.equal(data.without_a_date.length, 3);
});

// Last: the teammate's decision it adds would show in the tests above.
test("get_project lists only the pages and records you could open yourself", async () => {
  const mate = await register("Mate");
  const as = (
    who: string,
    method: "POST" | "GET",
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${who}` },
      ...(payload ? { payload } : {}),
    });
  const myEmail = (await as(token, "GET", "/me")).json().email;
  const team = (
    await as(mate.token, "POST", "/teams", { name: "Studio" })
  ).json();
  assert.equal(
    (
      await as(mate.token, "POST", `/teams/${team.id}/members`, {
        email: myEmail,
        role: "member",
      })
    ).statusCode,
    201,
  );
  const project = (
    await as(mate.token, "POST", "/projects", {
      name: "Studio launch",
      team_id: team.id,
    })
  ).json();
  const shared = await as(mate.token, "POST", "/docs", {
    title: "Team brief",
    team_id: team.id,
    project_id: project.id,
  });
  assert.equal(shared.statusCode, 201, shared.body);
  // A personal page and record of the teammate's that still point at the
  // project (it was theirs before it moved to the team).
  const own = (
    await as(mate.token, "POST", "/docs", { title: "Mate's diary" })
  ).json();
  const ownRecord = await as(mate.token, "POST", "/work-records", {
    kind: "decision",
    title: "Mate's private call",
  });
  assert.equal(ownRecord.statusCode, 201, ownRecord.body);
  const teamRecord = await as(mate.token, "POST", "/work-records", {
    kind: "decision",
    title: "Ship on Friday",
    team_id: team.id,
    project_id: project.id,
  });
  assert.equal(teamRecord.statusCode, 201, teamRecord.body);
  await pool.query("UPDATE docs SET project_id = $1 WHERE id = $2", [
    project.id,
    own.id,
  ]);
  await pool.query("UPDATE work_records SET project_id = $1 WHERE id = $2", [
    project.id,
    ownRecord.json().id,
  ]);

  const mine = await run("get_project", { project_id: project.id });
  assert.equal(mine.isError, false, mine.content);
  assert.deepEqual(
    mine.data.notes.map((n: { title: string }) => n.title),
    ["Team brief"],
  );
  assert.deepEqual(
    mine.data.open_records.map((r: { title: string }) => r.title),
    ["Ship on Friday"],
  );
  assert.doesNotMatch(mine.content, /diary|private call/);
  // Their author still sees both.
  const theirs = await run(
    "get_project",
    { project_id: project.id },
    mate.user.id,
  );
  assert.equal(theirs.data.notes.length, 2);
  assert.equal(theirs.data.open_records.length, 2);
});

test("goals stay private and require valid inputs", async () => {
  assert.equal((await app.inject({ url: "/me/goals" })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: "/me/goals/not-a-uuid",
        headers: { authorization: `Bearer ${token}` },
        payload: { title: "Updated goal" },
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/me/goals",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        payload: "{",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        url: "/admin/overview",
        headers: { authorization: `Bearer ${strangerToken}` },
      })
    ).statusCode,
    403,
  );

  const limitedAddress = "10.99.254.7";
  let rateLimited = false;
  for (let attempt = 0; attempt < 11; attempt++) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: limitedAddress,
      payload: {
        email: `rate-${randomUUID()}@example.com`,
        password: "a-long-test-password",
      },
    });
    if (attempt < 10) assert.equal(response.statusCode, 401, response.body);
    else rateLimited = response.statusCode === 429;
  }
  assert.equal(rateLimited, true, "sign-in attempts are rate limited");

  const plan = await post("/docs", {
    title: "Capstone plan",
    kind: "agent",
    content: [{ type: "paragraph", text: "Finish the capstone in stages." }],
  });
  assert.equal(plan.statusCode, 201, plan.body);
  const goalResponse = await post("/me/goals", {
    title: "Finish the capstone",
    target: "Submit the final project",
    target_date: "2026-11-30",
    plan_doc_id: plan.json().id,
  });
  assert.equal(goalResponse.statusCode, 201, goalResponse.body);
  const goal = goalResponse.json();
  const goals = await app.inject({
    url: "/me/goals",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(goals.statusCode, 200, goals.body);
  assert.equal(goals.json()[0].plan_doc_id, plan.json().id);
  assert.equal(
    (
      await app.inject({
        url: `/me/goals/${goal.id}/checkins`,
        headers: { authorization: `Bearer ${token}` },
      })
    ).json().length,
    0,
  );

  const stranger = await register("Workspace stranger");
  assert.deepEqual(
    (
      await app.inject({
        url: "/me/goals",
        headers: { authorization: `Bearer ${stranger.token}` },
      })
    ).json(),
    [],
  );
  assert.equal(
    (
      await app.inject({
        url: `/me/goals/${goal.id}/checkins`,
        headers: { authorization: `Bearer ${stranger.token}` },
      })
    ).statusCode,
    404,
  );
});

test("agent goal reads leave goals linked to assistant-off projects out", async () => {
  await pool.query("UPDATE projects SET assistant_off = true WHERE id = $1", [
    projectId,
  ]);
  const goal = await saveGoal(pool, userId, null, {
    title: "Hidden project goal",
    project_id: projectId,
  });

  assert.ok((await listGoals(pool, userId)).some((row) => row.id === goal.id));
  assert.ok(
    !(await listGoals(pool, userId, true)).some((row) => row.id === goal.id),
  );
  assert.equal(await readGoal(pool, userId, goal.id, true), null);
  await assert.rejects(
    saveGoal(pool, userId, goal.id, { title: "Changed hidden goal" }, true),
    /Goal not found/,
  );
});

test("goal check-ins use the person's local Monday and the Agent tool saves them", async () => {
  await pool.query(
    `INSERT INTO planner_prefs (user_id, timezone) VALUES ($1, 'Australia/Melbourne')
     ON CONFLICT (user_id) DO UPDATE SET timezone = EXCLUDED.timezone`,
    [userId],
  );
  assert.equal(
    await goalWeekStart(pool, userId, new Date("2026-09-27T14:30:00.000Z")),
    "2026-09-28",
  );

  const goal = await saveGoal(pool, userId, null, {
    title: "Weekly capstone review",
  });
  const ctx = {
    principal: { user: { id: userId, role: "member" }, personal: true },
    db: pool,
    now: new Date(),
    timezone: "Australia/Melbourne",
    spaces: {},
    cursor: { seal: async () => "", open: async () => 0 },
  };
  const result = await manageGoals.run(
    ctx as never,
    manageGoals.input.parse({
      action: "checkin",
      id: goal.id,
      summary: "Finished the outline and set the next step.",
      progress: { completed: ["outline"] },
    }) as never,
  );
  const expectedWeek = await goalWeekStart(pool, userId);
  assert.equal(result.structured.checkins[0].week_of, expectedWeek);
  assert.equal(result.structured.checkins[0].status, "done");
});
