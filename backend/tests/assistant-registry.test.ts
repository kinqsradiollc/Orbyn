import { test } from "node:test";
import assert from "node:assert/strict";

const { registry } = await import("../src/capabilities/index.js");

test("the built-in assistant uses the shared MCP capability catalogue", () => {
  const listed = registry.all.filter((capability) => !capability.legacyOnly);
  const names = registry.all.map((capability) => capability.name);
  assert.equal(listed.length, 64);
  assert.equal(
    listed.filter((capability) => capability.toolset === "core").length,
    32,
  );
  assert.equal(
    new Set(names).size,
    names.length,
    "capability names are unique",
  );
  for (const name of [
    "get_context",
    "get_chats",
    "manage_memory",
    "apply_plan",
    "search",
    "get_calendar",
  ])
    assert.ok(registry.get(name), `${name} is shared with the assistant`);
});
