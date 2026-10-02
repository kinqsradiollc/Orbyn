import { test } from "node:test";
import assert from "node:assert/strict";
import {
  levelIn,
  reachableTeams,
  type Principal,
  type PrincipalTeam,
} from "../src/capabilities/policy.js";
import type { Queryable } from "../src/db/pool.js";
const principal = (teams: PrincipalTeam[], readonly = false): Principal => ({
  user: { id: "fixture", name: "Fixture", role: "admin" },
  via: "plugin",
  grant_id: "fixture",
  client: { id: "fixture", name: "Fixture" },
  access: "write",
  team_ids: null,
  personal: true,
  toolsets: ["core"],
  flags: { notify_teammates: false, hide_outside_content: false, readonly },
  trust: { level: "full", spaces: {}, acts_alone: [] },
  teams,
});

test("plugin identity retains outside-agent policy ceilings even for an administrator", () => {
  for (const [agent_access, expected] of [
    ["off", null],
    ["read", "read"],
    ["suggest", "suggest"],
    ["role", "write"],
  ] as const) {
    assert.equal(
      levelIn(
        principal([{ id: "team", name: "Team", role: "owner", agent_access }]),
        "team",
      ),
      expected,
    );
  }
  assert.equal(
    levelIn(
      principal([
        { id: "team", name: "Team", role: "viewer", agent_access: "role" },
      ]),
      "team",
    ),
    "read",
  );
  assert.equal(levelIn(principal([], true), null), "read");
  assert.equal(levelIn({ ...principal([]), personal: false }, null), null);
});
test("plugin team discovery removes teams that turned outside agents off", async () => {
  const rows: PrincipalTeam[] = [
    { id: "allowed", name: "Allowed", role: "member", agent_access: "read" },
    { id: "blocked", name: "Blocked", role: "owner", agent_access: "off" },
  ];
  const db = { query: async () => ({ rows }) } as unknown as Queryable;
  assert.deepEqual(
    (await reachableTeams(db, "fixture", null, "plugin")).map((row) => row.id),
    ["allowed"],
  );
  assert.equal(
    (await reachableTeams(db, "fixture", null, "session")).length,
    2,
  );
});
