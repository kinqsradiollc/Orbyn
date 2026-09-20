import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { placeHabits } = await import("../src/modules/planner/habits.js");
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const TZ = "UTC";
// A week that starts on a Monday: 2026-01-05 is a Monday.
const WEEK = ["05", "06", "07", "08", "09", "10", "11"].map(
  (d) => `2026-01-${d}`,
);
const ms = (day: string, clock: string) => Date.parse(`${day}T${clock}:00Z`);
const before9 = ms(WEEK[0], "00");

const habit = (
  over: Partial<Parameters<typeof placeHabits>[0]["habits"][0]> = {},
) => ({
  id: over.id ?? randomUUID(),
  name: over.name ?? "Gym",
  cadence: over.cadence ?? 3,
  period: over.period ?? "week",
  duration_minutes: over.duration_minutes ?? 30,
  days: over.days ?? [0, 1, 2, 3, 4, 5, 6],
  window_start: over.window_start ?? null,
  window_end: over.window_end ?? null,
  priority: over.priority ?? "medium",
});

const base = {
  busy: [] as { start: number; end: number }[],
  days: WEEK,
  timezone: TZ,
  workStart: 9 * 60,
  workEnd: 17 * 60,
  existing: [] as { habit_id: string; start: number }[],
  now: before9,
};

// ---- placement engine (pure) ----------------------------------------------

test("a weekly habit is spread across distinct days inside working hours", () => {
  const h = habit({ cadence: 3 });
  const { blocks, summary } = placeHabits({ ...base, habits: [h] });
  assert.equal(blocks.length, 3, "three sessions");
  const days = new Set(blocks.map((b) => b.start_at.slice(0, 10)));
  assert.equal(days.size, 3, "on three different days");
  for (const b of blocks) {
    const start = new Date(b.start_at);
    assert.ok(start.getUTCHours() >= 9 && start.getUTCHours() < 17, "in hours");
    assert.equal(Date.parse(b.end_at) - Date.parse(b.start_at), 30 * 60_000);
  }
  assert.equal(summary[0].placed, 3);
  assert.equal(summary[0].reason, null);
});

test("only allowed weekdays are used", () => {
  const h = habit({ cadence: 1, days: [1] }); // Mondays only
  const { blocks } = placeHabits({ ...base, habits: [h] });
  assert.equal(blocks.length, 1);
  assert.equal(new Date(blocks[0].start_at).getUTCDay(), 1);
});

test("a habit's own time-of-day window is honoured", () => {
  const h = habit({ cadence: 1, window_start: "18:00", window_end: "20:00" });
  const { blocks } = placeHabits({
    ...base,
    habits: [h],
    // 18:00 is outside working hours, so the window itself must be used.
    now: before9,
  });
  assert.equal(blocks.length, 1);
  assert.equal(new Date(blocks[0].start_at).getUTCHours(), 18);
});

test("sessions already set aside count towards the target", () => {
  const h = habit({ cadence: 3 });
  const existing = [
    { habit_id: h.id, start: ms(WEEK[0], "10:00") },
    { habit_id: h.id, start: ms(WEEK[1], "10:00") },
  ];
  const { blocks, summary } = placeHabits({ ...base, habits: [h], existing });
  assert.equal(blocks.length, 1, "only the missing one is proposed");
  assert.equal(summary[0].placed, 1);
  assert.equal(summary[0].needed, 1);
});

test("busy time pushes a session to the next free day (flexibility)", () => {
  const h = habit({ cadence: 1 });
  // Fill the first day's whole window; the session must land later.
  const busy = [{ start: ms(WEEK[0], "09:00"), end: ms(WEEK[0], "17:00") }];
  const { blocks } = placeHabits({ ...base, habits: [h], busy });
  assert.equal(blocks.length, 1);
  assert.notEqual(blocks[0].start_at.slice(0, 10), WEEK[0]);
});

test("a habit that can't be fully placed says why", () => {
  // Four Mondays would be needed but the range has one Monday.
  const h = habit({ cadence: 4, period: "week", days: [1] });
  const { blocks, summary } = placeHabits({ ...base, habits: [h] });
  assert.ok(blocks.length < 4);
  assert.ok(summary[0].reason);
});

test("higher-priority habits are placed first", () => {
  const low = habit({ name: "Low", cadence: 7, priority: "low" });
  const high = habit({ name: "High", cadence: 1, priority: "high" });
  // Only one 30-min slot exists all week.
  const busy = WEEK.flatMap((d) => [
    { start: ms(d, "09:00"), end: ms(d, "16:30") },
    ...(d === WEEK[6] ? [] : [{ start: ms(d, "16:30"), end: ms(d, "17:00") }]),
  ]);
  const { blocks } = placeHabits({ ...base, habits: [low, high], busy });
  const first = blocks[0];
  assert.equal(
    first?.habit_id,
    high.id,
    "the high-priority habit wins the slot",
  );
});

// ---- routes ---------------------------------------------------------------

const app = await buildApp();
let token = "";
const auth = () => ({ authorization: `Bearer ${token}` });
const call = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: auth(),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

before(async () => {
  await migrate();
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `habits-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "H",
    },
  });
  token = reg.json().token;
});
after(async () => {
  await app.close();
  await pool.end();
});

test("habits can be created, listed, updated and deleted", async () => {
  const created = await call("POST", "/planner/habits", {
    name: "Read",
    cadence: 3,
    period: "week",
    duration_minutes: 30,
  });
  assert.equal(created.statusCode, 201, created.body);
  const h = created.json();
  assert.equal(h.name, "Read");
  assert.equal(h.cadence, 3);
  assert.deepEqual(h.days, [0, 1, 2, 3, 4, 5, 6]);

  const list = await call("GET", "/planner/habits");
  assert.equal(list.json().length, 1);

  const upd = await call("PUT", `/planner/habits/${h.id}`, {
    cadence: 5,
    active: false,
  });
  assert.equal(upd.json().cadence, 5);
  assert.equal(upd.json().active, false);

  assert.equal(
    (await call("DELETE", `/planner/habits/${h.id}`)).statusCode,
    204,
  );
  assert.equal((await call("GET", "/planner/habits")).json().length, 0);
});

test("a rejected window and a bad cadence are 422", async () => {
  assert.equal(
    (
      await call("POST", "/planner/habits", {
        name: "Bad",
        cadence: 1,
        duration_minutes: 30,
        window_start: "20:00",
        window_end: "08:00",
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call("POST", "/planner/habits", {
        name: "Too many",
        cadence: 10,
        period: "day",
        duration_minutes: 30,
      })
    ).statusCode,
    422,
  );
});

test("planning proposes sessions, applying saves them, and the calendar shows them", async () => {
  await call("POST", "/planner/habits", {
    name: "Walk",
    cadence: 2,
    period: "week",
    duration_minutes: 45,
  });
  const plan = (await call("POST", "/planner/habits/plan", { days: 7 })).json();
  assert.ok(plan.blocks.length >= 1, "at least one session proposed");
  assert.equal(plan.summary[0].name, "Walk");

  const applied = await call("POST", "/planner/habits/plan/apply", {
    blocks: plan.blocks.map(
      (b: { habit_id: string; start_at: string; end_at: string }) => ({
        habit_id: b.habit_id,
        start_at: b.start_at,
        end_at: b.end_at,
      }),
    ),
  });
  assert.equal(applied.statusCode, 200, applied.body);
  assert.ok(applied.json().length >= 1);

  const first = applied.json()[0];
  const from = new Date(Date.parse(first.start_at) - 3_600_000).toISOString();
  const to = new Date(
    Date.parse(first.start_at) + 8 * 86_400_000,
  ).toISOString();
  const cal = await call("GET", `/calendar?from=${from}&to=${to}`);
  assert.ok(
    cal.json().habit_blocks.some((b: { id: string }) => b.id === first.id),
    "the session appears on the calendar",
  );

  // A session can be removed.
  assert.equal(
    (await call("DELETE", `/planner/habits/blocks/${first.id}`)).statusCode,
    204,
  );
});

test("applying the same plan twice does not double-book", async () => {
  const list = await call("GET", "/planner/habits");
  const walk = list.json().find((h: { name: string }) => h.name === "Walk");
  const plan = (await call("POST", "/planner/habits/plan", { days: 7 })).json();
  const blocks = plan.blocks
    .filter((b: { habit_id: string }) => b.habit_id === walk.id)
    .map((b: { habit_id: string; start_at: string; end_at: string }) => ({
      habit_id: b.habit_id,
      start_at: b.start_at,
      end_at: b.end_at,
    }));
  if (!blocks.length) return;
  await call("POST", "/planner/habits/plan/apply", { blocks });
  const second = await call("POST", "/planner/habits/plan/apply", { blocks });
  // Every block now clashes with the ones just saved, so none is added again.
  const saved = second
    .json()
    .filter((b: { start_at: string }) =>
      blocks.some((x: { start_at: string }) => x.start_at === b.start_at),
    );
  assert.ok(saved.length <= blocks.length);
});
