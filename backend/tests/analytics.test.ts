import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
let token = "";
const auth = () => ({ authorization: `Bearer ${token}` });
const call = (method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: auth(),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3_600_000).toISOString();

before(async () => {
  await migrate();
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `an-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "A",
    },
  });
  token = reg.json().token;
});
after(async () => {
  await app.close();
  await pool.end();
});

test("analytics sum set-aside time by list and tag, and count completions", async () => {
  const list = (await call("POST", "/lists", { name: "Work" })).json();
  const tag = (await call("POST", "/tags", { name: "deep" })).json();
  const task = (
    await call("POST", "/items", {
      title: "Report",
      kind: "task",
      list_id: list.id,
      tag_ids: [tag.id],
    })
  ).json();
  // Two hours set aside for it, yesterday.
  await call("POST", "/blocks", {
    item_id: task.id,
    start_at: hoursAgo(26),
    end_at: hoursAgo(24),
  });
  // A finished task, for the completed count.
  const done = (
    await call("POST", "/items", { title: "Quick", kind: "task" })
  ).json();
  await call("POST", `/items/${done.id}/updates`, { status: "done" });

  const a = (await call("GET", "/planner/analytics?days=30")).json();
  assert.equal(a.days, 30);
  assert.equal(a.planned_minutes, 120, "two hours set aside");
  assert.ok(a.completed >= 1, "the finished task is counted");
  assert.deepEqual(
    a.by_list.find((x: { name: string }) => x.name === "Work"),
    { name: "Work", minutes: 120 },
  );
  assert.deepEqual(
    a.by_tag.find((x: { name: string }) => x.name === "deep"),
    { name: "deep", minutes: 120 },
  );
});

test("a short window excludes older blocks", async () => {
  const task = (
    await call("POST", "/items", { title: "Old work", kind: "task" })
  ).json();
  // A block from 10 days ago.
  await call("POST", "/blocks", {
    item_id: task.id,
    start_at: hoursAgo(10 * 24 + 2),
    end_at: hoursAgo(10 * 24),
  });
  const week = (await call("GET", "/planner/analytics?days=7")).json();
  const month = (await call("GET", "/planner/analytics?days=30")).json();
  assert.ok(
    month.planned_minutes > week.planned_minutes,
    "the 10-day-old block is only in the month",
  );
});
