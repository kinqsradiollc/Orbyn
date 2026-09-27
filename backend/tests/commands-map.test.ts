import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * The command list (H6b), like the route inventory: every command Orbyn's
 * apps offer (⌘K, the shortcut sheet, the phone's Search & do and the
 * Settings commands) maps to a tool an agent can call, with an example of
 * the arguments it takes, or to a written reason agents don't do it. A new
 * command fails here until it is placed in capabilities/commands-map.ts.
 * No database: the registry and the lists are plain code.
 */

const { COMMANDS, SETTING_COMMANDS } = await import("@orbyn/core");
const { COMMAND_TOOLS } = await import("../src/capabilities/commands-map.js");
const { registry } = await import("../src/capabilities/index.js");

const every = [...COMMANDS, ...SETTING_COMMANDS];

test("every command maps to a tool or a written reason", () => {
  const unplaced = every
    .map((c) => c.id)
    .filter((id) => !(id in COMMAND_TOOLS));
  assert.deepEqual(
    unplaced,
    [],
    "Place each command in backend/src/capabilities/commands-map.ts: a tool with example args, or a reason.",
  );
  const known = new Set(every.map((c) => c.id));
  const stale = Object.keys(COMMAND_TOOLS).filter((id) => !known.has(id));
  assert.deepEqual(stale, [], "These aren't commands (any more).");
});

test("each mapped tool exists, is listed, and takes the example's arguments", () => {
  for (const [id, place] of Object.entries(COMMAND_TOOLS)) {
    if ("reason" in place) {
      assert.ok(
        place.reason.trim().length >= 20,
        `${id}: say why agents don't do it`,
      );
      continue;
    }
    const cap = registry.get(place.tool);
    assert.ok(cap, `${id}: no tool ${place.tool}`);
    assert.ok(
      !cap.legacyOnly && !cap.aliasOf,
      `${id}: ${place.tool} is retired`,
    );
    const parsed = cap.input.safeParse(place.args);
    assert.ok(
      parsed.success,
      `${id}: ${place.tool} refuses ${JSON.stringify(place.args)}: ${parsed.success ? "" : parsed.error.issues[0]?.message}`,
    );
  }
});

test("most commands are the agent's to do", () => {
  const places = Object.values(COMMAND_TOOLS);
  const tools = places.filter((p) => "tool" in p).length;
  const reasons = places.length - tools;
  // Reported with the counts, so a drift the other way is seen.
  assert.ok(tools >= 40, `${tools} mapped to tools, ${reasons} with reasons`);
  assert.equal(places.length, every.length);
});
