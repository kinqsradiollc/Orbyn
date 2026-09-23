import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProjectDraft } from "../src/modules/ai/project-draft.js";
import { scheduleProjectDraft } from "../src/modules/ai/project-schedule.js";
import type { SchedulerInput } from "../src/modules/planner/scheduler.js";
const input: Omit<SchedulerInput, "tasks" | "pinned"> = {
  busy: [],
  frames: [],
  useFrames: true,
  days: ["2026-09-22"],
  timezone: "UTC",
  workDays: [0, 1, 2, 3, 4, 5, 6],
  workStart: "09:00",
  workEnd: "17:00",
  padPercent: 0,
  split: true,
  splitAfterMinutes: 60,
  minBlockMinutes: 15,
  breakLevel: "none",
  now: new Date("2026-09-22T08:00:00Z"),
};
const draft = (
  tasks: { id: string; estimate_minutes: number; depends_on: string[] }[],
) =>
  parseProjectDraft(
    JSON.stringify({
      title: "Launch",
      tasks: tasks.map((t) => ({ ...t, title: t.id, due_in_days: 0 })),
    }),
  );
test("places every dependent after all sessions of its prerequisites", () => {
  const plan = scheduleProjectDraft(
    draft([
      { id: "ship", estimate_minutes: 30, depends_on: ["build"] },
      { id: "build", estimate_minutes: 120, depends_on: [] },
    ]),
    input,
  );
  assert.equal(plan.unplaced.length, 0);
  const build = plan.blocks.filter((b) => b.item_id === "build");
  assert.equal(build.length, 2);
  assert.ok(
    plan.blocks.find((b) => b.item_id === "ship")!.start_at >=
      build.at(-1)!.end_at,
  );
  assert.equal(plan.planned_minutes, 150);
});
test("does not schedule dependents when only part of a prerequisite fits", () => {
  const plan = scheduleProjectDraft(
    draft([
      { id: "build", estimate_minutes: 120, depends_on: [] },
      { id: "ship", estimate_minutes: 15, depends_on: ["build"] },
    ]),
    { ...input, workEnd: "10:00" },
  );
  assert.equal(plan.blocks.length, 1);
  assert.deepEqual(
    plan.unplaced.map((t) => t.item_id),
    ["build", "ship"],
  );
});
test("respects busy time and carries breaks between separately scheduled tasks", () => {
  const plan = scheduleProjectDraft(
    draft([
      { id: "a", estimate_minutes: 60, depends_on: [] },
      { id: "b", estimate_minutes: 30, depends_on: ["a"] },
    ]),
    {
      ...input,
      breakLevel: "normal",
      busy: [
        { start_at: "2026-09-22T09:00:00Z", end_at: "2026-09-22T10:00:00Z" },
      ],
    },
  );
  assert.equal(plan.blocks[0].start_at, "2026-09-22T10:00:00.000Z");
  assert.equal(plan.blocks[1].start_at, "2026-09-22T11:10:00.000Z");
});
test("uses frames in their timezone and never falls back outside available frames", () => {
  const frames = [
    {
      id: "f",
      name: "Focus",
      days: [2],
      start_time: "10:00",
      end_time: "11:00",
      filters: {
        priorities: [],
        list_ids: [],
        tag_ids: [],
        team_ids: [],
        max_minutes: null,
      },
      color: null,
      position: 0,
      timezone: "Australia/Melbourne",
    },
  ] as SchedulerInput["frames"];
  const plan = scheduleProjectDraft(
    draft([{ id: "a", estimate_minutes: 30, depends_on: [] }]),
    {
      ...input,
      timezone: "Australia/Melbourne",
      now: new Date("2026-09-21T21:00:00Z"),
      frames,
    },
  );
  assert.equal(plan.blocks[0].start_at, "2026-09-22T00:00:00.000Z");
  assert.equal(plan.blocks[0].frame_id, "f");
});

test("keeps local working hours and dependency order across a DST change", () => {
  // Australia/Melbourne moves +10 -> +11 at 2am local on Sun 2026-10-04, so
  // the same wall-clock morning is a different UTC instant on either side.
  const tz = "Australia/Melbourne";
  const plan = scheduleProjectDraft(
    draft([
      { id: "c", estimate_minutes: 480, depends_on: ["b"] },
      { id: "b", estimate_minutes: 480, depends_on: ["a"] },
      { id: "a", estimate_minutes: 480, depends_on: [] },
    ]),
    {
      ...input,
      timezone: tz,
      days: ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"],
      splitAfterMinutes: 240,
      now: new Date("2026-10-02T00:00:00+10:00"),
    },
  );
  const local = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  assert.equal(plan.unplaced.length, 0);
  // Every session sits inside 09:00-17:00 LOCAL, including the day the clocks
  // change — the bug this guards against places them an hour out instead.
  for (const b of plan.blocks) {
    assert.ok(
      local(b.start_at) >= "09:00",
      `${b.item_id} starts ${local(b.start_at)}`,
    );
    assert.ok(
      local(b.end_at) <= "17:00",
      `${b.item_id} ends ${local(b.end_at)}`,
    );
  }
  const last = (id: string) =>
    plan.blocks.filter((b) => b.item_id === id).at(-1)!.end_at;
  const first = (id: string) =>
    plan.blocks.filter((b) => b.item_id === id)[0]!.start_at;
  assert.ok(first("b") >= last("a"), "b must start after a finishes");
  assert.ok(first("c") >= last("b"), "c must start after b finishes");
  // The plan has to actually straddle the change, or this test proves nothing.
  // Saturday and Sunday both start at 09:00 local, but Sunday is an hour
  // earlier in UTC because the offset moved +10 -> +11. A scheduler that
  // computed local time from a fixed offset would put them at the same instant
  // of day, and this is the assertion that catches it.
  assert.equal(local(first("b")), "09:00");
  assert.equal(local(first("c")), "09:00");
  const utcHour = (iso: string) => new Date(iso).getUTCHours();
  assert.equal(
    utcHour(first("b")),
    23,
    "Saturday 09:00 local is 23:00Z at +10",
  );
  assert.equal(utcHour(first("c")), 22, "Sunday 09:00 local is 22:00Z at +11");
});

test("over-subscribed capacity stops at the free time and says which task blocked", () => {
  const plan = scheduleProjectDraft(
    draft([
      { id: "a", estimate_minutes: 300, depends_on: [] },
      { id: "b", estimate_minutes: 300, depends_on: ["a"] },
      { id: "c", estimate_minutes: 300, depends_on: ["b"] },
    ]),
    { ...input, splitAfterMinutes: 240 },
  );
  // One 09:00-17:00 day is 480 minutes; 900 were asked for.
  assert.equal(plan.capacity_minutes, 480);
  assert.ok(
    plan.planned_minutes <= plan.capacity_minutes,
    `planned ${plan.planned_minutes} exceeds capacity ${plan.capacity_minutes}`,
  );
  assert.deepEqual(
    plan.blocks.map((b) => b.item_id),
    ["a", "a"],
    "only the work that fits is scheduled",
  );
  const reason = (id: string) =>
    plan.unplaced.find((t) => t.item_id === id)?.reason ?? "";
  assert.match(reason("b"), /Not enough free time/);
  // c is blocked by b, and must say so rather than blaming the calendar.
  assert.match(reason("c"), /prerequisite/i);
});
