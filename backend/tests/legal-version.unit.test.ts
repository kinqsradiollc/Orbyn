import { test } from "node:test";
import assert from "node:assert/strict";
import { nextLegalVersion, compareLegalVersions } from "@orbyn/core";

test("legal publication advances on the same day, a later day and a clock rollback", () => {
  for (const [previous, today, expected] of [
    ["2026-09-29", "2026-10-01", "2026-10-01"],
    ["2026-10-01", "2026-10-01", "2026-10-01.2"],
    ["2026-10-01.2", "2026-10-01", "2026-10-01.3"],
    ["2026-10-01", "2026-09-30", "2026-10-01.2"],
    ["2026-10-01.9", "2026-09-30", "2026-10-01.10"],
  ]) {
    const actual = nextLegalVersion(previous, today);
    assert.equal(actual, expected);
    assert.ok(compareLegalVersions(actual, previous) > 0);
  }
});
