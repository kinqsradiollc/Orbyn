import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  dependencyConflict,
  horizonLanes,
  laneLabel,
  onDay,
  type Item,
  type Plan,
  type PlannedBlock,
} from "@orbyn/core";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();

/**
 * The planner preview as days ahead: lanes by day, moving a session to
 * another day at the same time, and refusing a move that would start a task
 * before what it waits on.
 */
const TZ = "Australia/Melbourne";
const block = (id: string, start: string, end: string): PlannedBlock => ({
  item_id: id,
  title: id,
  start_at: start,
  end_at: end,
  frame_id: null,
  frame_name: null,
  part: 1,
  parts: 1,
  score: 0,
});
const plan = (blocks: PlannedBlock[]): Plan =>
  ({
    id: "p",
    starts_on: "2026-09-15",
    days: 3,
    blocks,
    unplaced: [],
    at_risk: [],
    capacity_minutes: 0,
    planned_minutes: 0,
    applied: false,
    expires_at: "",
    summary: "",
  }) as Plan;
const task = (id: string, waits: string[] = [], status = "todo") =>
  ({ id, title: id, status, prerequisite_ids: waits }) as unknown as Item;

test("lanes hold every day of the plan, sessions in time order", () => {
  const lanes = horizonLanes(
    plan([
      block("b", "2026-09-16T02:00:00Z", "2026-09-16T03:00:00Z"),
      block("a", "2026-09-15T23:00:00Z", "2026-09-16T00:30:00Z"),
    ]),
    TZ,
  );
  assert.deepEqual(
    lanes.map((l) => l.day),
    ["2026-09-15", "2026-09-16", "2026-09-17"],
  );
  assert.equal(lanes[0].blocks.length, 0);
  assert.deepEqual(
    lanes[1].blocks.map((b) => b.item_id),
    ["a", "b"],
  );
  assert.equal(lanes[1].minutes, 150);
  assert.equal(laneLabel("2026-09-15", "2026-09-15"), "Today");
  assert.equal(laneLabel("2026-09-16", "2026-09-15"), "Tomorrow");
});

test("moving to another day keeps the clock time and length", () => {
  // 9:00–10:30 in Melbourne on the 16th.
  const moved = onDay(
    { start_at: "2026-09-15T23:00:00Z", end_at: "2026-09-16T00:30:00Z" },
    "2026-09-18",
    TZ,
  );
  assert.equal(moved.start.toISOString(), "2026-09-17T23:00:00.000Z");
  assert.equal(moved.end.toISOString(), "2026-09-18T00:30:00.000Z");
});

test("a task can't move before what it waits on, or after what waits on it", () => {
  const p = plan([
    block("write", "2026-09-15T23:00:00Z", "2026-09-16T01:00:00Z"),
    block("review", "2026-09-16T23:00:00Z", "2026-09-17T00:00:00Z"),
  ]);
  const items = [task("write"), task("review", ["write"])];
  // Review before the writing finishes: refused, with the reason.
  assert.match(
    dependencyConflict(
      "review",
      new Date("2026-09-15T22:00:00Z"),
      new Date("2026-09-15T23:00:00Z"),
      p,
      items,
    )!,
    /Waits on write/,
  );
  // Writing moved past the review: refused too.
  assert.match(
    dependencyConflict(
      "write",
      new Date("2026-09-17T23:00:00Z"),
      new Date("2026-09-18T01:00:00Z"),
      p,
      items,
    )!,
    /review waits on this/,
  );
  // Later is fine, and a finished prerequisite doesn't hold anything.
  assert.equal(
    dependencyConflict(
      "review",
      new Date("2026-09-17T23:00:00Z"),
      new Date("2026-09-18T00:00:00Z"),
      p,
      items,
    ),
    null,
  );
  assert.equal(
    dependencyConflict(
      "review",
      new Date("2026-09-15T22:00:00Z"),
      new Date("2026-09-15T23:00:00Z"),
      p,
      [task("write", [], "done"), task("review", ["write"])],
    ),
    null,
  );
});

// ---- two weeks ahead ------------------------------------------------------

let token = "";
before(async () => {
  await migrate();
  token = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `hz-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name: "Horizon",
      },
    })
  ).json().token;
});
after(async () => {
  await app.close();
  await pool.end();
});

test("a preview can look two weeks ahead, and no further", async () => {
  const call = (days: number) =>
    app.inject({
      method: "POST",
      url: "/planner/preview",
      headers: { authorization: `Bearer ${token}` },
      payload: { days },
    });
  const two = await call(14);
  assert.equal(two.statusCode, 200, two.body);
  assert.equal(two.json().days, 14);
  assert.equal((await call(15)).statusCode, 422);
});
