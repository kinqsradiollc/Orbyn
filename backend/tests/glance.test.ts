import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGlance, type Item } from "@orbyn/core";

// buildGlance is pure, so it's unit-tested here. The native widget/Watch that
// render its fields are built and verified in Xcode.

const TZ = "Australia/Melbourne";
// A fixed "now": 2026-09-20 10:00 Melbourne.
const NOW = new Date("2026-09-20T00:00:00.000Z"); // 10:00 AEST

const item = (over: Partial<Item>): Item =>
  ({
    id: Math.random().toString(36).slice(2),
    title: "x",
    kind: "task",
    status: "todo",
    due_at: null,
    ...over,
  }) as Item;

test("counts today's open and done tasks and overdue ones", () => {
  const g = buildGlance(
    [
      item({ title: "A", due_at: "2026-09-20T02:00:00.000Z" }), // today, open
      item({ title: "B", due_at: "2026-09-20T05:00:00.000Z", status: "done" }), // today, done
      item({ title: "C", due_at: "2026-09-18T02:00:00.000Z" }), // overdue, open
      item({
        title: "D",
        due_at: "2026-09-15T02:00:00.000Z",
        status: "done",
      }), // past but done → ignored
      item({ title: "E", due_at: "2026-09-25T02:00:00.000Z" }), // future → ignored
      item({ title: "F" }), // no due date → ignored
    ],
    { now: NOW, timeZone: TZ },
  );
  assert.equal(g.todayOpen, 1);
  assert.equal(g.todayDone, 1);
  assert.equal(g.overdue, 1);
  assert.equal(g.updatedAt, NOW.toISOString());
});

test("picks the next upcoming, non-cancelled event", () => {
  const g = buildGlance(
    [
      item({
        kind: "event",
        title: "Earliest",
        due_at: "2026-09-20T00:30:00.000Z",
      }), // 30 min after now
      item({
        kind: "event",
        title: "Soon",
        due_at: "2026-09-20T03:00:00.000Z",
      }),
      item({
        kind: "event",
        title: "Later",
        due_at: "2026-09-20T06:00:00.000Z",
      }),
      item({
        kind: "event",
        title: "Cancelled",
        due_at: "2026-09-20T01:00:00.000Z",
        status: "cancelled",
      }),
    ],
    { now: NOW, timeZone: TZ },
  );
  // NOW is 00:00Z; the earliest active event at/after now is 00:30Z.
  assert.equal(g.nextEvent?.title, "Earliest");
});

test("no upcoming event yields a null nextEvent", () => {
  const g = buildGlance(
    [
      item({
        kind: "event",
        title: "Gone",
        due_at: "2026-09-01T00:00:00.000Z",
      }),
    ],
    { now: NOW, timeZone: TZ },
  );
  assert.equal(g.nextEvent, null);
});
