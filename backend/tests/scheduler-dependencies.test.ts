import { test } from "node:test";
import assert from "node:assert/strict";
import {
  schedule,
  type SchedulerInput,
  type SchedulerTask,
} from "../src/modules/planner/scheduler.js";
const task = (
  id: string,
  dependencies: SchedulerTask["dependencies"] = [],
): SchedulerTask => ({
  id,
  title: id,
  dependencies,
  priority: "medium",
  status: "todo",
  due_at: null,
  estimate_minutes: 30,
  spent_minutes: 0,
  scheduled_minutes: 0,
  list_id: null,
  tag_ids: [],
  team_id: null,
});
const input = (tasks: SchedulerTask[]): SchedulerInput => ({
  tasks,
  busy: [],
  frames: [],
  useFrames: true,
  days: ["2026-09-22"],
  timezone: "UTC",
  workDays: [2],
  workStart: "09:00",
  workEnd: "17:00",
  padPercent: 0,
  split: true,
  splitAfterMinutes: 60,
  minBlockMinutes: 15,
  breakLevel: "none",
  now: new Date("2026-09-22T08:00:00Z"),
});
test("priority cannot place a dependent before its lower-priority prerequisite", () => {
  const prerequisite = {
    ...task("z-build"),
    priority: "low" as const,
    estimate_minutes: 120,
  };
  const dependent = {
    ...task("a-ship", [{ id: "z-build", ready_at: null }]),
    priority: "high" as const,
  };
  const plan = schedule(input([dependent, prerequisite]));
  assert.equal(plan.unplaced.length, 0);
  const end = plan.blocks
    .filter((b) => b.item_id === prerequisite.id)
    .at(-1)!.end_at;
  assert.ok(
    plan.blocks.find((b) => b.item_id === dependent.id)!.start_at >= end,
  );
});
test("partial, missing and cyclic prerequisites do not release dependents", () => {
  const a = task("a", [{ id: "b", ready_at: null }]);
  for (const tasks of [
    [a],
    [a, task("b", [{ id: "a", ready_at: null }])],
    [a, { ...task("b"), estimate_minutes: 600 }],
  ]) {
    const plan = schedule(input(tasks));
    assert.equal(
      plan.blocks.some((b) => b.item_id === "a"),
      false,
    );
    assert.ok(plan.unplaced.some((t) => t.item_id === "a"));
  }
});
test("fully scheduled prerequisites outside the requested scope provide an earliest start", () => {
  const plan = schedule(
    input([
      task("dependent", [{ id: "outside", ready_at: "2026-09-22T14:00:00Z" }]),
      task("independent"),
    ]),
  );
  assert.equal(
    plan.blocks.find((b) => b.item_id === "dependent")!.start_at,
    "2026-09-22T14:00:00.000Z",
  );
  assert.equal(
    plan.blocks.find((b) => b.item_id === "independent")!.start_at,
    "2026-09-22T09:00:00.000Z",
  );
});
test("pinned sessions that violate a prerequisite are not applied as valid blocks", () => {
  const i = input([
    task("dependent", [{ id: "outside", ready_at: "2026-09-22T14:00:00Z" }]),
  ]);
  i.pinned = [
    {
      item_id: "dependent",
      start_at: "2026-09-22T09:00:00Z",
      end_at: "2026-09-22T09:30:00Z",
    },
  ];
  const plan = schedule(i);
  assert.equal(plan.blocks.length, 0);
  assert.equal(plan.unplaced.length, 1);
});
test("already scheduled prerequisites in scope release dependents at their final block", () => {
  const p = {
    ...task("p"),
    scheduled_minutes: 30,
    scheduled_end_at: "2026-09-22T12:00:00Z",
  };
  const plan = schedule(input([task("d", [{ id: "p", ready_at: null }]), p]));
  assert.equal(
    plan.blocks.find((b) => b.item_id === "d")!.start_at,
    "2026-09-22T12:00:00.000Z",
  );
});
