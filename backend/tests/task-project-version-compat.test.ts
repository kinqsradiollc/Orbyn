import "./setup.js";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";
import type { UserRow } from "../src/lib/auth.js";

const { taskProjectExpectedVersion, TASK_PROJECT_COMPAT_KEY } =
  await import("../src/lib/task-project-compat.js");
const { buildApp } = await import("../src/app.js");
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { setItemPlacement } = await import("../src/modules/items/service.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();
let owner: Person, actor: UserRow, key: string, original: unknown;
const windowMs = 90 * 24 * 60 * 60 * 1000;
const installed = new Date("2026-01-01T00:00:00.000Z");
const deadline = new Date(installed.getTime() + windowMs);
function policy(start = installed) {
  return {
    version: 1,
    installed_at: start.toISOString(),
    deadline: new Date(start.getTime() + windowMs).toISOString(),
    legacy_use_count: 0,
    legacy_last_used_at: null,
  };
}
async function put(value: unknown) {
  await pool.query("UPDATE system_settings SET value=$2::jsonb WHERE key=$1", [
    TASK_PROJECT_COMPAT_KEY,
    JSON.stringify(value),
  ]);
}
async function saved() {
  return (
    await pool.query("SELECT value FROM system_settings WHERE key=$1", [
      TASK_PROJECT_COMPAT_KEY,
    ])
  ).rows[0]?.value;
}
async function taskAndProject() {
  const t = await h.call(owner.token, "POST", "/items", {
    title: "Compatibility task",
    kind: "task",
  });
  assert.equal(t.statusCode, 201, t.body);
  const p = await h.call(owner.token, "POST", "/projects", {
    name: "Compatibility project",
  });
  assert.equal(p.statusCode, 201, p.body);
  return { task: t.json(), project: p.json() };
}
before(async () => {
  await migrate();
  original = await saved();
  assert.ok(original);
  owner = await h.register("task-project-compat");
  actor = (
    await pool.query<UserRow>("SELECT * FROM users WHERE id=$1", [owner.id])
  ).rows[0];
  key = (await h.agentKey(owner, { access: "write" })).key;
});
afterEach(async () => {
  await pool.query(
    `INSERT INTO system_settings(key,value) VALUES($1,$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [TASK_PROJECT_COMPAT_KEY, JSON.stringify(original)],
  );
});
after(async () => {
  const { closeLive } = await import("../src/modules/documents/live.js");
  await closeLive();
  assert.deepEqual(network.calls, []);
  network.restore();
  await app.close();
  await pool.end();
});

test("migration fixes one 90-day UTC deadline and reruns preserve usage and deadline", async () => {
  const row = await saved();
  assert.equal(
    Date.parse(row.deadline) - Date.parse(row.installed_at),
    windowMs,
  );
  await put({
    ...row,
    legacy_use_count: 7,
    legacy_last_used_at: row.installed_at,
  });
  const sql = await readFile(
    new URL(
      "../migrations/290_task_project_version_compat.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await transaction(async (db) => {
    await db.query(sql);
    await db.query(sql);
  });
  const retained = await saved();
  assert.equal(retained.deadline, row.deadline);
  assert.equal(retained.installed_at, row.installed_at);
  assert.equal(retained.legacy_use_count, 7);
});

for (const offset of [-1, 0, 1]) {
  test(`legacy placement uses shared cutoff ${offset < 0 ? "before" : offset === 0 ? "at" : "after"} its deadline`, async () => {
    await put(policy());
    const { task, project } = await taskAndProject();
    const work = transaction(async (db) => {
      const current = (
        await db.query("SELECT version FROM items WHERE id=$1 FOR UPDATE", [
          task.id,
        ])
      ).rows[0];
      const version = await taskProjectExpectedVersion(
        db,
        undefined,
        current.version,
        { now: new Date(deadline.getTime() + offset) },
      );
      return setItemPlacement(db, actor, task.id, {
        version,
        project_id: project.id,
      });
    });
    if (offset < 0) {
      const placed = await work;
      assert.equal(placed.project_id, project.id);
      const row = await saved();
      assert.equal(row.legacy_use_count, 1);
      assert.equal(Date.parse(row.legacy_last_used_at), deadline.getTime() - 1);
      assert.deepEqual(Object.keys(row).sort(), [
        "deadline",
        "installed_at",
        "legacy_last_used_at",
        "legacy_use_count",
        "version",
      ]);
    } else {
      await assert.rejects(
        work,
        (error: any) =>
          error.code === "INVALID" && /Fetch the task/.test(error.fix),
      );
      assert.equal((await saved()).legacy_use_count, 0);
      assert.equal(
        (
          await pool.query("SELECT project_id FROM items WHERE id=$1", [
            task.id,
          ])
        ).rows[0].project_id,
        null,
      );
    }
  });
}

test("separate replica clients share the persisted deadline and atomically accumulate legacy use", async () => {
  await put(policy());
  const first = await pool.connect(),
    second = await pool.connect();
  try {
    const firstPid = (await first.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    const secondPid = (await second.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    assert.notEqual(firstPid, secondPid);
    await first.query("BEGIN");
    await second.query("BEGIN");
    assert.equal(
      await taskProjectExpectedVersion(first, undefined, 4, {
        now: new Date(deadline.getTime() - 2),
      }),
      4,
    );
    const waiting = taskProjectExpectedVersion(second, undefined, 5, {
      now: new Date(deadline.getTime() - 1),
    });
    await first.query("COMMIT");
    assert.equal(await waiting, 5);
    await second.query("COMMIT");
    const row = await saved();
    assert.equal(row.deadline, deadline.toISOString());
    assert.equal(row.legacy_use_count, 2);
    assert.equal(Date.parse(row.legacy_last_used_at), deadline.getTime() - 1);
  } finally {
    await first.query("ROLLBACK");
    await second.query("ROLLBACK");
    first.release();
    second.release();
  }
});

test("legacy accounting rolls back when canonical placement fails", async () => {
  await put(policy());
  const { task, project } = await taskAndProject();
  await h.call(owner.token, "PUT", `/items/${task.id}/project`, {
    version: task.version,
    project_id: project.id,
  });
  await assert.rejects(
    transaction(async (db) => {
      const version = await taskProjectExpectedVersion(
        db,
        undefined,
        task.version,
        { now: installed },
      );
      await setItemPlacement(db, actor, task.id, { version, project_id: null });
    }),
    (error: any) => error.status === 409,
  );
  assert.equal((await saved()).legacy_use_count, 0);
});

for (const expired of [false, true]) {
  test(`explicit stale versions conflict ${expired ? "after" : "during"} the grace window`, async () => {
    await put(
      policy(expired ? new Date("2000-01-01T00:00:00.000Z") : new Date()),
    );
    const { task, project } = await taskAndProject();
    await h.call(owner.token, "PUT", `/items/${task.id}/project`, {
      version: task.version,
      project_id: project.id,
    });
    await assert.rejects(
      transaction(async (db) => {
        const version = await taskProjectExpectedVersion(
          db,
          task.version,
          task.version + 1,
        );
        assert.equal(version, task.version);
        await setItemPlacement(db, actor, task.id, {
          version,
          project_id: null,
        });
      }),
      (error: any) => error.status === 409,
    );
    assert.equal((await saved()).legacy_use_count, 0);
  });
}

test("missing or corrupt policy refuses omission while explicit expected versions stay available", async () => {
  const corrupt = [
    null,
    {},
    { ...policy(), deadline: "invalid" },
    { ...policy(), legacy_use_count: -1 },
    { ...policy(), deadline: new Date(deadline.getTime() + 1).toISOString() },
  ];
  for (const value of corrupt) {
    if (value === null)
      await pool.query("DELETE FROM system_settings WHERE key=$1", [
        TASK_PROJECT_COMPAT_KEY,
      ]);
    else
      await pool.query(
        `INSERT INTO system_settings(key,value) VALUES($1,$2::jsonb)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
        [TASK_PROJECT_COMPAT_KEY, JSON.stringify(value)],
      );
    await assert.rejects(
      transaction((db) => taskProjectExpectedVersion(db, undefined, 3)),
      (error: any) => error.code === "UNAVAILABLE",
    );
    assert.equal(
      await transaction((db) => taskProjectExpectedVersion(db, 2, 3)),
      2,
    );
  }
});

test("MCP runtime accepts legacy placement only in-window, honors explicit versions, and REST always requires them", async () => {
  await put(policy(new Date()));
  const { task, project } = await taskAndProject();
  const args = {
    action: "link",
    kind: "task_project",
    from: `task:${task.id}`,
    to: `project:${project.id}`,
  };
  const tool = async (input: object) => {
    limiter.reset();
    strikes.reset();
    return (await h.tool(key, "link", input)) as any;
  };
  const made = await tool(args);
  assert.ok(!made.isError, made.content?.[0]?.text);
  assert.equal((await saved()).legacy_use_count, 1);
  await put(policy(new Date("2000-01-01T00:00:00.000Z")));
  const retired = await tool({ ...args, action: "unlink" });
  assert.equal(retired._meta?.["orbyn/error"]?.code, "INVALID");
  const publicClockAttempt = await tool({
    ...args,
    action: "unlink",
    now: installed.toISOString(),
  });
  assert.equal(
    publicClockAttempt.isError,
    true,
    "Tool callers cannot inject the internal test clock",
  );
  assert.equal((await saved()).legacy_use_count, 0);
  assert.equal(
    (await tool({ ...args, action: "unlink", version: task.version }))._meta?.[
      "orbyn/error"
    ]?.code,
    "VERSION_CONFLICT",
  );
  const current = (
    await pool.query("SELECT version FROM items WHERE id=$1", [task.id])
  ).rows[0];
  assert.ok(
    !(await tool({ ...args, action: "unlink", version: current.version }))
      .isError,
  );
  assert.equal(
    (
      await h.call(owner.token, "PUT", `/items/${task.id}/project`, {
        project_id: project.id,
      })
    ).statusCode,
    422,
  );
});

test("test clock override is internal and refused on a client without the database marker", async () => {
  await put(policy());
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL orbyn.environment='not-test'");
    await assert.rejects(
      taskProjectExpectedVersion(db, undefined, 1, { now: installed }),
      /marked test database/,
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
