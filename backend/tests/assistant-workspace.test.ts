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

const app = await buildApp();
let token = "";
let userId = "";
let strangerId = "";
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
  strangerId = (await register("Stranger")).user.id;
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
