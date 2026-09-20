import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
type Json = Record<string, any>;
const call = (
  token: string | null,
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function newUser(name: string) {
  const r = await call(null, "POST", "/auth/register", {
    email: `ta-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name,
  });
  return { token: r.json().token as string, id: r.json().user.id as string };
}

let owner: { token: string; id: string };
let member: { token: string; id: string };
let team = "";

before(async () => {
  await migrate();
  owner = await newUser("Owner");
  member = await newUser("Member");
  team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Analytics crew', $1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member')",
    [team, owner.id, member.id],
  );
});
after(async () => {
  await app.close();
  await pool.end();
});

test("owners see per-member set-aside time on team items; members can't", async () => {
  // A team task assigned to the member, with two hours set aside by them.
  const task = (
    await call(member.token, "POST", "/items", {
      title: "Team report",
      kind: "task",
      team_id: team,
      assignee_id: member.id,
    })
  ).json();
  await call(member.token, "POST", "/blocks", {
    item_id: task.id,
    start_at: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    end_at: new Date(Date.now() - 24 * 3_600_000).toISOString(),
  });
  // A finished team task assigned to the member.
  const done = (
    await call(member.token, "POST", "/items", {
      title: "Quick team task",
      kind: "task",
      team_id: team,
      assignee_id: member.id,
    })
  ).json();
  await call(member.token, "POST", `/items/${done.id}/updates`, {
    status: "done",
  });

  const a = await call(owner.token, "GET", `/teams/${team}/analytics?days=30`);
  assert.equal(a.statusCode, 200, a.body);
  const row = a.json().members.find((m: Json) => m.user_id === member.id);
  assert.equal(row.planned_minutes, 120, "two hours on the team item");
  assert.ok(row.completed >= 1, "the finished team task is counted");
  assert.equal(a.json().total_planned_minutes, 120);

  // A plain member can't see the team's analytics.
  assert.equal(
    (await call(member.token, "GET", `/teams/${team}/analytics`)).statusCode,
    403,
  );
});
