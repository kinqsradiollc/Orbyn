import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { randomUUID } from "node:crypto";

process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { enqueue } = await import("../src/worker/scheduler.js");
const app = await buildApp();

type Account = { token: string; id: string; email: string };
const accounts: Account[] = [];
let owner: Account;
let viewer: Account;
let outsider: Account;

async function register(label: string): Promise<Account> {
  const email = `${label}-${randomUUID()}@example.com`;
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "a-long-test-password", name: label },
  });
  assert.equal(r.statusCode, 201, r.body);
  const a = { token: r.json().token, id: r.json().user.id, email };
  accounts.push(a);
  return a;
}

const call = (
  a: Account,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: object,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${a.token}` },
    ...(payload === undefined ? {} : { payload }),
  });

const task = (title: string, extra: object = {}) => ({
  title,
  due_at: new Date(Date.now() + 60_000).toISOString(),
  ...extra,
});

before(async () => {
  await migrate();
  owner = await register("owner");
  viewer = await register("viewer");
  outsider = await register("outsider");
});

after(async () => {
  await pool.query("DELETE FROM teams WHERE created_by=ANY($1::uuid[])", [
    accounts.map((a) => a.id),
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    accounts.map((a) => a.id),
  ]);
  await app.close();
  await pool.end();
});

test("checklist steps drive progress and move a task into progress", async () => {
  const item = (
    await call(owner, "POST", "/items", task("Launch plan"))
  ).json();
  assert.equal(item.status, "todo");
  assert.equal(item.progress, 0);

  let detail = (
    await call(owner, "POST", `/items/${item.id}/steps`, { title: "Draft" })
  ).json();
  detail = (
    await call(owner, "POST", `/items/${item.id}/steps`, { title: "Review" })
  ).json();
  assert.deepEqual(
    detail.steps.map((s: { title: string }) => s.title),
    ["Draft", "Review"],
  );
  assert.equal(detail.progress, 0);

  const [draft, review] = detail.steps;
  detail = (
    await call(owner, "PUT", `/items/${item.id}/steps/${draft.id}`, {
      done: true,
    })
  ).json();
  assert.equal(detail.progress, 50);
  assert.equal(detail.status, "in_progress");
  assert.equal(detail.steps_total, 2);
  assert.equal(detail.steps_done, 1);

  detail = (
    await call(owner, "PUT", `/items/${item.id}/steps/${review.id}`, {
      done: true,
    })
  ).json();
  assert.equal(detail.progress, 100);
  assert.equal(
    detail.status,
    "in_progress",
    "finishing steps does not close the task",
  );

  // Steps don't change the edit version, so an open editor can still save,
  // and saving without progress keeps it.
  const saved = await call(owner, "PUT", `/items/${item.id}`, {
    title: "Launch plan v2",
    status: "in_progress",
    due_at: item.due_at,
    version: item.version,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().progress, 100);

  // Manual progress is refused while a checklist exists.
  assert.equal(
    (await call(owner, "POST", `/items/${item.id}/updates`, { progress: 10 }))
      .statusCode,
    409,
  );

  detail = (
    await call(owner, "DELETE", `/items/${item.id}/steps/${draft.id}`)
  ).json();
  assert.equal(detail.steps.length, 1);

  const list = (await call(owner, "GET", "/items")).json();
  const row = list.find((i: { id: string }) => i.id === item.id);
  assert.equal(row.steps_total, 1);
  assert.equal(row.steps_done, 1);
});

test("progress updates build a timeline and change status", async () => {
  const item = (
    await call(owner, "POST", "/items", task("Write report"))
  ).json();
  let detail = (
    await call(owner, "POST", `/items/${item.id}/updates`, {
      body: "Outline done",
      progress: 30,
    })
  ).json();
  assert.equal(detail.progress, 30);
  assert.equal(detail.status, "in_progress");
  assert.equal(detail.updates[0].body, "Outline done");
  assert.equal(detail.updates[0].author_name, "owner");
  assert.equal(detail.updates[0].progress, 30);

  detail = (
    await call(owner, "POST", `/items/${item.id}/updates`, {
      body: "Waiting on data",
      status: "blocked",
    })
  ).json();
  assert.equal(detail.status, "blocked");
  detail = (
    await call(owner, "POST", `/items/${item.id}/updates`, { status: "done" })
  ).json();
  assert.equal(detail.status, "done");
  assert.equal(detail.progress, 100);
  assert.equal(detail.updates.length, 3);
  assert.equal(detail.updates[0].status, "done", "newest first");

  // Reopening re-arms reminders.
  const before = (
    await pool.query("SELECT reminder_version FROM items WHERE id=$1", [
      item.id,
    ])
  ).rows[0].reminder_version;
  await call(owner, "POST", `/items/${item.id}/updates`, {
    body: "One more pass",
    status: "in_progress",
  });
  const after = (
    await pool.query("SELECT reminder_version FROM items WHERE id=$1", [
      item.id,
    ])
  ).rows[0].reminder_version;
  assert.equal(after, before + 1);

  assert.equal(
    (await call(owner, "POST", `/items/${item.id}/updates`, {})).statusCode,
    422,
  );
  const count = (await call(owner, "GET", "/items"))
    .json()
    .find((i: { id: string }) => i.id === item.id);
  assert.equal(count.updates_count, 4);
  assert.ok(count.last_update_at);
});

test("viewers read progress but cannot change it; outsiders see nothing", async () => {
  const team = (
    await call(owner, "POST", "/teams", { name: "Progress team" })
  ).json();
  await call(owner, "POST", `/teams/${team.id}/members`, {
    email: viewer.email,
    role: "viewer",
  });
  const item = (
    await call(owner, "POST", "/items", task("Team task", { team_id: team.id }))
  ).json();
  await call(owner, "POST", `/items/${item.id}/steps`, { title: "Step" });

  const seen = await call(viewer, "GET", `/items/${item.id}`);
  assert.equal(seen.statusCode, 200);
  assert.equal(seen.json().steps.length, 1);
  assert.equal(
    (await call(viewer, "POST", `/items/${item.id}/steps`, { title: "Nope" }))
      .statusCode,
    403,
  );
  assert.equal(
    (await call(viewer, "POST", `/items/${item.id}/updates`, { body: "Nope" }))
      .statusCode,
    403,
  );
  assert.equal(
    (await call(outsider, "GET", `/items/${item.id}`)).statusCode,
    404,
  );
  assert.equal(
    (
      await call(outsider, "POST", `/items/${item.id}/updates`, {
        body: "Nope",
      })
    ).statusCode,
    404,
  );
});

test("reminders cover every status except done", async () => {
  const blocked = (
    await call(
      owner,
      "POST",
      "/items",
      task("Blocked task", { status: "blocked" }),
    )
  ).json();
  const done = (
    await call(owner, "POST", "/items", task("Done task", { status: "done" }))
  ).json();
  assert.equal(done.progress, 100);
  await enqueue();
  const reminded = (
    await pool.query(
      "SELECT item_id FROM notifications WHERE item_id = ANY($1::uuid[]) AND channel='inapp'",
      [[blocked.id, done.id]],
    )
  ).rows.map((r) => r.item_id);
  assert.deepEqual(reminded, [blocked.id]);
});
