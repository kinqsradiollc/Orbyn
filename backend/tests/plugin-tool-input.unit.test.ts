import { test } from "node:test";
import assert from "node:assert/strict";
import { pluginToolInput } from "../src/modules/plugin/tool-input.js";

test("plugin tool input retains ordinary JSON arguments without mutation", () => {
  const input = {
    name: "orbyn_query",
    arguments: {
      filter: { types: ["doc", "task"] },
      limit: 10,
      cursor: null,
      active: true,
    },
  };
  const before = structuredClone(input);
  assert.deepEqual(pluginToolInput.parse(input), input);
  assert.deepEqual(input, before);
});
test("plugin tool input rejects extra authority and malformed envelopes", () => {
  for (const input of [
    null,
    {},
    { name: "", arguments: {} },
    { name: "x".repeat(129), arguments: {} },
    { name: "tool", arguments: [] },
    { name: "tool", arguments: {}, user_id: "another-user" },
  ])
    assert.equal(pluginToolInput.safeParse(input).success, false);
});
test("plugin tool input rejects excessive depth without recursive traversal", () => {
  let value: unknown = "end";
  for (let n = 0; n < 17; n++) value = { nested: value };
  assert.equal(
    pluginToolInput.safeParse({ name: "tool", arguments: { value } }).success,
    false,
  );
  assert.equal(
    pluginToolInput.safeParse({
      name: "tool",
      arguments: { values: Array.from({ length: 4096 }, () => 0) },
    }).success,
    false,
  );
});
test("plugin tool input rejects non-JSON values and cycles", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const value of [
    undefined,
    NaN,
    Infinity,
    () => {},
    Symbol("key"),
    new Date(),
    cyclic,
  ])
    assert.equal(
      pluginToolInput.safeParse({ name: "tool", arguments: { value } }).success,
      false,
    );
});
test("plugin tool input accepts bounded nested JSON at the depth boundary", () => {
  let value: unknown = "end";
  for (let n = 0; n < 15; n++) value = { nested: value };
  assert.equal(
    pluginToolInput.safeParse({ name: "tool", arguments: { value } }).success,
    true,
  );
});
