import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AssistantActionRule } from "@orbyn/core";
import { policy, type Principal } from "../src/capabilities/policy.js";

const ownerId = randomUUID();
const teamId = randomUUID();
const rule = (
  decision: AssistantActionRule["decision"],
  scope: AssistantActionRule["scope"],
): AssistantActionRule => ({
  id: randomUUID(),
  lane: "background",
  action: "read",
  scope,
  decision,
});

function principal(rules: AssistantActionRule[]): Principal {
  return {
    user: { id: ownerId, name: "Owner", role: "member" },
    via: "assistant",
    grant_id: randomUUID(),
    client: { id: null, name: "Orbyn" },
    assistant_lane: "background",
    assistant_rules: rules,
    access: "write",
    team_ids: [teamId],
    personal: true,
    toolsets: ["core"],
    flags: {
      notify_teammates: false,
      hide_outside_content: false,
      readonly: false,
    },
    trust: { level: "ask", spaces: {}, acts_alone: [] },
    teams: [{ id: teamId, name: "Team", role: "member", agent_access: "role" }],
  };
}

test("assistant read restrictions remove only the named space from reads and writes", () => {
  const p = principal([rule("deny", { kind: "team", id: teamId })]);
  assert.deepEqual(policy.spaces(p), {
    userId: ownerId,
    teamIds: [],
    personal: true,
  });
  assert.equal(policy.levelIn(p, teamId), null);
  assert.equal(policy.can(p, "read", { team_id: teamId }).ok, false);
  assert.equal(policy.can(p, "write", { team_id: teamId }).ok, false);
  assert.equal(policy.can(p, "read", { team_id: null }).ok, true);
});

test("ask on unattended reads is held; allow cannot override deny", () => {
  const p = principal([
    rule("allow", { kind: "all" }),
    rule("ask", { kind: "personal" }),
  ]);
  assert.equal(policy.spaces(p).personal, false);
  assert.deepEqual(policy.spaces(p).teamIds, [teamId]);
  p.assistant_rules?.push(rule("deny", { kind: "team", id: teamId }));
  assert.deepEqual(policy.spaces(p).teamIds, []);
  p.assistant_lane = "overnight";
  assert.equal(policy.spaces(p).personal, true);
  assert.deepEqual(policy.spaces(p).teamIds, [teamId]);
});

test("assistant restrictions never narrow the owner's own session", () => {
  const p = principal([rule("deny", { kind: "all" })]);
  p.via = "session";
  assert.equal(policy.spaces(p).personal, true);
  assert.deepEqual(policy.spaces(p).teamIds, [teamId]);
});
