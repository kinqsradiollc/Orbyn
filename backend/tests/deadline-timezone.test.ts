import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * "Deadline passed" only once the moment a task is due by has passed.
 *
 * Reported in production (account in Australia/Melbourne): a task's Sessions
 * card said "No sessions yet. Due Sun 27 Sept, 23:59 · about 8 h of work."
 * with a "Deadline passed" chip on Sunday 27 September, hours before 23:59.
 * The card named the task's own deadline, but its status was measured
 * against its planning deadline: the earlier of that and a latest date (its
 * project's deadline, 5 pm by default, or a task waiting on it). Once that
 * earlier date had gone, the task read as past its deadline. Now a latest
 * date already gone gives way to the task's own deadline (`fitDeadline`),
 * the card names the moment it measures against, in the account's zone, and
 * no working time left today is "At risk", not "Deadline passed".
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { itemSessions } = await import("../src/modules/planner/sessions.js");
const { plannedFeed } = await import("../src/modules/planner/planned.js");
const { candidateTasks } = await import("../src/modules/planner/plans.js");
const { todayForPrincipal } = await import("../src/capabilities/today.js");
const {
  addDays,
  atRiskReason,
  dayTime,
  deadlineFit,
  deadlineOf,
  dueDate,
  fitDeadline,
  localDateKey,
  sessionsDeadlineWords,
  splitSessions,
  todayDue,
} = await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.73.${Math.floor(++caller / 250)}.${caller % 250}`;

type Json = Record<string, any>;
async function call(
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
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
  let body: any = null;
  try {
    body = r.body ? JSON.parse(r.body) : null;
  } catch {
    body = r.body;
  }
  return { status: r.statusCode, body, raw: r };
}

before(async () => {
  await migrate();
});

after(async () => {
  await app.close();
  await pool.end();
});

// ---- the rule, in core ---------------------------------------------------------

/** A Melbourne wall-clock time on `day` ("YYYY-MM-DD"). */
const mel = (day: string, hour: number, minute = 0) =>
  dayTime(day, hour * 60 + minute, TZ).toISOString();
const SUNDAY = "2026-09-27";
const DUE = mel(SUNDAY, 23, 59);
const MORNING = new Date(mel(SUNDAY, 10));
const EVENING = new Date(mel(SUNDAY, 18));
const PROJECT = mel(SUNDAY, 17);
const task = (due_at: string, extra: Json = {}) => ({
  due_at,
  end_at: null,
  all_day: false,
  timezone: TZ,
  ...extra,
});

test("due 23:59 today in Melbourne: not passed in the morning, nor after work", () => {
  // The exact moment: Sunday 27 September 2026, 23:59 AEST (UTC+10).
  assert.equal(DUE, "2026-09-27T13:59:00.000Z");
  assert.equal(deadlineOf(task(DUE)), DUE);
  for (const now of [MORNING, EVENING]) {
    const fit = deadlineFit({
      deadline_at: DUE,
      needed_minutes: 480,
      planned_minutes: 0,
      estimated: true,
      now,
    });
    assert.notEqual(fit.status, "overdue");
    assert.equal(fit.status, "unplanned");
    assert.equal(fit.deadline_at, DUE);
  }
  // Seven working hours left (10:00 to 17:00) for eight hours of work.
  const morning = deadlineFit({
    deadline_at: DUE,
    needed_minutes: 480,
    planned_minutes: 0,
    free_minutes: 420,
    estimated: true,
    now: MORNING,
  });
  assert.equal(morning.status, "at_risk");
  // After work there's no working time left: at risk, told honestly.
  const evening = deadlineFit({
    deadline_at: DUE,
    needed_minutes: 480,
    planned_minutes: 0,
    free_minutes: 0,
    estimated: true,
    now: EVENING,
  });
  assert.equal(evening.status, "at_risk");
  assert.equal(evening.label, "At risk");
  assert.equal(
    atRiskReason(evening.short_minutes, 0),
    "Needs 8 h more, with no working time left before it's due.",
  );
  // A minute after 23:59 it has passed.
  const late = deadlineFit({
    deadline_at: DUE,
    needed_minutes: 480,
    planned_minutes: 0,
    now: new Date(Date.parse(DUE) + 60_000),
  });
  assert.equal(late.status, "overdue");
  assert.equal(late.label, "Deadline passed");
});

test("with a session tonight, it counts before 23:59", () => {
  const sessions = [{ start_at: mel(SUNDAY, 19), end_at: mel(SUNDAY, 21) }];
  const split = splitSessions(task(DUE), sessions, EVENING);
  assert.equal(split.planned_minutes, 120);
  assert.equal(split.late_minutes, 0);
  assert.equal(split.catch_up, false);
  const fit = deadlineFit({
    deadline_at: DUE,
    needed_minutes: 480,
    planned_minutes: split.planned_minutes,
    free_minutes: 0,
    estimated: true,
    now: EVENING,
  });
  assert.equal(fit.status, "at_risk");
  assert.equal(fit.short_minutes, 360);
});

test("a project deadline already gone gives way to the task's own", () => {
  // Before the project's 5 pm, the project's deadline sets the pace.
  assert.equal(fitDeadline(DUE, PROJECT, MORNING), PROJECT);
  // After it, the task's own 23:59 does: it hasn't passed.
  assert.equal(fitDeadline(DUE, PROJECT, EVENING), DUE);
  // Past both, its own deadline is the one that passed.
  const after = new Date(mel("2026-09-28", 0, 30));
  assert.equal(fitDeadline(DUE, PROJECT, after), DUE);
  // Without its own deadline, the latest date, passed or not.
  assert.equal(fitDeadline(null, PROJECT, EVENING), PROJECT);
  assert.equal(fitDeadline(null, null, EVENING), null);

  // The status says the same, told the task's own deadline.
  const fit = deadlineFit({
    deadline_at: PROJECT,
    task_deadline_at: DUE,
    needed_minutes: 480,
    planned_minutes: 0,
    estimated: true,
    now: EVENING,
  });
  assert.equal(fit.status, "unplanned");
  assert.equal(fit.deadline_at, DUE);
  // A session tonight counts once the project's date has gone; before it,
  // tonight is after the date being planned to.
  const sessions = [{ start_at: mel(SUNDAY, 19), end_at: mel(SUNDAY, 21) }];
  assert.equal(
    splitSessions(task(DUE), sessions, EVENING, PROJECT).planned_minutes,
    120,
  );
  const morning = splitSessions(task(DUE), sessions, MORNING, PROJECT);
  assert.equal(morning.planned_minutes, 0);
  assert.equal(morning.late_minutes, 120);
});

test("the Sessions card names the moment its status is measured against", () => {
  const own = sessionsDeadlineWords({
    deadline_at: DUE,
    due_all_day: false,
    planning_deadline_at: DUE,
    fit: { deadline_at: DUE },
    time_zone: TZ,
  });
  assert.equal(own.due, `Due ${dueDate(DUE, false, TZ)}`);
  assert.match(own.due!, /27/);
  assert.match(own.due!, /11:59|23:59/);
  assert.equal(own.sooner, null);
  assert.equal(own.by, `before ${dueDate(DUE, false, TZ)}`);
  // An earlier project deadline still ahead is named beside the due date.
  const capped = sessionsDeadlineWords({
    deadline_at: DUE,
    due_all_day: false,
    project_deadline: PROJECT,
    planning_deadline_at: PROJECT,
    fit: { deadline_at: PROJECT },
    time_zone: TZ,
  });
  assert.equal(capped.sooner, `project ends ${dueDate(PROJECT, false, TZ)}`);
  assert.equal(capped.by, `before ${dueDate(PROJECT, false, TZ)}`);
  // Named in the account's zone, whatever the device's: 13:59 UTC is 23:59
  // in Melbourne, never "1:59 pm".
  assert.match(dueDate(DUE, false, TZ), /11:59|23:59/);
  // A whole day: named as its day.
  const allDay = deadlineOf({
    due_at: mel(SUNDAY, 0),
    all_day: true,
    timezone: TZ,
  })!;
  const words = sessionsDeadlineWords({
    deadline_at: allDay,
    due_all_day: true,
    planning_deadline_at: allDay,
    time_zone: TZ,
  });
  assert.equal(words.due, `Due ${dueDate(allDay, true, TZ)}`);
  assert.match(words.due!, /27/);
  assert.equal(words.by, `by the end of ${dueDate(allDay, true, TZ)}`);
});

test("an all-day due is due at the end of its day in the task's zone", () => {
  const due = mel(SUNDAY, 0);
  const deadline = deadlineOf({ due_at: due, all_day: true, timezone: TZ })!;
  assert.equal(deadline, mel("2026-09-28", 0));
  const lateEvening = new Date(mel(SUNDAY, 23, 30));
  const fit = deadlineFit({
    deadline_at: deadline,
    needed_minutes: 60,
    planned_minutes: 0,
    estimated: true,
    now: lateEvening,
  });
  assert.notEqual(fit.status, "overdue");
  assert.equal(
    todayDue({ due_at: due, all_day: true, timezone: TZ }, lateEvening, TZ),
    "today",
  );
  // Timed 23:59 today is "today" on the Today list, not late.
  assert.equal(todayDue(task(DUE), EVENING, TZ), "today");
  assert.equal(
    todayDue(task(DUE), new Date(mel("2026-09-28", 0, 30)), TZ),
    "late",
  );
});

test("a DST day: Melbourne's clocks go forward on 4 Oct and back on 5 Apr", () => {
  // 4 October 2026: 02:00 AEST becomes 03:00 AEDT (UTC+11).
  const spring = "2026-10-04";
  const due = mel(spring, 23, 59);
  assert.equal(due, "2026-10-04T12:59:00.000Z");
  const evening = new Date(mel(spring, 22));
  assert.equal(
    deadlineFit({
      deadline_at: due,
      needed_minutes: 60,
      planned_minutes: 0,
      now: evening,
    }).status,
    "unplanned",
  );
  assert.equal(todayDue(task(due), evening, TZ), "today");
  // All day on the 4th: due at the midnight after it, in daylight time.
  const allDay = deadlineOf({
    due_at: mel(spring, 0),
    all_day: true,
    timezone: TZ,
  })!;
  assert.equal(allDay, "2026-10-04T13:00:00.000Z");
  assert.notEqual(
    deadlineFit({
      deadline_at: allDay,
      needed_minutes: 60,
      planned_minutes: 0,
      now: new Date(mel(spring, 23, 30)),
    }).status,
    "overdue",
  );
  // 5 April 2026: 03:00 AEDT becomes 02:00 AEST (UTC+10); the day is 25 h.
  const autumn = "2026-04-05";
  const autumnAllDay = deadlineOf({
    due_at: mel(autumn, 0),
    all_day: true,
    timezone: TZ,
  })!;
  assert.equal(autumnAllDay, "2026-04-05T14:00:00.000Z");
  assert.equal(mel(autumn, 23, 59), "2026-04-05T13:59:00.000Z");
  assert.equal(addDays(autumn, 1), "2026-04-06");
  assert.equal(localDateKey(new Date(autumnAllDay), TZ), "2026-04-06");
});

// ---- the server ------------------------------------------------------------------

async function newUser() {
  const r = await call(null, "POST", "/auth/register", {
    email: `tz-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name: "Melbourne",
  });
  assert.equal(r.status, 201, r.raw.body);
  const token = r.body.token as string;
  const prefs = await call(token, "PUT", "/planner/prefs", {
    timezone: TZ,
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "09:00",
    work_end: "17:00",
  });
  assert.equal(prefs.status, 200, prefs.raw.body);
  return { token, id: r.body.user.id as string };
}

async function newTask(token: string, data: Json) {
  const r = await call(token, "POST", "/items", { kind: "task", ...data });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}

async function session(
  userId: string,
  itemId: string,
  start: string,
  end: string,
) {
  await pool.query(
    `INSERT INTO time_blocks (item_id, user_id, start_at, end_at, source)
     VALUES ($1, $2, $3, $4, 'manual')`,
    [itemId, userId, start, end],
  );
}

/** A day a few days ahead, in Melbourne, so the test never depends on the clock. */
const ahead = addDays(localDateKey(new Date(), TZ), 3);

test("GET /items/:id/sessions: due 23:59, morning and evening, never 'Deadline passed'", async () => {
  const me = await newUser();
  const due = mel(ahead, 23, 59);
  const t = await newTask(me.token, {
    title: "Essay",
    due_at: due,
    estimate_minutes: 480,
  });
  const morning = await itemSessions(
    pool,
    me.id,
    t.id,
    new Date(mel(ahead, 10)),
  );
  assert.equal(morning.deadline_at, due);
  assert.equal(morning.planning_deadline_at, due);
  assert.equal(morning.fit?.deadline_at, due);
  assert.equal(morning.fit?.status, "at_risk");
  assert.equal(morning.fit?.free_minutes, 420);
  // After work: no working time left, still not passed.
  const evening = await itemSessions(
    pool,
    me.id,
    t.id,
    new Date(mel(ahead, 18)),
  );
  assert.equal(evening.fit?.status, "at_risk");
  assert.equal(evening.fit?.free_minutes, 0);
  assert.equal(
    atRiskReason(evening.fit!.short_minutes, evening.fit!.free_minutes!),
    "Needs 8 h more, with no working time left before it's due.",
  );
  // With a session tonight, it counts.
  await session(me.id, t.id, mel(ahead, 19), mel(ahead, 21));
  const planned = await itemSessions(
    pool,
    me.id,
    t.id,
    new Date(mel(ahead, 18)),
  );
  assert.equal(planned.planned_minutes, 120);
  assert.equal(planned.late_minutes, 0);
  assert.equal(planned.fit?.status, "at_risk");
  assert.equal(planned.fit?.short_minutes, 360);
  // Only after 23:59.
  const next = await itemSessions(
    pool,
    me.id,
    t.id,
    new Date(mel(addDays(ahead, 1), 0, 30)),
  );
  assert.equal(next.fit?.status, "overdue");
  // Over HTTP it names the account's zone for the apps.
  const card = await call(me.token, "GET", `/items/${t.id}/sessions`);
  assert.equal(card.status, 200, card.raw.body);
  assert.equal(card.body.time_zone, TZ);
  assert.equal(card.body.deadline_at, due);
});

test("a project deadline gone by 5 pm doesn't make a task due at 23:59 'passed'", async () => {
  const me = await newUser();
  const project = await call(me.token, "POST", "/projects", {
    name: "Assignment",
    deadline: mel(ahead, 17),
  });
  assert.equal(project.status, 201, project.raw.body);
  const due = mel(ahead, 23, 59);
  const t = await newTask(me.token, {
    title: "Final draft",
    due_at: due,
    estimate_minutes: 480,
    project_id: project.body.id,
  });
  await session(me.id, t.id, mel(ahead, 19), mel(ahead, 21));
  // In the morning the project's 5 pm sets the pace: tonight is after it.
  const morning = await itemSessions(
    pool,
    me.id,
    t.id,
    new Date(mel(ahead, 10)),
  );
  assert.equal(morning.planning_deadline_at, mel(ahead, 17));
  assert.equal(morning.fit?.deadline_at, mel(ahead, 17));
  assert.equal(morning.late_minutes, 120);
  assert.notEqual(morning.fit?.status, "overdue");
  assert.equal(
    sessionsDeadlineWords(morning).sooner,
    `project ends ${dueDate(mel(ahead, 17), false, TZ)}`,
  );
  // At 18:00 the project's date has gone; the task's own 23:59 hasn't.
  const now = new Date(mel(ahead, 18));
  const evening = await itemSessions(pool, me.id, t.id, now);
  assert.equal(evening.deadline_at, due);
  assert.equal(evening.planning_deadline_at, due);
  assert.equal(evening.fit?.deadline_at, due);
  assert.notEqual(evening.fit?.status, "overdue");
  assert.equal(evening.fit?.status, "at_risk");
  assert.equal(evening.planned_minutes, 120);
  assert.equal(evening.late_minutes, 0);
  assert.equal(sessionsDeadlineWords(evening).sooner, null);
  // Task rows (and Today) read the same status.
  const feed = await plannedFeed(pool, me.id, { item_ids: [t.id] }, now);
  assert.equal(feed.tasks[0].fit?.status, "at_risk");
  assert.equal(feed.tasks[0].fit?.deadline_at, due);
  // So does the planner, and it plans up to 23:59.
  const [row] = await candidateTasks(pool, me.id, { only: [t.id], now });
  assert.equal(row.deadline_at, due);
  assert.equal(row.scheduled_minutes, 120);
  assert.equal(row.late_minutes, 0);
});

test("a task waiting on it that is already late doesn't make it 'passed'", async () => {
  const me = await newUser();
  const due = mel(ahead, 23, 59);
  const first = await newTask(me.token, {
    title: "Collect sources",
    due_at: due,
    estimate_minutes: 120,
  });
  await newTask(me.token, {
    title: "Outline (late)",
    due_at: mel(addDays(localDateKey(new Date(), TZ), -1), 17),
    prerequisite_ids: [first.id],
  });
  const card = await call(me.token, "GET", `/items/${first.id}/sessions`);
  assert.equal(card.status, 200, card.raw.body);
  assert.equal(card.body.deadline_at, due);
  assert.equal(card.body.planning_deadline_at, due);
  assert.notEqual(card.body.fit.status, "overdue");
  assert.equal(card.body.fit.deadline_at, due);
  // 401 without a token, 404 for a task that isn't there.
  assert.equal(
    (await call(null, "GET", `/items/${first.id}/sessions`)).status,
    401,
  );
  assert.equal(
    (await call(me.token, "GET", `/items/${randomUUID()}/sessions`)).status,
    404,
  );
});

test("an all-day task: its sessions that day count, and it is due today until midnight", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Hand in",
    due_at: mel(ahead, 0),
    all_day: true,
    timezone: TZ,
    estimate_minutes: 60,
  });
  await session(me.id, t.id, mel(ahead, 10), mel(ahead, 11));
  const card = await itemSessions(pool, me.id, t.id, new Date(mel(ahead, 9)));
  assert.equal(card.deadline_at, mel(addDays(ahead, 1), 0));
  assert.equal(card.due_all_day, true);
  assert.equal(card.planned_minutes, 60);
  assert.equal(card.fit?.status, "on_track");
  const late = await itemSessions(
    pool,
    me.id,
    t.id,
    new Date(mel(ahead, 23, 30)),
  );
  assert.notEqual(late.fit?.status, "overdue");
  // The agent's Today counts that session as planned before the deadline.
  const spaces = { userId: me.id, teamIds: [], personal: true };
  const today = await todayForPrincipal(
    pool,
    { userId: me.id, spaces },
    new Date(mel(ahead, 9)),
    TZ,
  );
  const row = today.due.find((d) => d.id === `task:${t.id}`);
  assert.ok(row, JSON.stringify(today.due));
  assert.equal(row.planned_minutes, 60);
  assert.equal(row.due.at, mel(addDays(ahead, 1), 0));
});
