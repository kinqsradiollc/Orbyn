import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { helpers, type Person } from "./mcp-helpers.js";

/**
 * One visibility rule (lib/visibility.ts) and one principal (capabilities/
 * policy.ts). The builders are checked as a permission matrix (owner,
 * admin, member, viewer, someone outside the team, and a system admin who
 * isn't in it) against real rows, with the default scope giving exactly
 * what the app's older copies of the rule give, and the narrower scopes an
 * agent connection uses. policy.can is checked the same way.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { readdir, readFile } = await import("node:fs/promises");
const { join } = await import("node:path");
const v = await import("../src/lib/visibility.js");
const { policy, reachableTeams } =
  await import("../src/capabilities/policy.js");

const app = await buildApp();
const h = helpers(app);

type Role = "owner" | "admin" | "member" | "viewer" | "outsider" | "sysadmin";
const people = {} as Record<Role, Person>;
let teamId = "";
let otherTeam = "";
/** Row ids by table and by whose they are. */
const rows = {
  items: {} as Record<string, string>,
  docs: {} as Record<string, string>,
  projects: {} as Record<string, string>,
  records: {} as Record<string, string>,
};

const make = async (who: Person, url: string, payload: object) => {
  const r = await h.call(who.token, "POST", url, payload);
  assert.ok(r.statusCode < 300, `${url}: ${r.statusCode} ${r.body}`);
  return (r.json() as { id: string }).id;
};

before(async () => {
  await migrate();
  for (const role of [
    "owner",
    "admin",
    "member",
    "viewer",
    "outsider",
    "sysadmin",
  ] as Role[])
    people[role] = await h.register(`vis-${role}`, role);
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [
    people.sysadmin.id,
  ]);
  teamId = await h.team(people.owner, "Visible team", [
    [people.admin, "admin"],
    [people.member, "member"],
    [people.viewer, "viewer"],
  ]);
  otherTeam = await h.team(people.member, "Member's other team");

  // Each table: the owner's personal row, a team row made by the member,
  // and the member's row in another team.
  for (const [key, who, team] of [
    ["personal", people.owner, null],
    ["team", people.member, teamId],
    ["other", people.member, otherTeam],
  ] as const) {
    const team_id = team ?? undefined;
    rows.items[key] = await make(who, "/items", {
      title: `Visible ${key} task`,
      kind: "task",
      ...(team_id ? { team_id } : {}),
    });
    rows.docs[key] = await make(who, "/docs", {
      title: `Visible ${key} page`,
      ...(team_id ? { team_id } : {}),
    });
    rows.projects[key] = await make(who, "/projects", {
      name: `Visible ${key} project`,
      ...(team_id ? { team_id } : {}),
    });
    rows.records[key] = await make(who, "/work-records", {
      kind: "decision",
      title: `Visible ${key} decision`,
      ...(team_id ? { team_id } : {}),
    });
  }
});
after(async () => {
  await app.close();
  await pool.end();
});

const TABLES = {
  items: { table: "items", alias: "i", build: v.visibleItems },
  docs: { table: "docs", alias: "d", build: v.visibleDocs },
  projects: { table: "projects", alias: "p", build: v.visibleProjects },
  records: { table: "work_records", alias: "w", build: v.visibleRecords },
} as const;

/** Which of our fixture rows `userId` sees in `which`, under `scope`. */
async function seen(
  which: keyof typeof TABLES,
  spaces: { userId: string; teamIds: string[] | null; personal: boolean },
): Promise<string[]> {
  const t = TABLES[which];
  const params = new v.Params();
  const scope = v.scopeFor(spaces, params);
  const ids = params.add(Object.values(rows[which]));
  const found = await pool.query<{ id: string }>(
    `SELECT ${t.alias}.id FROM ${t.table} ${t.alias}
      WHERE ${t.alias}.id = ANY (${ids}::uuid[]) AND ${t.build(t.alias, scope)}`,
    params.values,
  );
  const names = Object.fromEntries(
    Object.entries(rows[which]).map(([k, id]) => [id, k]),
  );
  return found.rows.map((r) => names[r.id]).sort();
}

test("permission matrix: each role sees its own and its teams' rows, nothing else", async () => {
  const expected: Record<Role, string[]> = {
    owner: ["personal", "team"],
    admin: ["team"],
    member: ["other", "team"],
    viewer: ["team"],
    outsider: [],
    // A system admin who isn't in the team sees none of it.
    sysadmin: [],
  };
  for (const which of Object.keys(TABLES) as (keyof typeof TABLES)[])
    for (const [role, want] of Object.entries(expected))
      assert.deepEqual(
        await seen(which, {
          userId: people[role as Role].id,
          teamIds: null,
          personal: true,
        }),
        want,
        `${which} as ${role}`,
      );
});

test("the default scope is the app's own rule, and pages in the Trash are left out", async () => {
  // The app's rule, written out once here as the reference.
  const reference = (alias: string, owner = "user_id") =>
    `((${alias}.team_id IS NULL AND ${alias}.${owner} = $1) OR ${alias}.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;
  const trashed = await make(people.owner, "/docs", {
    title: "Visible trashed page",
    team_id: teamId,
  });
  await pool.query("UPDATE docs SET deleted_at = now() WHERE id = $1", [
    trashed,
  ]);
  try {
    for (const role of Object.keys(people) as Role[]) {
      const id = people[role].id;
      for (const [table, alias, build, owner] of [
        ["items", "i", v.visibleItems, "user_id"],
        ["projects", "p", v.visibleProjects, "user_id"],
        ["work_records", "w", v.visibleRecords, "created_by"],
        ["docs", "d", v.readableDocs, "user_id"],
      ] as const) {
        const older = await pool.query<{ id: string }>(
          `SELECT ${alias}.id FROM ${table} ${alias} WHERE ${reference(alias, owner)} ORDER BY ${alias}.id`,
          [id],
        );
        const now = await pool.query<{ id: string }>(
          `SELECT ${alias}.id FROM ${table} ${alias} WHERE ${build(alias)} ORDER BY ${alias}.id`,
          [id],
        );
        assert.deepEqual(now.rows, older.rows, `${table} as ${role}`);
      }
      // Live pages: readable ones not in the Trash.
      const live = await pool.query<{ id: string }>(
        `SELECT d.id FROM docs d WHERE ${v.visibleDocs()} AND d.id = $2`,
        [id, trashed],
      );
      assert.equal(live.rowCount, 0, `a trashed page is hidden from ${role}`);
      const readable = await pool.query<{ id: string }>(
        `SELECT d.id FROM docs d WHERE ${v.readableDocs()} AND d.id = $2`,
        [id, trashed],
      );
      assert.equal(
        readable.rowCount,
        ["owner", "admin", "member", "viewer"].includes(role) ? 1 : 0,
        `the Trash shows it to ${role} only as a team member`,
      );
    }
  } finally {
    await pool.query("DELETE FROM docs WHERE id = $1", [trashed]);
  }
});

/** Every .ts file under `dir`. */
async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sources(path)));
    else if (e.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("the rule lives only in lib/visibility.ts: no copies anywhere else in the code", async () => {
  const root = new URL("../src/", import.meta.url).pathname;
  // Copies of "their own, or their teams'" in any spelling: the membership
  // subquery, and the personal half beside a team_members check.
  const copies = [
    /team_id\s+IN\s*\(\s*SELECT\s+team_id\s+FROM\s+team_members\s+WHERE\s+user_id\s*=\s*[$\w.]+\s*\)/i,
    /team_id\s+IS\s+NULL\s+AND\s+\w+\.(user_id|created_by)\s*=\s*[$\w.]+\)\s*OR\s+[\s\S]{0,40}team_members/i,
    /THEN\s+\w+\.user_id\s*=\s*[$\w.]+\s+ELSE\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+team_members/i,
    /\bconst\s+(VISIBLE\w*|SEES)\s*=\s*`/,
  ];
  // Not the visibility rule: who may add to a project (viewers can't).
  const writeChecks = new Set(["modules/imports/converter.ts"]);
  const found: string[] = [];
  for (const file of await sources(root)) {
    const rel = file.slice(root.length);
    if (rel === "lib/visibility.ts" || writeChecks.has(rel)) continue;
    const text = await readFile(file, "utf8");
    for (const copy of copies)
      if (copy.test(text)) found.push(`${rel}: ${text.match(copy)![0]}`);
  }
  assert.deepEqual(
    found,
    [],
    "Use the builders in lib/visibility.ts (visibleItems, visibleDocs, readableDocs, visibleProjects, visibleRecords, visibleFolders, visibleTemplates, visibleOwned, inMyTeams) instead of writing the rule out.",
  );
});

test("an agent's narrower spaces: fewer teams, no Personal, never a team left", async () => {
  const member = people.member.id;
  // Only the one team: the other team's rows are out.
  assert.deepEqual(
    await seen("items", { userId: member, teamIds: [teamId], personal: true }),
    ["team"],
  );
  // No teams at all.
  assert.deepEqual(
    await seen("docs", {
      userId: people.owner.id,
      teamIds: [],
      personal: true,
    }),
    ["personal"],
  );
  // No Personal space.
  assert.deepEqual(
    await seen("projects", {
      userId: people.owner.id,
      teamIds: null,
      personal: false,
    }),
    ["team"],
  );
  // Naming a team isn't enough: membership is checked in the same query.
  assert.deepEqual(
    await seen("records", {
      userId: people.outsider.id,
      teamIds: [teamId],
      personal: true,
    }),
    [],
  );
  assert.equal(v.inSpaces({ teamIds: [teamId], personal: false }, null), false);
  assert.equal(v.inSpaces({ teamIds: null, personal: true }, otherTeam), true);
  assert.throws(() => v.visibleItems("i; DROP TABLE items"), /safe SQL/);
});

/** A principal for the policy checks. */
const principal = (
  over: Partial<Parameters<typeof policy.can>[0]> = {},
): Parameters<typeof policy.can>[0] => ({
  user: { id: people.member.id, name: "member", role: "admin" },
  via: "agent_key",
  grant_id: "00000000-0000-0000-0000-000000000001",
  client: { id: "orbyn-agent-key", name: "Agent key" },
  access: "write",
  team_ids: [teamId],
  personal: true,
  toolsets: ["core"],
  flags: {
    notify_teammates: false,
    hide_outside_content: false,
    readonly: false,
  },
  teams: [
    { id: teamId, name: "Visible team", role: "member", agent_access: "role" },
  ],
  ...over,
});

test("policy.can: the lowest of the access level, the team role and the team's agent policy", () => {
  const team = { team_id: teamId };
  const personal = { team_id: null };
  assert.deepEqual(policy.can(principal(), "write", team), {
    ok: true,
    level: "write",
  });
  // A viewer only reads, whatever the connection says.
  const viewer = principal({
    teams: [{ id: teamId, name: "t", role: "viewer", agent_access: "role" }],
  });
  assert.equal(policy.can(viewer, "read", team).ok, true);
  const refused = policy.can(viewer, "suggest", team);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.code, "FORBIDDEN");
  // The team's agent policy caps it.
  const capped = principal({
    teams: [{ id: teamId, name: "t", role: "owner", agent_access: "suggest" }],
  });
  assert.equal(policy.levelIn(capped, teamId), "suggest");
  assert.equal(policy.can(capped, "write", team).ok, false);
  // A read connection reads; a read-only call reads.
  assert.equal(policy.levelIn(principal({ access: "read" }), null), "read");
  assert.equal(
    policy.levelIn(
      principal({
        flags: {
          notify_teammates: false,
          hide_outside_content: false,
          readonly: true,
        },
      }),
      teamId,
    ),
    "read",
  );
  // A space the connection doesn't reach isn't found (nothing leaks).
  const other = policy.can(principal(), "read", { team_id: otherTeam });
  assert.equal(!other.ok && other.code, "NOT_FOUND");
  const noPersonal = policy.can(
    principal({ personal: false }),
    "read",
    personal,
  );
  assert.equal(!noPersonal.ok && noPersonal.code, "NOT_FOUND");
  // A person's own session isn't capped by the team's agent policy.
  const session = principal({
    via: "session",
    teams: [{ id: teamId, name: "t", role: "member", agent_access: "off" }],
  });
  assert.equal(policy.levelIn(session, teamId), "write");
});

test("policy: toolsets and access gate the tools; agents act as an ordinary member", () => {
  const read = { access: "read" as const, toolset: "core" as const };
  const write = { access: "write" as const, toolset: "core" as const };
  assert.equal(policy.allows(principal(), write), true);
  assert.equal(policy.allows(principal({ access: "read" }), write), false);
  assert.equal(policy.allows(principal({ access: "read" }), read), true);
  assert.equal(
    policy.allows(principal(), { ...read, toolset: "planner" as const }),
    false,
  );
  assert.equal(
    policy.allows(principal(), { ...read, legacyOnly: true }),
    false,
  );
  assert.equal(
    policy.allows(principal({ via: "legacy_key" }), {
      ...read,
      legacyOnly: true,
    }),
    true,
  );
  // A system admin's agent is a member: the admin override never applies.
  assert.equal(policy.actor(principal()).role, "member");
  assert.deepEqual(policy.spaces(principal()), {
    userId: people.member.id,
    teamIds: [teamId],
    personal: true,
  });
});

test("reachableTeams: live membership, the connection's teams, and teams that turned agents off", async () => {
  const member = people.member.id;
  const all = await reachableTeams(pool, member, null, "agent_key");
  assert.deepEqual(all.map((t) => t.id).sort(), [teamId, otherTeam].sort());
  assert.equal(all.find((t) => t.id === teamId)?.role, "member");
  const one = await reachableTeams(pool, member, [teamId], "agent_key");
  assert.deepEqual(
    one.map((t) => t.id),
    [teamId],
  );
  // Someone not in a team never reaches it, whatever the connection names.
  assert.deepEqual(
    await reachableTeams(pool, people.outsider.id, [teamId], "agent_key"),
    [],
  );
  await pool.query("UPDATE teams SET agent_access = 'off' WHERE id = $1", [
    teamId,
  ]);
  try {
    assert.deepEqual(
      (await reachableTeams(pool, member, null, "oauth")).map((t) => t.id),
      [otherTeam],
    );
    // The person's own session still reaches it.
    assert.equal(
      (await reachableTeams(pool, member, null, "session")).length,
      2,
    );
  } finally {
    await pool.query("UPDATE teams SET agent_access = 'role' WHERE id = $1", [
      teamId,
    ]);
  }
});
