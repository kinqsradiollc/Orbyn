import { test } from "node:test";
import assert from "node:assert/strict";
import { nightPlanNeedsReview } from "../src/modules/ai/agent/checker.js";
import type { PlanStep } from "../src/capabilities/plan-run.js";

const additions = (count: number): PlanStep[] =>
  Array.from({ length: Math.ceil(count / 25) }, (_, batch) => ({
    id: `s${batch}`,
    tool: "create_tasks",
    args: {
      tasks: Array.from(
        { length: Math.min(25, count - batch * 25) },
        (_, n) => ({
          title: `Task ${batch * 25 + n}`,
          kind: "task",
        }),
      ),
    },
  }));

test("known over-limit night additions select Review before disposable item mutations", () => {
  assert.equal(nightPlanNeedsReview(additions(75)), true);
  assert.equal(nightPlanNeedsReview(additions(51)), true);
  assert.equal(nightPlanNeedsReview(additions(50)), false);
});
