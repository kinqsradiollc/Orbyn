import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { capacityLevel, hoursLabel } from "@orbyn/core";
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
    email: `cap-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name,
  });
  return { token: r.json().token as string, id: r.json().user.id as string };
}

let owner: { token: string; id: string };
let member: { token: string; id: string };
let stranger: { token: string; id: string };
let team = "";

// A Monday to Friday week, in UTC (everyone's default zone here).
const week = "from=2026-09-14T00:00:00Z&to=2026-09-19T00:00:00Z";

before(async () => {
  await migrate();
  owner = await newUser("Owner");
  member = await newUser("Member");
  stranger = await newUser("Stranger");
  team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Capacity crew', $1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member')",
    [team, owner.id, member.id],
  );
  // The member: a 3-hour meeting on Tuesday, and a 10-hour one on Wednesday.
  for (const [title, due, end] of [
    ["Workshop", "2026-09-15T09:00:00Z", "2026-09-15T12:00:00Z"],
    ["Offsite", "2026-09-16T08:00:00Z", "2026-09-16T18:00:00Z"],
  ])
    assert.equal(
      (
        await call(member.token, "POST", "/items", {
          title,
          kind: "event",
          due_at: due,
          end_at: end,
        })
      ).statusCode,
      201,
    );
  // Team work assigned to the member, nothing planned for it yet.
  await call(owner.token, "POST", "/items", {
    title: "Draft the launch post",
    kind: "task",
    team_id: team,
    assignee_id: member.id,
    estimate_minutes: 240,
  });
});
after(async () => {
  await app.close();
  await pool.end();
});

test("owners see free hours per person per day", async () => {
  const r = await call(owner.token, "GET", `/teams/${team}/capacity?${week}`);
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.show_hours, true);
  assert.deepEqual(body.days, [
    "2026-09-14",
    "2026-09-15",
    "2026-09-16",
    "2026-09-17",
    "2026-09-18",
  ]);
  const m = body.members.find((x: Json) => x.user_id === member.id);
  const [mon, tue, wed] = m.days;
  assert.equal(mon.working_minutes, 480);
  assert.equal(mon.free_minutes, 480);
  assert.equal(mon.level, 3);
  // The workshop takes three of Tuesday's eight hours.
  assert.equal(tue.free_minutes, 300);
  assert.equal(tue.level, 3);
  // The offsite runs past working hours: no time left, and over by two hours.
  assert.equal(wed.free_minutes, 0);
  assert.equal(wed.level, 0);
  assert.equal(wed.over, true);
  assert.equal(wed.over_minutes, 120);
  // The unplanned team task stays in its own column, not spread over days.
  assert.equal(m.unplaced_minutes, 240);
});

test("members see the shades but not the hours", async () => {
  const body = (
    await call(member.token, "GET", `/teams/${team}/capacity?${week}`)
  ).json();
  assert.equal(body.show_hours, false);
  const m = body.members.find((x: Json) => x.user_id === member.id);
  assert.equal(m.unplaced_minutes, null);
  assert.equal(m.days[2].free_minutes, null);
  assert.equal(m.days[2].over, true);
  assert.equal(m.days[2].level, 0);
  // Never the titles: nothing in the answer names an event.
  assert.ok(!JSON.stringify(body).includes("Offsite"));
});

test("capacity is guarded and ranges are bounded", async () => {
  assert.equal(
    (await call(null, "GET", `/teams/${team}/capacity?${week}`)).statusCode,
    401,
  );
  assert.equal(
    (await call(stranger.token, "GET", `/teams/${team}/capacity?${week}`))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        owner.token,
        "GET",
        `/teams/${team}/capacity?from=2026-09-01T00:00:00Z&to=2026-11-01T00:00:00Z`,
      )
    ).statusCode,
    422,
  );
});

test("levels and labels", () => {
  assert.equal(capacityLevel(0), 0);
  assert.equal(capacityLevel(90), 1);
  assert.equal(capacityLevel(180), 2);
  assert.equal(capacityLevel(360), 3);
  assert.equal(hoursLabel(210), "3½h");
  assert.equal(hoursLabel(45), "45m");
  assert.equal(hoursLabel(300), "5h");
});
