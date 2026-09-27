import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * The server's clock against outside time (lib/clock.ts): fast, slow,
 * within tolerance, and one source not answering — with the clock and the
 * network stood in for, so nothing here leaves the machine. What's found
 * shows on GET /status and in Admin → System, admins get one notice, and
 * it goes once the clock is right.
 */
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { checkServerClock, judgeClock, readSource, serverClock } =
  await import("../src/lib/clock.js");
const { clearStatusCache } = await import("../src/modules/status/report.js");
const { clockSkewText } = await import("@orbyn/core");

const app = await buildApp();
const REAL = Date.parse("2026-09-27T06:20:00Z");
const HOUR = 3_600_000;
const A = "https://a.example";
const B = "https://b.example";

/** A server whose clock reads `skew` ms off, and sources that answer so. */
const world = (
  skew: number,
  answers: Record<string, "ok" | "fail" | "garbled"> = {},
) => ({
  now: () => REAL + skew,
  async dateOf(url: string) {
    const how = answers[url] ?? "ok";
    if (how === "fail") throw new Error("offline");
    if (how === "garbled") return "not a date";
    return new Date(REAL).toUTCString();
  },
});

let adminId = "";
let adminToken = "";

before(async () => {
  await migrate();
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `clock-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Clock admin",
    },
  });
  adminToken = r.json().token;
  adminId = r.json().user.id;
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminId]);
});
beforeEach(async () => {
  await pool.query("DELETE FROM server_clock");
  clearStatusCache();
});
after(async () => {
  await pool.query("DELETE FROM server_clock");
  await app.close();
  await pool.end();
});

const notices = async () =>
  (
    await pool.query<{ title: string; body: string; ref: string }>(
      "SELECT title, body, ref FROM notifications WHERE user_id = $1 AND kind = 'system'",
      [adminId],
    )
  ).rows;

test("the wording: hours and minutes, fast or slow", () => {
  assert.equal(
    clockSkewText(10 * HOUR),
    "Server clock is 10 h fast — reminders and sign-ins may misbehave.",
  );
  assert.equal(
    clockSkewText(-(HOUR + 25 * 60_000)),
    "Server clock is 1 h 25 min slow — reminders and sign-ins may misbehave.",
  );
  assert.match(clockSkewText(3 * 60_000), /is 3 min fast/);
});

test("judging: both out the same way, within tolerance, or unsure", () => {
  const r = (a: number | null, b: number | null) => [
    { source: A, skew_ms: a },
    { source: B, skew_ms: b },
  ];
  assert.deepEqual(judgeClock(r(10 * HOUR, 10 * HOUR + 900)), {
    verdict: "out",
    skew_ms: 10 * HOUR,
  });
  assert.deepEqual(judgeClock(r(-5 * 60_000, -6 * 60_000)), {
    verdict: "out",
    skew_ms: -5 * 60_000,
  });
  assert.deepEqual(judgeClock(r(90_000, -30_000)), { verdict: "right" });
  // One source down: can't say it's out, but a right answer still counts.
  assert.deepEqual(judgeClock(r(10 * HOUR, null)), { verdict: "unsure" });
  assert.deepEqual(judgeClock(r(null, 1_000)), { verdict: "right" });
  assert.deepEqual(judgeClock(r(null, null)), { verdict: "unsure" });
  // Sources that disagree settle nothing.
  assert.deepEqual(judgeClock(r(10 * HOUR, 0)), { verdict: "unsure" });
  assert.deepEqual(judgeClock(r(10 * HOUR, -10 * HOUR)), {
    verdict: "unsure",
  });
});

test("reading a source: the middle of the request against its Date", async () => {
  const fast = await readSource(A, world(10 * HOUR));
  // A Date header counts whole seconds; its time is the middle of one.
  assert.equal(fast.skew_ms, 10 * HOUR - 500);
  assert.equal((await readSource(A, world(0, { [A]: "fail" }))).skew_ms, null);
  assert.equal(
    (await readSource(A, world(0, { [A]: "garbled" }))).skew_ms,
    null,
  );
});

test("a clock 10 hours fast is recorded, shown and told to admins once", async () => {
  const first = await checkServerClock(world(10 * HOUR), [A, B]);
  assert.equal(first.verdict, "out");
  const clock = await serverClock();
  assert.ok(clock);
  assert.equal(clock.skew_ms, 10 * HOUR - 500);
  // Recorded in outside time, not the server's.
  assert.ok(Math.abs(Date.parse(clock.since) - REAL) < 2_000, clock.since);

  // Again: the same occurrence, so no second notice.
  await checkServerClock(world(10 * HOUR), [A, B]);
  const told = await notices();
  assert.equal(told.length, 1);
  assert.equal(told[0].title, "Server clock is 10 h fast");
  assert.match(told[0].body, /NTP/);

  const status = await app.inject({ method: "GET", url: "/status" });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().clock.skew_ms, 10 * HOUR - 500);

  const view = await app.inject({
    method: "GET",
    url: "/admin/settings",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(view.statusCode, 200, view.body);
  assert.equal(view.json().clock.skew_ms, 10 * HOUR - 500);
});

test("slow counts too; within tolerance clears it; one source down changes nothing", async () => {
  assert.equal(
    (await checkServerClock(world(-7 * 60_000), [A, B])).verdict,
    "out",
  );
  assert.ok((await serverClock())!.skew_ms < 0);

  // One source down and the other still says it's out: kept as it was.
  const unsure = await checkServerClock(world(-7 * 60_000, { [B]: "fail" }), [
    A,
    B,
  ]);
  assert.equal(unsure.verdict, "unsure");
  assert.ok(await serverClock());

  // Set right (within two minutes): gone, from /status as well.
  assert.equal(
    (await checkServerClock(world(40_000), [A, B])).verdict,
    "right",
  );
  assert.equal(await serverClock(), null);
  clearStatusCache();
  const status = await app.inject({ method: "GET", url: "/status" });
  assert.equal(status.json().clock, null);

  // Both down: nothing recorded either way.
  assert.equal(
    (
      await checkServerClock(world(10 * HOUR, { [A]: "fail", [B]: "fail" }), [
        A,
        B,
      ])
    ).verdict,
    "unsure",
  );
  assert.equal(await serverClock(), null);
});

test("Admin → System needs an admin (401, 403)", async () => {
  assert.equal(
    (await app.inject({ method: "GET", url: "/admin/settings" })).statusCode,
    401,
  );
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `clock-member-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Member",
    },
  });
  const member = await app.inject({
    method: "GET",
    url: "/admin/settings",
    headers: { authorization: `Bearer ${r.json().token}` },
  });
  assert.equal(member.statusCode, 403);
});
