import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assistantIdentityForLane } from "@orbyn/core";
test("interactive context never adopts an automation character name or persona", () => {
  const identity = {
    name: "Night researcher",
    persona: "Reflect on completed work",
  };
  assert.deepEqual(assistantIdentityForLane(identity, "interactive"), {
    name: "Orbyn",
    persona: "",
  });
  assert.deepEqual(assistantIdentityForLane(identity, "background"), identity);
  assert.deepEqual(assistantIdentityForLane(identity, "overnight"), identity);
});
test("both chat surfaces keep character configuration and forced naming out of conversations", async () => {
  const files = [
    "../../desktop/src/features/assistant/AssistantView.tsx",
    "../../mobile/src/screens/AssistantScreen.tsx",
  ];
  for (const name of files) {
    const source = await readFile(new URL(name, import.meta.url), "utf8");
    for (const removed of [
      "CharacterEditor",
      "Make me yours",
      "Customize ${agentName}",
      "!identity.named_at",
    ])
      assert.ok(!source.includes(removed), `${name}: ${removed}`);
    assert.ok(source.includes("What would you like to work on?"));
    assert.ok(source.includes('placeholder="Ask Orbyn…"'));
  }
});

test("runtime and profile readers use independently stored automation identities", async () => {
  const runtime = await readFile(
    new URL("../src/modules/ai/agent/run.ts", import.meta.url),
    "utf8",
  );
  assert.ok(runtime.includes("await readAutomationIdentity"));
  assert.ok(
    runtime.includes(
      'request.automation.kind === "night" || request.automation.night_id',
    ),
  );
  assert.ok(runtime.includes('{ name: "Orbyn", persona: "" }'));
  for (const file of [
    "../../desktop/src/features/settings/AgentContext.tsx",
    "../../mobile/src/screens/AgentContext.tsx",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.ok(source.includes("updateAutomationAgentIdentity(lane"));
    assert.ok(source.includes("expected_revision: identity.revision"));
    assert.ok(source.includes("Reload agent profile"));
    assert.ok(!source.includes("updateAgentSettings("));
  }
});
