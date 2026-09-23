import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  estimateModelOf,
  guessEstimate,
  learnDurations,
  learnLoad,
  learnRhythm,
  learnedRatio,
  titleTokens,
  type DurationSample,
  type RhythmSample,
} from "@orbyn/core";
import { schedule, slackUrgency } from "../src/modules/planner/scheduler.js";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { upNext } = await import("../src/modules/planner/next.js");

const NOW = new Date("2026-09-24T10:00:00Z");
const names = {
  tags: new Map<string, string>(),
  lists: new Map<string, string>(),
};
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();
const done = (
  estimate: number | null,
  actual: number,
  extra: Partial<DurationSample> = {},
): DurationSample => ({
  title: "Task",
  estimate_minutes: estimate,
  actual_minutes: actual,
  finished_at: daysAgo(1),
  list_id: null,
  tag_ids: [],
  ...extra,
});

// ---- Durations -------------------------------------------------------------

test("a few finished tasks move the ratio a little, many move it a lot", () => {
  const few = learnDurations(
    Array.from({ length: 3 }, () => done(60, 120)),
    names,
    NOW,
  );
  const fewRatio = estimateModelOf(few, false).overall.ratio;
  assert.ok(fewRatio > 1.3 && fewRatio < 1.8, `shrunk towards 1: ${fewRatio}`);

  const many = learnDurations(
    Array.from({ length: 30 }, () => done(60, 120)),
    names,
    NOW,
  );
  const manyRatio = estimateModelOf(many, false).overall.ratio;
  assert.ok(manyRatio > 1.85 && manyRatio <= 2, `close to 2×: ${manyRatio}`);
  assert.ok(manyRatio > fewRatio);

  // Below three tasks nothing is claimed.
  const two = learnDurations([done(60, 120), done(60, 120)], names, NOW);
  assert.equal(estimateModelOf(two, false).overall.ratio, 1);
  assert.equal(estimateModelOf(two, false).overall.range, null);
});

test("one wild task can't drag the ratio, and recent tasks count more", () => {
  const steady = Array.from({ length: 8 }, () => done(60, 60));
  const wild = learnDurations([...steady, done(1, 500)], names, NOW);
  assert.ok(
    estimateModelOf(wild, false).overall.ratio < 1.25,
    "averaged in log space and capped at 4×",
  );

  const recentFast = learnDurations(
    [
      ...Array.from({ length: 6 }, () =>
        done(60, 180, { finished_at: daysAgo(170) }),
      ),
      ...Array.from({ length: 6 }, () =>
        done(60, 60, { finished_at: daysAgo(2) }),
      ),
    ],
    names,
    NOW,
  );
  const r = estimateModelOf(recentFast, false).overall.ratio;
  assert.ok(r < 1.35, `old slow tasks fade (half-life 45 days): ${r}`);
  const [low, high] = estimateModelOf(recentFast, false).overall.range!;
  assert.ok(low <= r && r <= high, "the middle half brackets the ratio");
});

test("a tag's ratio leans on the overall one until it has its own history", () => {
  const tags = new Map([["t-writing", "writing"]]);
  const d = learnDurations(
    [
      ...Array.from({ length: 10 }, () => done(60, 60)),
      ...Array.from({ length: 6 }, () =>
        done(60, 150, { tag_ids: ["t-writing"] }),
      ),
    ],
    { tags, lists: new Map() },
    NOW,
  );
  const model = estimateModelOf(d, true);
  assert.equal(model.tags[0].name, "writing");
  assert.ok(model.tags[0].ratio > model.overall.ratio);
  assert.ok(model.tags[0].ratio < 2.5, "shrunk towards the overall ratio");
  assert.ok(
    learnedRatio({ tag_ids: ["t-writing"], list_id: null }, d) >
      learnedRatio({ tag_ids: [], list_id: null }, d),
    "a writing task is scaled by the writing ratio",
  );
});

test("tasks with no estimate are guessed from similar finished ones", () => {
  assert.deepEqual(titleTokens("Writing the weekly reports"), [
    "writ",
    "weekly",
    "report",
  ]);
  const d = learnDurations(
    [
      done(null, 50, { title: "Weekly report" }),
      done(null, 60, { title: "Write weekly report" }),
      done(null, 55, { title: "Weekly report for Anna" }),
      done(null, 20, { title: "Email Sam", list_id: "l-admin" }),
      done(null, 15, { title: "Book dentist", list_id: "l-admin" }),
      done(null, 25, { title: "Pay invoice", list_id: "l-admin" }),
    ],
    names,
    NOW,
  );
  const report = guessEstimate(
    { title: "Weekly report", tag_ids: [], list_id: null },
    d,
  );
  assert.equal(report?.basis, "similar");
  assert.ok(
    report!.minutes >= 50 && report!.minutes <= 60,
    `${report!.minutes}`,
  );

  const admin = guessEstimate(
    { title: "Renew passport", tag_ids: [], list_id: "l-admin" },
    d,
  );
  assert.equal(admin?.basis, "list");
  assert.ok(admin!.minutes < 30, "admin tasks run short");

  const nothing = learnDurations([], names, NOW);
  assert.equal(
    guessEstimate({ title: "Anything", tag_ids: [], list_id: null }, nothing),
    null,
    "no history: the planner keeps its default",
  );
});

// ---- Rhythm and load -------------------------------------------------------

test("the hours that usually go well are learned, and thin history says nothing", () => {
  const samples: RhythmSample[] = [];
  for (let day = 0; day < 10; day++) {
    // Mornings at 10–12 go into the work; afternoons at 15–17 slip.
    samples.push({ hour: 10, planned: 60, kept: 60 });
    samples.push({ hour: 11, planned: 60, kept: 55 });
    samples.push({ hour: 15, planned: 60, kept: 10 });
    samples.push({ hour: 16, planned: 60, kept: 5 });
  }
  const r = learnRhythm(samples);
  assert.ok(r.hours[10] > 0.3 && r.hours[15] < -0.3, JSON.stringify(r.hours));
  assert.deepEqual(r.peak, { start_hour: 10, end_hour: 12 });
  assert.ok(r.confidence > 0.9);

  const thin = learnRhythm([{ hour: 10, planned: 60, kept: 60 }]);
  assert.equal(thin.confidence, 0);
  assert.equal(thin.peak, null);
  assert.ok(thin.hours.every((h) => h === 0));
});

test("a typical day is the upper quartile of what got done", () => {
  assert.equal(
    learnLoad([{ planned: 300, kept: 200 }]).typical_day_minutes,
    null,
  );
  const load = learnLoad(
    [120, 180, 200, 240, 300, 150, 90].map((kept) => ({ planned: 360, kept })),
  );
  assert.equal(load.typical_day_minutes, 240);
  assert.equal(load.days, 7);
  assert.ok(load.follow_through! > 0.5 && load.follow_through! < 0.6);
});

// ---- Smart placement -------------------------------------------------------

const base = {
  busy: [],
  frames: [],
  useFrames: true,
  days: ["2026-09-25"],
  timezone: "UTC",
  workDays: [0, 1, 2, 3, 4, 5, 6],
  workStart: "09:00",
  workEnd: "17:00",
  padPercent: 0,
  split: true,
  splitAfterMinutes: 90,
  minBlockMinutes: 25,
  breakLevel: "none" as const,
  now: NOW,
};
const task = (o: Record<string, unknown> = {}) => ({
  id: "t1",
  title: "Deep work",
  priority: "medium" as const,
  status: "todo" as const,
  due_at: null,
  estimate_minutes: 60,
  spent_minutes: 0,
  scheduled_minutes: 0,
  list_id: null,
  tag_ids: [],
  team_id: null,
  ...o,
});
/** Afternoons at 14–16 go well; mornings are average. */
const afternoon = Array.from({ length: 24 }, (_, h) =>
  h === 14 || h === 15 ? 1 : h < 12 ? -0.3 : 0,
);
const at = (r: ReturnType<typeof schedule>, id: string) =>
  r.blocks.find((b) => b.item_id === id)!.start_at.slice(11, 16);

test("demanding work moves to the hours that go well; light work doesn't", () => {
  const tasks = [
    task({
      id: "big",
      title: "Thesis chapter",
      priority: "high",
      estimate_minutes: 90,
    }),
    task({
      id: "small",
      title: "Reply to email",
      priority: "low",
      estimate_minutes: 15,
    }),
  ];
  const plain = schedule({ ...base, tasks });
  assert.equal(at(plain, "big"), "09:00", "earliest without learning");

  const smart = schedule({
    ...base,
    tasks,
    smart: {
      rhythm: afternoon,
      peak: { start_hour: 14, end_hour: 16 },
      batch: true,
    },
  });
  assert.equal(at(smart, "big"), "14:00");
  assert.ok(at(smart, "small") < "12:00", "the small task stays early");
  assert.match(
    smart.notes!.join(" "),
    /Thesis chapter is in your best hours \(14:00–16:00\)/,
  );
});

test("related tasks sit together, and a day isn't loaded past what it usually holds", () => {
  const batched = schedule({
    ...base,
    splitAfterMinutes: 60,
    tasks: [
      task({ id: "a", title: "Invoice A", list_id: "admin", priority: "high" }),
      task({ id: "x", title: "Design", list_id: "design", priority: "high" }),
      task({ id: "b", title: "Invoice B", list_id: "admin" }),
    ],
    smart: { batch: true },
  });
  const order = [...batched.blocks]
    .sort((p, q) => p.start_at.localeCompare(q.start_at))
    .map((b) => b.item_id);
  assert.ok(
    Math.abs(order.indexOf("a") - order.indexOf("b")) === 1,
    `the invoices are back to back: ${order.join(",")}`,
  );

  const three = ["2026-09-25", "2026-09-26", "2026-09-27"];
  const tasks = ["p", "q", "r"].map((id) =>
    task({ id, title: id, estimate_minutes: 90 }),
  );
  const crammed = schedule({ ...base, days: three, tasks });
  assert.equal(
    new Set(crammed.blocks.map((b) => b.start_at.slice(0, 10))).size,
    1,
    "all on the first day without a learned day size",
  );
  const spread = schedule({
    ...base,
    days: three,
    tasks,
    smart: { dayMinutes: 120 },
  });
  assert.ok(
    new Set(spread.blocks.map((b) => b.start_at.slice(0, 10))).size >= 2,
    "spread over the days",
  );
});

test("big work with little slack goes before small work due sooner", () => {
  assert.equal(slackUrgency(1000, 0), 0);
  assert.ok(slackUrgency(400, 360) > slackUrgency(400, 30));
  const days = ["2026-09-25", "2026-09-26"];
  const tasks = [
    task({
      id: "small",
      title: "Small",
      estimate_minutes: 30,
      due_at: "2026-09-25T17:00:00Z",
    }),
    task({
      id: "big",
      title: "Big",
      estimate_minutes: 600,
      due_at: "2026-09-26T17:00:00Z",
    }),
  ];
  const plain = schedule({ ...base, days, tasks });
  const smart = schedule({ ...base, days, tasks, smart: { batch: true } });
  assert.equal(at(plain, "small"), "09:00");
  assert.equal(at(smart, "big"), "09:00", "the big one can't wait");
  assert.ok(smart.at_risk.length <= plain.at_risk.length);
  // Both still make it on time.
  const small = smart.blocks.find((b) => b.item_id === "small")!;
  assert.ok(small.end_at <= "2026-09-25T17:00:00.000Z");
});

// ---- Endpoints -------------------------------------------------------------

const app = await buildApp();
let token = "";
let userId = "";
const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

before(async () => {
  await migrate();
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `learn-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "L",
    },
  });
  token = reg.json().token;
  userId = reg.json().user.id;
});
after(async () => {
  await app.close();
  await pool.end();
});

test("what the planner has learned, and switching each part off", async () => {
  const empty = (await call("GET", "/planner/learning")).json();
  assert.equal(empty.rhythm.confidence, 0);
  assert.equal(empty.load.typical_day_minutes, null);
  assert.equal(empty.rhythm.applied, true, "on by default");
  assert.equal(empty.load.applied, true);
  assert.equal(empty.estimates.applied, false, "estimates stay opt-in");

  const prefs = (
    await call("PUT", "/planner/prefs", {
      learn_rhythm: false,
      balance_load: false,
    })
  ).json();
  assert.equal(prefs.learn_rhythm, false);
  assert.equal(prefs.balance_load, false);
  const off = (await call("GET", "/planner/learning")).json();
  assert.equal(off.rhythm.applied, false);
  assert.equal(off.load.applied, false);
  await call("PUT", "/planner/prefs", {
    learn_rhythm: true,
    balance_load: true,
  });
});

test("a plan uses a learned length for a task with no estimate", async () => {
  for (const minutes of [50, 55, 60])
    await pool.query(
      `INSERT INTO items (user_id, title, kind, status, spent_minutes, updated_at)
       VALUES ($1, 'Weekly report', 'task', 'done', $2, now())`,
      [userId, minutes],
    );
  const open = (
    await call("POST", "/items", { title: "Weekly report", kind: "task" })
  ).json();
  const plan = async () =>
    (
      await call("POST", "/planner/preview", { days: 3, item_ids: [open.id] })
    ).json();
  await call("PUT", "/planner/prefs", { learn_estimates: false });
  const before = (await plan()).tasks[0];
  assert.equal(before.estimate_guess, null);
  await call("PUT", "/planner/prefs", { learn_estimates: true });
  const after = (await plan()).tasks[0];
  assert.equal(after.estimate_guess.basis, "similar");
  assert.equal(after.estimate_minutes, after.estimate_guess.minutes);
  assert.ok(after.estimate_minutes >= 50 && after.estimate_minutes <= 60);
  await call("PUT", "/planner/prefs", { learn_estimates: false });
  await call("PUT", "/items/" + open.id, {
    ...open,
    status: "cancelled",
    version: open.version,
  });
});

test("up next: what's planned now first, then what's due, with the reasons", async () => {
  // Working all day in UTC, so any time of day is inside working hours.
  await call("PUT", "/planner/prefs", {
    timezone: "UTC",
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "00:00",
    work_end: "23:55",
  });
  const now = new Date(Date.now() + 2 * 86_400_000);
  now.setUTCHours(10, 0, 0, 0);
  const make = async (body: Record<string, unknown>) =>
    (await call("POST", "/items", { kind: "task", ...body })).json();
  const planned = await make({ title: "Plan the week", estimate_minutes: 30 });
  const due = await make({
    title: "Submit the form",
    priority: "high",
    estimate_minutes: 20,
    due_at: new Date(now.getTime() + 5 * 3_600_000).toISOString(),
  });
  const slipping = await make({
    title: "Clean the inbox",
    estimate_minutes: 90,
  });
  await make({ title: "Someday idea", priority: "low" });
  const meeting = await make({
    title: "Standup",
    kind: "event",
    due_at: new Date(now.getTime() + 60 * 60_000).toISOString(),
    end_at: new Date(now.getTime() + 90 * 60_000).toISOString(),
  });
  await pool.query(
    `INSERT INTO time_blocks (item_id, user_id, start_at, end_at)
     VALUES ($1, $2, $3, $4)`,
    [
      planned.id,
      userId,
      new Date(now.getTime() - 10 * 60_000),
      new Date(now.getTime() + 20 * 60_000),
    ],
  );
  // Two past sessions for the inbox that went nowhere.
  for (const back of [1, 2])
    await pool.query(
      `INSERT INTO time_blocks (item_id, user_id, start_at, end_at)
       VALUES ($1, $2, $3, $4)`,
      [
        slipping.id,
        userId,
        new Date(now.getTime() - back * 86_400_000),
        new Date(now.getTime() - back * 86_400_000 + 3_600_000),
      ],
    );

  const next = await upNext(pool, userId, now);
  assert.ok(next.window, "free until the meeting");
  assert.ok(next.window!.minutes <= 60);
  assert.equal(next.window!.until, "Standup");

  const [first, ...rest] = next.suggestions;
  assert.equal(first.item_id, planned.id);
  assert.equal(first.planned_now, true);
  assert.match(first.reasons[0], /^Planned for now, until 10:20$/);
  assert.equal(first.minutes, 20);

  const form = rest.find((s) => s.item_id === due.id)!;
  assert.ok(form, "the high-priority form due today is suggested");
  assert.match(form.reasons.join(" | "), /Due today, 15:00/);
  assert.match(
    form.reasons.join(" | "),
    /Fits the (1 h|\d+ min) before Standup/,
  );

  const inbox = next.suggestions.find((s) => s.item_id === slipping.id);
  if (inbox) {
    assert.match(
      inbox.reasons.join(" | "),
      /Planned 2 times without getting done/,
    );
    assert.ok(inbox.minutes <= 25, "offered as a short start");
  }
  assert.ok(
    !next.suggestions.some((s) => s.item_id === meeting.id),
    "events aren't tasks",
  );

  // Over HTTP too.
  const res = await call("GET", "/planner/next");
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.json().suggestions));
});

test("the assistant can ask what to do now and what's been learned", async () => {
  const { runTool } = await import("../src/modules/ai/agent/tools.js");
  const ctx = {
    user: { id: userId, role: "member" as const },
    timezone: "UTC",
    intentText: "what should I do now?",
    actions: [],
    clarification: null,
  };
  const run = async (name: string) =>
    JSON.parse(
      (
        await runTool(
          { id: "t", name, arguments: "{}" },
          ctx as Parameters<typeof runTool>[1],
        )
      ).content,
    );
  const next = await run("up_next");
  assert.ok(Array.isArray(next.suggestions));
  assert.ok(
    next.suggestions.every((s: { reasons: string[] }) => s.reasons.length),
  );
  const patterns = await run("get_work_patterns");
  assert.match(String(patterns.best_hours), /Not enough|\d\d:00–\d\d:00/);
  assert.equal(patterns.planner_uses_best_hours, true);
});
