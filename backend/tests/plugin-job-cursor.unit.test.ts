import { test } from "node:test";
import assert from "node:assert/strict";
import { pluginJobCursor } from "../src/modules/plugin/job-cursor.js";
import type { Principal } from "../src/capabilities/policy.js";

const principal = (): Principal => ({
  via: "plugin",
  user: { id: "owner", name: "Owner", role: "member" },
  grant_id: "grant",
  client: { id: "client", name: "Client" },
  access: "write",
  personal: true,
  team_ids: ["a", "b"],
  teams: [
    { id: "a", name: "A", role: "member", agent_access: "role" },
    { id: "b", name: "B", role: "viewer", agent_access: "read" },
  ],
  toolsets: ["core", "study"],
  flags: {
    readonly: false,
    notify_teammates: false,
    hide_outside_content: false,
  },
  trust: { level: "full", spaces: {}, acts_alone: [] },
});
const binding = {
  resource: "https://mcp.orbyn.test/plugin",
  jobId: "00000000-0000-4000-8000-000000000001",
  sourceRevision: "sources-1",
};
const key = Buffer.alloc(32, 7);
const time = 100_000;
const codec = (p = principal(), b = binding, at = time, secret = key) =>
  pluginJobCursor(p, b, secret, () => at);

test("plugin job reconnect cursor round trips an exact event position without names or credentials", () => {
  const cursor = codec().seal(7, time + 60_000);
  assert.equal(codec().open(cursor), 7);
  assert.equal(codec().open(codec().seal(0, time + 60_000)), 0);
  assert.doesNotMatch(cursor, /owner|grant|client|sources-1/);
});

test("plugin job cursors refuse another owner, grant, client, resource, job or source revision", () => {
  const cursor = codec().seal(7, time + 60_000);
  for (const changed of [
    { ...principal(), user: { ...principal().user, id: "other" } },
    { ...principal(), grant_id: "other" },
    { ...principal(), client: { id: "other", name: "Other" } },
  ])
    assert.throws(() => codec(changed).open(cursor), /unavailable/);
  for (const changed of [
    { ...binding, resource: "https://mcp.orbyn.test/mcp" },
    { ...binding, jobId: "00000000-0000-4000-8000-000000000002" },
    { ...binding, sourceRevision: "sources-2" },
  ])
    assert.throws(
      () => codec(principal(), changed).open(cursor),
      /unavailable/,
    );
  assert.throws(
    () => codec(principal(), binding, time, Buffer.alloc(32, 8)).open(cursor),
    /unavailable/,
  );
});

test("effective permission changes invalidate plugin reconnect positions", () => {
  const cursor = codec().seal(7, time + 60_000);
  const changes: Principal[] = [
    { ...principal(), access: "read" },
    { ...principal(), personal: false },
    { ...principal(), team_ids: ["a"] },
    { ...principal(), teams: principal().teams.slice(0, 1) },
    {
      ...principal(),
      teams: principal().teams.map((t) => ({ ...t, agent_access: "off" })),
    },
    { ...principal(), toolsets: ["core"] },
    { ...principal(), flags: { ...principal().flags, readonly: true } },
    { ...principal(), trust: { ...principal().trust, level: "suggest" } },
  ];
  for (const changed of changes)
    assert.throws(() => codec(changed).open(cursor), /unavailable/);
});

test("team ordering and display renames preserve equivalent reconnect authority", () => {
  const cursor = codec().seal(7, time + 60_000);
  const same = principal();
  same.user.name = "Renamed";
  same.client.name = "Renamed";
  same.team_ids!.reverse();
  same.teams.reverse().forEach((team) => {
    team.name = "Renamed";
  });
  same.toolsets.reverse();
  assert.equal(codec(same).open(cursor), 7);
});

test("plugin reconnect cursors enforce expiry, safe event sequences and structural bounds", () => {
  const cursor = codec().seal(7, time + 60_000);
  assert.throws(
    () => codec(principal(), binding, time + 60_000).open(cursor),
    /unavailable/,
  );
  for (const sequence of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => codec().seal(sequence, time + 60_000), /unavailable/);
  for (const expiry of [time, time - 1, time + 3_600_001, Infinity])
    assert.throws(() => codec().seal(7, expiry), /unavailable/);
  for (const malformed of [
    "",
    "x".repeat(513),
    cursor + ".extra",
    cursor.replace("pj1", "pj2"),
    cursor.slice(0, -1) + (cursor.endsWith("A") ? "B" : "A"),
  ])
    assert.throws(() => codec().open(malformed), /unavailable/);
});

test("only resolved plugin identities and valid server bindings can construct job cursors", () => {
  for (const changed of [
    { ...principal(), via: "session" as const },
    { ...principal(), grant_id: null },
    { ...principal(), client: { id: null, name: "None" } },
  ])
    assert.throws(() => codec(changed), /unavailable/);
  for (const changed of [
    { ...binding, jobId: "not-a-job" },
    { ...binding, sourceRevision: "" },
    { ...binding, resource: "https://user:pass@mcp.orbyn.test/plugin" },
    { ...binding, resource: "file:///plugin" },
  ])
    assert.throws(() => codec(principal(), changed), /unavailable/);
  assert.throws(
    () => codec(principal(), binding, time, Buffer.alloc(16)),
    /unavailable/,
  );
});
