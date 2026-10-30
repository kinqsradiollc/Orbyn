import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeWorkLimitMs,
  activeWorkRemainingMs,
} from "../src/modules/ai/agent/active-work-limit.js";
import { routineRunLimits, routineSetupInput } from "@orbyn/core";
test("configured automatic active duration cannot enlarge the global runtime cap", () => {
  assert.equal(activeWorkLimitMs(600000, 60000), 60000);
  assert.equal(activeWorkLimitMs(600000, 900000), 600000);
  for (const value of [undefined, null, NaN, Infinity, -1, 0, 1.5, "60000"])
    assert.equal(activeWorkLimitMs(600000, value), 600000);
});
test("legacy setup has no injected run-limit field and explicit limits require finite bounded integers", () => {
  const body = {
    request_id: "00000000-0000-4000-8000-000000000001",
    routine: {
      instruction: "Read source notes",
      rrule: "FREQ=DAILY",
      timezone: "UTC",
      next_run_at: "2026-12-01T09:00:00.000Z",
    },
    expected_snapshot: "a".repeat(64),
  };
  assert.equal(
    Object.hasOwn(routineSetupInput.parse(body), "run_limits"),
    false,
  );
  assert.deepEqual(routineRunLimits.parse({}), {
    token_limit: 200000,
    active_work_minutes: 10,
  });
  for (const limits of [
    { token_limit: 200001, active_work_minutes: 1 },
    { token_limit: 1, active_work_minutes: 11 },
    { token_limit: 1.5, active_work_minutes: 1 },
    { token_limit: NaN, active_work_minutes: 1 },
  ])
    assert.equal(routineRunLimits.safeParse(limits).success, false);
});

test("resumes and reviewed-plan repair re-entry retain only the original remaining active allowance", () => {
  assert.equal(
    activeWorkRemainingMs(600000, 60000, 45000, undefined, 1000000),
    15000,
    "Parked time is excluded",
  );
  assert.equal(
    activeWorkRemainingMs(600000, 60000, 45000, 1000000, 1005000),
    10000,
    "A resumed active segment consumes the same allowance",
  );
  assert.equal(
    activeWorkRemainingMs(600000, 60000, 60000, 2000000, 2000000),
    0,
    "A checker repair cannot obtain a fresh reviewed-plan model allowance",
  );
  assert.equal(
    activeWorkRemainingMs(600000, 60000, 59000, 2000000, 2001500),
    -500,
    "Exhaustion remains visible, rather than resetting the budget",
  );
});
