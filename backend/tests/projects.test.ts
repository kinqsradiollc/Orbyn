import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { scanProjectPlanningNotices, scanProjectDeadlineMoves } =
  await import("../src/worker/planning.js");
const {
  projectProgress,
  projectAtRisk,
  projectTimeline,
  projectSessionTicks,
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

test("project visits preserve the prior visit across clients and reject strangers", async () => {
  const project = (
    await call("POST", "/projects", { name: "Visit history" })
  ).json();
  const url = `/projects/${project.id}/visit`;
  const first = await call("POST", url);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().since_at, null);
  assert.ok(first.json().visited_at);
  // A remount or second device during the same visit must keep the catch-up point.
  const repeated = await call("POST", url);
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal(repeated.json().since_at, null);
  await pool.query(
    "UPDATE project_visits SET last_seen_at = now() - interval '10 minutes' WHERE project_id = $1",
    [project.id],
  );
  const next = await call("POST", url);
  assert.equal(next.statusCode, 200, next.body);
  assert.ok(next.json().since_at);
  assert.notEqual(next.json().visited_at, next.json().since_at);
  assert.equal(
    (await call("POST", url, undefined, () => otherToken)).statusCode,
    404,
  );
  assert.equal((await app.inject({ method: "POST", url })).statusCode, 401);
});

test("project links enforce visibility and safe URLs", async () => {
  const project = (
    await call("POST", "/projects", { name: "References" })
  ).json();
  const path = `/projects/${project.id}/links`;
  const created = await call("POST", path, {
    url: "https://example.com/reference",
    title: "Design reference",
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal((await call("GET", path)).json()[0].title, "Design reference");
  assert.equal(
    (await call("POST", path, { url: "javascript:alert(1)" })).statusCode,
    422,
  );
  assert.equal(
    (await call("POST", path, { url: "https://user:pass@example.com" }))
      .statusCode,
    422,
  );
  assert.equal(
    (await call("GET", path, undefined, () => otherToken)).statusCode,
    404,
  );
  assert.equal(
    (await call("POST", path, { url: "https://example.com" }, () => otherToken))
      .statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: path })).statusCode,
    401,
  );
  assert.equal(
    (await call("DELETE", `${path}/${created.json().id}`)).statusCode,
    204,
  );
  assert.deepEqual((await call("GET", path)).json(), []);
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

  const filed = await call("PUT", `/items/${a.id}/project`, {
    project_id: p.id,
    stage_id: planning.id,
  });
  assert.equal(filed.statusCode, 200);
  const kept = await call("PUT", `/items/${a.id}/project`, {
    project_id: p.id,
  });
  assert.equal(kept.statusCode, 200, kept.body);
  assert.equal(kept.json().item.stage_id, planning.id);
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
    version: kept.json().item.version,
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

test("task context exposes only readable project and page links", async () => {
  const project = (
    await call("POST", "/projects", { name: "Coursework" })
  ).json();
  const task = (
    await call("POST", "/items", {
      title: "Write the report",
      kind: "task",
      project_id: project.id,
      stage_id: project.stages[0].id,
    })
  ).json();
  const source = (
    await call("POST", "/docs", {
      title: "Lecture notes",
      content: [
        {
          id: "source-line",
          type: "todo",
          text: "Write the report",
          done: false,
        },
      ],
    })
  ).json();
  await pool.query(
    "INSERT INTO doc_task_links (doc_id, block_id, item_id, done) VALUES ($1,$2,$3,false)",
    [source.id, "source-line", task.id],
  );
  const about = (
    await call("POST", "/docs", {
      title: "Report outline",
      kind: "note",
      item_id: task.id,
      project_id: project.id,
    })
  ).json();

  const response = await call("GET", `/items/${task.id}/context`);
  assert.equal(response.statusCode, 200, response.body);
  const context = response.json();
  assert.equal(context.project.name, "Coursework");
  assert.equal(context.project.stage_id, project.stages[0].id);
  assert.equal(context.came_from.doc_id, source.id);
  assert.equal(context.came_from.quote, "Write the report");
  assert.deepEqual(
    context.pages.map((p: { id: string }) => p.id),
    [about.id],
  );
  assert.equal(
    (
      await call(
        "GET",
        `/items/${task.id}/context`,
        undefined,
        () => otherToken,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: `/items/${task.id}/context` }))
      .statusCode,
    401,
  );
});

test("a team task never reveals its owner's personal source page", async () => {
  const email = `proj-reader-${randomUUID()}@example.com`;
  const teammate = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "a-long-test-password", name: "Reader" },
    })
  ).json().token as string;
  const team = (await call("POST", "/teams", { name: "Shared work" })).json();
  assert.equal(
    (await call("POST", `/teams/${team.id}/members`, { email, role: "viewer" }))
      .statusCode,
    201,
  );
  const task = (
    await call("POST", "/items", {
      title: "Team report",
      kind: "task",
      team_id: team.id,
    })
  ).json();
  const privatePage = (
    await call("POST", "/docs", {
      title: "Private research",
      content: [
        { id: "private-line", type: "todo", text: "Team report", done: false },
      ],
    })
  ).json();
  await pool.query(
    "INSERT INTO doc_task_links (doc_id, block_id, item_id, done) VALUES ($1,$2,$3,false)",
    [privatePage.id, "private-line", task.id],
  );
  const context = await call(
    "GET",
    `/items/${task.id}/context`,
    undefined,
    () => teammate,
  );
  assert.equal(context.statusCode, 200, context.body);
  assert.equal(context.json().came_from, null);
  assert.deepEqual(context.json().pages, []);
  assert.ok(!context.body.includes("Private research"));
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

test("project planning reports your remaining work against counted sessions", async () => {
  const now = Date.now();
  const deadline = new Date(now + 2 * 86_400_000).toISOString();
  const p = (
    await call("POST", "/projects", { name: "Measured launch", deadline })
  ).json();
  const task = (
    await call("POST", "/items", {
      title: "Prepare launch",
      kind: "task",
      estimate_minutes: 120,
      project_id: p.id,
    })
  ).json();
  const unknown = (
    await call("POST", "/items", {
      title: "Check details",
      kind: "task",
      project_id: p.id,
    })
  ).json();
  const userId = (
    await pool.query<{ user_id: string }>(
      "SELECT user_id FROM items WHERE id = $1",
      [task.id],
    )
  ).rows[0].user_id;
  const earlier = new Date(now + 86_400_000);
  const later = new Date(now + 3 * 86_400_000);
  for (const start of [earlier, later])
    await pool.query(
      "INSERT INTO time_blocks(item_id, user_id, start_at, end_at) VALUES ($1, $2, $3, $4)",
      [task.id, userId, start, new Date(start.getTime() + 60 * 60_000)],
    );
  const response = await call("GET", `/projects/${p.id}/planning`);
  assert.equal(response.statusCode, 200, response.body);
  const summary = response.json();
  assert.equal(summary.task_count, 2);
  assert.equal(summary.needed_minutes, 120);
  assert.equal(summary.planned_minutes, 60);
  assert.equal(summary.unplanned_minutes, 60);
  assert.equal(summary.late_session_count, 1);
  assert.equal(summary.planned_finish_at, null);
  assert.deepEqual(summary.unestimated_tasks, [
    { id: unknown.id, title: "Check details" },
  ]);
  assert.equal(
    (
      await call(
        "GET",
        `/projects/${p.id}/planning`,
        undefined,
        () => otherToken,
      )
    ).statusCode,
    404,
  );
});

test("team planning totals are visible only to owners and admins", async () => {
  const email = `project-member-${randomUUID()}@example.com`;
  const member = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "a-long-test-password", name: "Member" },
    })
  ).json().token as string;
  const team = (await call("POST", "/teams", { name: "Status team" })).json();
  assert.equal(
    (await call("POST", `/teams/${team.id}/members`, { email, role: "member" }))
      .statusCode,
    201,
  );
  const project = (
    await call("POST", "/projects", { name: "Team status", team_id: team.id })
  ).json();
  const task = (
    await call("POST", "/items", {
      title: "Prepare release",
      kind: "task",
      team_id: team.id,
      project_id: project.id,
      estimate_minutes: 60,
    })
  ).json();
  const ownerId = (
    await pool.query<{ user_id: string }>(
      "SELECT user_id FROM items WHERE id = $1",
      [task.id],
    )
  ).rows[0].user_id;
  const start = new Date(Date.now() + 86_400_000);
  await pool.query(
    "INSERT INTO time_blocks(item_id, user_id, start_at, end_at) VALUES ($1, $2, $3, $4)",
    [task.id, ownerId, start, new Date(start.getTime() + 60 * 60_000)],
  );
  const owner = (await call("GET", `/projects/${project.id}/planning`)).json();
  const other = (
    await call(
      "GET",
      `/projects/${project.id}/planning`,
      undefined,
      () => member,
    )
  ).json();
  assert.equal(owner.team_planned_minutes, 60);
  assert.equal(other.team_planned_minutes, undefined);
  assert.equal(other.planned_minutes, 0);
  const ownerSessions = (
    await call("GET", `/projects/${project.id}/sessions`)
  ).json();
  const memberSessions = (
    await call(
      "GET",
      `/projects/${project.id}/sessions`,
      undefined,
      () => member,
    )
  ).json();
  assert.equal(ownerSessions.length, 1);
  assert.equal(ownerSessions[0].item_id, task.id);
  assert.deepEqual(memberSessions, []);
  await call("PUT", `/projects/${project.id}`, {
    deadline: new Date(start.getTime() - 60 * 60_000).toISOString(),
  });
  await scanProjectDeadlineMoves(new Date());
  const movedNotices = (
    await pool.query<{ user_id: string }>(
      "SELECT user_id FROM notifications WHERE kind = 'project' AND ref LIKE $1 AND channel = 'inapp'",
      [`${project.id}:%`],
    )
  ).rows;
  assert.deepEqual(
    movedNotices.map((notice) => notice.user_id),
    [ownerId],
  );
});

test("project plan previews only assigned work and respects project access", async () => {
  const email = `project-planner-${randomUUID()}@example.com`;
  const member = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "a-long-test-password", name: "Planner" },
    })
  ).json().token as string;
  const memberId = (
    await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [
      email,
    ])
  ).rows[0].id;
  const team = (await call("POST", "/teams", { name: "Plan team" })).json();
  await call("POST", `/teams/${team.id}/members`, { email, role: "member" });
  const project = (
    await call("POST", "/projects", { name: "Team plan", team_id: team.id })
  ).json();
  const assigned = (
    await call("POST", "/items", {
      title: "My assigned work",
      kind: "task",
      team_id: team.id,
      project_id: project.id,
      assignee_id: memberId,
      estimate_minutes: 60,
    })
  ).json();
  const unassigned = (
    await call("POST", "/items", {
      title: "Unclaimed work",
      kind: "task",
      team_id: team.id,
      project_id: project.id,
      estimate_minutes: 60,
    })
  ).json();
  const planned = await call(
    "POST",
    `/projects/${project.id}/plan`,
    { timezone: "Australia/Melbourne" },
    () => member,
  );
  assert.equal(planned.statusCode, 200, planned.body);
  assert.ok(
    planned
      .json()
      .tasks.some((task: { item_id: string }) => task.item_id === assigned.id),
  );
  assert.ok(
    !planned
      .json()
      .tasks.some(
        (task: { item_id: string }) => task.item_id === unassigned.id,
      ),
  );
  assert.ok(planned.json().days <= 14);
  assert.equal(planned.json().options.project_id, project.id);
  const tuned = await app.inject({
    method: "PATCH",
    url: `/planner/plans/${planned.json().id}`,
    headers: { authorization: `Bearer ${member}` },
    payload: { include_item_ids: [unassigned.id] },
  });
  assert.equal(tuned.statusCode, 200, tuned.body);
  assert.ok(
    !tuned
      .json()
      .tasks.some(
        (task: { item_id: string }) => task.item_id === unassigned.id,
      ),
  );
  assert.equal(tuned.json().options.project_id, project.id);
  assert.equal(
    (await call("POST", `/projects/${project.id}/plan`, {}, () => otherToken))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        `/projects/${project.id}/plan`,
        { timezone: "Invalid/Zone" },
        () => member,
      )
    ).statusCode,
    422,
  );
  const sessionStart = new Date(Date.now() + 2 * 86_400_000);
  await pool.query(
    "INSERT INTO time_blocks(item_id, user_id, start_at, end_at) VALUES ($1, $2, $3, $4)",
    [
      assigned.id,
      memberId,
      sessionStart,
      new Date(sessionStart.getTime() + 30 * 60_000),
    ],
  );
  const handedOver = await call("PUT", `/items/${assigned.id}`, {
    title: assigned.title,
    kind: "task",
    team_id: team.id,
    assignee_id: null,
    version: assigned.version,
  });
  assert.equal(handedOver.statusCode, 200, handedOver.body);
  const oldSessions = await call(
    "GET",
    `/items/${assigned.id}/sessions`,
    undefined,
    () => member,
  );
  assert.equal(oldSessions.statusCode, 200, oldSessions.body);
  assert.equal(oldSessions.json().assigned_to_me, false);
  assert.equal(oldSessions.json().sessions.length, 1);
  const stale = await call(
    "GET",
    `/planner/plans/${tuned.json().id}/stale`,
    undefined,
    () => member,
  );
  assert.equal(stale.statusCode, 200, stale.body);
  assert.equal(stale.json().stale, true);
  const claimed = await call(
    "PUT",
    `/items/${unassigned.id}`,
    {
      title: unassigned.title,
      kind: "task",
      team_id: team.id,
      assignee_id: memberId,
      version: unassigned.version,
    },
    () => member,
  );
  assert.equal(claimed.statusCode, 200, claimed.body);
  const afterClaim = await call(
    "POST",
    `/projects/${project.id}/plan`,
    {},
    () => member,
  );
  assert.equal(afterClaim.statusCode, 200, afterClaim.body);
  assert.ok(
    afterClaim
      .json()
      .tasks.some(
        (task: { item_id: string }) => task.item_id === unassigned.id,
      ),
  );
});

test("a near project deadline sends one planning notice per local day", async () => {
  const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const project = (
    await call("POST", "/projects", { name: "Notice project", deadline: due })
  ).json();
  const task = (
    await call("POST", "/items", {
      title: "Still needs time",
      kind: "task",
      project_id: project.id,
      estimate_minutes: 120,
    })
  ).json();
  const userId = (
    await pool.query<{ user_id: string }>(
      "SELECT user_id FROM projects WHERE id = $1",
      [project.id],
    )
  ).rows[0].user_id;
  await scanProjectPlanningNotices(new Date(), [userId]);
  await scanProjectPlanningNotices(new Date(), [userId]);
  const notices = (
    await pool.query<{ id: string; ref: string; title: string }>(
      "SELECT id, ref, title FROM notifications WHERE user_id = $1 AND kind = 'project' AND ref LIKE $2 AND channel = 'inapp'",
      [userId, `${project.id}:%`],
    )
  ).rows;
  assert.equal(notices.length, 1);
  assert.match(notices[0].title, /Notice project/);
  const start = new Date(Date.now() + 2 * 86_400_000);
  await pool.query(
    "INSERT INTO time_blocks(item_id, user_id, start_at, end_at) VALUES ($1, $2, $3, $4)",
    [task.id, userId, start, new Date(start.getTime() + 60 * 60_000)],
  );
  const earlier = new Date(Date.now() + 86_400_000).toISOString();
  const moved = await call("PUT", `/projects/${project.id}`, {
    deadline: earlier,
  });
  assert.equal(moved.statusCode, 200, moved.body);
  await scanProjectDeadlineMoves(new Date());
  const merged = (
    await pool.query<{ id: string; body: string }>(
      "SELECT id, body FROM notifications WHERE user_id = $1 AND kind = 'project' AND ref LIKE $2 AND channel = 'inapp'",
      [userId, `${project.id}:%`],
    )
  ).rows;
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, notices[0].id);
  assert.match(merged[0].body, /deadline moved earlier/);
  await pool.query("UPDATE notifications SET read = true WHERE id = $1", [
    merged[0].id,
  ]);
  await scanProjectDeadlineMoves(new Date());
  const afterRepeat = (
    await pool.query<{ read: boolean }>(
      "SELECT read FROM notifications WHERE id = $1",
      [merged[0].id],
    )
  ).rows[0];
  assert.equal(afterRepeat.read, true);
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

test("saved sessions occupy their real position on a project timeline", () => {
  const session = {
    id: randomUUID(),
    item_id: "task",
    start_at: "2026-09-24T09:00:00.000Z",
    end_at: "2026-09-24T10:00:00.000Z",
  };
  const line = projectTimeline(
    { deadline: null, stages: [] },
    [{ id: "task", title: "Undated", status: "todo" }],
    new Date("2026-09-24T08:00:00.000Z"),
    [session],
  );
  assert.ok(line);
  assert.equal(line.bars.length, 0);
  const ticks = projectSessionTicks(line, [session]);
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].left, 0);
  assert.ok(ticks[0].width > 0);
});
