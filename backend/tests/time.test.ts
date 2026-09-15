import { test } from "node:test";
import assert from "node:assert/strict";
// Pure unit tests: time zones, repeating items, priority, and the planner's
// placement engine. No database or network.
const {
  describeRrule,
  nextOccurrence,
  occurrencesBetween,
  parseRrule,
  priorityScore,
  zonedInstant,
  formatRrule,
} = await import("@orbyn/core");
const { schedule, sessions } =
  await import("../src/modules/planner/scheduler.js");
const { wantsPlan, mayChange } = await import("../src/modules/ai/guards.js");

const TZ = "Australia/Melbourne";
const iso = (d: Date) => d.toISOString();

test("wall-clock times survive daylight-saving changes", () => {
  // Melbourne moves from +10 to +11 at 2:00 on 4 October 2026.
  assert.equal(
    iso(zonedInstant(2026, 10, 3, 9, 0, TZ)),
    "2026-10-02T23:00:00.000Z",
  );
  assert.equal(
    iso(zonedInstant(2026, 10, 5, 9, 0, TZ)),
    "2026-10-04T22:00:00.000Z",
  );
  // 2:30 doesn't exist that night; it moves forward to 3:30 (+11).
  assert.equal(
    iso(zonedInstant(2026, 10, 4, 2, 30, TZ)),
    "2026-10-03T16:30:00.000Z",
  );
});

test("weekly rules keep their weekdays and time across daylight saving", () => {
  const start = zonedInstant(2026, 9, 28, 9, 0, TZ); // Monday
  const got = occurrencesBetween(
    start,
    "FREQ=WEEKLY;BYDAY=MO,WE",
    TZ,
    new Date("2026-09-27T00:00:00Z"),
    new Date("2026-10-09T00:00:00Z"),
  ).map(iso);
  assert.deepEqual(got, [
    "2026-09-27T23:00:00.000Z", // Mon 28 Sep, 09:00 +10
    "2026-09-29T23:00:00.000Z", // Wed 30 Sep
    "2026-10-04T22:00:00.000Z", // Mon 5 Oct, 09:00 +11
    "2026-10-06T22:00:00.000Z", // Wed 7 Oct
  ]);
});

test("monthly rules skip months without the day, and counts and ends hold", () => {
  const start = zonedInstant(2026, 1, 31, 8, 0, "UTC");
  const monthly = occurrencesBetween(
    start,
    "FREQ=MONTHLY",
    "UTC",
    start,
    new Date("2026-06-01T00:00:00Z"),
  ).map((d) => iso(d).slice(0, 10));
  assert.deepEqual(monthly, ["2026-01-31", "2026-03-31", "2026-05-31"]);
  const counted = occurrencesBetween(
    start,
    "FREQ=DAILY;COUNT=3",
    "UTC",
    start,
    new Date("2027-01-01T00:00:00Z"),
  );
  assert.equal(counted.length, 3);
  const until = occurrencesBetween(
    start,
    "FREQ=DAILY;UNTIL=20260202",
    "UTC",
    start,
    new Date("2027-01-01T00:00:00Z"),
  );
  assert.equal(until.length, 3);
  // Removed occurrences are skipped.
  const skipped = occurrencesBetween(
    start,
    "FREQ=DAILY;COUNT=3",
    "UTC",
    start,
    new Date("2027-01-01T00:00:00Z"),
    [new Date("2026-02-01T08:00:00Z")],
  );
  assert.equal(skipped.length, 2);
  // The next occurrence strictly after a time, and none once the series ends.
  assert.equal(
    iso(
      nextOccurrence(
        start,
        "FREQ=DAILY;COUNT=3",
        "UTC",
        new Date("2026-02-01T08:00:00Z"),
      )!,
    ),
    "2026-02-02T08:00:00.000Z",
  );
  assert.equal(
    nextOccurrence(
      start,
      "FREQ=DAILY;COUNT=3",
      "UTC",
      new Date("2026-02-02T08:00:00Z"),
    ),
    null,
  );
});

test("only the supported repeat rules are accepted, and they read well", () => {
  assert.equal(parseRrule("FREQ=HOURLY"), null);
  assert.equal(parseRrule("FREQ=DAILY;COUNT=2;UNTIL=20260101"), null);
  assert.equal(parseRrule("FREQ=DAILY;BYDAY=MO"), null);
  assert.equal(parseRrule("INTERVAL=2"), null);
  assert.ok(parseRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10"));
  assert.equal(
    describeRrule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"),
    "Every weekday",
  );
  assert.equal(
    describeRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10"),
    "Every 2 weeks on Mon, Wed · 10 times",
  );
  assert.equal(describeRrule("FREQ=DAILY"), "Every day");
  assert.equal(
    formatRrule({
      freq: "WEEKLY",
      interval: 1,
      byDay: [1, 3],
      count: null,
      until: "2026-12-31",
    }),
    "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231",
  );
});

test("priority weighs importance, urgency and lateness", () => {
  const now = new Date("2026-09-15T00:00:00Z");
  const due = (hours: number) =>
    new Date(now.getTime() + hours * 3_600_000).toISOString();
  const high = priorityScore(
    { priority: "high", status: "todo", due_at: null },
    now,
  );
  const lowSoon = priorityScore(
    { priority: "low", status: "todo", due_at: due(2) },
    now,
  );
  const lowLate = priorityScore(
    { priority: "low", status: "todo", due_at: due(-5) },
    now,
  );
  const blocked = priorityScore(
    { priority: "high", status: "blocked", due_at: null },
    now,
  );
  assert.equal(high, 9);
  assert.ok(lowLate > lowSoon);
  assert.ok(blocked < high);
});

const frame = (overrides: Record<string, unknown> = {}) => ({
  id: "f1",
  name: "Deep work",
  days: [0, 1, 2, 3, 4, 5, 6],
  start_time: "09:00",
  end_time: "12:00",
  filters: {
    priorities: [],
    list_ids: [],
    tag_ids: [],
    team_ids: [],
    min_minutes: null,
    max_minutes: null,
  },
  color: "#9ab68c",
  position: 0,
  ...overrides,
});
const task = (overrides: Record<string, unknown> = {}) => ({
  id: "t1",
  title: "Write report",
  priority: "medium" as const,
  status: "todo" as const,
  due_at: null,
  estimate_minutes: 60,
  spent_minutes: 0,
  scheduled_minutes: 0,
  list_id: null,
  tag_ids: [],
  team_id: null,
  ...overrides,
});
const base = {
  busy: [],
  frames: [],
  useFrames: true,
  days: ["2026-09-16"],
  timezone: "UTC",
  workDays: [0, 1, 2, 3, 4, 5, 6],
  workStart: "09:00",
  workEnd: "17:00",
  padPercent: 0,
  split: true,
  splitAfterMinutes: 60,
  minBlockMinutes: 25,
  breakLevel: "none" as const,
  now: new Date("2026-09-15T00:00:00Z"),
};

test("long tasks split into sessions around busy time", () => {
  assert.deepEqual(sessions(150, true, 60, 25), [60, 60, 30]);
  assert.deepEqual(sessions(130, true, 60, 25), [60, 70]);
  assert.deepEqual(sessions(150, false, 60, 25), [150]);
  const result = schedule({
    ...base,
    tasks: [task({ estimate_minutes: 120 })],
    busy: [
      {
        start_at: "2026-09-16T09:00:00.000Z",
        end_at: "2026-09-16T10:00:00.000Z",
      },
    ],
  });
  assert.deepEqual(
    result.blocks.map((b) => [
      b.start_at.slice(11, 16),
      b.end_at.slice(11, 16),
      b.part,
    ]),
    [
      ["10:00", "11:00", 1],
      ["11:00", "12:00", 2],
    ],
  );
  assert.equal(result.capacity_minutes, 420);
  assert.equal(result.planned_minutes, 120);
});

test("estimates are padded, higher scores go first, and breaks follow long sessions", () => {
  const result = schedule({
    ...base,
    padPercent: 20,
    breakLevel: "normal",
    tasks: [
      task({ id: "low", title: "Low", priority: "low", estimate_minutes: 50 }),
      task({
        id: "high",
        title: "High",
        priority: "high",
        estimate_minutes: 50,
      }),
    ],
  });
  // 50 minutes padded by 20% is 60; the high task goes first, then a 10-minute break.
  assert.deepEqual(
    result.blocks.map((b) => [
      b.item_id,
      b.start_at.slice(11, 16),
      b.end_at.slice(11, 16),
    ]),
    [
      ["high", "09:00", "10:00"],
      ["low", "10:10", "11:10"],
    ],
  );
});

test("frames take only the tasks their filters allow", () => {
  const result = schedule({
    ...base,
    frames: [
      frame({
        filters: {
          priorities: ["high"],
          list_ids: [],
          tag_ids: [],
          team_ids: [],
          min_minutes: null,
          max_minutes: null,
        },
      }),
    ],
    tasks: [
      task({ id: "low", priority: "low" }),
      task({ id: "high", priority: "high" }),
    ],
  });
  assert.deepEqual(
    result.blocks.map((b) => b.item_id),
    ["high"],
  );
  assert.equal(result.blocks[0].frame_name, "Deep work");
  assert.equal(result.unplaced[0].item_id, "low");
  assert.match(result.unplaced[0].reason, /No frame takes this task/);
});

test("tasks that can't fit before they're due are flagged", () => {
  const result = schedule({
    ...base,
    tasks: [
      task({
        estimate_minutes: 600,
        due_at: "2026-09-16T12:00:00.000Z",
        title: "Big",
      }),
      task({ id: "blocked", status: "blocked" }),
    ],
  });
  assert.equal(result.at_risk[0].title, "Big");
  assert.match(
    result.unplaced.find((u) => u.item_id === "blocked")!.reason,
    /Blocked/,
  );
});

test("planning requests are told apart from change requests", () => {
  for (const m of [
    "Plan my day",
    "plan tomorrow",
    "Can you organise my week?",
    "What should I work on?",
    "Block out my afternoon",
  ])
    assert.equal(wantsPlan(m), true, m);
  for (const m of [
    "Schedule my dentist appointment for Friday",
    "Schedule tomorrow's standup at 9",
    "What's due Friday?",
  ])
    assert.equal(wantsPlan(m), false, m);
  assert.equal(mayChange("Schedule my dentist appointment for Friday"), true);
});
