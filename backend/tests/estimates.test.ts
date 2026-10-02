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
let userId = "";
const auth = () => ({ authorization: `Bearer ${token}` });
const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: auth(),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

/** A finished task that took `spent` against an `estimate`. */
async function finished(estimate: number, spent: number) {
  await pool.query(
    `INSERT INTO items (user_id, title, kind, status, estimate_minutes, spent_minutes, updated_at)
     VALUES ($1, 'done task', 'task', 'done', $2, $3, now())`,
    [userId, estimate, spent],
  );
}

before(async () => {
  await migrate();
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `est-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "E",
    },
  });
  token = reg.json().token;
  userId = reg.json().user.id;
});
after(async () => {
  await app.close();
  await pool.end();
});

test("the ratio needs a few finished tasks before it is trusted", async () => {
  // Two tasks that each took twice as long — not enough to trust yet.
  await finished(60, 120);
  await finished(30, 60);
  let model = (await call("GET", "/planner/estimates")).json();
  assert.equal(model.overall.samples, 2);
  assert.equal(model.overall.ratio, 1, "held at 1 below the sample floor");

  // A third tips it over the floor, though three tasks only move it part of
  // the way: it's shrunk towards 1 until there's more history.
  await finished(30, 60);
  model = (await call("GET", "/planner/estimates")).json();
  assert.equal(model.overall.samples, 3);
  assert.ok(
    model.overall.ratio > 1.3 && model.overall.ratio < 2,
    `part of the way to 2× (${model.overall.ratio})`,
  );
  assert.equal(model.applied, false, "not applied until turned on");

  // With more of the same, it settles close to twice as long.
  for (let i = 0; i < 20; i++) await finished(30, 60);
  model = (await call("GET", "/planner/estimates")).json();
  assert.ok(model.overall.ratio >= 1.8, `close to 2× (${model.overall.ratio})`);
  const [low, high] = model.overall.range;
  assert.ok(low <= model.overall.ratio && model.overall.ratio <= high);
});

test("the ratio is clamped so one wild task can't dominate", async () => {
  // A task that took 100× would push the raw ratio far past the cap.
  await finished(1, 100);
  const model = (await call("GET", "/planner/estimates")).json();
  assert.ok(model.overall.ratio <= 3, "never more than triple");
});

test("turning it on scales an open task's planned time", async () => {
  // Fresh user so the earlier history doesn't muddy the ratio.
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `est2-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "E2",
    },
  });
  token = reg.json().token;
  userId = reg.json().user.id;
  // Ratio 1.5; a dozen tasks bring the learned ratio to about 1.4.
  for (let i = 0; i < 12; i++) await finished(60, 90);

  const task = (
    await call("POST", "/items", {
      title: "Write the memo",
      kind: "task",
      estimate_minutes: 60,
      due_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    })
  ).json();

  // Include a full week so Friday/weekend runs have enough working time.
  // This tests estimate learning, not a plan truncated by remaining capacity.
  const planned = async () => {
    const plan = (
      await call("POST", "/planner/preview", { days: 7, item_ids: [task.id] })
    ).json();
    const row = plan.tasks.find(
      (t: { item_id: string }) => t.item_id === task.id,
    );
    return row.planned_minutes as number;
  };

  await call("PUT", "/planner/prefs", { learn_estimates: false });
  const base = await planned();
  assert.ok(base >= 60, "at least the estimate when off");

  await call("PUT", "/planner/prefs", { learn_estimates: true });
  const scaled = await planned();
  // Planned time carries the same padding either way, so their ratio is ~1.5×.
  assert.ok(scaled > base, "more time is set aside when learning is on");
  assert.ok(
    Math.abs(scaled / base - 1.42) < 0.15,
    `about 1.4× (base ${base}, scaled ${scaled})`,
  );
});
