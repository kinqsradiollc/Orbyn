import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWeekScene,
  movedPartTimes,
  type CalendarEntry,
  type TimeBlock,
} from "@orbyn/core";

const prefs = {
  timezone: "UTC",
  work_days: [1, 2, 3, 4, 5],
  work_start: "09:00",
  work_end: "17:00",
};
const now = new Date("2026-11-02T10:40:00Z");
const week_start = "2026-11-02";

const block = (id: string, start: string, end: string, extra = {}) =>
  ({
    id,
    item_id: `item-${id}`,
    user_id: "u",
    start_at: start,
    end_at: end,
    source: "manual",
    plan_id: null,
    title: id,
    status: "todo",
    kind: "task",
    priority: "medium",
    team_id: null,
    list_id: null,
    estimate_minutes: null,
    ...extra,
  }) as TimeBlock;

const event = (id: string, start: string, end: string | null, extra = {}) =>
  ({
    item_id: id,
    title: id,
    kind: "event",
    status: "todo",
    priority: "medium",
    start_at: start,
    end_at: end,
    team_id: null,
    team_name: null,
    list_id: null,
    location: "",
    meeting_url: "",
    occurrence: null,
    rrule: null,
    version: 1,
    ...extra,
  }) as CalendarEntry;

const scene = (blocks: TimeBlock[], entries: CalendarEntry[] = []) =>
  buildWeekScene({
    week_start,
    prefs,
    now,
    view: { blocks, entries, frames: [], external: [], habit_blocks: [] },
  });

test("free time counts working hours and over needs 15 minutes", () => {
  const near = scene(
    [],
    [event("all", "2026-11-03T09:00:00Z", "2026-11-03T17:10:00Z")],
  );
  assert.equal(near.days[1].free_minutes, 0);
  assert.equal(near.days[1].over_minutes, 10);
  assert.equal(near.days[1].over, false);
  const over = scene(
    [],
    [event("all", "2026-11-03T08:00:00Z", "2026-11-03T18:00:00Z")],
  );
  assert.equal(over.days[1].over_minutes, 120);
  assert.deepEqual(over.issues, [{ kind: "over", day: 1, minutes: 120 }]);
});

test("days off are never over, and overlapping time counts once", () => {
  const s = scene(
    [],
    [
      event("sat", "2026-11-07T09:00:00Z", "2026-11-07T20:00:00Z"),
      event("a", "2026-11-02T09:00:00Z", "2026-11-02T11:00:00Z"),
      event("b", "2026-11-02T10:00:00Z", "2026-11-02T12:00:00Z"),
    ],
  );
  assert.equal(s.days[5].off, true);
  assert.equal(s.days[5].over, false);
  assert.equal(s.days[0].booked_minutes, 180);
  assert.equal(s.days[0].free_minutes, 300);
});

test("free events do not take up time", () => {
  const s = scene(
    [],
    [
      event("free", "2026-11-02T09:00:00Z", "2026-11-02T17:00:00Z", {
        busy: false,
      }),
    ],
  );
  assert.equal(s.days[0].free_minutes, 480);
});

test("a session after a coming deadline is late, and catch-up time is not", () => {
  const late = block("late", "2026-11-03T13:00:00Z", "2026-11-03T14:00:00Z", {
    deadline_at: "2026-11-03T12:00:00Z",
  });
  const fits = block("fits", "2026-11-03T10:00:00Z", "2026-11-03T11:00:00Z", {
    deadline_at: "2026-11-03T12:00:00Z",
  });
  const catchUp = block(
    "catch",
    "2026-11-03T15:00:00Z",
    "2026-11-03T16:00:00Z",
    {
      deadline_at: "2026-10-30T12:00:00Z",
    },
  );
  const s = scene([late, fits, catchUp]);
  const issues = s.issues.filter((i) => i.kind === "late");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind === "late" && issues[0].title, "late");
  assert.deepEqual(
    s.deadlines.map((d) => [d.title, d.minutes]),
    [
      ["late", 720],
      ["fits", 720],
    ],
  );
});

test("finished sessions are not late and cannot be moved", () => {
  const done = block("done", "2026-11-03T13:00:00Z", "2026-11-03T14:00:00Z", {
    deadline_at: "2026-11-03T12:00:00Z",
    status: "done",
  });
  const [part] = scene([done]).parts;
  assert.equal(part.late, false);
  assert.equal(part.movable, false);
});

test("overlaps stack and report a clash only when you can act on it", () => {
  const s = scene(
    [block("session", "2026-11-05T11:30:00Z", "2026-11-05T12:30:00Z")],
    [
      event("meeting", "2026-11-05T11:00:00Z", "2026-11-05T12:00:00Z"),
      event("x", "2026-11-04T09:00:00Z", "2026-11-04T10:00:00Z"),
      event("y", "2026-11-04T09:30:00Z", "2026-11-04T10:30:00Z"),
    ],
  );
  assert.equal(s.parts.find((p) => p.title === "session")?.level, 1);
  assert.equal(s.parts.find((p) => p.title === "y")?.level, 1);
  const clashes = s.issues.filter((i) => i.kind === "clash");
  assert.equal(clashes.length, 1);
});

test("a session across midnight splits and cannot be dragged", () => {
  const s = scene([
    block("night", "2026-11-03T23:00:00Z", "2026-11-04T01:00:00Z"),
  ]);
  assert.deepEqual(
    s.parts.map((p) => [p.day, p.start_minutes, p.end_minutes, p.movable]),
    [
      [1, 1380, 1440, false],
      [2, 0, 60, false],
    ],
  );
  assert.equal(new Set(s.parts.map((p) => p.id)).size, 2);
});

test("all-day events leave the time axis and due points are not spans", () => {
  const s = scene(
    [],
    [
      event("Holiday", "2026-11-04T00:00:00Z", "2026-11-05T00:00:00Z", {
        all_day: true,
      }),
      event("due", "2026-11-04T06:00:00Z", null, { kind: "task" }),
    ],
  );
  assert.deepEqual(s.days[2].all_day, ["Holiday"]);
  assert.equal(s.parts.length, 0);
});

test("the floor widens to fit early work and proposals stay unsaved", () => {
  const s = buildWeekScene({
    week_start,
    prefs,
    now,
    view: {
      blocks: [block("early", "2026-11-02T03:00:00Z", "2026-11-02T03:45:00Z")],
      entries: [],
    },
    proposals: [
      {
        item_id: "p",
        title: "planned",
        start_at: "2026-11-04T14:00:00Z",
        end_at: "2026-11-04T15:00:00Z",
        frame_id: null,
        frame_name: null,
        part: 1,
        parts: 1,
        score: 1,
      },
    ],
  });
  assert.equal(s.start_minutes, 120);
  assert.equal(s.parts.find((p) => p.source === "proposal")?.day, 2);
  assert.equal(s.days[2].booked_minutes, 0);
});

test("week days follow the viewer's zone across a clock change", () => {
  const s = buildWeekScene({
    week_start: "2026-10-19",
    prefs: { ...prefs, timezone: "Europe/London" },
    now,
    view: {
      blocks: [block("after", "2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z")],
      entries: [],
    },
  });
  assert.equal(s.from, "2026-10-18T23:00:00.000Z");
  assert.equal(s.to, "2026-10-26T00:00:00.000Z");
  assert.equal(s.parts[0].day, 6);
  assert.equal(s.parts[0].start_at, "2026-10-25T09:00:00Z");
  const melbourne = buildWeekScene({
    week_start,
    prefs: { ...prefs, timezone: "Australia/Melbourne" },
    now,
    view: {
      blocks: [block("m", "2026-11-02T22:00:00Z", "2026-11-02T23:00:00Z")],
      entries: [],
    },
  });
  assert.equal(melbourne.parts[0].day, 1);
  assert.equal(melbourne.parts[0].start_minutes, 540);
});

test("moving keeps a session's length", () => {
  const s = scene([block("m", "2026-11-03T13:00:00Z", "2026-11-03T14:30:00Z")]);
  assert.deepEqual(movedPartTimes(s, s.parts[0], 4, 600), {
    start_at: "2026-11-06T10:00:00.000Z",
    end_at: "2026-11-06T11:30:00.000Z",
  });
});
