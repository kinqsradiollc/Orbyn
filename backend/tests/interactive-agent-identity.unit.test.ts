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
