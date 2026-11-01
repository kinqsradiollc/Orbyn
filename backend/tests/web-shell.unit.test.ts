// Pure command dispatch and shortcut assignment contracts; no browser or API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveKeys, keysId } from "@orbyn/core";
import { runCommand } from "../../web/src/app/controls/commands";
import {
  SHORTCUT_CATALOG,
  assignShortcut,
  shortcutConflicts,
} from "../../web/src/app/controls/shortcuts";
import { sidebarComposition, owns, ownsAny } from "../../web/src/app/nav";

test("reset sidebar has five primary groups and role-filtered utilities", () => {
  const member = sidebarComposition({ order: [], hidden: [] }, false);
  assert.equal(member.kind, "default");
  if (member.kind !== "default") return;
  assert.deepEqual(
    member.primary.map((entry) => entry.label),
    ["Today", "Work", "Calendar", "Library", "Agents"],
  );
  assert.deepEqual(
    member.primary
      .find((entry) => entry.label === "Work")!
      .children!.map((entry) => entry.label),
    ["Projects", "Views", "Lists"],
  );
  assert.equal(
    member.more.some((entry) => entry.adminOnly),
    false,
  );
  const admin = sidebarComposition({ order: [], hidden: [] }, true);
  assert.ok(
    admin.kind === "default" &&
      admin.more.some((entry) => entry.label === "Admin"),
  );
});

test("partial custom sidebar order moves groups while preserving unmentioned slots", () => {
  const arrangement = {
    order: ["Starred", "My tasks", "Pinned views", "Overview"],
    hidden: [],
  };
  const original = structuredClone(arrangement);
  const result = sidebarComposition(arrangement, false);
  assert.equal(result.kind, "custom");
  if (result.kind !== "custom") return;
  assert.deepEqual(
    result.slots
      .filter((entry) => arrangement.order.includes(entry.key))
      .map((entry) => entry.key),
    arrangement.order,
  );
  assert.equal(result.slots[2].key, "Projects");
  assert.deepEqual(arrangement, original);
});

test("hidden-only custom choices preserve the always-shown home and unknown saved keys", () => {
  const arrangement = {
    order: ["unknown-legacy-key"],
    hidden: ["Starred", "Pinned views", "Overview", "Study"],
  };
  const original = structuredClone(arrangement);
  const result = sidebarComposition(arrangement, false);
  assert.equal(result.kind, "custom");
  if (result.kind !== "custom") return;
  assert.ok(result.slots.some((entry) => entry.key === "Overview"));
  assert.equal(
    result.slots.some((entry) =>
      ["Starred", "Pinned views", "Study", "Admin"].includes(entry.key),
    ),
    false,
  );
  assert.deepEqual(arrangement, original);
});

test("child object routes expose their branch without marking its parent link current", () => {
  const result = sidebarComposition({ order: [], hidden: [] }, false);
  assert.equal(result.kind, "default");
  if (result.kind !== "default") return;
  const work = result.primary.find((entry) => entry.label === "Work")!;
  assert.equal(owns(work, "/app/project/fixture"), false);
  assert.equal(ownsAny(work, "/app/project/fixture"), true);
  assert.equal(
    work.children!.filter((entry) => owns(entry, "/app/project/fixture"))
      .length,
    1,
  );
});

test("shortcut assignment sees unavailable page commands and displaces the confirmed binding", () => {
  const read = SHORTCUT_CATALOG.find((command) => command.id === "page.read")!;
  assert.ok(read.keys?.length);
  assert.ok(
    shortcutConflicts({}, "app.search", read.keys!).some(
      (command) => command.id === read.id,
    ),
  );
  const next = assignShortcut({}, "app.search", read.keys!);
  assert.deepEqual(next[read.id], []);
  assert.deepEqual(next["app.search"], read.keys);
});

test("resetting a shortcut detects and displaces a conflicting custom assignment", () => {
  const search = SHORTCUT_CATALOG.find(
    (command) => command.id === "app.search",
  )!;
  const original = {
    "app.search": ["Mod", "J"],
    "page.read": [...search.keys!],
  };
  const snapshot = structuredClone(original);
  assert.ok(
    shortcutConflicts(original, search.id, search.keys!).some(
      (command) => command.id === "page.read",
    ),
  );
  const next = assignShortcut(original, search.id, null);
  assert.deepEqual(original, snapshot);
  assert.equal(next[search.id], undefined);
  assert.deepEqual(next["page.read"], []);
  assert.equal(keysId(effectiveKeys(search, next)), keysId(search.keys!));
});

test("explicit assignment removes every duplicate and disable retains other bindings", () => {
  const overrides = {
    "page.read": ["Mod", "J"],
    "app.shortcuts": ["Mod", "J"],
  };
  const next = assignShortcut(overrides, "app.search", ["Mod", "J"]);
  assert.deepEqual(next["page.read"], []);
  assert.deepEqual(next["app.shortcuts"], []);
  const disabled = assignShortcut(overrides, "app.search", []);
  assert.deepEqual(disabled["app.search"], []);
  assert.deepEqual(disabled["page.read"], overrides["page.read"]);
});

test("unknown command assignment preserves the original preference object", () => {
  const original = { "app.search": ["Mod", "J"] };
  assert.equal(assignShortcut(original, "unknown-command", null), original);
});

for (const [name, action, expected] of [
  [
    "synchronous refusal",
    () => ({ kind: "refused", reason: "sync refusal" }),
    ["sync refusal"],
  ],
  [
    "asynchronous refusal",
    async () => ({ kind: "refused", reason: "async refusal" }),
    ["async refusal"],
  ],
  [
    "synchronous exception",
    () => {
      throw new Error("sync exception");
    },
    ["sync exception"],
  ],
  [
    "rejected promise",
    async () => {
      throw new Error("async exception");
    },
    ["async exception"],
  ],
  ["synchronous success", () => ({ kind: "committed", activation: 1 }), []],
  [
    "asynchronous success",
    async () => ({ kind: "committed", activation: 1 }),
    [],
  ],
] as const) {
  test(`command feedback: ${name}`, async () => {
    const reports: string[] = [];
    runCommand(action, (message) => reports.push(message));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(reports, [...expected]);
  });
}
