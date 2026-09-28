import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultNightShift } from "@orbyn/core";
import { assistantNightWindow } from "../src/worker/night-window.js";
const settings = {
  ...defaultNightShift(),
  start: "22:00",
  end: "08:00",
  timezone: "Australia/Melbourne",
};
test("night identity and boundaries remain stable across midnight", () => {
  const before = assistantNightWindow(
    new Date("2026-09-29T11:59:59Z"),
    settings,
  );
  assert.equal(before, null);
  const start = assistantNightWindow(
    new Date("2026-09-29T12:00:00Z"),
    settings,
  )!;
  const afterMidnight = assistantNightWindow(
    new Date("2026-09-29T17:00:00Z"),
    settings,
  )!;
  assert.equal(start.localDay, "2026-09-29");
  assert.deepEqual(afterMidnight, start);
  assert.equal(start.end.toISOString(), "2026-09-29T22:00:00.000Z");
  assert.equal(assistantNightWindow(start.end, settings), null);
});
test("DST forward and backward nights have their actual elapsed lengths", () => {
  const forward = assistantNightWindow(
    new Date("2026-10-03T13:00:00Z"),
    settings,
  )!;
  assert.equal(forward.localDay, "2026-10-03");
  assert.equal((forward.end.getTime() - forward.start.getTime()) / 3600000, 9);
  const backward = assistantNightWindow(
    new Date("2027-04-03T12:00:00Z"),
    settings,
  )!;
  assert.equal(backward.localDay, "2027-04-03");
  assert.equal(
    (backward.end.getTime() - backward.start.getTime()) / 3600000,
    11,
  );
  const repeatedA = assistantNightWindow(
    new Date("2027-04-03T15:30:00Z"),
    settings,
  )!;
  const repeatedB = assistantNightWindow(
    new Date("2027-04-03T16:30:00Z"),
    settings,
  )!;
  assert.deepEqual(repeatedA, repeatedB);
});
test("a window on the same day does not include the next morning", () => {
  const sameDay = { ...settings, start: "18:00", end: "23:00" };
  assert.equal(
    assistantNightWindow(new Date("2026-09-29T16:00:00Z"), sameDay),
    null,
  );
  assert.equal(
    assistantNightWindow(new Date("2026-09-29T09:00:00Z"), sameDay)?.localDay,
    "2026-09-29",
  );
});
