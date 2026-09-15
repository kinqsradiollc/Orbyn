import assert from "node:assert/strict";
import test from "node:test";
import { freshItem, overviewItems, type Item } from "@orbyn/core";

const now = new Date(2026, 8, 15, 12);
const at = (day: number) => new Date(2026, 8, day, 10).toISOString();
const item = (id: string, patch: Partial<Item> = {}): Item =>
  ({ ...freshItem(), id, title: id, ...patch }) as Item;

test("overview counts overdue work but lists each item only once", () => {
  const result = overviewItems(
    [
      item("overdue", { status: "in_progress", due_at: at(14) }),
      item("blocked", { status: "blocked", due_at: at(15) }),
      item("started", { status: "in_progress", due_at: at(15) }),
      item("today", { due_at: at(15) }),
      item("future", { due_at: at(16) }),
      item("done", { status: "done", due_at: at(14) }),
    ],
    now,
  );
  assert.equal(result.inProgressCount, 2);
  assert.equal(result.blockedCount, 1);
  assert.deepEqual(
    result.attention.map((i) => i.id),
    ["blocked", "overdue"],
  );
  assert.deepEqual(
    result.inProgress.map((i) => i.id),
    ["started"],
  );
  assert.deepEqual(
    result.today.map((i) => i.id),
    ["today"],
  );
  assert.deepEqual(
    result.upcoming.map((i) => i.id),
    ["future"],
  );
});

test("overview uses the latest activity within the current local week", () => {
  const result = overviewItems(
    [
      item("edited", {
        status: "done",
        updated_at: at(14),
        last_update_at: at(12),
      }),
      item("updated", {
        status: "done",
        updated_at: at(12),
        last_update_at: at(14),
      }),
      item("old", { status: "done", updated_at: at(12) }),
      item("future", { status: "done", updated_at: at(16) }),
      item("open", { updated_at: at(14) }),
    ],
    now,
  );
  assert.equal(result.doneThisWeek, 2);
  assert.deepEqual(overviewItems([], now).attention, []);
});
