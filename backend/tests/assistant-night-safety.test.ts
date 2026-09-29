import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup.js";
import { destination } from "../src/capabilities/write.js";
import type { Principal } from "../src/capabilities/policy.js";
import type {
  CapabilityContext,
  Effect,
} from "../src/capabilities/registry.js";

const principal: Principal = {
  user: { id: "person", name: "Night tester", role: "member" },
  via: "assistant",
  grant_id: "grant",
  client: { id: null, name: "Orbyn" },
  access: "write",
  team_ids: null,
  personal: true,
  toolsets: [],
  flags: {
    readonly: false,
    hide_outside_content: false,
    notify_teammates: true,
  },
  trust: {
    level: "full",
    spaces: {},
    acts_alone: ["people", "publishing", "teammates", "bulk"],
  },
  teams: [],
};
const context = (unattended: boolean) =>
  ({
    principal: { ...principal, unattended },
    asking: { mode: "approved", reviewed: true, reasons: [] },
  }) as unknown as CapabilityContext;

for (const effect of [
  "email_outside",
  "notify_member",
  "publish",
] as Effect[]) {
  test(`night guard holds a dynamically discovered ${effect} despite full trust and permissions`, () => {
    assert.equal(destination(context(true), null, "W1", [effect]), "review");
    assert.equal(destination(context(false), null, "W1", [effect]), "direct");
  });
}

test("night guard holds deletion and removal while ordinary private additions stay direct", () => {
  assert.equal(destination(context(true), null, "W3"), "review");
  assert.equal(destination(context(false), null, "W3"), "direct");
  assert.equal(destination(context(true), null, "W1"), "direct");
});

test("night checker distinguishes moving sessions from removing them", async () => {
  const { nightPlanNeedsReview } =
    await import("../src/modules/ai/agent/checker.js");
  const step = {
    id: "s1",
    tool: "reschedule_sessions" as const,
    args: {
      changes: [
        {
          session: "session",
          action: "move",
          start_at: "2099-01-05T09:00:00Z",
          end_at: "2099-01-05T10:00:00Z",
        },
      ],
    },
  };
  assert.equal(nightPlanNeedsReview([step]), false);
  assert.equal(
    nightPlanNeedsReview([
      {
        ...step,
        args: { changes: [{ session: "session", action: "remove" }] },
      },
    ]),
    true,
  );
});
