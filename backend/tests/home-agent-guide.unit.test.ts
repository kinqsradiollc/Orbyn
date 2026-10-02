import { test } from "node:test";
import assert from "node:assert/strict";
import { HOME_AGENT_GUIDE, HOME_AGENT_IDLE_NOTE } from "@orbyn/core";

test("Home explains distinct work triggers, review destinations and pauses", () => {
  assert.deepEqual(
    HOME_AGENT_GUIDE.map((agent) => agent.name),
    ["Background", "Overnight"],
  );
  assert.match(HOME_AGENT_GUIDE[0].timing, /delegate/);
  assert.match(HOME_AGENT_GUIDE[0].result, /agent activity/);
  assert.match(HOME_AGENT_GUIDE[0].pause, /answer or approval/);
  assert.match(HOME_AGENT_GUIDE[1].timing, /night window/);
  assert.match(HOME_AGENT_GUIDE[1].result, /unfinished tasks in Overnight/);
  assert.match(HOME_AGENT_GUIDE[1].pause, /budget/);
  assert.match(HOME_AGENT_IDLE_NOTE, /idle until.*authorized/);
  for (const agent of HOME_AGENT_GUIDE) {
    assert.ok(agent.request.length > 0);
    assert.doesNotMatch(
      JSON.stringify(agent),
      /always.on|cloud computer|reflection/i,
    );
  }
});
