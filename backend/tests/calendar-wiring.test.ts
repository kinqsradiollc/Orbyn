import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Subscribed calendars wired through Orbyn: each kind's defaults, busy time
 * for planning and booking, all-day events that block the day, hidden
 * calendars, calendars kept from teammates, clashes, reminders, the
 * assistant's calendar, and a feed that hasn't changed not being rewritten.
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { remindSubscribed } = await import("../src/worker/planning.js");
const { getCalendar } = await import("../src/modules/ai/agent/workspace.js");
const { addDays, localDateKey, dayTime } = await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.12.${Math.floor(++caller / 250)}.${caller % 250}`;

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
  return {
    status: r.statusCode,
    body: r.body ? (JSON.parse(r.body) as any) : null,
    raw: r,
  };
}

async function newUser(name = "Student") {
  const r = await call(null, "POST", "/auth/register", {
    email: `wire-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name,
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

const day = (offset: number) => addDays(localDateKey(new Date(), TZ), offset);
const local = (offset: number, hour: number) =>
  dayTime(day(offset), hour * 60, TZ).toISOString();
const range = (a: number, b: number) =>
  `from=${encodeURIComponent(local(a, 0))}&to=${encodeURIComponent(local(b, 0))}`;
/** "20260916T100000" in Melbourne. */
const stamp = (offset: number, hour: number) =>
  `${day(offset).replaceAll("-", "")}T${String(hour).padStart(2, "0")}0000`;

/** A timetable: a lecture at 10–12 tomorrow, and an all-day exam in 3 days. */
const timetable = (lecture = "Algorithms lecture") =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `X-WR-TIMEZONE:${TZ}`,
    "BEGIN:VEVENT",
    "UID:lecture-1",
    // Google stamps each download, so the text is never the same twice.
    "DTSTAMP:{{STAMP}}",
    `SUMMARY:${lecture}`,
    "LOCATION:Theatre 1",
    `DTSTART:${stamp(1, 10)}`,
    `DTEND:${stamp(1, 12)}`,
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:exam-1",
    "DTSTAMP:{{STAMP}}",
    "SUMMARY:Final exam",
    `DTSTART;VALUE=DATE:${day(3).replaceAll("-", "")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

let feed = timetable();
let fetches = 0;
const realFetch = globalThis.fetch;

before(async () => {
  await migrate();
  // Every subscription reads the feed above; nothing leaves the machine.
  globalThis.fetch = (async () => {
    fetches++;
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    // And lists events in a different order each time.
    let text = feed.replaceAll("{{STAMP}}", `${stamp}${fetches}`);
    if (fetches % 2) {
      const events = text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT\r\n/g) ?? [];
      text = text.replace(events.join(""), [...events].reverse().join(""));
    }
    return new Response(text, {
      status: 200,
      headers: { "content-type": "text/calendar" },
    });
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await app.close();
  await pool.end();
});

async function subscribe(token: string, extra: Json = {}) {
  const r = await call(token, "POST", "/me/calendar-subscriptions", {
    url: `https://93.184.216.34/${randomUUID()}.ics`,
    name: "Uni",
    ...extra,
  });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}
async function busy(token: string, userId: string, a = 0, b = 5) {
  const r = await call(
    token,
    "GET",
    `/availability?user_ids=${userId}&${range(a, b)}`,
  );
  assert.equal(r.status, 200, r.raw.body);
  return r.body[0]?.busy as Json[];
}

test("each kind starts with its own defaults, and they can be changed", async () => {
  const me = await newUser();
  const classes = await subscribe(me.token, { kind: "classes" });
  assert.equal(classes.kind, "classes");
  assert.equal(classes.busy, true);
  assert.equal(classes.all_day_busy, false);
  assert.equal(classes.visible, true);
  assert.equal(classes.sharing, "busy");
  assert.equal(classes.reminder_minutes, null);
  // Fetched as it's added.
  assert.equal(classes.event_count, 2);

  const exams = await subscribe(me.token, { kind: "exams" });
  assert.equal(exams.all_day_busy, true);
  assert.equal(exams.reminder_minutes, 1440);
  const holidays = await subscribe(me.token, { kind: "holidays" });
  assert.equal(holidays.busy, false);
  // Anything given explicitly beats the kind's default.
  const quiet = await subscribe(me.token, {
    kind: "meetings",
    reminder_minutes: null,
  });
  assert.equal(quiet.reminder_minutes, null);

  const changed = await call(
    me.token,
    "PUT",
    `/me/calendar-subscriptions/${classes.id}`,
    { kind: "work", reminder_minutes: 15, sharing: "hidden" },
  );
  assert.equal(changed.status, 200, changed.raw.body);
  assert.equal(changed.body.kind, "work");
  assert.equal(changed.body.reminder_minutes, 15);
  assert.equal(changed.body.sharing, "hidden");
});

test("a class is busy by default; an all-day exam blocks its day only when asked", async () => {
  const me = await newUser();
  const sub = await subscribe(me.token, { kind: "classes" });
  const lecture = { start_at: local(1, 10), end_at: local(1, 12) };
  assert.deepEqual(await busy(me.token, me.id), [lecture]);

  // Exams: the all-day exam blocks the whole day.
  await call(me.token, "PUT", `/me/calendar-subscriptions/${sub.id}`, {
    all_day_busy: true,
  });
  assert.deepEqual(await busy(me.token, me.id), [
    lecture,
    { start_at: local(3, 0), end_at: local(4, 0) },
  ]);

  // Not busy at all: nothing counts.
  await call(me.token, "PUT", `/me/calendar-subscriptions/${sub.id}`, {
    busy: false,
  });
  assert.deepEqual(await busy(me.token, me.id), []);
});

test("a hidden calendar leaves the calendar but still counts as busy", async () => {
  const me = await newUser();
  const sub = await subscribe(me.token, { kind: "classes" });
  const shown = async () =>
    (await call(me.token, "GET", `/calendar?${range(0, 5)}`)).body.external
      .length as number;
  assert.equal(await shown(), 2);
  await call(me.token, "PUT", `/me/calendar-subscriptions/${sub.id}`, {
    visible: false,
  });
  assert.equal(await shown(), 0);
  assert.equal((await busy(me.token, me.id)).length, 1);
});

test("teammates see a calendar's busy time only when it's shared", async () => {
  const me = await newUser();
  const mate = await newUser("Mate");
  const team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Study group', $1) RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')",
    [team, me.id, mate.id],
  );
  const sub = await subscribe(me.token, { kind: "classes" });
  assert.equal((await busy(mate.token, me.id)).length, 1);
  await call(me.token, "PUT", `/me/calendar-subscriptions/${sub.id}`, {
    sharing: "hidden",
  });
  assert.equal((await busy(mate.token, me.id)).length, 0);
  // You still plan around it yourself.
  assert.equal((await busy(me.token, me.id)).length, 1);
});

test("time set aside on top of a class shows as a clash", async () => {
  const me = await newUser();
  await subscribe(me.token, { kind: "classes", name: "Uni timetable" });
  const task = await call(me.token, "POST", "/items", {
    title: "Write essay",
    kind: "task",
  });
  const block = await call(me.token, "POST", "/blocks", {
    item_id: task.body.id,
    start_at: local(1, 11),
    end_at: local(1, 13),
  });
  assert.equal(block.status, 201, block.raw.body);
  const review = await call(me.token, "GET", "/planner/review");
  assert.equal(review.status, 200, review.raw.body);
  const clash = review.body.conflicts.find(
    (c: Json) => c.block.id === block.body.id,
  );
  assert.ok(clash, "the block clashes with the lecture");
  assert.equal(clash.entry.title, "Algorithms lecture");
  assert.equal(clash.entry.source, "subscription");
  assert.equal(clash.entry.calendar, "Uni timetable");
});

test("an unchanged feed isn't rewritten; a changed one is", async () => {
  const me = await newUser();
  const sub = await subscribe(me.token, { kind: "classes" });
  const ids = async () =>
    (
      await pool.query<{ id: string }>(
        "SELECT id FROM external_events WHERE subscription_id = $1 ORDER BY uid",
        [sub.id],
      )
    ).rows.map((r) => r.id);
  const first = await ids();
  const refresh = () =>
    call(me.token, "POST", `/me/calendar-subscriptions/${sub.id}/refresh`);
  await refresh();
  assert.deepEqual(await ids(), first);
  feed = timetable("Algorithms lecture (moved)");
  try {
    await refresh();
    assert.notDeepEqual(await ids(), first);
    const titles = (
      await call(me.token, "GET", `/calendar?${range(0, 5)}`)
    ).body.external.map((e: Json) => e.title);
    assert.ok(titles.includes("Algorithms lecture (moved)"));
  } finally {
    feed = timetable();
  }
});

test("reminders go once, at the time asked for", async () => {
  const me = await newUser();
  const sub = await subscribe(me.token, {
    kind: "classes",
    reminder_minutes: 30,
  });
  const lecture = new Date(local(1, 10));
  const notices = async () =>
    (
      await pool.query<{ title: string; body: string }>(
        "SELECT title, body FROM notifications WHERE user_id = $1 AND kind = 'calendar' AND channel = 'inapp'",
        [me.id],
      )
    ).rows;
  // Too early: nothing.
  await remindSubscribed(new Date(lecture.getTime() - 60 * 60_000));
  assert.equal((await notices()).length, 0);
  // Thirty minutes before: once, however often the worker looks.
  const due = new Date(lecture.getTime() - 30 * 60_000);
  await remindSubscribed(due);
  await remindSubscribed(new Date(due.getTime() + 60_000));
  const sent = await notices();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, "Algorithms lecture");
  assert.match(sent[0].body, /Theatre 1/);
  assert.match(sent[0].body, /Uni/);
  assert.ok(sub.id);
});

test("the assistant reads subscribed events, marked read only", async () => {
  const me = await newUser();
  await subscribe(me.token, { kind: "classes", name: "Uni timetable" });
  const result = await getCalendar(
    {
      user: { id: me.id, name: "Student", role: "member" },
      timezone: TZ,
    } as never,
    { start_date: day(1), days: 3 },
  );
  const lecture = result.events.find(
    (e: Json) => e.title === "Algorithms lecture",
  );
  assert.ok(lecture);
  assert.match(lecture.from, /Uni timetable/);
  assert.match(lecture.from, /read only/);
  assert.equal(lecture.location, "Theatre 1");
  assert.ok(result.events.some((e: Json) => e.title === "Final exam"));
  assert.ok(fetches > 0);
});
