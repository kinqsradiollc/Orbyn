import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  advanceFocus,
  focusRemaining,
  focusRhythm,
  freshFocus,
  pauseFocus,
  rhythmForBreakLevel,
  startFocus,
} from "@orbyn/core";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
type Json = Record<string, any>;
const call = (
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
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
    email: `fp-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name,
  });
  return { token: r.json().token as string, id: r.json().user.id as string };
}

let owner: { token: string; id: string };
let member: { token: string; id: string };
let stranger: { token: string; id: string };
let team = "";

before(async () => {
  await migrate();
  owner = await newUser("Owner");
  member = await newUser("Member");
  stranger = await newUser("Stranger");
  team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Presence crew', $1) RETURNING id",
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

// ---- the rhythm, without a server ------------------------------------------

test("a rhythm runs work, break, work, and a long break after the last round", () => {
  const rhythm = focusRhythm("25-5")!;
  const t0 = Date.parse("2026-09-15T09:00:00Z");
  let s = startFocus(freshFocus(rhythm, null), t0);
  assert.equal(focusRemaining(s, t0 + 60_000), 24 * 60_000);
  // Pausing keeps what's left; the time away doesn't count.
  s = pauseFocus(s, t0 + 5 * 60_000);
  assert.equal(focusRemaining(s, t0 + 60 * 60_000), 20 * 60_000);
  // Work ends: the break starts on its own.
  s = advanceFocus(rhythm, s, t0);
  assert.equal(s.phase, "short_break");
  assert.ok(s.ends_at);
  // The break ends: the next session waits to be started.
  s = advanceFocus(rhythm, s, t0);
  assert.equal(s.phase, "work");
  assert.equal(s.round, 2);
  assert.equal(s.ends_at, null);
  for (let round = 2; round < 4; round++)
    s = advanceFocus(rhythm, advanceFocus(rhythm, s, t0), t0);
  assert.equal(s.round, 4);
  assert.equal(advanceFocus(rhythm, s, t0).phase, "long_break");
});

test("the default rhythm follows the planner's break level", () => {
  assert.equal(rhythmForBreakLevel("none").id, "open");
  assert.equal(rhythmForBreakLevel("light").id, "25-5");
  assert.equal(rhythmForBreakLevel("normal").id, "50-10");
  assert.equal(rhythmForBreakLevel("intense").id, "45-15");
  assert.deepEqual(focusRhythm("custom:30/5/20/3"), {
    id: "custom:30/5/20/3",
    label: "30 / 5",
    work: 30,
    short_break: 5,
    long_break: 20,
    rounds: 3,
  });
  assert.equal(focusRhythm("custom:2/5/20/3"), null);
});

// ---- focus sessions ---------------------------------------------------------

test("a work session is kept once and logs its minutes to the task", async () => {
  assert.equal(
    (await call(null, "POST", "/focus/sessions", {})).statusCode,
    401,
  );
  const task = (
    await call(owner.token, "POST", "/items", {
      title: "Write the brief",
      kind: "task",
    })
  ).json();
  const session = {
    id: randomUUID(),
    item_id: task.id,
    kind: "work",
    started_at: "2026-09-15T09:00:00+10:00",
    ended_at: "2026-09-15T09:25:00+10:00",
    planned_minutes: 25,
    minutes: 25,
    completed: true,
  };
  const first = await call(owner.token, "POST", "/focus/sessions", session);
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json().item.spent_minutes, 25);
  assert.equal(first.json().session.item_title, "Write the brief");
  // A retry after a dropped connection changes nothing.
  const again = await call(owner.token, "POST", "/focus/sessions", session);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().item.spent_minutes, 25);
  // The same id from someone else is refused.
  assert.equal(
    (
      await call(stranger.token, "POST", "/focus/sessions", {
        ...session,
        item_id: null,
      })
    ).statusCode,
    409,
  );
  // Nobody logs time on a task they can't see.
  assert.equal(
    (
      await call(stranger.token, "POST", "/focus/sessions", {
        ...session,
        id: randomUUID(),
      })
    ).statusCode,
    404,
  );
  // A break is kept but logs nothing.
  const rest = await call(owner.token, "POST", "/focus/sessions", {
    ...session,
    id: randomUUID(),
    kind: "short_break",
    started_at: "2026-09-15T09:25:00+10:00",
    ended_at: "2026-09-15T09:30:00+10:00",
    planned_minutes: 5,
    minutes: 5,
  });
  assert.equal(rest.json().item.spent_minutes, 25);
  // A session cut short counts its minutes and says so.
  await call(owner.token, "POST", "/focus/sessions", {
    ...session,
    id: randomUUID(),
    started_at: "2026-09-15T09:30:00+10:00",
    ended_at: "2026-09-15T09:40:00+10:00",
    minutes: 10,
    completed: false,
  });
  // Bad input is refused, not kept.
  assert.equal(
    (
      await call(owner.token, "POST", "/focus/sessions", {
        ...session,
        id: randomUUID(),
        ended_at: session.started_at,
      })
    ).statusCode,
    422,
  );

  const summary = (
    await call(
      owner.token,
      "GET",
      "/focus/summary?from=2026-09-15T00:00:00%2B10:00&to=2026-09-16T00:00:00%2B10:00",
    )
  ).json();
  assert.equal(summary.work_minutes, 35);
  assert.equal(summary.completed, 1);
  assert.equal(summary.cut_short, 1);
  assert.equal(summary.breaks_taken, 1);
  assert.deepEqual(summary.by_item, [
    { item_id: task.id, title: "Write the brief", minutes: 35 },
  ]);
  assert.equal(summary.recent.length, 3);
});

test("the session running now is shared with your own devices only", async () => {
  const state = {
    rhythm: "25-5",
    phase: "work",
    round: 1,
    ends_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    remaining_ms: 25 * 60_000,
    run_started_at: new Date().toISOString(),
    ran_ms: 0,
    item_id: null,
  };
  const put = await call(owner.token, "PUT", "/focus/current", {
    state,
    device: "MacBook",
    device_id: "device-web-1",
  });
  assert.equal(put.statusCode, 200, put.body);
  const mine = (await call(owner.token, "GET", "/focus/current")).json();
  assert.equal(mine.device, "MacBook");
  assert.equal(mine.state.phase, "work");
  assert.equal(
    (await call(member.token, "GET", "/focus/current")).json(),
    null,
  );
  assert.equal(
    (await call(owner.token, "DELETE", "/focus/current")).statusCode,
    204,
  );
  assert.equal((await call(owner.token, "GET", "/focus/current")).json(), null);
});

// ---- presence ---------------------------------------------------------------

const beat = (token: string, body: Json) =>
  call(token, "POST", "/presence/heartbeat", {
    platform: "web",
    ...body,
  });

test("your devices show whether they are online and in sync", async () => {
  assert.equal((await beat(owner.token, { device_id: "x" })).statusCode, 422);
  assert.equal(
    (await beat(owner.token, { device_id: "laptop-0001", label: "MacBook" }))
      .statusCode,
    200,
  );
  await beat(owner.token, {
    device_id: "phone-0001",
    platform: "ios",
    label: "iPhone",
    pending_changes: 2,
    synced_at: "2026-09-15T09:00:00+10:00",
  });
  const devices: Json[] = (
    await call(owner.token, "GET", "/presence/devices")
  ).json();
  const phone = devices.find((d) => d.device_id === "phone-0001")!;
  assert.equal(phone.online, true);
  assert.equal(phone.pending_changes, 2);
  assert.equal(phone.label, "iPhone");
  // Leaving takes it offline; forgetting removes it.
  await call(owner.token, "POST", "/presence/leave", {
    device_id: "phone-0001",
  });
  const after = (await call(owner.token, "GET", "/presence/devices")).json();
  assert.equal(
    after.find((d: Json) => d.device_id === "phone-0001").online,
    false,
  );
  assert.equal(
    (await call(owner.token, "DELETE", "/presence/devices/phone-0001"))
      .statusCode,
    204,
  );
  assert.ok(
    !(await call(owner.token, "GET", "/presence/devices"))
      .json()
      .some((d: Json) => d.device_id === "phone-0001"),
  );
  // Nobody else sees them.
  assert.deepEqual(
    (await call(member.token, "GET", "/presence/devices")).json(),
    [],
  );
});

test("teammates see who is active only when they choose to share it", async () => {
  await beat(member.token, { device_id: "member-laptop" });
  const hidden: Json[] = (
    await call(owner.token, "GET", `/teams/${team}/presence`)
  ).json();
  assert.equal(hidden.find((m) => m.user_id === member.id)?.status, "hidden");
  const shared = await call(member.token, "PUT", "/presence/settings", {
    share_presence: true,
  });
  assert.deepEqual(shared.json(), { share_presence: true });
  const now: Json[] = (
    await call(owner.token, "GET", `/teams/${team}/presence`)
  ).json();
  const row = now.find((m) => m.user_id === member.id)!;
  assert.equal(row.status, "active");
  // Only a status: no time, no device, nothing about what they're on.
  assert.deepEqual(Object.keys(row).sort(), ["status", "user_id"]);
  assert.equal(
    (await call(stranger.token, "GET", `/teams/${team}/presence`)).statusCode,
    404,
  );
});

test("a shared page shows who else has it open", async () => {
  const doc = (
    await call(owner.token, "POST", "/docs", {
      title: "Launch brief",
      kind: "doc",
      team_id: team,
    })
  ).json();
  assert.ok(doc.id, JSON.stringify(doc));
  await beat(member.token, { device_id: "member-laptop", doc_id: doc.id });
  const viewers = (
    await call(owner.token, "GET", `/docs/${doc.id}/presence`)
  ).json();
  assert.deepEqual(viewers, [{ user_id: member.id, name: "Member" }]);
  // You are not in your own list.
  assert.deepEqual(
    (await call(member.token, "GET", `/docs/${doc.id}/presence`)).json(),
    [],
  );
  // Someone who can't see the page can't say they're on it, or ask who is.
  assert.equal(
    (await beat(stranger.token, { device_id: "stranger-1", doc_id: doc.id }))
      .statusCode,
    404,
  );
  assert.equal(
    (await call(stranger.token, "GET", `/docs/${doc.id}/presence`)).statusCode,
    404,
  );
});

// ---- quick add: repeats and habits -------------------------------------------

test("quick add makes a repeating item, or a habit when no time is given", async () => {
  const repeat = await call(owner.token, "POST", "/items/quick", {
    text: "Water plants every monday at 8am",
    timezone: "Australia/Melbourne",
  });
  assert.equal(repeat.statusCode, 201, repeat.body);
  assert.equal(repeat.json().item.rrule, "FREQ=WEEKLY;BYDAY=MO");
  assert.equal(repeat.json().item.title, "Water plants");

  const habit = await call(owner.token, "POST", "/items/quick", {
    text: "Read 20 minutes every day",
    timezone: "Australia/Melbourne",
  });
  assert.equal(habit.statusCode, 201, habit.body);
  assert.equal(habit.json().item, null);
  assert.equal(habit.json().habit.name, "Read");
  assert.equal(habit.json().habit.duration_minutes, 20);
  const habits: Json[] = (
    await call(owner.token, "GET", "/planner/habits")
  ).json();
  assert.ok(habits.some((h) => h.id === habit.json().habit.id));

  // A preview saves nothing and says what it would make.
  const preview = (
    await call(owner.token, "POST", "/items/quick", {
      text: "Gym 3 times a week",
      preview: true,
    })
  ).json();
  assert.equal(preview.habit.cadence, 3);
  assert.equal(
    (await call(owner.token, "GET", "/planner/habits")).json().length,
    habits.length,
  );
});
