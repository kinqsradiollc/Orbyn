import { test } from "node:test";
import assert from "node:assert/strict";
import { dueAfterProject, latestDates, priorityScore } from "@orbyn/core";

const task = (
  id: string,
  due: string | null,
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind: "task",
  status: "todo",
  due_at: due,
  ...extra,
});

test("a task's latest date is the earliest of its own, its project's and its waiters'", () => {
  const project = "2026-10-16T07:00:00.000Z";
  const latest = latestDates([
    task("own-first", "2026-10-10T07:00:00.000Z", {
      project_id: "p",
      project_deadline: project,
    }),
    task("project-first", "2026-10-20T07:00:00.000Z", {
      project_id: "p",
      project_deadline: project,
    }),
    task("undated", null, { project_id: "p", project_deadline: project }),
    task("prerequisite", null),
    task("waiter", "2026-10-05T07:00:00.000Z", {
      prerequisite_ids: ["prerequisite"],
    }),
    task("done-waiter", "2026-10-01T07:00:00.000Z", {
      status: "done",
      prerequisite_ids: ["prerequisite"],
    }),
    task("loop-a", null, { prerequisite_ids: ["loop-b"] }),
    task("loop-b", null, { prerequisite_ids: ["loop-a"] }),
  ]);
  assert.equal(latest.get("own-first"), "2026-10-10T07:00:00.000Z");
  assert.equal(latest.get("project-first"), project);
  assert.equal(latest.get("undated"), project);
  // Inherits the open waiter's date; the finished one doesn't count.
  assert.equal(latest.get("prerequisite"), "2026-10-05T07:00:00.000Z");
  assert.equal(latest.get("loop-a"), null);
  // A map of project deadlines wins over what the tasks carry.
  const moved = latestDates(
    [task("t", null, { project_id: "p", project_deadline: project })],
    new Map([["p", "2026-10-02T07:00:00.000Z"]]),
  );
  assert.equal(moved.get("t"), "2026-10-02T07:00:00.000Z");
});

test("sorting by the latest date puts a task due after its project first", () => {
  const now = new Date("2026-10-14T00:00:00.000Z");
  const tasks = [
    task("late", "2026-11-30T07:00:00.000Z", {
      priority: "medium",
      project_id: "p",
      project_deadline: "2026-10-15T07:00:00.000Z",
    }),
    task("soon", "2026-10-20T07:00:00.000Z", { priority: "medium" }),
  ];
  const latest = latestDates(tasks);
  const score = (t: (typeof tasks)[number]) =>
    priorityScore(
      {
        ...t,
        priority: "medium",
        deadline_at: latest.get(t.id),
      },
      now,
    );
  assert.ok(score(tasks[0]) > score(tasks[1]));
  assert.equal(
    dueAfterProject("2026-11-30T07:00:00.000Z", "2026-10-15T07:00:00.000Z"),
    true,
  );
  assert.equal(dueAfterProject("2026-10-01T07:00:00.000Z", null), false);
});
