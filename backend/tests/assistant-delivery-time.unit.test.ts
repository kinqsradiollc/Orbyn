import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAssistantDeliveryTime } from "@orbyn/core";

test("quiet delivery windows resolve real instants across repeated and skipped DST hours", () => {
  assert.equal(
    nextAssistantDeliveryTime(
      new Date("2026-04-04T14:30:00Z"),
      "Australia/Melbourne",
      { quiet_start: "22:00", quiet_end: "03:30" },
    ).toISOString(),
    "2026-04-04T17:30:00.000Z",
  );
  assert.equal(
    nextAssistantDeliveryTime(
      new Date("2026-10-03T15:30:00Z"),
      "Australia/Melbourne",
      { quiet_start: "01:00", quiet_end: "02:30" },
    ).toISOString(),
    "2026-10-03T16:00:00.000Z",
  );
  assert.equal(
    nextAssistantDeliveryTime(
      new Date("2026-04-04T16:10:00Z"),
      "Australia/Melbourne",
      { quiet_start: "01:30", quiet_end: "02:30" },
    ).toISOString(),
    "2026-04-04T16:30:00.000Z",
  );
});
test("ordinary cross-midnight windows defer; equal endpoints disable quiet hours", () => {
  const now = new Date("2026-10-21T23:02:07Z");
  assert.equal(
    nextAssistantDeliveryTime(now, "UTC", {
      quiet_start: "22:00",
      quiet_end: "08:00",
    }).toISOString(),
    "2026-10-22T08:00:00.000Z",
  );
  assert.equal(
    nextAssistantDeliveryTime(now, "UTC", {
      quiet_start: "00:00",
      quiet_end: "00:00",
    }),
    now,
  );
});
