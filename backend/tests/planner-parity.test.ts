import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Planner parity end to end: the priority score and list orders, tuning a
 * plan before applying it (tasks in and out, estimates, pinned blocks,
 * scope, staleness), frames that repeat by rule, skip dates and count as
 * busy, the planner's daily notices, reminder times in the user's zone,
 * duplicating a block and a team's at-risk tasks.
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { largestFreeMinutes } = await import("../src/modules/planner/plans.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { scanPlanningNotices, scanConflicts } =
  await import("../src/worker/planning.js");
const { enqueue } = await import("../src/worker/scheduler.js");
const { addDays, localDateKey, dayTime, zonedParts } =
  await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.9.${Math.floor(++caller / 250)}.${caller % 250}`;

type Json = Record<string, any>;
async function call(
  token: string | null,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
) {
  const r = await app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as Json }),
  });
  return {
    status: r.statusCode,
    body: r.body ? (safeJson(r.body) as any) : null,
    raw: r,
  };
}
const safeJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

async function newUser() {
  const r = await call(null, "POST", "/auth/register", {
    email: `parity-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name: "Planner",
  });
  assert.equal(r.status, 201, r.raw.body);
  const token = r.body.token as string;
  // Everyone here works every day 9 to 5 in Melbourne, so tests don't depend on the weekday.
  await call(token, "PUT", "/planner/prefs", {
    timezone: TZ,
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "09:00",
    work_end: "17:00",
    pad_percent: 0,
    break_level: "none",
  });
  return { token, id: r.body.user.id as string };
}

async function newTeam(ownerId: string, members: string[] = []) {
  const id = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Parity crew', $1) RETURNING id",
      [ownerId],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')",
    [id, ownerId],
  );
  for (const m of members)
    await pool.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'member')",
      [id, m],
    );
  return id;
}

const day = (offset: number) => addDays(localDateKey(new Date(), TZ), offset);
/** A Melbourne wall-clock time on the day `offset` days from today. */
const local = (offset: number, hour: number, minute = 0) =>
  dayTime(day(offset), hour * 60 + minute, TZ).toISOString();
const range = (fromOffset: number, toOffset: number) =>
  `from=${encodeURIComponent(local(fromOffset, 0))}&to=${encodeURIComponent(local(toOffset, 0))}`;

async function task(token: string, data: Json) {
  const r = await call(token, "POST", "/items", { kind: "task", ...data });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}

before(async () => {
  await migrate();
  await pool
    .query("DELETE FROM system_settings WHERE key = 'smtp'")
    .catch(() => {});
  invalidateSettings();
});

after(async () => {
  await app.close();
  await pool.end();
});

test("the score's size reference skips a day with no room left for a block", async () => {
  const me = await newUser();
  const today = localDateKey(new Date(), TZ);
  // Mid-morning: the rest of the 9-to-5 day is the reference.
  const morning = await largestFreeMinutes(
    pool,
    me.id,
    dayTime(today, 10 * 60, TZ),
  );
  assert.equal(morning, 7 * 60);
  // Ten minutes before the day ends, nothing plannable fits today, so the
  // next working day is the reference instead of a 10-minute scrap.
  const lateInTheDay = await largestFreeMinutes(
    pool,
    me.id,
    dayTime(today, 16 * 60 + 50, TZ),
  );
  assert.equal(lateInTheDay, 8 * 60);
});

test("items carry a priority score and sort by it, or by due, priority, estimate, title and age", async () => {
  const me = await newUser();
  const quick = await task(me.token, {
    title: "B quick win",
    priority: "medium",
    estimate_minutes: 20,
  });
  const big = await task(me.token, {
    title: "C big job",
    priority: "medium",
    estimate_minutes: 3000,
  });
  const urgent = await task(me.token, {
    title: "A urgent",
    priority: "high",
    due_at: local(1, 12),
  });
  const event = await call(me.token, "POST", "/items", {
    title: "Z event",
    kind: "event",
    due_at: local(2, 9),
    end_at: local(2, 10),
  });

  const newest = await call(me.token, "GET", "/items");
  assert.equal(newest.status, 200);
  assert.deepEqual(
    newest.body.map((i: Json) => i.id),
    [event.body.id, urgent.id, big.id, quick.id],
  );
  const score = (id: string) =>
    newest.body.find((i: Json) => i.id === id).score;
  // An estimate that fits today's (or the next working day's) largest free
  // slot scores 0.5 more than one that doesn't.
  assert.equal(score(quick.id) - score(big.id), 0.5);
  assert.equal(score(event.body.id), null);

  const ids = async (sort: string) =>
    (await call(me.token, "GET", `/items?sort=${sort}`)).body.map(
      (i: Json) => i.id,
    );
  assert.deepEqual((await ids("score")).slice(0, 3), [
    urgent.id,
    quick.id,
    big.id,
  ]);
  assert.equal((await ids("score")).at(-1), event.body.id);
  assert.deepEqual(await ids("title"), [
    urgent.id,
    quick.id,
    big.id,
    event.body.id,
  ]);
  assert.deepEqual((await ids("due")).slice(0, 2), [urgent.id, event.body.id]);
  assert.equal((await ids("priority"))[0], urgent.id);
  assert.deepEqual((await ids("estimate")).slice(0, 2), [quick.id, big.id]);
  assert.deepEqual(await ids("created"), [
    quick.id,
    big.id,
    urgent.id,
    event.body.id,
  ]);
  // Paging a score-sorted list keeps the order.
  const page = await call(
    me.token,
    "GET",
    "/items?sort=score&limit=1&offset=1",
  );
  assert.deepEqual(
    page.body.map((i: Json) => i.id),
    [quick.id],
  );
  assert.equal((await call(me.token, "GET", "/items?sort=random")).status, 422);
});

test("plans can be tuned before they're applied: tasks in and out, estimates, pins and scope", async () => {
  const me = await newUser();
  const other = await newUser();
  const report = await task(me.token, {
    title: "Report",
    priority: "high",
    estimate_minutes: 60,
  });
  const slides = await task(me.token, {
    title: "Slides",
    priority: "medium",
    estimate_minutes: 60,
  });
  const email = await task(me.token, {
    title: "Email",
    priority: "low",
    estimate_minutes: 30,
  });
  const plan = await call(me.token, "POST", "/planner/preview", {
    start_date: day(1),
    days: 1,
    pad_percent: 0,
  });
  assert.equal(plan.status, 200, plan.raw.body);
  assert.equal(plan.body.options.start_date, day(1));
  assert.equal(plan.body.options.pad_percent, 0);
  assert.deepEqual(
    plan.body.tasks.map((t: Json) => [t.title, t.included]).sort(),
    [
      ["Email", true],
      ["Report", true],
      ["Slides", true],
    ],
  );
  const stale = await call(
    me.token,
    "GET",
    `/planner/plans/${plan.body.id}/stale`,
  );
  assert.deepEqual(stale.body, { stale: false });

  const tuned = await call(
    me.token,
    "PATCH",
    `/planner/plans/${plan.body.id}`,
    {
      exclude_item_ids: [email.id],
      estimates: { [report.id]: 90 },
      save_estimates: true,
      pinned_blocks: [
        { item_id: slides.id, start_at: local(1, 14), end_at: local(1, 15) },
      ],
      keep_free: [{ start_at: local(1, 9), end_at: local(1, 10) }],
    },
  );
  assert.equal(tuned.status, 200, tuned.raw.body);
  assert.notEqual(tuned.body.id, plan.body.id);
  const mine = (id: string) =>
    tuned.body.blocks.filter((b: Json) => b.item_id === id);
  // Slides stays where it was pinned; the report gets its new 90 minutes
  // after the time kept free; email is left out.
  assert.deepEqual(
    mine(slides.id).map((b: Json) => [b.start_at, !!b.pinned]),
    [[new Date(local(1, 14)).toISOString(), true]],
  );
  assert.deepEqual(
    mine(report.id).map((b: Json) => [b.start_at, b.end_at]),
    [
      [
        new Date(local(1, 10)).toISOString(),
        new Date(local(1, 11, 30)).toISOString(),
      ],
    ],
  );
  assert.equal(mine(email.id).length, 0);
  const row = (id: string) =>
    tuned.body.tasks.find((t: Json) => t.item_id === id);
  assert.equal(row(email.id).included, false);
  assert.match(row(email.id).reason, /Left out/);
  assert.equal(row(report.id).estimate_minutes, 90);
  assert.equal(row(report.id).estimate_tuned, true);
  assert.equal(row(slides.id).planned_minutes, 60);
  assert.deepEqual(tuned.body.estimates_saved, [report.id]);
  assert.equal(
    (await call(me.token, "GET", `/items/${report.id}`)).body.estimate_minutes,
    90,
  );

  // The old plan is replaced: it can't be applied or tuned, and it's stale.
  const old = await call(me.token, "GET", `/planner/plans/${plan.body.id}`);
  assert.equal(old.body.superseded_by, tuned.body.id);
  assert.equal(
    (await call(me.token, "POST", `/planner/plans/${plan.body.id}/apply`))
      .status,
    409,
  );
  assert.equal(
    (await call(me.token, "PATCH", `/planner/plans/${plan.body.id}`, {}))
      .status,
    409,
  );
  assert.equal(
    (await call(me.token, "GET", `/planner/plans/${plan.body.id}/stale`)).body
      .stale,
    true,
  );
  // Only the owner can tune a plan, and pins stay inside the days planned.
  assert.equal(
    (await call(other.token, "PATCH", `/planner/plans/${tuned.body.id}`, {}))
      .status,
    404,
  );
  const outside = await call(
    me.token,
    "PATCH",
    `/planner/plans/${tuned.body.id}`,
    {
      pinned_blocks: [
        { item_id: slides.id, start_at: local(3, 9), end_at: local(3, 10) },
      ],
    },
  );
  assert.equal(outside.status, 422);

  // Tuning keeps what was tuned before; putting a task back brings it in.
  const again = await call(
    me.token,
    "PATCH",
    `/planner/plans/${tuned.body.id}`,
    { exclude_item_ids: [] },
  );
  assert.equal(again.status, 200, again.raw.body);
  assert.ok(again.body.blocks.some((b: Json) => b.item_id === email.id));
  assert.ok(again.body.blocks.some((b: Json) => b.pinned));

  // A new event on the planned day makes the plan stale.
  assert.equal(
    (await call(me.token, "GET", `/planner/plans/${again.body.id}/stale`)).body
      .stale,
    false,
  );
  await call(me.token, "POST", "/items", {
    title: "Surprise meeting",
    kind: "event",
    due_at: local(1, 16),
    end_at: local(1, 17),
  });
  assert.equal(
    (await call(me.token, "GET", `/planner/plans/${again.body.id}/stale`)).body
      .stale,
    true,
  );
  const applied = await call(
    me.token,
    "POST",
    `/planner/plans/${again.body.id}/apply`,
  );
  assert.equal(applied.status, 200, applied.raw.body);

  // Scope: team tasks only leaves personal ones out.
  const team = await newTeam(other.id, [me.id]);
  const teamTask = await task(other.token, {
    title: "Team task",
    team_id: team,
    assignee_id: me.id,
    estimate_minutes: 30,
  });
  const teamOnly = await call(me.token, "POST", "/planner/preview", {
    start_date: day(2),
    days: 1,
    scope: { personal: false },
  });
  assert.equal(teamOnly.status, 200, teamOnly.raw.body);
  assert.deepEqual(
    teamOnly.body.tasks.map((t: Json) => t.item_id),
    [teamTask.id],
  );
  const noTeams = await call(me.token, "POST", "/planner/preview", {
    start_date: day(2),
    days: 1,
    scope: { team_ids: [] },
  });
  assert.ok(noTeams.body.tasks.every((t: Json) => t.item_id !== teamTask.id));
  // Including a task brings it in whatever the scope.
  const back = await call(
    me.token,
    "PATCH",
    `/planner/plans/${noTeams.body.id}`,
    { include_item_ids: [teamTask.id] },
  );
  assert.ok(back.body.tasks.some((t: Json) => t.item_id === teamTask.id));
});

test("frames repeat by rule, skip dates, and busy ones block booking and team time", async () => {
  const me = await newUser();
  const mate = await newUser();
  const bad = await call(me.token, "POST", "/planner/frames", {
    name: "Nope",
    rrule: "FREQ=HOURLY",
    start_time: "09:00",
    end_time: "10:00",
  });
  assert.equal(bad.status, 422);
  const lunch = await call(me.token, "POST", "/planner/frames", {
    name: "Lunch",
    rrule: "FREQ=DAILY",
    start_time: "12:00",
    end_time: "13:00",
    busy: true,
  });
  assert.equal(lunch.status, 201, lunch.raw.body);
  assert.deepEqual(lunch.body.days, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(lunch.body.busy, true);
  assert.equal(lunch.body.series_start, day(0));
  const monthEnd = await call(me.token, "POST", "/planner/frames", {
    name: "Month end",
    rrule: "FREQ=MONTHLY;BYMONTHDAY=-1",
    start_time: "15:00",
    end_time: "16:00",
  });
  assert.equal(monthEnd.status, 201, monthEnd.raw.body);

  const shown = async () =>
    (await call(me.token, "GET", `/calendar?${range(1, 4)}`)).body
      .frames as Json[];
  const lunches = (await shown()).filter((f) => f.frame_id === lunch.body.id);
  assert.equal(lunches.length, 3);
  assert.deepEqual(lunches[0], {
    frame_id: lunch.body.id,
    name: "Lunch",
    color: "#9ab68c",
    start_at: new Date(local(1, 12)).toISOString(),
    end_at: new Date(local(1, 13)).toISOString(),
    busy: true,
    date: day(1),
  });

  const skipped = await call(
    me.token,
    "POST",
    `/planner/frames/${lunch.body.id}/skip`,
    { date: day(1) },
  );
  assert.equal(skipped.status, 200, skipped.raw.body);
  assert.deepEqual(skipped.body.exdates, [day(1)]);
  assert.ok(
    !(await shown()).some((f) => f.date === day(1) && f.name === "Lunch"),
  );
  await call(me.token, "POST", `/planner/frames/${lunch.body.id}/unskip`, {
    date: day(1),
  });
  assert.ok(
    (await shown()).some((f) => f.date === day(1) && f.name === "Lunch"),
  );
  assert.equal(
    (
      await call(mate.token, "POST", `/planner/frames/${lunch.body.id}/skip`, {
        date: day(1),
      })
    ).status,
    404,
  );

  // Booking pages and teammates see the busy frame; free frames stay free.
  const page = await call(me.token, "POST", "/booking-pages", {
    slug: `parity-${randomUUID().slice(0, 8)}`,
    title: "Chat",
    durations: [30],
    min_notice_minutes: 0,
  });
  assert.equal(page.status, 201, page.raw.body);
  const slots = (
    await call(
      null,
      "GET",
      `/book/${page.body.slug}?duration=30&timezone=${encodeURIComponent(TZ)}&date=${day(2)}&days=1`,
    )
  ).body.slots.map((s: Json) => s.start_at);
  assert.ok(slots.includes(new Date(local(2, 11, 30)).toISOString()));
  assert.ok(!slots.includes(new Date(local(2, 12)).toISOString()));
  assert.ok(!slots.includes(new Date(local(2, 12, 30)).toISOString()));
  assert.ok(slots.includes(new Date(local(2, 13)).toISOString()));

  const team = await newTeam(mate.id, [me.id]);
  const availability = await call(
    mate.token,
    "GET",
    `/teams/${team}/availability?${range(2, 3)}`,
  );
  const busy = availability.body.find((m: Json) => m.user_id === me.id).busy;
  assert.deepEqual(busy, [
    {
      start_at: new Date(local(2, 12)).toISOString(),
      end_at: new Date(local(2, 13)).toISOString(),
    },
  ]);

  // The planner plans inside frames, never around busy ones.
  await task(me.token, { title: "Inside lunch", estimate_minutes: 30 });
  const plan = await call(me.token, "POST", "/planner/preview", {
    start_date: day(2),
    days: 1,
  });
  assert.equal(
    plan.body.blocks[0].start_at,
    new Date(local(2, 12)).toISOString(),
  );
});

test("planner notices: roll forward, at risk and due soon, once a day, on the lanes chosen", async () => {
  const me = await newUser();
  const prefs = await call(me.token, "PUT", "/planner/prefs", {
    deadline_notice_days: 1,
    planner_notices: { push: true },
  });
  assert.equal(prefs.status, 200, prefs.raw.body);
  assert.equal(prefs.body.deadline_notice_days, 1);
  assert.deepEqual(prefs.body.planner_notices, { push: true, email: false });
  await call(me.token, "POST", "/devices", {
    token: `ExponentPushToken[${randomUUID().replaceAll("-", "")}]`,
  });

  const unfinished = await task(me.token, {
    title: "Draft proposal",
    estimate_minutes: 60,
  });
  await pool.query(
    "INSERT INTO time_blocks (item_id, user_id, start_at, end_at) VALUES ($1, $2, $3, $4)",
    [unfinished.id, me.id, local(-1, 9), local(-1, 10)],
  );
  const huge = await task(me.token, {
    title: "Huge migration",
    estimate_minutes: 600,
    due_at: local(0, 11),
  });
  const soon = await task(me.token, {
    title: "Expenses",
    estimate_minutes: 15,
    due_at: local(0, 16),
  });
  const covered = await task(me.token, {
    title: "Already planned",
    estimate_minutes: 30,
    due_at: local(0, 16),
  });
  await pool.query(
    "INSERT INTO time_blocks (item_id, user_id, start_at, end_at) VALUES ($1, $2, now() + interval '1 minute', now() + interval '31 minutes')",
    [covered.id, me.id],
  );

  // Before work starts there's no roll-forward notice yet.
  await scanPlanningNotices(new Date(local(0, 8)), [me.id]);
  const early = (await call(me.token, "GET", "/notifications")).body;
  assert.ok(!early.some((n: Json) => n.kind === "rollforward"));

  const at = new Date(local(0, 10));
  await scanPlanningNotices(at, [me.id]);
  await scanPlanningNotices(at, [me.id]);
  const notices = (await call(me.token, "GET", "/notifications"))
    .body as Json[];
  const of = (kind: string) => notices.filter((n) => n.kind === kind);
  assert.equal(of("rollforward").length, 1);
  assert.equal(of("rollforward")[0].ref, day(0));
  assert.equal(of("rollforward")[0].item_id, null);
  assert.match(of("rollforward")[0].body, /Draft proposal/);
  assert.deepEqual(
    of("at_risk").map((n) => n.item_id),
    [huge.id],
  );
  assert.match(of("at_risk")[0].title, /^At risk: Huge migration/);
  assert.deepEqual(
    of("deadline").map((n) => n.item_id),
    [soon.id],
  );
  assert.match(of("deadline")[0].body, /Plan it\?/);

  // Push rows wait for the delivery lanes, one per notice.
  const push = (
    await pool.query<{ kind: string }>(
      "SELECT kind FROM notifications WHERE user_id = $1 AND channel = 'push' AND state = 'pending'",
      [me.id],
    )
  ).rows.map((r) => r.kind);
  assert.deepEqual(push.sort(), ["at_risk", "deadline", "rollforward"]);

  // With push off, the next day's notices stay in the app. Conflicts follow the same lanes.
  await call(me.token, "PUT", "/planner/prefs", {
    planner_notices: { push: false },
  });
  const block = (
    await pool.query<{ id: string }>(
      "INSERT INTO time_blocks (item_id, user_id, start_at, end_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [unfinished.id, me.id, local(2, 9), local(2, 10)],
    )
  ).rows[0];
  await call(me.token, "POST", "/items", {
    title: "Clash",
    kind: "event",
    due_at: local(2, 9),
    end_at: local(2, 10),
  });
  await scanConflicts();
  const lanes = (
    await pool.query<{ channel: string }>(
      "SELECT channel FROM notifications WHERE kind = 'conflict' AND ref = $1",
      [block.id],
    )
  ).rows.map((r) => r.channel);
  assert.deepEqual(lanes, ["inapp"]);
  // Nothing from this test is left for other tests' delivery lanes.
  await pool.query(
    "UPDATE notifications SET state = 'cancelled' WHERE user_id = $1 AND state = 'pending'",
    [me.id],
  );
});

test("reminders show the due time in the user's own time zone", async () => {
  const me = await newUser();
  const due = new Date(Date.now() + 10 * 60_000);
  due.setUTCSeconds(0, 0);
  const item = await task(me.token, {
    title: "Call the bank",
    due_at: due.toISOString(),
    reminder_minutes: 30,
  });
  await enqueue();
  const reminder = (await call(me.token, "GET", "/notifications")).body.find(
    (n: Json) => n.item_id === item.id && n.kind === "reminder",
  );
  assert.ok(reminder, "a reminder was queued");
  const p = zonedParts(due, TZ);
  const clock = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  assert.match(
    reminder.body,
    new RegExp(`, ${clock} \\(Australia/Melbourne\\)`),
  );
  assert.doesNotMatch(reminder.body, /UTC/);
});

test("a block can be duplicated at a chosen time or the next free time after it", async () => {
  const me = await newUser();
  const other = await newUser();
  const t = await task(me.token, { title: "Deep work", estimate_minutes: 120 });
  const block = await call(me.token, "POST", "/blocks", {
    item_id: t.id,
    start_at: local(1, 10),
    end_at: local(1, 11),
  });
  assert.equal(block.status, 201, block.raw.body);
  const next = await call(
    me.token,
    "POST",
    `/blocks/${block.body.id}/duplicate`,
    {},
  );
  assert.equal(next.status, 201, next.raw.body);
  assert.equal(next.body.item_id, t.id);
  assert.equal(next.body.start_at, new Date(local(1, 11)).toISOString());
  assert.equal(next.body.end_at, new Date(local(1, 12)).toISOString());
  const chosen = await call(
    me.token,
    "POST",
    `/blocks/${block.body.id}/duplicate`,
    { start_at: local(2, 14) },
  );
  assert.equal(chosen.status, 201, chosen.raw.body);
  assert.equal(chosen.body.end_at, new Date(local(2, 15)).toISOString());
  assert.equal(
    (await call(other.token, "POST", `/blocks/${block.body.id}/duplicate`, {}))
      .status,
    404,
  );
});

test("team workload lists the team's at-risk tasks", async () => {
  const lead = await newUser();
  const mate = await newUser();
  const team = await newTeam(lead.id, [mate.id]);
  const risky = await task(lead.token, {
    title: "Launch checklist",
    team_id: team,
    assignee_id: mate.id,
    estimate_minutes: 2000,
    due_at: local(1, 12),
  });
  // Due later but small: the checklist due first takes all the free time.
  const small = await task(lead.token, {
    title: "Small thing",
    team_id: team,
    assignee_id: mate.id,
    estimate_minutes: 15,
    due_at: local(3, 12),
  });
  const workload = await call(
    lead.token,
    "GET",
    `/teams/${team}/workload?${range(0, 5)}`,
  );
  assert.equal(workload.status, 200, workload.raw.body);
  const mine = workload.body.find((m: Json) => m.user_id === mate.id);
  assert.deepEqual(mine.at_risk_items, [
    {
      id: risky.id,
      title: "Launch checklist",
      assignee_id: mate.id,
      assignee_name: "Planner",
      due_at: new Date(local(1, 12)).toISOString(),
      remaining_minutes: 2000,
    },
    {
      id: small.id,
      title: "Small thing",
      assignee_id: mate.id,
      assignee_name: "Planner",
      due_at: new Date(local(3, 12)).toISOString(),
      remaining_minutes: 15,
    },
  ]);
  assert.equal(mine.at_risk, 2);
  assert.deepEqual(
    workload.body.find((m: Json) => m.user_id === lead.id).at_risk_items,
    [],
  );
});
