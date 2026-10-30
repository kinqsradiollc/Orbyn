import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dueDate,
  sessionsDeadlineWords,
  splitSessions,
  endsAfterDeadline,
  deadlineOf,
} from "@orbyn/core";

const zone = "Australia/Melbourne";
test("future sessions for an overdue task are described as catch-up rather than planned before the past deadline", () => {
  const deadline = "2026-10-28T06:00:00.000Z",
    now = new Date("2026-10-30T00:00:00.000Z");
  const session = {
    start_at: "2026-10-31T03:00:00.000Z",
    end_at: "2026-10-31T03:45:00.000Z",
  };
  const split = splitSessions(
    { due_at: deadline, all_day: false, timezone: zone },
    [session],
    now,
  );
  assert.equal(split.planned_minutes, 45);
  assert.equal(split.late_minutes, 0);
  assert.equal(split.catch_up, true);
  assert.equal(
    endsAfterDeadline(session.end_at, deadline),
    true,
    "The row retains its factual after-deadline flag",
  );
  const words = sessionsDeadlineWords(
    {
      deadline_at: deadline,
      due_all_day: false,
      planning_deadline_at: deadline,
      time_zone: zone,
    },
    now,
  );
  assert.equal(
    `Planned ${split.planned_minutes}m ${words.by}`,
    `Planned 45m for catch-up after ${dueDate(deadline, false, zone)}`,
  );
  assert.equal(words.due, `Due ${dueDate(deadline, false, zone)}`);
  assert.doesNotMatch(words.by, /before/);
});

test("future deadlines still describe planned time before the correct own or project deadline", () => {
  const own = "2026-11-02T06:00:00.000Z",
    project = "2026-11-01T06:00:00.000Z",
    now = new Date("2026-10-30T00:00:00.000Z");
  const words = sessionsDeadlineWords(
    {
      deadline_at: own,
      due_all_day: false,
      project_deadline: project,
      planning_deadline_at: project,
      time_zone: zone,
    },
    now,
  );
  assert.equal(words.by, `before ${dueDate(project, false, zone)}`);
  assert.equal(words.due, `Due ${dueDate(own, false, zone)}`);
  assert.equal(words.sooner, `project ends ${dueDate(project, false, zone)}`);
});

test("all-day catch-up starts at the account-zone deadline and undated sessions do not invent one", () => {
  const deadline = deadlineOf({
    due_at: "2026-10-27T13:00:00.000Z",
    all_day: true,
    timezone: zone,
  })!;
  const data = { deadline_at: deadline, due_all_day: true, time_zone: zone };
  const before = sessionsDeadlineWords(
    data,
    new Date(Date.parse(deadline) - 1),
  );
  assert.equal(before.by, `by the end of ${dueDate(deadline, true, zone)}`);
  const passed = sessionsDeadlineWords(data, new Date(deadline));
  assert.equal(
    passed.by,
    `for catch-up after the end of ${dueDate(deadline, true, zone)}`,
  );
  const undated = sessionsDeadlineWords(
    { deadline_at: null, due_all_day: false, time_zone: zone },
    new Date(deadline),
  );
  assert.deepEqual(undated, { due: null, sooner: null, by: "" });
});
