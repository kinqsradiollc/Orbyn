import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  projectProgress,
  projectAtRisk,
  projectTimeline,
  DEFAULT_STAGES,
  dayTime,
} = await import("@orbyn/core");

const app = await buildApp();
let token = "";
let otherToken = "";

const call = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  as = () => token,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${as()}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async (name: string) =>
  (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `proj-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name,
      },
    })
  ).json().token as string;

const newTask = async (title: string) =>
  (await call("POST", "/items", { title, kind: "task" })).json();

before(async () => {
  await migrate();
  token = await register("Lead");
  otherToken = await register("Stranger");
});
after(async () => {
  await app.close();
  await pool.end();
});

test("progress and at-risk are computed from the task counts", () => {
  assert.equal(projectProgress({ task_count: 0, done_count: 0 }), 0);
  assert.equal(projectProgress({ task_count: 4, done_count: 1 }), 25);
  assert.equal(projectProgress({ task_count: 3, done_count: 3 }), 100);

  const now = new Date("2026-09-20T00:00:00.000Z");
  const past = "2026-09-18T00:00:00.000Z";
  const soon = "2026-09-23T00:00:00.000Z";
  const far = "2026-12-01T00:00:00.000Z";
  // Overdue with work left.
  assert.equal(
    projectAtRisk({ deadline: past, task_count: 4, done_count: 1 }, now),
    true,
  );
  // Overdue but finished is not at risk.
  assert.equal(
    projectAtRisk({ deadline: past, task_count: 4, done_count: 4 }, now),
    false,
  );
  // Due soon and behind.
  assert.equal(
    projectAtRisk({ deadline: soon, task_count: 4, done_count: 1 }, now),
    true,
  );
  // Due soon but well ahead.
  assert.equal(
    projectAtRisk({ deadline: soon, task_count: 4, done_count: 3 }, now),
    false,
  );
  // Plenty of time, and no deadline at all.
  assert.equal(
    projectAtRisk({ deadline: far, task_count: 4, done_count: 0 }, now),
    false,
  );
  assert.equal(
    projectAtRisk({ deadline: null, task_count: 4, done_count: 0 }, now),
    false,
  );
});

test("a new project comes with default stages", async () => {
  const made = await call("POST", "/projects", { name: "Q2 launch" });
  assert.equal(made.statusCode, 201, made.body);
  const p = made.json();
  assert.equal(p.name, "Q2 launch");
  assert.equal(p.status, "active");
  assert.deepEqual(
    p.stages.map((s: { name: string }) => s.name),
    DEFAULT_STAGES,
  );
  assert.deepEqual(
    p.stages.map((s: { position: number }) => s.position),
    [0, 1, 2, 3],
  );
  assert.equal(p.task_count, 0);
  assert.equal(p.done_count, 0);
});

test("tasks join a project and a stage, and counts follow", async () => {
  const p = (
    await call("POST", "/projects", {
      name: "Email campaign",
      stages: ["Planning", "Content"],
    })
  ).json();
  const planning = p.stages[0];
  const a = await newTask("Define the audience");
  const b = await newTask("Draft the email");

  assert.equal(
    (
      await call("PUT", `/items/${a.id}/project`, {
        project_id: p.id,
        stage_id: planning.id,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await call("PUT", `/items/${b.id}/project`, { project_id: p.id }))
      .statusCode,
    200,
  );

  // Finishing one moves the done count.
  await call("PUT", `/items/${a.id}`, {
    title: "Define the audience",
    kind: "task",
    status: "done",
    version: a.version,
  });

  const read = (await call("GET", `/projects/${p.id}`)).json();
  assert.equal(read.task_count, 2);
  assert.equal(read.done_count, 1);
  assert.equal(projectProgress(read), 50);
});

test("a stage from another project is refused", async () => {
  const one = (await call("POST", "/projects", { name: "One" })).json();
  const two = (await call("POST", "/projects", { name: "Two" })).json();
  const task = await newTask("Stray");
  const bad = await call("PUT", `/items/${task.id}/project`, {
    project_id: one.id,
    stage_id: two.stages[0].id,
  });
  assert.equal(bad.statusCode, 422, bad.body);
});

test("renaming, reordering and removing stages keeps the survivors", async () => {
  const p = (
    await call("POST", "/projects", {
      name: "Rework",
      stages: ["Alpha", "Beta", "Gamma"],
    })
  ).json();
  const [alpha, beta] = p.stages;
  const updated = (
    await call("PUT", `/projects/${p.id}`, {
      // Beta first and renamed, Alpha second, Gamma dropped, one new stage.
      stages: [
        { id: beta.id, name: "Build" },
        { id: alpha.id, name: "Alpha" },
        { name: "Ship" },
      ],
    })
  ).json();
  assert.deepEqual(
    updated.stages.map((s: { name: string }) => s.name),
    ["Build", "Alpha", "Ship"],
  );
  assert.equal(updated.stages[0].id, beta.id, "renamed stage keeps its id");
});

test("a deadline can be set and then cleared", async () => {
  const p = (await call("POST", "/projects", { name: "Dated" })).json();
  assert.equal(p.deadline, null);
  const when = "2026-12-01T00:00:00.000Z";
  const set = (
    await call("PUT", `/projects/${p.id}`, { deadline: when })
  ).json();
  assert.equal(new Date(set.deadline).toISOString(), when);
  const cleared = (
    await call("PUT", `/projects/${p.id}`, { deadline: null })
  ).json();
  assert.equal(cleared.deadline, null);
});

test("deleting a project leaves its tasks behind, unfiled", async () => {
  const p = (await call("POST", "/projects", { name: "Temporary" })).json();
  const task = await newTask("Outlives the project");
  await call("PUT", `/items/${task.id}/project`, { project_id: p.id });

  assert.equal((await call("DELETE", `/projects/${p.id}`)).statusCode, 204);
  assert.equal((await call("GET", `/projects/${p.id}`)).statusCode, 404);

  const still = await call("GET", `/items/${task.id}`);
  assert.equal(still.statusCode, 200, "the task is still there");
  assert.equal(still.json().project_id ?? null, null, "and is unfiled");
});

test("someone else's project is not found", async () => {
  const p = (await call("POST", "/projects", { name: "Private" })).json();
  assert.equal(
    (await call("GET", `/projects/${p.id}`, undefined, () => otherToken))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "PUT",
        `/projects/${p.id}`,
        { name: "Hijack" },
        () => otherToken,
      )
    ).statusCode,
    404,
  );
  const theirs = await call("GET", "/projects", undefined, () => otherToken);
  assert.ok(!theirs.json().some((x: { id: string }) => x.id === p.id));
});

test("a timeline lays dated tasks on one axis", () => {
  const now = new Date("2026-09-20T00:00:00.000Z");
  const project = {
    deadline: "2026-09-24T00:00:00.000Z",
    stages: [{ id: "s1", name: "Planning" }],
  };
  const line = projectTimeline(
    project,
    [
      // Two hours of work due on the 21st.
      {
        id: "a",
        title: "Draft",
        due_at: "2026-09-21T00:00:00.000Z",
        estimate_minutes: 120,
        status: "todo",
        stage_id: "s1",
      },
      // Overdue and unfinished.
      {
        id: "b",
        title: "Chase",
        due_at: "2026-09-19T00:00:00.000Z",
        estimate_minutes: 60,
        status: "todo",
      },
      // Finished, so not late even though it is in the past.
      {
        id: "c",
        title: "Kickoff",
        due_at: "2026-09-19T12:00:00.000Z",
        estimate_minutes: 60,
        status: "done",
      },
      // No date: a timeline can only show what has one.
      { id: "d", title: "Someday", status: "todo" },
    ],
    now,
  )!;

  assert.ok(line);
  assert.deepEqual(
    line.bars.map((b) => b.id),
    ["b", "c", "a"],
    "bars run earliest first",
  );
  assert.equal(line.bars.find((b) => b.id === "b")!.late, true);
  assert.equal(
    line.bars.find((b) => b.id === "c")!.late,
    false,
    "done is never late",
  );
  assert.equal(line.bars.find((b) => b.id === "a")!.stage, "Planning");
  // The axis starts at the earliest bar and ends at the deadline.
  assert.equal(line.start, "2026-09-18T23:00:00.000Z");
  assert.equal(line.end, "2026-09-24T00:00:00.000Z");
  // Today and the deadline sit inside the range.
  assert.ok(line.todayAt !== null && line.todayAt > 0 && line.todayAt < 100);
  assert.equal(Math.round(line.deadlineAt!), 100);
  // Every bar stays inside the chart.
  for (const b of line.bars) {
    assert.ok(b.left >= 0 && b.left <= 100, `${b.id} starts inside`);
    assert.ok(b.left + b.width <= 100.01, `${b.id} ends inside`);
    assert.ok(b.width >= 1.5, `${b.id} is visible`);
  }
});

test("a timeline bar ends at the task's deadline and is late only once it has passed", () => {
  const TZ = "Australia/Melbourne";
  const at = (day: string, hour: number) =>
    dayTime(day, hour * 60, TZ).toISOString();
  // 10 am Thursday 24 September in Melbourne.
  const now = new Date(at("2026-09-24", 10));
  const line = projectTimeline(
    { deadline: null, stages: [] },
    [
      // All day today: due by tonight, so not late this morning.
      {
        id: "today",
        title: "Renew licence",
        due_at: at("2026-09-24", 0),
        all_day: true,
        timezone: TZ,
        status: "todo",
      },
      // All day yesterday: that day is over.
      {
        id: "yesterday",
        title: "Book venue",
        due_at: at("2026-09-23", 0),
        all_day: true,
        timezone: TZ,
        status: "todo",
      },
      // 9 am to noon today: due when it ends.
      {
        id: "span",
        title: "Workshop",
        due_at: at("2026-09-24", 9),
        end_at: at("2026-09-24", 12),
        status: "todo",
      },
      // Due at 9 am today: that has passed.
      {
        id: "plain",
        title: "Send notes",
        due_at: at("2026-09-24", 9),
        status: "todo",
      },
    ],
    now,
  )!;
  const bar = (id: string) => line.bars.find((b) => b.id === id)!;
  assert.equal(bar("today").late, false, "all day today");
  assert.equal(bar("yesterday").late, true, "all day yesterday");
  assert.equal(bar("span").late, false, "before its end time");
  assert.equal(bar("plain").late, true, "past its due time");
  // The axis runs to the latest deadline: the end of today's all-day task.
  assert.equal(line.end, at("2026-09-25", 0));
  // Bars end at their deadlines: the all-day task's at the end of its day,
  // the span's at its end time; an all-day bar covers its whole day.
  const edge = (iso: string) =>
    ((Date.parse(iso) - Date.parse(line.start)) /
      (Date.parse(line.end) - Date.parse(line.start))) *
    100;
  const close = (a: number, b: number, what: string) =>
    assert.ok(Math.abs(a - b) < 0.01, `${what}: ${a} vs ${b}`);
  close(bar("today").left + bar("today").width, 100, "all-day end");
  close(bar("today").left, edge(at("2026-09-24", 0)), "all-day start");
  close(
    bar("span").left + bar("span").width,
    edge(at("2026-09-24", 12)),
    "span end",
  );
  // Done is never late.
  const done = projectTimeline(
    { deadline: null, stages: [] },
    [
      {
        id: "d",
        title: "Old",
        due_at: at("2026-09-20", 9),
        status: "done",
      },
    ],
    now,
  )!;
  assert.equal(done.bars[0].late, false);
});

test("a project with no dated tasks has no timeline", () => {
  assert.equal(
    projectTimeline({ deadline: null, stages: [] }, [
      { id: "a", title: "Undated", status: "todo" },
    ]),
    null,
  );
});
