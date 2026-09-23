import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { migrate } = await import("../src/db/migrate.js");
const { pool } = await import("../src/db/pool.js");
const app = await buildApp();
let lead = "";
let outsider = "";

const call = (
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
  token = lead,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

before(async () => {
  await migrate();
  for (const name of ["Lead", "Outsider"]) {
    const result = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `time-machine-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name,
      },
    });
    assert.equal(result.statusCode, 201, result.body);
    if (name === "Lead") lead = result.json().token;
    else outsider = result.json().token;
  }
});
after(async () => {
  await app.close();
  await pool.end();
});

test("time machine requires auth and validates its cursor", async () => {
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/projects/${randomUUID()}/time-machine/checkpoints`,
      })
    ).statusCode,
    401,
  );
  const project = (
    await call("POST", "/projects", { name: "Versioned project" })
  ).json();
  assert.equal(
    (
      await call(
        "GET",
        `/projects/${project.id}/time-machine/checkpoints?before=oops`,
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (await call("GET", `/projects/${project.id}/time-machine/not-a-number`))
      .statusCode,
    422,
  );
  assert.equal(
    (await call("GET", `/projects/${project.id}/time-machine/999999999`))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "GET",
        `/projects/${project.id}/time-machine/checkpoints`,
        undefined,
        outsider,
      )
    ).statusCode,
    404,
  );
});

test("a snapshot shows task state at the selected change, including later removal", async () => {
  const project = (
    await call("POST", "/projects", { name: "Launch archive" })
  ).json();
  const task = (
    await call("POST", "/items", { title: "Prepare launch", kind: "task" })
  ).json();
  assert.equal(
    (await call("PUT", `/items/${task.id}/project`, { project_id: project.id }))
      .statusCode,
    200,
  );
  const first = (
    await call("GET", `/projects/${project.id}/time-machine/checkpoints`)
  ).json();
  const added = first.find(
    (row: { summary: string }) => row.summary === "Task added: Prepare launch",
  );
  assert.ok(added);
  assert.equal(typeof added.event_order, "string");
  const before = await call(
    "GET",
    `/projects/${project.id}/time-machine/${added.event_order}`,
  );
  assert.equal(before.statusCode, 200, before.body);
  assert.equal(before.json().project.name, "Launch archive");
  assert.equal(before.json().tasks.length, 1);
  assert.equal(before.json().tasks[0].status, "todo");

  const done = await call("PUT", `/items/${task.id}`, {
    title: "Prepare launch",
    kind: "task",
    status: "done",
    version: task.version,
  });
  assert.equal(done.statusCode, 200, done.body);
  const latest = (
    await call("GET", `/projects/${project.id}/time-machine/checkpoints`)
  ).json();
  const completed = latest.find(
    (row: { summary: string }) =>
      row.summary === "Task updated: Prepare launch",
  );
  assert.ok(completed);
  const after = await call(
    "GET",
    `/projects/${project.id}/time-machine/${completed.event_order}`,
  );
  assert.equal(after.statusCode, 200, after.body);
  assert.equal(after.json().tasks[0].status, "done");
  assert.equal(
    (
      await call(
        "GET",
        `/projects/${project.id}/time-machine/${added.event_order}`,
      )
    ).json().tasks[0].status,
    "todo",
  );
  assert.equal(
    (
      await call(
        "GET",
        `/projects/${project.id}/time-machine/${added.event_order}`,
        undefined,
        outsider,
      )
    ).statusCode,
    404,
  );
  const older = await call(
    "GET",
    `/projects/${project.id}/time-machine/checkpoints?before=${completed.event_order}`,
  );
  assert.ok(
    older
      .json()
      .every(
        (row: { event_order: string }) =>
          BigInt(row.event_order) < BigInt(completed.event_order),
      ),
  );

  assert.equal(
    (await call("PUT", `/items/${task.id}/project`, { project_id: null }))
      .statusCode,
    200,
  );
  const removed = (
    await call("GET", `/projects/${project.id}/time-machine/checkpoints`)
  )
    .json()
    .find(
      (row: { summary: string }) =>
        row.summary === "Task removed: Prepare launch",
    );
  assert.ok(removed);
  assert.equal(
    (
      await call(
        "GET",
        `/projects/${project.id}/time-machine/${removed.event_order}`,
      )
    ).json().tasks.length,
    0,
  );
  assert.equal(
    (
      await call(
        "GET",
        `/projects/${project.id}/time-machine/${completed.event_order}`,
      )
    ).json().tasks[0].status,
    "done",
  );

  const note = await call("POST", "/docs", {
    title: "Private reasoning",
    kind: "note",
    project_id: project.id,
    content: [{ type: "paragraph", text: "Sensitive note body" }],
  });
  assert.equal(note.statusCode, 201, note.body);
  const decision = await call("POST", "/work-records", {
    kind: "decision",
    title: "Launch carefully",
    project_id: project.id,
    source_doc_id: note.json().id,
  });
  assert.equal(decision.statusCode, 201, decision.body);
  const recordEvent = (
    await call("GET", `/projects/${project.id}/time-machine/checkpoints`)
  )
    .json()
    .find(
      (row: { summary: string }) =>
        row.summary === "Decision recorded: Launch carefully",
    );
  assert.ok(recordEvent);
  const archived = (
    await call(
      "GET",
      `/projects/${project.id}/time-machine/${recordEvent.event_order}`,
    )
  ).json();
  assert.equal(archived.notes[0].title, "Private reasoning");
  assert.equal(archived.records[0].title, "Launch carefully");
  assert.ok(!JSON.stringify(archived).includes("Sensitive note body"));
});

test("a preexisting project starts at a truthful baseline", async () => {
  const project = (
    await call("POST", "/projects", { name: "Earlier work" })
  ).json();
  const task = (
    await call("POST", "/items", { title: "Existing task", kind: "task" })
  ).json();
  assert.equal(
    (await call("PUT", `/items/${task.id}/project`, { project_id: project.id }))
      .statusCode,
    200,
  );
  const early = (
    await call("GET", `/projects/${project.id}/time-machine/checkpoints`)
  ).json()[0];
  await pool.query(
    "DELETE FROM project_activity WHERE project_id = $1 AND kind = 'project_created'",
    [project.id],
  );
  const sql = await readFile(
    new URL("../migrations/054_project_history_baseline.sql", import.meta.url),
    "utf8",
  );
  await pool.query(sql);
  const checkpoints = (
    await call("GET", `/projects/${project.id}/time-machine/checkpoints`)
  ).json();
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].summary, "Project history starts here");
  assert.equal(
    (
      await call(
        "GET",
        `/projects/${project.id}/time-machine/${early.event_order}`,
      )
    ).statusCode,
    404,
  );
  const baseline = await call(
    "GET",
    `/projects/${project.id}/time-machine/${checkpoints[0].event_order}`,
  );
  assert.equal(baseline.statusCode, 200, baseline.body);
  assert.equal(baseline.json().project.name, "Earlier work");
  assert.equal(baseline.json().stages.length, 4);
  assert.equal(baseline.json().tasks[0].title, "Existing task");
  const done = await call("PUT", `/items/${task.id}`, {
    title: "Existing task",
    kind: "task",
    status: "done",
    version: task.version,
  });
  assert.equal(done.statusCode, 200, done.body);
  const changed = (
    await call("GET", `/projects/${project.id}/time-machine/checkpoints`)
  ).json()[0];
  const after = await call(
    "GET",
    `/projects/${project.id}/time-machine/${changed.event_order}`,
  );
  assert.equal(after.statusCode, 200, after.body);
  assert.equal(after.json().tasks[0].status, "done");
  assert.equal(
    (
      await call(
        "GET",
        `/projects/${project.id}/time-machine/${checkpoints[0].event_order}`,
      )
    ).json().tasks[0].status,
    "todo",
  );
});
