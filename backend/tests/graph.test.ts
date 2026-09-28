import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEAD_MAX_STEPS,
  SPECIALIST_MAX_RUNS,
  MAX_STAGNANT_DELEGATE_ROUNDS,
} from "../src/modules/ai/agent/lead.js";

test("assistant orchestration keeps lead and specialist work bounded", () => {
  assert.equal(LEAD_MAX_STEPS, 8);
  assert.equal(SPECIALIST_MAX_RUNS, 12);
  assert.equal(MAX_STAGNANT_DELEGATE_ROUNDS, 2);
});
