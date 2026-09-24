import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import nodemailer from "nodemailer";

// With a mail server set (for the unconfirmed-account check), nothing is sent.
mock.method(nodemailer, "createTransport", () => ({
  sendMail: async () => ({ messageId: "test" }),
  close: () => {},
  verify: async () => true,
}));

/**
 * Today, planned and due in one list: todayList() in core (time zones,
 * midnight, a task both planned and due today as one row with two chips,
 * late tasks, unfinished sessions), GET /today and the planned feed
 * GET /planned that puts "Planned 9:15" and status chips on task rows, with
 * their guards (401, 403, 400, 429).
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { todayFor } = await import("../src/modules/planner/today.js");
const { plannedFeed } = await import("../src/modules/planner/planned.js");
const {
  addDays,
  dayBounds,
  dayTime,
  deadlineFit,
  localDateKey,
  plannedLabel,
  plannedTodayIds,
  rowFitChip,
  sessionLine,
  sessionsOnDay,
  stillToPlan,
  stillToPlanLabel,
  todayChipText,
  todayDue,
  todayList,
  todayRowWords,
  unfinishedHeading,
  unfinishedWhen,
  dueWhen,
} = await import("@orbyn/core");
type TodayInput = Parameters<typeof todayList>[0];
type Fit = ReturnType<typeof deadlineFit>;
const app = await buildApp();

const MEL = "Australia/Melbourne";
const LA = "America/Los_Angeles";
let caller = 0;
const address = () => `10.73.${Math.floor(++caller / 250)}.${caller % 250}`;

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
    email: `today-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name: "Today",
  });
  assert.equal(r.status, 201, r.raw.body);
  const token = r.body.token as string;
  const prefs = await call(token, "PUT", "/planner/prefs", {
    timezone: MEL,
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "09:00",
    work_end: "17:00",
  });
  assert.equal(prefs.status, 200, prefs.raw.body);
  return { token, id: r.body.user.id as string };
}

async function newTeam(ownerId: string, members: string[] = []) {
  const id = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Today crew', $1) RETURNING id",
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

async function newItem(token: string, data: Json) {
  const r = await call(token, "POST", "/items", { kind: "task", ...data });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}

/** A Melbourne wall-clock time on the day `offset` days from `base`'s. */
const local = (base: Date, offset: number, hour: number, minute = 0) =>
  dayTime(
    addDays(localDateKey(base, MEL), offset),
    hour * 60 + minute,
    MEL,
  ).toISOString();
const plus = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

/** A session straight into the table (past ones too). */
async function session(
  userId: string,
  itemId: string,
  start: string,
  minutes = 60,
) {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO time_blocks (item_id, user_id, start_at, end_at, source)
       VALUES ($1, $2, $3, $4, 'manual') RETURNING id`,
      [itemId, userId, start, plus(start, minutes)],
    )
  ).rows[0].id;
}

/** Turn a configured mail server on or off (new accounts then need confirming). */
async function setMail(on: boolean) {
  if (on)
    await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ('smtp', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify({ host: "smtp.test", port: 587, from: "orbyn@test" })],
    );
  else await pool.query("DELETE FROM system_settings WHERE key='smtp'");
  invalidateSettings();
}

before(async () => {
  await migrate();
});

after(async () => {
  await setMail(false).catch(() => {});
  await app.close();
  await pool.end();
});

// ---- todayList, in core --------------------------------------------------------

/** Thu 24 Sep 2026, 12:00 in Melbourne (UTC+10); Wed 23 Sep, 19:00 in LA. */
const NOON = new Date("2026-09-24T02:00:00Z");
const mel = (hour: number, minute = 0, offset = 0) =>
  local(NOON, offset, hour, minute);

const fitOf = (
  status: Fit["status"],
  deadline: string,
  short = status === "on_track" ? 0 : 60,
): Fit => ({
  status,
  label:
    status === "unplanned"
      ? "Nothing planned"
      : status === "on_track"
        ? "On track"
        : status === "short"
          ? "Short 1h"
          : status === "late_session"
            ? "Session after the deadline"
            : status === "at_risk"
              ? "At risk"
              : status === "overdue"
                ? "Deadline passed"
                : "No deadline",
  needed_minutes: 60,
  planned_minutes: 60 - short,
  late_minutes: status === "late_session" ? 60 : 0,
  short_minutes: short,
  free_minutes: null,
  deadline_at: deadline,
});

const task = (
  id: string,
  due_at: string | null,
  extra: Partial<TodayInput["tasks"][number]> = {},
): TodayInput["tasks"][number] => ({
  id,
  title: id,
  kind: "task",
  status: "todo",
  due_at,
  timezone: MEL,
  ...extra,
});

const block = (
  id: string,
  item_id: string,
  start_at: string,
  minutes = 60,
  extra: Partial<TodayInput["sessions"][number]> = {},
): TodayInput["sessions"][number] => ({
  id,
  item_id,
  title: item_id,
  start_at,
  end_at: plus(start_at, minutes),
  status: "todo",
  ...extra,
});

const list = (x: Partial<TodayInput>) =>
  todayList({
    now: NOON,
    timezone: MEL,
    events: [],
    sessions: [],
    tasks: [],
    ...x,
  });

test("todayList: a task both planned and due today is one row with two chips", () => {
  const due = mel(17);
  const t = list({
    tasks: [task("Send invoice", due)],
    sessions: [block("s1", "Send invoice", mel(13))],
    fits: { "Send invoice": fitOf("on_track", due) },
  });
  assert.equal(t.rows.length, 1, "no separate session row");
  const row = t.rows[0];
  assert.equal(row.kind, "task");
  assert.equal(row.due, "today");
  assert.equal(row.at, mel(13), "sits at its session");
  assert.deepEqual(
    row.chips.map((c) => c.kind),
    ["planned", "due"],
  );
  assert.equal(row.action, "focus", "its session is still ahead");
  assert.match(todayChipText(row.chips[0], MEL), /^Planned (1:00\sPM|13:00)$/i);
  assert.match(todayChipText(row.chips[1], MEL), /^Due (5\sPM|17:00)$/i);
  const words = todayRowWords(row, NOON, MEL);
  assert.equal(words.lead, null);
  assert.deepEqual(
    words.chips.map((c) => c.tone),
    ["accent", "muted"],
  );

  // Not on track: its status is a third chip.
  const short = list({
    tasks: [task("Send invoice", due)],
    sessions: [block("s1", "Send invoice", mel(13))],
    fits: { "Send invoice": fitOf("short", due) },
  }).rows[0];
  assert.deepEqual(
    short.chips.map((c) => c.kind),
    ["planned", "due", "fit"],
  );
  assert.equal(todayChipText(short.chips[2]), "Short 1h");
});

test("todayList: due today with nothing planned says so and offers Plan it; on track offers nothing", () => {
  const due = mel(17);
  const [row] = list({
    tasks: [task("Pay supplier", due)],
    fits: { "Pay supplier": fitOf("unplanned", due) },
  }).rows;
  assert.equal(row.at, due, "sits at its deadline");
  assert.equal(row.action, "plan");
  const words = todayRowWords(row, NOON, MEL);
  assert.match(words.lead!, /^Due today (5\sPM|17:00)$/i);
  assert.deepEqual(words.chips, [{ text: "Nothing planned", tone: "warn" }]);

  // Planned on an earlier day and on track: just the deadline.
  const [calm] = list({
    tasks: [task("Pay supplier", due)],
    fits: { "Pay supplier": fitOf("on_track", due) },
  }).rows;
  assert.equal(calm.chips.length, 0);
  assert.equal(calm.action, null);

  // An all-day task is due today until the day is over, and sorts last.
  const allDay = list({
    tasks: [
      task("Whole day", dayTime("2026-09-24", 0, MEL).toISOString(), {
        all_day: true,
      }),
      task("Evening", mel(20)),
    ],
  });
  assert.deepEqual(
    allDay.rows.map((r) => r.title),
    ["Evening", "Whole day"],
  );
  assert.equal(todayRowWords(allDay.rows[1], NOON, MEL).lead, "Due today");
});

test("todayList: time zones decide the day", () => {
  // 07:00Z on the 24th is 17:00 in Melbourne (today there) and midnight
  // starting the 24th in LA, where it's still the 23rd: not due today.
  const tasks = [
    task("A", "2026-09-24T07:00:00.000Z"),
    // 20:00Z on the 23rd: 06:00 on the 24th in Melbourne, 13:00 on the 23rd in LA.
    task("B", "2026-09-23T20:00:00.000Z"),
  ];
  const inMel = list({ tasks });
  assert.equal(inMel.day, "2026-09-24");
  assert.deepEqual(inMel.rows.map((r) => r.title).sort(), ["A", "B"]);
  assert.ok(inMel.rows.every((r) => r.due === "today"));
  const inLa = list({ tasks, timezone: LA });
  assert.equal(inLa.day, "2026-09-23");
  assert.deepEqual(
    inLa.rows.map((r) => r.title),
    ["B"],
  );
  assert.equal(inLa.from, dayTime("2026-09-23", 0, LA).toISOString());
  assert.equal(todayDue(tasks[0], NOON, LA), null, "tomorrow in LA");
  assert.equal(todayDue(tasks[0], NOON, MEL), "today");
});

test("todayList: midnight belongs to the day it starts", () => {
  const start24 = dayTime("2026-09-24", 0, MEL).toISOString();
  const start25 = dayTime("2026-09-25", 0, MEL).toISOString();
  const allDay = task("All day", start24, { all_day: true });
  const justBefore = new Date(Date.parse(start25) - 60_000);
  assert.equal(todayDue(allDay, justBefore, MEL), "today");
  assert.equal(todayDue(allDay, new Date(start25), MEL), "late");
  // A timed deadline at the midnight that starts the day is that day's.
  assert.equal(todayDue(task("Midnight", start24), NOON, MEL), "today");

  // A session over midnight shows on both days; an event ending at
  // midnight only on the first.
  const overnight = block("night", "Deploy", mel(23), 120);
  const event = {
    item_id: "e1",
    title: "Late call",
    start_at: mel(22),
    end_at: start25,
  };
  const first = list({ sessions: [overnight], events: [event] });
  assert.deepEqual(
    first.rows.map((r) => r.kind),
    ["event", "session"],
  );
  const second = list({
    now: new Date(Date.parse(start25) + 3_600_000),
    sessions: [overnight],
    events: [event],
  });
  assert.equal(second.day, "2026-09-25");
  assert.deepEqual(
    second.rows.map((r) => r.kind),
    ["session"],
  );
});

test("todayList: events and sessions in time order, all-day first, finished ones out", () => {
  const t = list({
    events: [
      {
        item_id: "standup",
        title: "Standup",
        start_at: mel(9),
        end_at: mel(9, 30),
      },
      {
        item_id: "holiday",
        title: "Holiday",
        start_at: dayTime("2026-09-24", 0, MEL).toISOString(),
        end_at: dayTime("2026-09-25", 0, MEL).toISOString(),
        all_day: true,
      },
      {
        item_id: "gone",
        title: "Cancelled",
        start_at: mel(15),
        end_at: mel(16),
        status: "cancelled",
      },
      {
        item_id: null,
        title: "Gym",
        start_at: mel(18),
        end_at: mel(19),
        calendar: "Personal",
      },
    ],
    sessions: [
      block("s1", "Write homepage copy", mel(9, 15), 45, {
        part: 1,
        parts: 2,
        deadline_at: local(NOON, 12, 17),
      }),
      block("s2", "Done already", mel(14), 60, { status: "done" }),
      block("s3", "After lunch", mel(14), 60),
    ],
  });
  assert.deepEqual(
    t.rows.map((r) => r.title),
    ["Holiday", "Standup", "Write homepage copy", "After lunch", "Gym"],
  );
  const [holiday, standup, copy, lunch, gym] = t.rows;
  assert.equal(todayRowWords(holiday, NOON, MEL).lead, "All day");
  assert.equal(standup.past, true, "over by noon");
  assert.equal(copy.past, true);
  assert.equal(copy.action, null);
  assert.equal(lunch.action, "focus");
  assert.equal(copy.block_id, "s1");
  assert.equal(
    todayRowWords(copy, NOON, MEL).meta,
    sessionLine(
      {
        start_at: copy.start_at!,
        end_at: copy.end_at!,
        part: 1,
        parts: 2,
        deadline_at: copy.deadline_at,
      },
      NOON,
      MEL,
    ),
  );
  assert.match(todayRowWords(copy, NOON, MEL).meta!, /^Session 1 · due /);
  assert.equal(gym.item_id, null);
  assert.equal(todayRowWords(gym, NOON, MEL).meta, "Personal");
});

test("todayList: late tasks come last, latest first, capped and counted; one planned today joins its session", () => {
  const tasks = [
    task("Book venue", mel(17, 0, -2)),
    task("Older", mel(10, 0, -9)),
    task("Oldest", mel(10, 0, -30)),
    task("Catch up", mel(12, 0, -1)),
    task("Done late", mel(12, 0, -1), { status: "done" }),
  ];
  const t = list({
    tasks,
    sessions: [block("c1", "Catch up", mel(15))],
    late_limit: 2,
    fits: { "Book venue": fitOf("overdue", mel(17, 0, -2)) },
  });
  assert.equal(t.late_total, 4, "every late task is counted");
  assert.deepEqual(
    t.rows.map((r) => r.title),
    ["Catch up", "Book venue", "Older"],
  );
  const [catchUp, venue] = t.rows;
  assert.equal(catchUp.due, "late");
  assert.equal(catchUp.at, mel(15));
  assert.deepEqual(
    catchUp.chips.map((c) => c.kind),
    ["planned"],
  );
  assert.equal(catchUp.action, "focus");
  assert.equal(venue.at, null);
  assert.equal(venue.action, "plan");
  const words = todayRowWords(venue, NOON, MEL);
  assert.equal(words.lead, "Late");
  assert.equal(
    words.meta,
    `due ${dueWhen(venue.deadline_at!, false, NOON, MEL)}`,
  );
  assert.match(words.meta!, /^due Tue,? (22 Sep|Sep 22)$/);
  assert.deepEqual(words.chips, [], "no second 'deadline passed' chip");
});

test("todayList: unfinished sessions from earlier days, yesterday's first", () => {
  const t = list({
    unfinished: [
      {
        id: "u1",
        item_id: "t1",
        title: "Competitor review",
        start_at: mel(14, 0, -1),
        end_at: mel(15, 0, -1),
      },
    ],
  });
  assert.equal(t.unfinished.length, 1);
  assert.equal(t.unfinished[0].yesterday, true);
  assert.equal(unfinishedHeading(t), "Not finished yesterday");
  assert.match(unfinishedWhen(t.unfinished[0], MEL), /^(2:00\sPM|14:00)–/i);
  const older = list({
    unfinished: [
      {
        id: "u1",
        item_id: "t1",
        title: "Competitor review",
        start_at: mel(14, 0, -1),
        end_at: mel(15, 0, -1),
      },
      {
        id: "u2",
        item_id: "t2",
        title: "Survey",
        start_at: mel(9, 0, -3),
        end_at: mel(10, 0, -3),
      },
    ],
  });
  assert.equal(unfinishedHeading(older), "Not finished");
  assert.deepEqual(
    older.unfinished.map((u) => u.block_id),
    ["u1", "u2"],
  );
  assert.match(
    unfinishedWhen(older.unfinished[1], MEL),
    /^Mon,? (21 Sep|Sep 21) /,
  );
});

// ---- the planned feed's words, in core ------------------------------------------

test("planned feed words: 'Planned 9:15' for a session today, status chips within a week or after the deadline", () => {
  const p = {
    item_id: "t",
    sessions: [
      {
        id: "a",
        start_at: mel(9, 15),
        end_at: mel(10),
        after_deadline: false,
      },
      {
        id: "b",
        start_at: mel(15),
        end_at: mel(16),
        after_deadline: false,
      },
      {
        id: "c",
        start_at: mel(9, 15, 1),
        end_at: mel(10, 0, 1),
        after_deadline: false,
      },
    ],
  };
  assert.equal(sessionsOnDay(p, NOON, MEL).length, 2);
  // The next one that hasn't ended; the first once they all have.
  assert.match(plannedLabel(p, NOON, MEL)!, /^Planned (3:00\sPM|15:00)$/i);
  assert.match(
    plannedLabel(p, new Date(mel(20)), MEL)!,
    /^Planned (9:15\sAM|9:15|09:15)$/i,
  );
  assert.equal(plannedLabel({ sessions: [] }, NOON, MEL), null);
  assert.deepEqual(
    [
      ...plannedTodayIds(
        {
          tasks: [
            {
              ...p,
              next: null,
              planned_minutes: 0,
              late_minutes: 0,
              fit: null,
            },
          ],
        },
        NOON,
        MEL,
      ),
    ],
    ["t"],
  );
  assert.equal(
    plannedTodayIds(
      {
        tasks: [
          { ...p, next: null, planned_minutes: 0, late_minutes: 0, fit: null },
        ],
      },
      new Date(mel(12, 0, 3)),
      MEL,
    ).size,
    0,
  );

  const fit = (status: Fit["status"], days: number, late = 0) => ({
    ...fitOf(status, local(NOON, days, 17)),
    late_minutes: late,
  });
  assert.deepEqual(rowFitChip(fit("short", 3), NOON), {
    text: "Short 1h",
    tone: "warn",
  });
  assert.equal(rowFitChip(fit("short", 12), NOON), null, "not within a week");
  assert.equal(
    rowFitChip(fit("late_session", 12, 60), NOON)?.text,
    "Session after the deadline",
    "a session after the deadline shows whenever it is",
  );
  assert.equal(rowFitChip(fit("on_track", 2), NOON), null);
  assert.equal(rowFitChip(fit("overdue", -1), NOON), null);
  assert.equal(rowFitChip(null, NOON), null);

  assert.equal(stillToPlan({ fit: fit("short", 3) }), 60);
  assert.equal(stillToPlan({ fit: fit("on_track", 3) }), 0);
  assert.equal(stillToPlan({ fit: null }), null);
  assert.equal(stillToPlanLabel(120), "2 h still to plan");
  assert.equal(stillToPlanLabel(90), "1 h 30 min still to plan");
  assert.deepEqual(
    dayBounds(NOON, MEL).from.toISOString(),
    dayTime("2026-09-24", 0, MEL).toISOString(),
  );
});

// ---- GET /today, with the data behind it ------------------------------------------

test("todayFor: events, sessions, due and late tasks, unfinished work, only yours", async () => {
  const me = await newUser();
  const other = await newUser();
  // A fixed noon three days ahead, so nothing depends on the clock.
  const now = new Date(local(new Date(), 3, 12));
  const at = (hour: number, minute = 0, offset = 0) =>
    local(now, offset, hour, minute);

  const standup = await newItem(me.token, {
    kind: "event",
    title: "Standup",
    due_at: at(9),
    end_at: at(9, 30),
  });
  const copy = await newItem(me.token, {
    title: "Write homepage copy",
    due_at: at(17, 0, 9),
    estimate_minutes: 120,
  });
  const invoice = await newItem(me.token, {
    title: "Send invoice",
    due_at: at(17),
    estimate_minutes: 60,
  });
  const supplier = await newItem(me.token, {
    title: "Pay supplier",
    due_at: at(16),
    estimate_minutes: 30,
  });
  const venue = await newItem(me.token, {
    title: "Book venue",
    due_at: at(17, 0, -2),
  });
  const review = await newItem(me.token, {
    title: "Competitor review",
    due_at: at(17, 0, 6),
  });
  const theirs = await newItem(other.token, {
    title: "Not mine",
    due_at: at(15),
  });
  const team = await newTeam(me.id, [other.id]);
  const assignedAway = await newItem(me.token, {
    title: "Their team task",
    due_at: at(15),
    team_id: team,
    assignee_id: other.id,
  });
  const assignedToMe = await newItem(other.token, {
    title: "My team task",
    due_at: at(15),
    team_id: team,
    assignee_id: me.id,
  });

  await session(me.id, copy.id, at(9, 15), 45);
  await session(me.id, invoice.id, at(13), 60);
  // Yesterday's session for a task still open, with nothing planned since.
  const unfinished = await session(me.id, review.id, at(14, 0, -1), 60);
  // Someone else's session never shows.
  await session(other.id, supplier.id, at(14), 60).catch(() => null);

  const t = await todayFor(pool, me.id, now, MEL);
  assert.equal(t.day, localDateKey(now, MEL));
  const titles = t.rows.map((r) => r.title);
  assert.deepEqual(titles, [
    "Standup",
    "Write homepage copy",
    "Send invoice",
    "My team task",
    "Pay supplier",
    "Book venue",
  ]);
  assert.ok(!titles.includes(theirs.title));
  assert.ok(!titles.includes(assignedAway.title));
  const byTitle = new Map(t.rows.map((r) => [r.title, r]));
  assert.equal(byTitle.get("Standup")!.item_id, standup.id);
  assert.equal(byTitle.get("Write homepage copy")!.kind, "session");
  assert.equal(byTitle.get("Write homepage copy")!.part, 1);
  const inv = byTitle.get("Send invoice")!;
  assert.equal(inv.kind, "task");
  assert.deepEqual(
    inv.chips.map((c) => c.kind),
    ["planned", "due"],
    "planned and due: one row, two chips",
  );
  assert.equal(inv.action, "focus");
  const sup = byTitle.get("Pay supplier")!;
  assert.equal(sup.fit?.status, "unplanned");
  assert.equal(sup.action, "plan");
  assert.equal(byTitle.get("My team task")!.item_id, assignedToMe.id);
  const late = byTitle.get("Book venue")!;
  assert.equal(late.due, "late");
  assert.equal(late.fit?.status, "overdue");
  assert.equal(t.late_total, 1);
  assert.deepEqual(
    t.unfinished.map((u) => [u.block_id, u.yesterday]),
    [[unfinished, true]],
  );

  // Planned again for later: no longer unfinished.
  await session(me.id, review.id, at(10, 0, 1), 60);
  assert.equal((await todayFor(pool, me.id, now, MEL)).unfinished.length, 0);

  // Done: out of the list, with its sessions.
  await pool.query("UPDATE items SET status = 'done' WHERE id = $1", [
    invoice.id,
  ]);
  const after = await todayFor(pool, me.id, now, MEL);
  assert.ok(!after.rows.some((r) => r.title === "Send invoice"));
});

test("GET /today: the device's day, and its guards (401, 400, 403, 429)", async () => {
  const me = await newUser();
  const late = await newItem(me.token, {
    title: "Late one",
    due_at: local(new Date(), -3, 12),
  });
  assert.equal((await call(null, "GET", "/today")).status, 401);
  const bad = await call(me.token, "GET", "/today?timezone=Mars%2FOlympus");
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /time zone/i);

  const r = await call(me.token, "GET", "/today");
  assert.equal(r.status, 200, r.raw.body);
  assert.equal(r.body.timezone, MEL, "the planner's zone by default");
  assert.equal(r.body.day, localDateKey(new Date(), MEL));
  assert.ok(
    r.body.rows.some((x: Json) => x.item_id === late.id && x.due === "late"),
  );
  const la = await call(
    me.token,
    "GET",
    `/today?timezone=${encodeURIComponent(LA)}`,
  );
  assert.equal(la.status, 200);
  assert.equal(la.body.timezone, LA);
  assert.equal(la.body.day, localDateKey(new Date(), LA));

  // An account that hasn't confirmed its email can't read it yet.
  await setMail(true);
  try {
    const unconfirmed = await call(null, "POST", "/auth/register", {
      email: `unconfirmed-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "New",
    });
    assert.equal(unconfirmed.status, 201);
    assert.equal(
      (await call(unconfirmed.body.token, "GET", "/today")).status,
      403,
    );
    assert.equal(
      (await call(unconfirmed.body.token, "GET", "/planned")).status,
      403,
    );
  } finally {
    await setMail(false);
  }

  // Rate limited like everything else.
  const from = "10.74.0.1";
  const first = await call(me.token, "GET", "/today", undefined, from);
  const limit = Number(first.raw.headers["ratelimit-limit"]);
  assert.ok(limit > 0);
  let last = first;
  for (let i = 0; i < limit && last.status !== 429; i++)
    last = await call(me.token, "GET", "/today", undefined, from);
  assert.equal(last.status, 429);
});

// ---- GET /planned ------------------------------------------------------------------

test("plannedFeed: sessions in the window, the next one, and each task's status", async () => {
  const me = await newUser();
  const other = await newUser();
  const now = new Date(local(new Date(), 3, 12));
  const at = (hour: number, minute = 0, offset = 0) =>
    local(now, offset, hour, minute);
  const { from, to } = dayBounds(now, MEL);
  const window = { from: from.toISOString(), to: to.toISOString() };

  const today = await newItem(me.token, {
    title: "Planned today",
    due_at: at(17, 0, 2),
    estimate_minutes: 120,
  });
  const late = await newItem(me.token, {
    title: "Late session",
    due_at: at(12, 0, 1),
    estimate_minutes: 60,
  });
  const idle = await newItem(me.token, {
    title: "Nothing yet",
    due_at: at(12, 0, 2),
    estimate_minutes: 60,
  });
  const far = await newItem(me.token, { title: "No deadline" });
  const finished = await newItem(me.token, { title: "Finished" });
  const theirs = await newItem(other.token, { title: "Not mine" });
  const team = await newTeam(other.id, [me.id]);
  const teammates = await newItem(other.token, {
    title: "Teammate's",
    team_id: team,
    assignee_id: other.id,
    due_at: at(12, 0, 2),
  });

  await session(me.id, today.id, at(9, 15), 60);
  await session(me.id, today.id, at(15), 60);
  await session(me.id, late.id, at(10, 0, 2), 60);
  await session(me.id, finished.id, at(8), 30);
  await pool.query("UPDATE items SET status = 'done' WHERE id = $1", [
    finished.id,
  ]);

  const feed = await plannedFeed(pool, me.id, window, now);
  assert.equal(feed.from, window.from);
  const byId = new Map(feed.tasks.map((t) => [t.item_id, t]));
  // Open tasks of yours, and the finished one with a session in the window.
  for (const t of [today, late, idle, far, finished]) assert.ok(byId.has(t.id));
  assert.ok(!byId.has(theirs.id), "never someone else's");
  assert.ok(!byId.has(teammates.id), "a teammate's task isn't yours to plan");

  const planned = byId.get(today.id)!;
  assert.deepEqual(
    planned.sessions.map((s) => s.start_at),
    [at(9, 15), at(15)],
  );
  assert.deepEqual(planned.next, { start_at: at(15), end_at: at(16) });
  assert.equal(planned.planned_minutes, 60, "only time still to come");
  assert.equal(planned.fit?.status, "short");
  assert.match(plannedLabel(planned, now, MEL)!, /^Planned (3:00\sPM|15:00)$/i);

  const afterDeadline = byId.get(late.id)!;
  assert.equal(afterDeadline.sessions.length, 0, "not in today's window");
  assert.equal(afterDeadline.late_minutes, 60);
  assert.equal(afterDeadline.fit?.status, "late_session");
  assert.equal(
    rowFitChip(afterDeadline.fit, now)?.text,
    "Session after the deadline",
  );

  const nothing = byId.get(idle.id)!;
  assert.equal(nothing.fit?.status, "unplanned");
  assert.equal(nothing.next, null);
  assert.equal(stillToPlan(nothing), 60);
  assert.equal(byId.get(far.id)!.fit?.status, "no_deadline");
  assert.equal(byId.get(finished.id)!.fit, null, "finished: no status");
  assert.equal(byId.get(finished.id)!.sessions.length, 1);
  assert.deepEqual(
    [...plannedTodayIds(feed, now, MEL)].sort(),
    [finished.id, today.id].sort(),
  );

  // By id: any task you can see; a teammate's without a status.
  const some = await plannedFeed(
    pool,
    me.id,
    { item_ids: [teammates.id, theirs.id, today.id] },
    now,
  );
  assert.deepEqual(
    some.tasks.map((t) => t.item_id).sort(),
    [teammates.id, today.id].sort(),
  );
  assert.equal(some.tasks.find((t) => t.item_id === teammates.id)!.fit, null);
  assert.equal(some.from, null);
  assert.equal(
    some.tasks.find((t) => t.item_id === today.id)!.sessions.length,
    0,
    "no window, no session list",
  );
});

test("GET /planned: the window and ids are checked (401, 400), and it answers", async () => {
  const me = await newUser();
  const t = await newItem(me.token, {
    title: "Something",
    due_at: local(new Date(), 2, 12),
  });
  const { from, to } = dayBounds(new Date(), MEL);
  const q = (s: string) => call(me.token, "GET", `/planned${s}`);
  assert.equal((await call(null, "GET", "/planned")).status, 401);
  for (const bad of [
    "?item_ids=not-an-id",
    `?from=${encodeURIComponent(from.toISOString())}`,
    `?from=${encodeURIComponent(to.toISOString())}&to=${encodeURIComponent(from.toISOString())}`,
    "?from=yesterday&to=today",
    `?item_ids=${Array.from({ length: 201 }, () => randomUUID()).join(",")}`,
  ]) {
    const r = await q(bad);
    assert.equal(r.status, 400, `${bad}: ${r.raw.body}`);
    assert.ok(r.body.message);
  }
  const all = await q("");
  assert.equal(all.status, 200, all.raw.body);
  assert.equal(all.body.from, null);
  assert.ok(all.body.tasks.some((x: Json) => x.item_id === t.id));
  const one = await q(
    `?item_ids=${t.id}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
  );
  assert.equal(one.status, 200, one.raw.body);
  assert.deepEqual(
    one.body.tasks.map((x: Json) => x.item_id),
    [t.id],
  );
  assert.equal(one.body.from, from.toISOString());
});

test("the OpenAPI description documents both reads", async () => {
  const r = await call(null, "GET", "/openapi.yaml");
  assert.equal(r.status, 200);
  const { parse } = await import("yaml");
  const spec = parse(r.raw.body);
  for (const path of ["/today", "/planned"]) {
    assert.ok(spec.paths[path]?.get, `documents ${path}`);
    assert.ok(spec.paths[path].get.responses["400"]);
  }
  assert.ok(spec.components.schemas.TodayList);
  assert.ok(spec.components.schemas.PlannedFeed);
});
