import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * One deadline rule, and sessions that say what they're for: "Due" means
 * the deadline (the end time for a span, the end of the day for an all-day
 * task), every session carries its task's deadline, its number among all of
 * your sessions for the task and whether it ends after the deadline, and a
 * task's sessions can be read on their own without making a plan.
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { schedule } = await import("../src/modules/planner/scheduler.js");
const { rankTasks } = await import("../src/modules/ai/agent/workspace.js");
const { upNext } = await import("../src/modules/planner/next.js");
const { scanPlanningNotices } = await import("../src/worker/planning.js");
const {
  addDays,
  buildAgenda,
  buildGlance,
  dayTime,
  deadlineLine,
  deadlineOf,
  dueBeforeToday,
  dueDate,
  dueDateOf,
  dueDayAt,
  dueLine,
  dueWhen,
  endsAfterDeadline,
  localDateKey,
  numberSessions,
  overviewItems,
  planDaysBefore,
  priorityScore,
  sessionCount,
  sessionDueFor,
  sessionLine,
} = await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.63.${Math.floor(++caller / 250)}.${caller % 250}`;

type Json = Record<string, any>;
async function call(
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  from = address(),
) {
  const r = await app.inject({
    method,
    url,
    remoteAddress: from,
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

async function newUser() {
  const r = await call(null, "POST", "/auth/register", {
    email: `due-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name: "Planner",
  });
  assert.equal(r.status, 201, r.raw.body);
  const token = r.body.token as string;
  await call(token, "PUT", "/planner/prefs", {
    timezone: TZ,
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "09:00",
    work_end: "17:00",
  });
  return { token, id: r.body.user.id as string };
}

/** A Melbourne wall-clock time on the day `offset` days from today. */
const local = (offset: number, hour: number, minute = 0) =>
  dayTime(
    addDays(localDateKey(new Date(), TZ), offset),
    hour * 60 + minute,
    TZ,
  ).toISOString();
async function newTask(token: string, data: Json) {
  const r = await call(token, "POST", "/items", { kind: "task", ...data });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}

async function session(
  token: string,
  itemId: string,
  start: string,
  minutes = 45,
) {
  const r = await call(token, "POST", "/blocks", {
    item_id: itemId,
    start_at: start,
    end_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
  });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}

/** Your sessions for one task, from `GET /blocks` over the next weeks. */
async function listed(token: string, itemId: string, from = local(-3, 0)) {
  const r = await call(
    token,
    "GET",
    `/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(local(40, 0))}`,
  );
  assert.equal(r.status, 200, r.raw.body);
  return (r.body as Json[]).filter((b) => b.item_id === itemId);
}

before(async () => {
  await migrate();
});

after(async () => {
  await app.close();
  await pool.end();
});

// ---- the rule ------------------------------------------------------------------

test("a task is due at its due time, the end of a span, or the end of an all-day date", () => {
  assert.equal(deadlineOf({ due_at: null }), null);
  assert.equal(
    deadlineOf({ due_at: "2026-10-02T07:00:00.000Z" }),
    "2026-10-02T07:00:00.000Z",
  );
  // A span is due when it ends.
  assert.equal(
    deadlineOf({
      due_at: "2026-10-02T05:00:00.000Z",
      end_at: "2026-10-02T07:00:00.000Z",
    }),
    "2026-10-02T07:00:00.000Z",
  );
  // All-day Friday 2 October in Melbourne: due at the midnight after it.
  const friday = dayTime("2026-10-02", 0, TZ).toISOString();
  const saturday = dayTime("2026-10-03", 0, TZ).toISOString();
  assert.equal(
    deadlineOf({ due_at: friday, all_day: true, timezone: TZ }),
    saturday,
  );
  // Several days: the end is already the midnight after the last one.
  const monday = dayTime("2026-10-05", 0, TZ).toISOString();
  assert.equal(
    deadlineOf({ due_at: friday, end_at: monday, all_day: true, timezone: TZ }),
    monday,
  );
  // Only what ends after the deadline is late.
  assert.equal(endsAfterDeadline(saturday, saturday), false);
  assert.equal(
    endsAfterDeadline(
      new Date(Date.parse(saturday) + 1).toISOString(),
      saturday,
    ),
    true,
  );
  assert.equal(endsAfterDeadline(saturday, null), false);
});

test("a repeating task's session is for the first occurrence it ends by", () => {
  // Every Monday and Wednesday at 5 pm UTC from Monday 5 October, but not
  // Wednesday 7 October; then every week for two more occurrences only.
  const dueFor = sessionDueFor({
    due_at: "2026-10-05T17:00:00.000Z",
    series_start: "2026-10-05T17:00:00.000Z",
    rrule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
    exdates: ["2026-10-07T17:00:00.000Z"],
    timezone: "UTC",
  });
  assert.equal(
    dueFor("2026-10-05T12:00:00Z")?.due_at,
    "2026-10-05T17:00:00.000Z",
  );
  // Exactly at the deadline still counts for it.
  assert.equal(
    dueFor("2026-10-05T17:00:00Z")?.due_at,
    "2026-10-05T17:00:00.000Z",
  );
  // After Monday's deadline: the next occurrence, skipping the removed one.
  assert.equal(
    dueFor("2026-10-06T09:00:00Z")?.due_at,
    "2026-10-12T17:00:00.000Z",
  );
  // Past the last occurrence (COUNT=4 with one removed): the last one.
  const last = dueFor("2026-11-30T09:00:00Z")!;
  assert.equal(last.due_at, "2026-10-14T17:00:00.000Z");
  assert.equal(
    endsAfterDeadline("2026-11-30T09:00:00Z", last.deadline_at),
    true,
  );
  // A one-off task has one due date whatever the session.
  const once = sessionDueFor({ due_at: "2026-10-05T17:00:00.000Z" });
  assert.equal(
    once("2027-01-01T00:00:00Z")?.deadline_at,
    "2026-10-05T17:00:00.000Z",
  );
  assert.equal(sessionDueFor({ due_at: null })("2026-10-05T00:00:00Z"), null);
});

test("sessions are numbered in time order within their task", () => {
  const s = [
    { id: "c", item_id: "a", start_at: "2026-10-03T10:00:00Z" },
    { id: "a", item_id: "a", start_at: "2026-10-01T10:00:00Z" },
    { id: "x", item_id: "b", start_at: "2026-10-02T10:00:00Z" },
    { id: "b", item_id: "a", start_at: "2026-10-01T10:00:00Z" },
  ];
  const n = numberSessions(s, (x) => x.item_id);
  assert.deepEqual(
    s.map((x) => [x.id, n.get(x)!.part, n.get(x)!.parts]),
    [
      ["c", 3, 3],
      ["a", 1, 3],
      ["x", 1, 1],
      ["b", 2, 3],
    ],
  );
});

test("a session says its number and deadline only when that helps", () => {
  const now = new Date("2026-09-28T01:00:00Z");
  const soon = "2026-10-02T07:00:00.000Z";
  const far = "2026-11-20T07:00:00.000Z";
  const base = {
    start_at: "2026-10-01T04:00:00Z",
    end_at: "2026-10-01T05:30:00Z",
  };
  // One of several sessions, due within a week.
  assert.equal(
    sessionLine(
      { ...base, part: 2, parts: 3, due_at: soon, deadline_at: soon },
      now,
    ),
    `Session 2 · due ${dueWhen(soon, false, now)}`,
  );
  // After the deadline, whatever else.
  assert.equal(
    sessionLine(
      { ...base, part: 3, parts: 3, deadline_at: soon, after_deadline: true },
      now,
    ),
    "Session 3 · after the deadline",
  );
  assert.equal(
    sessionLine(
      { ...base, part: 1, parts: 1, deadline_at: soon, after_deadline: true },
      now,
    ),
    "After the deadline",
  );
  // A single session: only when it's due soon.
  assert.match(
    sessionLine(
      { ...base, part: 1, parts: 1, due_at: soon, deadline_at: soon },
      now,
    )!,
    /^Due /,
  );
  assert.equal(
    sessionLine(
      { ...base, part: 1, parts: 1, due_at: far, deadline_at: far },
      now,
    ),
    null,
  );
  // Several sessions and no deadline.
  assert.equal(
    sessionLine({ ...base, part: 2, parts: 3 }, now),
    "Session 2 of 3",
  );
  assert.equal(
    sessionCount({ ...base, part: 2, parts: 3 }),
    "Session 2 of 3 planned",
  );
  assert.equal(sessionCount(base), null);
  assert.match(deadlineLine({ ...base, deadline_at: soon })!, /^Deadline /);
  // An all-day date reads as its own day, not the midnight after it.
  const allDayEnd = dayTime("2026-10-03", 0, TZ).toISOString();
  assert.match(
    deadlineLine({ ...base, deadline_at: allDayEnd, due_all_day: true })!,
    /^Deadline end of /,
  );
  assert.equal(deadlineLine(base), null);
});

test("a plan for one task looks ahead to its deadline, counted where the planner plans", () => {
  // 10 am Thursday 24 September in Melbourne.
  const now = new Date(dayTime("2026-09-24", 10 * 60, TZ));
  const at = (day: string, hour: number) =>
    dayTime(day, hour * 60, TZ).toISOString();
  assert.equal(planDaysBefore(null, now, TZ), undefined);
  assert.equal(planDaysBefore(at("2026-09-24", 17), now, TZ), 1);
  assert.equal(planDaysBefore(at("2026-09-26", 17), now, TZ), 3);
  // An all-day deadline (the midnight after the day) counts that day, not the next.
  assert.equal(planDaysBefore(at("2026-09-25", 0), now, TZ), 1);
  // Two weeks at most; nothing once it has passed.
  assert.equal(planDaysBefore(at("2026-12-01", 17), now, TZ), 14);
  assert.equal(planDaysBefore(at("2026-09-24", 9), now, TZ), undefined);
  // In Los Angeles it's still Wednesday, so Saturday is a day further off.
  assert.equal(planDaysBefore(at("2026-09-26", 20), now, TZ), 3);
  assert.equal(
    planDaysBefore(at("2026-09-26", 20), now, "America/Los_Angeles"),
    4,
  );
});

test("the planner treats an all-day task as due at the end of its day", () => {
  const input = (deadline_at?: string) => ({
    tasks: [
      {
        id: "report",
        title: "Report",
        priority: "medium" as const,
        status: "todo" as const,
        due_at: "2026-09-22T00:00:00.000Z",
        ...(deadline_at ? { deadline_at } : {}),
        estimate_minutes: 60,
        spent_minutes: 0,
        scheduled_minutes: 0,
        list_id: null,
        tag_ids: [],
        team_id: null,
      },
    ],
    busy: [],
    frames: [],
    useFrames: false,
    days: ["2026-09-22"],
    timezone: "UTC",
    workDays: [2],
    workStart: "09:00",
    workEnd: "17:00",
    padPercent: 0,
    split: true,
    splitAfterMinutes: 60,
    minBlockMinutes: 15,
    breakLevel: "none" as const,
    // The evening before, so its day is still ahead either way.
    now: new Date("2026-09-21T20:00:00Z"),
  });
  // Read as due at the midnight it starts, the day's time is already late…
  assert.equal(schedule(input()).at_risk.length, 1);
  // …but it's due by the end of the day, so 9 am is on time.
  const onTime = schedule(input("2026-09-23T00:00:00.000Z"));
  assert.equal(onTime.blocks.length, 1);
  assert.equal(onTime.at_risk.length, 0);
});

// ---- sessions carry what they're for -------------------------------------------

test("each session carries its deadline, its number of all your sessions and the project", async () => {
  const me = await newUser();
  const project = await call(me.token, "POST", "/projects", {
    name: "Reports",
    deadline: local(20, 17),
  });
  assert.equal(project.status, 201, project.raw.body);
  const t = await newTask(me.token, {
    title: "Quarterly report",
    due_at: local(4, 17),
    estimate_minutes: 240,
  });
  const filed = await call(me.token, "PUT", `/items/${t.id}/project`, {
    project_id: project.body.id,
  });
  assert.equal(filed.status, 200, filed.raw.body);
  const first = await session(me.token, t.id, local(-1, 9, 15));
  // The answer to POST /blocks already knows where it stands.
  assert.equal(first.part, 1);
  assert.equal(first.parts, 1);
  await session(me.token, t.id, local(2, 14), 90);
  const late = await session(me.token, t.id, local(5, 10));
  assert.equal(late.after_deadline, true);

  const all = await listed(me.token, t.id);
  assert.deepEqual(
    all.map((b) => [b.part, b.parts, b.after_deadline]),
    [
      [1, 3, false],
      [2, 3, false],
      [3, 3, true],
    ],
  );
  for (const b of all) {
    assert.equal(b.due_at, new Date(local(4, 17)).toISOString());
    assert.equal(b.deadline_at, new Date(local(4, 17)).toISOString());
    assert.equal(b.due_all_day, false);
    assert.equal(b.project_id, project.body.id);
  }
  // Numbers count sessions outside the range asked for too.
  const later = await listed(me.token, t.id, local(1, 0));
  assert.deepEqual(
    later.map((b) => `${b.part}/${b.parts}`),
    ["2/3", "3/3"],
  );
  // The calendar view says the same.
  const cal = await call(
    me.token,
    "GET",
    `/calendar?from=${encodeURIComponent(local(1, 0))}&to=${encodeURIComponent(local(8, 0))}`,
  );
  assert.equal(cal.status, 200, cal.raw.body);
  const shown = (cal.body.blocks as Json[]).filter((b) => b.item_id === t.id);
  assert.deepEqual(
    shown.map((b) => [b.part, b.parts, b.after_deadline]),
    [
      [2, 3, false],
      [3, 3, true],
    ],
  );
  // Moving the late one before the deadline makes it on time, and renumbers.
  const moved = await call(me.token, "PUT", `/blocks/${late.id}`, {
    start_at: local(1, 9),
    end_at: local(1, 9, 45),
  });
  assert.equal(moved.status, 200, moved.raw.body);
  assert.equal(moved.body.after_deadline, false);
  assert.equal(moved.body.part, 2);
  assert.equal(moved.body.parts, 3);
});

test("an all-day task's sessions on its day are on time; the next day they're late", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Tax return",
    due_at: local(3, 0),
    all_day: true,
    timezone: TZ,
  });
  const onTheDay = await session(me.token, t.id, local(3, 20));
  const dayAfter = await session(me.token, t.id, local(4, 9));
  assert.equal(onTheDay.after_deadline, false);
  const [a, b] = await listed(me.token, t.id);
  assert.equal(a.after_deadline, false);
  assert.equal(b.after_deadline, true);
  assert.equal(b.id, dayAfter.id);
  assert.equal(a.due_all_day, true);
  assert.equal(a.due_at, new Date(local(3, 0)).toISOString());
  assert.equal(a.deadline_at, new Date(local(4, 0)).toISOString());
});

test("a task with an end time is due when it ends", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Workshop prep",
    due_at: local(3, 9),
    end_at: local(3, 12),
  });
  const before = await session(me.token, t.id, local(3, 10));
  const after = await session(me.token, t.id, local(3, 12));
  assert.equal(before.after_deadline, false);
  assert.equal(after.after_deadline, true);
  assert.equal(before.deadline_at, new Date(local(3, 12)).toISOString());
});

test("a repeating task's later sessions are for its next occurrence, numbered on their own", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Practise scales",
    due_at: local(2, 17),
    rrule: "FREQ=DAILY",
    timezone: TZ,
  });
  await session(me.token, t.id, local(1, 10));
  await session(me.token, t.id, local(2, 18));
  await session(me.token, t.id, local(3, 10));
  const all = await listed(me.token, t.id);
  assert.deepEqual(
    all.map((b) => [b.due_at, b.part, b.parts, b.after_deadline]),
    [
      [new Date(local(2, 17)).toISOString(), 1, 1, false],
      [new Date(local(3, 17)).toISOString(), 1, 2, false],
      [new Date(local(3, 17)).toISOString(), 2, 2, false],
    ],
  );
});

// ---- one task's sessions ---------------------------------------------------------

test("a task's sessions can be read on their own, and reading them makes no plan", async () => {
  const me = await newUser();
  const project = await call(me.token, "POST", "/projects", {
    name: "Launch",
    deadline: local(20, 17),
  });
  const t = await newTask(me.token, {
    title: "Write the launch post",
    due_at: local(4, 17),
    estimate_minutes: 240,
  });
  await call(me.token, "PUT", `/items/${t.id}/project`, {
    project_id: project.body.id,
  });
  await session(me.token, t.id, local(-1, 9, 15));
  await session(me.token, t.id, local(2, 14), 90);
  await session(me.token, t.id, local(5, 10));
  const plans = async () =>
    Number(
      (
        await pool.query("SELECT count(*) FROM plans WHERE user_id = $1", [
          me.id,
        ])
      ).rows[0].count,
    );
  const before = await plans();
  const r = await call(me.token, "GET", `/items/${t.id}/sessions`);
  assert.equal(r.status, 200, r.raw.body);
  assert.equal(await plans(), before);
  assert.equal(r.body.item_id, t.id);
  assert.equal(r.body.deadline_at, new Date(local(4, 17)).toISOString());
  assert.equal(r.body.due_all_day, false);
  assert.equal(r.body.project_deadline, new Date(local(20, 17)).toISOString());
  // Past ones too, oldest first.
  assert.deepEqual(
    (r.body.sessions as Json[]).map((s) => `${s.part}/${s.parts}`),
    ["1/3", "2/3", "3/3"],
  );
  // Only time still to come that ends by the deadline counts as planned.
  assert.equal(r.body.planned_minutes, 90);
  assert.equal(r.body.late_minutes, 45);

  // No date: everything still to come is planned, nothing is late.
  const undated = await newTask(me.token, { title: "Someday" });
  await session(me.token, undated.id, local(2, 9), 30);
  const u = await call(me.token, "GET", `/items/${undated.id}/sessions`);
  assert.equal(u.status, 200, u.raw.body);
  assert.equal(u.body.deadline_at, null);
  assert.equal(u.body.project_deadline, null);
  assert.equal(u.body.planned_minutes, 30);
  assert.equal(u.body.late_minutes, 0);
  assert.equal(u.body.sessions[0].after_deadline, false);
});

test("a repeating task lists the sessions for its current occurrence and later", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Weekly review",
    due_at: local(2, 17),
    rrule: "FREQ=DAILY",
    timezone: TZ,
  });
  // Done last time, before the series' first due date.
  await session(me.token, t.id, local(-1, 10));
  // Finish this occurrence: it moves on to the next day.
  const current = await call(me.token, "GET", `/items/${t.id}`);
  const done = await call(me.token, "PUT", `/items/${t.id}`, {
    title: current.body.title,
    notes: current.body.notes,
    kind: "task",
    status: "done",
    priority: current.body.priority,
    due_at: current.body.due_at,
    end_at: null,
    team_id: null,
    rrule: "FREQ=DAILY",
    timezone: TZ,
    version: current.body.version,
  });
  assert.equal(done.status, 200, done.raw.body);
  const next = await session(me.token, t.id, local(3, 10));
  const r = await call(me.token, "GET", `/items/${t.id}/sessions`);
  assert.equal(r.status, 200, r.raw.body);
  assert.deepEqual(
    (r.body.sessions as Json[]).map((s) => s.id),
    [next.id],
  );
  assert.equal(r.body.deadline_at, new Date(local(3, 17)).toISOString());
  assert.equal(r.body.planned_minutes, 45);
});

test("only your own sessions, only for a task you can see", async () => {
  const me = await newUser();
  const stranger = await newUser();
  const mine = await newTask(me.token, { title: "Mine", due_at: local(3, 17) });
  await session(me.token, mine.id, local(1, 10));
  // Someone else can't read it, or tell that it exists.
  const theirs = await call(
    stranger.token,
    "GET",
    `/items/${mine.id}/sessions`,
  );
  assert.equal(theirs.status, 404);
  assert.equal(
    (await call(me.token, "GET", `/items/${randomUUID()}/sessions`)).status,
    404,
  );
  assert.equal(
    (await call(null, "GET", `/items/${mine.id}/sessions`)).status,
    401,
  );
  // A malformed id is refused before anything is read (validation: 422).
  assert.equal(
    (await call(me.token, "GET", "/items/not-an-id/sessions")).status,
    422,
  );

  // A teammate's sessions on a team task stay theirs.
  const team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Session crew', $1) RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')",
    [team, me.id, stranger.id],
  );
  const shared = await newTask(me.token, {
    title: "Shared",
    team_id: team,
    due_at: local(3, 17),
  });
  await session(me.token, shared.id, local(1, 10));
  await session(stranger.token, shared.id, local(1, 12));
  await session(stranger.token, shared.id, local(2, 12));
  const mineOnly = await call(me.token, "GET", `/items/${shared.id}/sessions`);
  assert.equal(mineOnly.status, 200, mineOnly.raw.body);
  assert.equal(mineOnly.body.sessions.length, 1);
  assert.equal(mineOnly.body.sessions[0].parts, 1);
  const theirsOnly = await call(
    stranger.token,
    "GET",
    `/items/${shared.id}/sessions`,
  );
  assert.deepEqual(
    (theirsOnly.body.sessions as Json[]).map((s) => `${s.part}/${s.parts}`),
    ["1/2", "2/2"],
  );
});

test("reading a task's sessions is rate limited like everything else", async () => {
  const me = await newUser();
  const t = await newTask(me.token, { title: "Busy" });
  const from = "10.64.0.1";
  const first = await call(
    me.token,
    "GET",
    `/items/${t.id}/sessions`,
    undefined,
    from,
  );
  assert.equal(first.status, 200);
  const limit = Number(first.raw.headers["ratelimit-limit"]);
  assert.ok(limit > 0);
  let last = first;
  for (let i = 0; i < limit && last.status !== 429; i++)
    last = await call(
      me.token,
      "GET",
      `/items/${t.id}/sessions`,
      undefined,
      from,
    );
  assert.equal(last.status, 429);
});

// ---- plans number the same way -------------------------------------------------

test("a plan numbers its sessions among those already saved, as the calendar will", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Thesis chapter",
    due_at: local(8, 17),
    estimate_minutes: 240,
  });
  await session(me.token, t.id, local(1, 9));
  const plan = await call(me.token, "POST", "/planner/preview", {
    item_ids: [t.id],
    days: 7,
    timezone: TZ,
  });
  assert.equal(plan.status, 200, plan.raw.body);
  const planned = (plan.body.blocks as Json[]).filter(
    (b) => b.item_id === t.id,
  );
  assert.ok(planned.length >= 1, plan.raw.body);
  // Every number counts the saved session too, and none is used twice.
  for (const b of planned) assert.equal(b.parts, planned.length + 1);
  assert.equal(new Set(planned.map((b) => b.part)).size, planned.length);
  const applied = await call(
    me.token,
    "POST",
    `/planner/plans/${plan.body.id}/apply`,
  );
  assert.equal(applied.status, 200, applied.raw.body);
  assert.equal(applied.body.skipped, 0);
  // Saved, each keeps the number the preview gave it.
  const saved = await listed(me.token, t.id);
  for (const b of planned) {
    const same = saved.find((s) => s.start_at === b.start_at);
    assert.ok(same, `saved ${b.start_at}`);
    assert.equal(same.part, b.part);
    assert.equal(same.parts, b.parts);
  }
  for (const b of applied.body.blocks as Json[])
    assert.equal(b.parts, planned.length + 1);
});

// ---- every "is it past the deadline?" check reads the same rule ------------------

test("priority and 'overdue' on task lists read the deadline too", () => {
  // 10 am Thursday 24 September in Melbourne.
  const now = dayTime("2026-09-24", 10 * 60, TZ);
  const at = (day: string, hour: number, minute = 0) =>
    dayTime(day, hour * 60 + minute, TZ).toISOString();
  const task = { priority: "medium" as const, status: "todo" };
  const dueAt = (due_at: string) => priorityScore({ ...task, due_at }, now);

  // An all-day task due today is due by tonight: not overdue this morning,
  // and as pressing as a task due at midnight tonight.
  const today = {
    ...task,
    due_at: at("2026-09-24", 0),
    all_day: true,
    timezone: TZ,
  };
  assert.equal(priorityScore(today, now), dueAt(at("2026-09-25", 0)));
  assert.ok(priorityScore(today, now) < dueAt(at("2026-09-24", 0)));
  // A task with an end time is due when it ends.
  const span = {
    ...task,
    due_at: at("2026-09-23", 9),
    end_at: at("2026-09-24", 17),
  };
  assert.equal(priorityScore(span, now), dueAt(at("2026-09-24", 17)));
  // A deadline the caller already worked out is used as it is.
  assert.equal(
    priorityScore(
      {
        ...task,
        due_at: at("2026-09-20", 9),
        deadline_at: at("2026-09-26", 17),
      },
      now,
    ),
    dueAt(at("2026-09-26", 17)),
  );
  // Past the deadline: the overdue weight (2) on top of full urgency (4).
  assert.equal(dueAt(at("2026-09-23", 17)) - dueAt(at("2026-10-30", 17)), 6);

  // Overdue on task lists: the deadline fell on a day before today.
  const overdue = (item: Parameters<typeof dueBeforeToday>[0]) =>
    dueBeforeToday(item, now, TZ);
  assert.equal(overdue({ due_at: null }), false);
  assert.equal(
    overdue({ due_at: at("2026-09-24", 9) }),
    false,
    "earlier today",
  );
  assert.equal(overdue({ due_at: at("2026-09-23", 23) }), true, "last night");
  assert.equal(overdue({ ...today }), false, "all-day today");
  assert.equal(
    overdue({ due_at: at("2026-09-23", 0), all_day: true, timezone: TZ }),
    true,
    "all-day yesterday",
  );
  assert.equal(
    overdue({ due_at: at("2026-09-23", 22), end_at: at("2026-09-24", 1) }),
    false,
    "ended today",
  );
  assert.equal(
    overdue({ due_at: at("2026-09-22", 22), end_at: at("2026-09-23", 23) }),
    true,
    "ended yesterday",
  );
  // Two all-day dates: due by the end of the last one.
  const days = (first: string, last: string) => ({
    due_at: at(first, 0),
    end_at: at(addDays(last, 1), 0),
    all_day: true,
    timezone: TZ,
  });
  assert.equal(overdue(days("2026-09-23", "2026-09-24")), false);
  assert.equal(overdue(days("2026-09-22", "2026-09-23")), true);
});

test("lists put a task under the day its deadline falls on", () => {
  // 10 am Thursday 24 September in Melbourne.
  const now = dayTime("2026-09-24", 10 * 60, TZ);
  const at = (day: string, hour: number) =>
    dayTime(day, hour * 60, TZ).toISOString();
  const dayOf = (d: Date | null) => d && localDateKey(d, TZ);
  const allDay = (first: string, last = first) => ({
    due_at: at(first, 0),
    end_at: at(addDays(last, 1), 0),
    all_day: true,
    timezone: TZ,
  });
  assert.equal(dueDayAt({ due_at: null }), null);
  assert.equal(dayOf(dueDayAt({ due_at: at("2026-09-24", 9) })), "2026-09-24");
  // An all-day task is listed on its day (its deadline is the midnight after).
  assert.equal(
    dayOf(
      dueDayAt({ due_at: at("2026-09-24", 0), all_day: true, timezone: TZ }),
    ),
    "2026-09-24",
  );
  // Over several days: on the last one, the day it's due by.
  assert.equal(
    dayOf(dueDayAt(allDay("2026-09-23", "2026-09-25"))),
    "2026-09-25",
  );
  // A span over midnight: the day it ends.
  const overnight = {
    due_at: at("2026-09-23", 23),
    end_at: at("2026-09-24", 1),
  };
  assert.equal(dayOf(dueDayAt(overnight)), "2026-09-24");
  // An event goes by when it starts.
  assert.equal(dayOf(dueDayAt({ ...overnight, kind: "event" })), "2026-09-23");

  // The widget glance and the daily agenda count the same way.
  type Row = Parameters<typeof buildGlance>[0][number];
  const task = (id: string, times: Json): Row =>
    ({ id, title: id, kind: "task", status: "todo", ...times }) as Row;
  const items = [
    task("all day today", allDay("2026-09-24")),
    task("three days", allDay("2026-09-23", "2026-09-25")),
    task("overnight", overnight),
    task("all day yesterday", allDay("2026-09-23")),
  ];
  const glance = buildGlance(items, { now, timeZone: TZ });
  assert.equal(glance.todayOpen, 2, "all day today and overnight");
  assert.equal(glance.overdue, 1, "all day yesterday only");

  const page = buildAgenda(items, { now, timeZone: TZ });
  const under = (heading: string) => {
    const from = page.findIndex(
      (b) => b.type === "heading" && b.text === heading,
    );
    if (from < 0) return [];
    const next = page.findIndex(
      (b, n) => n > from && b.type === "heading" && b.level === 2,
    );
    return page
      .slice(from + 1, next < 0 ? undefined : next)
      .map((b) => ("text" in b ? b.text : ""));
  };
  assert.deepEqual(under("Due today").sort(), ["all day today", "overnight"]);
  assert.deepEqual(under("Carried over"), ["all day yesterday"]);
  // Coming up names the day it's due by, not the day it starts.
  const friday = new Date(at("2026-09-25", 12)).toLocaleDateString("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  assert.deepEqual(under("Coming up"), [`${friday} · three days`]);
});

test("Overview and Today agree with the task lists about what's overdue", () => {
  // The apps' days are the device's: build the times there.
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const at = (day: string, hour: number) =>
    dayTime(day, hour * 60, zone).toISOString();
  const now = new Date(at("2026-09-24", 10));
  const item = (id: string, times: Json) =>
    ({
      id,
      title: id,
      notes: "",
      kind: "task",
      status: "todo",
      priority: "medium",
      ...times,
    }) as Parameters<typeof overviewItems>[0][number];
  const allDay = (first: string, last = first) => ({
    due_at: at(first, 0),
    end_at: at(addDays(last, 1), 0),
    all_day: true,
    timezone: zone,
  });
  const items = [
    item("all day today", allDay("2026-09-24")),
    item("three days", allDay("2026-09-23", "2026-09-25")),
    item("overnight", {
      due_at: at("2026-09-23", 23),
      end_at: at("2026-09-24", 1),
    }),
    item("all day yesterday", allDay("2026-09-23")),
    item("this morning", { due_at: at("2026-09-24", 9) }),
  ];
  const view = overviewItems(items, now);
  assert.deepEqual(
    view.overdue.map((i) => i.id),
    ["all day yesterday"],
  );
  assert.deepEqual(
    view.overdue.map((i) => i.id),
    items.filter((i) => dueBeforeToday(i, now)).map((i) => i.id),
    "the same rule as the task lists' Overdue",
  );
  assert.deepEqual(view.today.map((i) => i.id).sort(), [
    "all day today",
    "overnight",
    "this morning",
  ]);
  // Still to come on a later day, not overdue from its first day.
  assert.deepEqual(
    view.upcoming.map((i) => i.id),
    ["three days"],
  );
});

test("the task panels say when a task is due by", () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const at = (day: string, hour: number) =>
    dayTime(day, hour * 60, zone).toISOString();
  assert.equal(dueLine({ due_at: null }), null);
  assert.equal(
    dueLine({ due_at: at("2026-10-02", 17) }),
    `Due ${dueDate(at("2026-10-02", 17))}`,
  );
  // All day, as the editors save it (to the midnight after): its day.
  const oneDay = {
    due_at: at("2026-10-02", 0),
    end_at: at("2026-10-03", 0),
    all_day: true,
    timezone: zone,
  };
  assert.equal(dueLine(oneDay), `Due ${dueDate(at("2026-10-03", 0), true)}`);
  assert.equal(
    dueLine({ ...oneDay, end_at: null }),
    `Due ${dueDate(at("2026-10-03", 0), true)}`,
  );
  assert.doesNotMatch(dueLine(oneDay)!, /12:00|→/);
  // Over several days: the last one.
  const threeDays = { ...oneDay, end_at: at("2026-10-05", 0) };
  assert.equal(dueLine(threeDays), `Due ${dueDate(at("2026-10-05", 0), true)}`);
  assert.notEqual(dueLine(threeDays), dueLine(oneDay));
  // With an end time: due when it ends, and when it starts.
  const span = dueLine({
    due_at: at("2026-10-02", 15),
    end_at: at("2026-10-02", 17),
  })!;
  assert.ok(
    span.startsWith(`Due ${dueDate(at("2026-10-02", 17))} · starts `),
    span,
  );
  assert.ok(!span.includes(" · starts " + dueDate(at("2026-10-02", 15))), span);
  assert.equal(
    dueLine({ due_at: at("2026-10-01", 15), end_at: at("2026-10-02", 17) }),
    `Due ${dueDate(at("2026-10-02", 17))} · starts ${dueDate(at("2026-10-01", 15))}`,
  );

  // Planner rows: the deadline they carry, or their due time.
  assert.equal(
    dueDateOf({
      due_at: at("2026-10-02", 0),
      deadline_at: at("2026-10-03", 0),
      due_all_day: true,
    }),
    dueDate(at("2026-10-03", 0), true),
  );
  assert.equal(
    dueDateOf({ due_at: at("2026-10-02", 9) }),
    dueDate(at("2026-10-02", 9)),
  );
  assert.equal(dueDateOf({ due_at: null }), null);
  // Tasks on list lines (Tasks to place, Focus mode's lists): their own
  // deadline, never the midnight an all-day date starts or a span's start.
  assert.equal(dueDateOf(oneDay), dueDate(at("2026-10-03", 0), true));
  assert.doesNotMatch(dueDateOf(oneDay)!, /12:00/);
  assert.equal(
    dueDateOf({ ...oneDay, end_at: null }),
    dueDate(at("2026-10-03", 0), true),
  );
  assert.equal(dueDateOf(threeDays), dueDate(at("2026-10-05", 0), true));
  assert.equal(
    dueDateOf({ due_at: at("2026-10-02", 15), end_at: at("2026-10-02", 17) }),
    dueDate(at("2026-10-02", 17)),
  );
  // A row's own deadline wins over working it out again.
  assert.equal(
    dueDateOf({
      due_at: at("2026-10-02", 15),
      end_at: at("2026-10-02", 17),
      deadline_at: at("2026-10-02", 18),
    }),
    dueDate(at("2026-10-02", 18)),
  );
  // Named in a zone when given (the server writing for someone).
  assert.equal(
    dueDate(dayTime("2026-10-03", 0, TZ).toISOString(), true, TZ),
    new Date(dayTime("2026-10-02", 12 * 60, TZ)).toLocaleDateString([], {
      timeZone: TZ,
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
  );
});

test("task lists and the assistant don't call an all-day task overdue on its day", async () => {
  const me = await newUser();
  const allDay = (offset: number, title: string) =>
    newTask(me.token, {
      title,
      due_at: local(offset, 0),
      all_day: true,
      timezone: TZ,
    });
  const today = await allDay(0, "Due today");
  const yesterday = await allDay(-1, "Due yesterday");

  // The list's priority score: the overdue weight only once the day is over.
  const listed = await call(me.token, "GET", "/items?sort=score&limit=50");
  assert.equal(listed.status, 200, listed.raw.body);
  const score = (id: string) =>
    (listed.body as Json[]).find((i) => i.id === id)!.score as number;
  // medium (6) + full urgency (4) + overdue (2), and a size term of at least 0.5.
  assert.ok(score(yesterday.id) >= 12.5, `${score(yesterday.id)}`);
  assert.ok(score(today.id) < 12, `${score(today.id)}`);

  // The assistant's "what should I do first?" says the same.
  const ranked = await rankTasks(
    { user: { id: me.id, role: "member" }, timezone: TZ } as never,
    {},
  );
  const why = (id: string) => ranked.tasks.find((t) => t.id === id)!.why;
  assert.ok(why(yesterday.id).includes("overdue"), why(yesterday.id).join());
  assert.ok(!why(today.id).includes("overdue"), why(today.id).join());
  assert.ok(why(today.id).includes("due today"), why(today.id).join());
});

test("Up next says when a task is due by, not when its day or span starts", async () => {
  const me = await newUser();
  const today = await newTask(me.token, {
    title: "Renew licence",
    due_at: local(0, 0),
    all_day: true,
    timezone: TZ,
  });
  const yesterday = await newTask(me.token, {
    title: "Book venue",
    due_at: local(-1, 0),
    all_day: true,
    timezone: TZ,
  });
  const span = await newTask(me.token, {
    title: "Run workshop",
    due_at: local(1, 9),
    end_at: local(1, 17),
  });
  const next = await upNext(pool, me.id, new Date(local(0, 10)));
  const why = (id: string) =>
    next.suggestions.find((s) => s.item_id === id)?.reasons.join(" | ") ?? "";
  assert.match(why(today.id), /(^| \| )Due today($| \| )/, why(today.id));
  assert.match(why(yesterday.id), /Overdue since yesterday($| \| )/);
  assert.match(why(span.id), /Due tomorrow, 17:00/);
});

test("the welcome-back brief says an all-day task due today is due, not overdue", async () => {
  const me = await newUser();
  const today = await newTask(me.token, {
    title: "Renew licence",
    due_at: local(0, 0),
    all_day: true,
    timezone: TZ,
  });
  const late = await newTask(me.token, {
    title: "Book venue",
    due_at: local(-1, 0),
    all_day: true,
    timezone: TZ,
  });
  const beat = () =>
    call(me.token, "POST", "/presence/heartbeat", {
      device_id: "due-laptop",
      platform: "web",
    });
  await beat();
  await pool.query(
    "UPDATE reentry SET last_active_at = now() - interval '3 days' WHERE user_id = $1",
    [me.id],
  );
  await beat();
  const brief = await call(me.token, "GET", "/me/reentry");
  assert.equal(brief.status, 200, brief.raw.body);
  const line = (id: string) =>
    (brief.body.due as Json[]).find((d) => d.item_id === id)!.detail as string;
  assert.match(line(today.id), /^Due /);
  assert.match(line(late.id), /^Overdue since /);
  // Each names its day (in the task's zone), not the midnight it starts.
  assert.equal(line(today.id), `Due ${dueDate(local(1, 0), true, TZ)}`);
  assert.equal(
    line(late.id),
    `Overdue since ${dueDate(local(0, 0), true, TZ)}`,
  );
  assert.doesNotMatch(line(today.id), /12:00/);
});

test("the welcome-back brief names a task's deadline, in your zone", async () => {
  const me = await newUser();
  const span = await newTask(me.token, {
    title: "Run workshop",
    due_at: local(1, 9),
    end_at: local(1, 17),
  });
  const beat = () =>
    call(me.token, "POST", "/presence/heartbeat", {
      device_id: "due-desk",
      platform: "web",
    });
  await beat();
  await pool.query(
    "UPDATE reentry SET last_active_at = now() - interval '3 days' WHERE user_id = $1",
    [me.id],
  );
  await beat();
  const brief = await call(me.token, "GET", "/me/reentry");
  assert.equal(brief.status, 200, brief.raw.body);
  const line = (brief.body.due as Json[]).find((d) => d.item_id === span.id)!;
  // Due when it ends, named in the planner's zone.
  assert.equal(line.detail, `Due ${dueDate(local(1, 17), false, TZ)}`);
});

test("an all-day task due today with nothing planned gets its due-soon notice", async () => {
  const me = await newUser();
  const t = await newTask(me.token, {
    title: "Pay supplier",
    due_at: local(0, 0),
    all_day: true,
    timezone: TZ,
  });
  const big = await newTask(me.token, {
    title: "Stocktake",
    due_at: local(0, 0),
    all_day: true,
    timezone: TZ,
    estimate_minutes: 900,
  });
  // 10 am on its day: its deadline is tonight, so it's due soon, not past.
  await scanPlanningNotices(new Date(local(0, 10)), [me.id]);
  const notices = (await call(me.token, "GET", "/notifications"))
    .body as Json[];
  const due = notices.filter((n) => n.kind === "deadline");
  assert.deepEqual(
    due.map((n) => n.item_id),
    [t.id],
  );
  // Both name the day it's due, not the midnight it starts.
  const day = new Intl.DateTimeFormat("en-AU", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(local(0, 12)));
  assert.equal(
    due[0].body,
    `"Pay supplier" is due ${day}, and no session is planned for it yet. Plan it?`,
  );
  const risk = notices.filter((n) => n.kind === "at_risk");
  assert.deepEqual(
    risk.map((n) => n.item_id),
    [big.id],
  );
  assert.match(risk[0].body, new RegExp(`It's due ${day}\\. Plan it\\?$`));
});

test("at-risk notices, the review and plans name the deadline, not the start", async () => {
  const me = await newUser();
  // 9 am to 5 pm tomorrow, far more work than fits: due when it ends.
  const span = await newTask(me.token, {
    title: "Build the stand",
    due_at: local(1, 9),
    end_at: local(1, 17),
    estimate_minutes: 5000,
  });
  // All day tomorrow, also too much: due by the end of tomorrow.
  const allDay = await newTask(me.token, {
    title: "Pack the van",
    due_at: local(1, 0),
    all_day: true,
    timezone: TZ,
    estimate_minutes: 5000,
  });

  await scanPlanningNotices(new Date(local(0, 10)), [me.id]);
  const notices = (await call(me.token, "GET", "/notifications"))
    .body as Json[];
  const risk = (id: string) =>
    notices.find((n) => n.kind === "at_risk" && n.item_id === id)!;
  const when = new Intl.DateTimeFormat("en-AU", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(local(1, 17)));
  assert.ok(risk(span.id), JSON.stringify(notices));
  assert.match(
    risk(span.id).body,
    new RegExp(`It's due ${when}\\. Plan it\\?$`),
  );
  const day = new Intl.DateTimeFormat("en-AU", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(local(1, 12)));
  assert.match(
    risk(allDay.id).body,
    new RegExp(`It's due ${day}\\. Plan it\\?$`),
  );

  // The planner's review carries the deadline.
  const review = await call(me.token, "GET", "/planner/review");
  assert.equal(review.status, 200, review.raw.body);
  const reviewed = (id: string) =>
    (review.body.at_risk as Json[]).find((t) => t.item_id === id)!;
  assert.equal(reviewed(span.id).deadline_at, local(1, 17));
  assert.equal(reviewed(span.id).due_all_day, false);
  assert.equal(reviewed(allDay.id).deadline_at, local(2, 0));
  assert.equal(reviewed(allDay.id).due_all_day, true);

  // So do a plan's tasks, and those that didn't fit or are at risk.
  const plan = await call(me.token, "POST", "/planner/preview", {
    item_ids: [span.id, allDay.id],
    days: 2,
    timezone: TZ,
  });
  assert.equal(plan.status, 200, plan.raw.body);
  const flagged = [
    ...(plan.body.unplaced as Json[]),
    ...(plan.body.at_risk as Json[]),
  ];
  for (const [t, deadline, whole] of [
    [span, local(1, 17), false],
    [allDay, local(2, 0), true],
  ] as const) {
    const rows = flagged.filter((u) => u.item_id === t.id);
    assert.ok(rows.length, `${t.title} didn't fit: ${plan.raw.body}`);
    for (const u of rows) {
      assert.equal(u.deadline_at, deadline);
      assert.equal(u.due_all_day, whole);
    }
    const listed = (plan.body.tasks as Json[]).find((x) => x.item_id === t.id)!;
    assert.equal(listed.deadline_at, deadline);
    assert.equal(listed.due_all_day, whole);
  }
});
