import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Lists and tags, repeating items, the calendar, time blocks and the planner,
 * team time, booking pages, API keys, webhooks and the calendar feed, end to
 * end against the test database.
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { scanConflicts } = await import("../src/worker/planning.js");
const { addDays, localDateKey, dayTime } = await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.5.${Math.floor(++caller / 250)}.${caller % 250}`;

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
    email: `plan-${randomUUID()}@example.com`,
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
      "INSERT INTO teams (name, created_by) VALUES ('Launch crew', $1) RETURNING id",
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

const item = (data: Json) => ({ kind: "task", ...data });
/** The full body PUT /items/:id takes, without the planning fields. */
const baseBody = (i: Json) => ({
  title: i.title,
  notes: i.notes,
  kind: i.kind,
  status: i.status,
  priority: i.priority,
  due_at: i.due_at,
  end_at: i.end_at,
  reminder_minutes: i.reminder_minutes,
  team_id: i.team_id,
  version: i.version,
});
/** A Melbourne wall-clock time on the day `offset` days from today. */
const local = (offset: number, hour: number, minute = 0) =>
  dayTime(
    addDays(localDateKey(new Date(), TZ), offset),
    hour * 60 + minute,
    TZ,
  ).toISOString();

before(async () => {
  await migrate();
  // Booking tests confirm straight away only when no SMTP server is set.
  await pool
    .query("DELETE FROM system_settings WHERE key = 'smtp'")
    .catch(() => {});
  invalidateSettings();
});

after(async () => {
  await app.close();
  await pool.end();
});

test("lists and tags stay with the items they belong to", async () => {
  const me = await newUser();
  const teamId = await newTeam(me.id);
  const home = await call(me.token, "POST", "/lists", { name: "Home" });
  assert.equal(home.status, 201);
  const launch = await call(me.token, "POST", "/lists", {
    name: "Launch",
    team_id: teamId,
  });
  assert.equal(launch.body.team_name, "Launch crew");
  const tag = await call(me.token, "POST", "/tags", { name: "writing" });
  assert.equal(tag.status, 201);
  assert.equal(
    (await call(me.token, "POST", "/tags", { name: "Writing" })).status,
    409,
  );

  const created = await call(
    me.token,
    "POST",
    "/items",
    item({
      title: "Draft the newsletter",
      list_id: home.body.id,
      tag_ids: [tag.body.id],
      estimate_minutes: 45,
    }),
  );
  assert.equal(created.status, 201, created.raw.body);
  assert.deepEqual(created.body.tag_ids, [tag.body.id]);
  assert.equal(created.body.estimate_minutes, 45);
  // A personal item can't go in a team's list.
  const wrong = await call(
    me.token,
    "POST",
    "/items",
    item({ title: "Wrong list", list_id: launch.body.id }),
  );
  assert.equal(wrong.status, 422);

  const byList = await call(me.token, "GET", `/items?list_id=${home.body.id}`);
  assert.deepEqual(
    byList.body.map((i: Json) => i.id),
    [created.body.id],
  );
  const byTag = await call(
    me.token,
    "GET",
    `/items?tag_id=${tag.body.id}&q=newsletter`,
  );
  assert.equal(byTag.body.length, 1);
  assert.equal(
    (await call(me.token, "GET", "/items?q=nothing-matches")).body.length,
    0,
  );

  // An edit without the planning fields keeps them.
  const edited = await call(me.token, "PUT", `/items/${created.body.id}`, {
    ...baseBody(created.body),
    title: "Draft the October newsletter",
  });
  assert.equal(edited.status, 200, edited.raw.body);
  assert.equal(edited.body.list_id, home.body.id);
  assert.deepEqual(edited.body.tag_ids, [tag.body.id]);
  assert.equal(edited.body.estimate_minutes, 45);

  // Deleting the list keeps the item.
  assert.equal(
    (await call(me.token, "DELETE", `/lists/${home.body.id}`)).status,
    204,
  );
  const after = await call(me.token, "GET", `/items/${created.body.id}`);
  assert.equal(after.body.list_id, null);
});

test("completing a repeating task moves it to the next occurrence", async () => {
  const me = await newUser();
  const created = await call(
    me.token,
    "POST",
    "/items",
    item({
      title: "Water the plants",
      due_at: "2026-09-21T09:00:00+10:00", // Monday
      rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
      timezone: TZ,
    }),
  );
  assert.equal(created.status, 201, created.raw.body);
  const done = await call(me.token, "PUT", `/items/${created.body.id}`, {
    ...baseBody(created.body),
    status: "done",
  });
  assert.equal(done.status, 200, done.raw.body);
  assert.equal(done.body.status, "todo");
  assert.equal(
    new Date(done.body.due_at).toISOString(),
    "2026-09-22T23:00:00.000Z",
  );
  const detail = await call(me.token, "GET", `/items/${created.body.id}`);
  assert.match(
    detail.body.updates[0].body,
    /Completed the occurrence due 2026-09-2/,
  );
});

test("the calendar shows every occurrence, with buffers and travel", async () => {
  const me = await newUser();
  await call(me.token, "PUT", "/planner/prefs", {
    buffer_after_minutes: 10,
    default_travel_minutes: 20,
  });
  const place = await call(me.token, "POST", "/planner/places", {
    label: "Office",
    match: "Collins St",
    travel_minutes: 25,
  });
  assert.equal(place.status, 201);
  const event = await call(
    me.token,
    "POST",
    "/items",
    item({
      title: "Team sync",
      kind: "event",
      due_at: "2026-09-22T10:00:00+10:00",
      end_at: "2026-09-22T11:00:00+10:00",
      rrule: "FREQ=WEEKLY;COUNT=3",
      timezone: TZ,
      location: "Level 2, 101 Collins St",
    }),
  );
  assert.equal(event.status, 201, event.raw.body);
  const view = await call(
    me.token,
    "GET",
    `/calendar?from=${encodeURIComponent("2026-09-21T00:00:00+10:00")}&to=${encodeURIComponent("2026-10-19T00:00:00+11:00")}`,
  );
  assert.equal(view.status, 200, view.raw.body);
  const sync = view.body.entries.filter(
    (e: Json) => e.item_id === event.body.id,
  );
  // 10:00 local every week, even after daylight saving starts on 4 October.
  assert.deepEqual(
    sync.map((e: Json) => e.start_at),
    [
      "2026-09-22T00:00:00.000Z",
      "2026-09-29T00:00:00.000Z",
      "2026-10-05T23:00:00.000Z",
    ],
  );
  const derived = view.body.derived.filter(
    (d: Json) => d.item_id === event.body.id,
  );
  const first = derived.filter((d: Json) => d.start_at.startsWith("2026-09-2"));
  assert.ok(
    first.some(
      (d: Json) =>
        d.label === "Travel to Office" &&
        d.end_at === "2026-09-22T00:00:00.000Z",
    ),
  );
  assert.ok(
    first.some(
      (d: Json) =>
        d.kind === "buffer" && d.start_at === "2026-09-22T01:00:00.000Z",
    ),
  );
  assert.ok(first.some((d: Json) => d.label === "Travel back"));
  // A range longer than 62 days is refused.
  const tooLong = await call(
    me.token,
    "GET",
    `/calendar?from=${encodeURIComponent("2026-01-01T00:00:00Z")}&to=${encodeURIComponent("2026-06-01T00:00:00Z")}`,
  );
  assert.equal(tooLong.status, 422);
});

test("plans place tasks around events, apply once, and conflicts can be rescheduled", async () => {
  const me = await newUser();
  await call(me.token, "PUT", "/planner/prefs", {
    split_after_minutes: 60,
    min_block_minutes: 25,
  });
  const report = await call(
    me.token,
    "POST",
    "/items",
    item({
      title: "Quarterly report",
      priority: "high",
      estimate_minutes: 120,
      due_at: local(2, 17),
    }),
  );
  const email = await call(
    me.token,
    "POST",
    "/items",
    item({ title: "Answer email", priority: "low", estimate_minutes: 30 }),
  );
  await call(
    me.token,
    "POST",
    "/items",
    item({
      title: "Standup",
      kind: "event",
      due_at: local(1, 9),
      end_at: local(1, 10),
    }),
  );
  const tomorrow = addDays(localDateKey(new Date(), TZ), 1);
  const plan = await call(me.token, "POST", "/planner/preview", {
    start_date: tomorrow,
    days: 1,
  });
  assert.equal(plan.status, 200, plan.raw.body);
  const blocks = plan.body.blocks.filter((b: Json) =>
    [report.body.id, email.body.id].includes(b.item_id),
  );
  assert.equal(blocks.length, 3);
  // The high-priority report comes first, in two sessions after the standup.
  assert.equal(blocks[0].item_id, report.body.id);
  assert.equal(blocks[0].start_at, new Date(local(1, 10)).toISOString());
  assert.deepEqual(blocks.map((b: Json) => b.part).slice(0, 2), [1, 2]);
  assert.match(plan.body.summary, /sessions? over 1 day/);

  const applied = await call(
    me.token,
    "POST",
    `/planner/plans/${plan.body.id}/apply`,
  );
  assert.equal(applied.status, 200, applied.raw.body);
  assert.ok(applied.body.blocks.length >= 3);
  assert.equal(
    (await call(me.token, "POST", `/planner/plans/${plan.body.id}/apply`))
      .status,
    409,
  );
  const saved = await call(
    me.token,
    "GET",
    `/blocks?from=${encodeURIComponent(local(1, 0))}&to=${encodeURIComponent(local(2, 0))}`,
  );
  assert.ok(saved.body.length >= 3);

  // An event added over a block: one conflict notice, then a reschedule.
  const target = saved.body.find((b: Json) => b.item_id === email.body.id);
  await call(
    me.token,
    "POST",
    "/items",
    item({
      title: "Client call",
      kind: "event",
      due_at: target.start_at,
      end_at: target.end_at,
    }),
  );
  await scanConflicts();
  await scanConflicts();
  const notices = (await call(me.token, "GET", "/notifications")).body.filter(
    (n: Json) => n.kind === "conflict",
  );
  assert.equal(notices.length, 1);
  assert.equal(notices[0].ref, target.id);
  const moved = await call(me.token, "POST", `/blocks/${target.id}/reschedule`);
  assert.equal(moved.status, 200, moved.raw.body);
  assert.notEqual(moved.body.start_at, target.start_at);

  // Yesterday's unfinished block shows in the review and can be rolled forward.
  await pool.query(
    "INSERT INTO time_blocks (item_id, user_id, start_at, end_at) VALUES ($1, $2, $3, $4)",
    [email.body.id, me.id, local(-1, 9), local(-1, 10)],
  );
  await pool.query(
    "DELETE FROM time_blocks WHERE item_id = $1 AND start_at > now()",
    [email.body.id],
  );
  const review = await call(me.token, "GET", "/planner/review");
  assert.ok(
    review.body.unfinished.some((b: Json) => b.item_id === email.body.id),
  );
  const rolled = await call(me.token, "POST", "/planner/roll-forward", {});
  assert.equal(rolled.status, 200, rolled.raw.body);
  assert.ok(rolled.body.blocks.every((b: Json) => b.item_id === email.body.id));
});

test("teammates see busy times only, plus workload and meeting times", async () => {
  const owner = await newUser();
  const mate = await newUser();
  const outsider = await newUser();
  const teamId = await newTeam(owner.id, [mate.id]);
  await call(
    mate.token,
    "POST",
    "/items",
    item({
      title: "Secret dentist",
      kind: "event",
      due_at: local(1, 10),
      end_at: local(1, 11),
    }),
  );
  const range = `from=${encodeURIComponent(local(1, 0))}&to=${encodeURIComponent(local(3, 0))}`;
  const availability = await call(
    owner.token,
    "GET",
    `/teams/${teamId}/availability?${range}`,
  );
  assert.equal(availability.status, 200, availability.raw.body);
  const mateBusy = availability.body.find(
    (m: Json) => m.user_id === mate.id,
  ).busy;
  assert.deepEqual(mateBusy, [
    {
      start_at: new Date(local(1, 10)).toISOString(),
      end_at: new Date(local(1, 11)).toISOString(),
    },
  ]);
  assert.doesNotMatch(availability.raw.body, /Secret dentist/);
  assert.equal(
    (
      await call(
        outsider.token,
        "GET",
        `/teams/${teamId}/availability?${range}`,
      )
    ).status,
    404,
  );

  const assigned = await call(
    owner.token,
    "POST",
    "/items",
    item({
      title: "Launch plan",
      team_id: teamId,
      assignee_id: mate.id,
      estimate_minutes: 600,
      due_at: local(2, 12),
    }),
  );
  assert.equal(assigned.status, 201, assigned.raw.body);
  assert.equal(
    (
      await call(
        owner.token,
        "POST",
        "/items",
        item({
          title: "Not a member",
          team_id: teamId,
          assignee_id: outsider.id,
        }),
      )
    ).status,
    422,
  );
  const workload = await call(
    owner.token,
    "GET",
    `/teams/${teamId}/workload?${range}`,
  );
  const mateLoad = workload.body.find((m: Json) => m.user_id === mate.id);
  assert.equal(mateLoad.assigned_minutes, 600);
  assert.equal(mateLoad.open_tasks, 1);
  assert.ok(mateLoad.capacity_minutes > 0);

  const slots = await call(
    owner.token,
    "GET",
    `/teams/${teamId}/suggest?${range}&duration=60`,
  );
  assert.equal(slots.status, 200, slots.raw.body);
  assert.ok(slots.body.length > 0);
  for (const s of slots.body)
    assert.ok(
      s.end_at <= new Date(local(1, 10)).toISOString() ||
        s.start_at >= new Date(local(1, 11)).toISOString(),
    );
});

test("booking pages offer free times only and put bookings on the host's calendar", async () => {
  const host = await newUser();
  const slug = `intro-${randomUUID().slice(0, 8)}`;
  const page = await call(host.token, "POST", "/booking-pages", {
    slug,
    title: "Intro call",
    durations: [30],
    min_notice_minutes: 0,
    window_days: 7,
  });
  assert.equal(page.status, 201, page.raw.body);
  await call(
    host.token,
    "POST",
    "/items",
    item({
      title: "Busy",
      kind: "event",
      due_at: local(1, 10),
      end_at: local(1, 11),
    }),
  );
  const tomorrow = addDays(localDateKey(new Date(), TZ), 1);
  const open = await call(
    null,
    "GET",
    `/book/${slug}?duration=30&timezone=${encodeURIComponent(TZ)}&date=${tomorrow}&days=1`,
  );
  assert.equal(open.status, 200, open.raw.body);
  assert.equal(open.body.title, "Intro call");
  assert.deepEqual(open.body.hosts, ["Planner"]);
  const busyStart = new Date(local(1, 10)).toISOString();
  assert.ok(!open.body.slots.some((s: Json) => s.start_at === busyStart));
  const slot = open.body.slots[0];
  const booked = await call(null, "POST", `/book/${slug}`, {
    start_at: slot.start_at,
    duration: 30,
    name: "Sam Lee",
    email: "sam@example.com",
    timezone: TZ,
  });
  assert.equal(booked.status, 201, booked.raw.body);
  assert.equal(booked.body.status, "confirmed");
  const again = await call(null, "POST", `/book/${slug}`, {
    start_at: slot.start_at,
    duration: 30,
    name: "Alex",
    email: "alex@example.com",
  });
  assert.equal(again.status, 409);
  const events = await call(host.token, "GET", "/items?q=Intro");
  assert.equal(events.body[0].title, "Intro call with Sam Lee");
  const bookings = await call(
    host.token,
    "GET",
    `/booking-pages/${page.body.id}/bookings`,
  );
  assert.equal(bookings.body.length, 1);
  const cancelled = await call(
    host.token,
    "POST",
    `/booking-pages/${page.body.id}/bookings/${bookings.body[0].id}/cancel`,
  );
  assert.equal(cancelled.status, 200);
  assert.equal(
    (await call(host.token, "GET", "/items?q=Intro")).body.length,
    0,
  );
  assert.equal(
    (
      await call(host.token, "POST", "/booking-pages", {
        slug,
        title: "Taken",
        durations: [30],
      })
    ).status,
    409,
  );
});

test("API keys work for scripts but not for the admin console", async () => {
  const me = await newUser();
  const created = await call(me.token, "POST", "/me/api-keys", {
    name: "Zapier",
  });
  assert.equal(created.status, 201);
  assert.match(created.body.key, /^ok_/);
  assert.equal((await call(created.body.key, "GET", "/items")).status, 200);
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [me.id]);
  const admin = await call(created.body.key, "GET", "/admin/overview");
  assert.equal(admin.status, 403);
  assert.match(admin.body.message, /API keys can't use the admin console/);
  assert.equal((await call(me.token, "GET", "/admin/overview")).status, 200);
  const listed = await call(me.token, "GET", "/me/api-keys");
  assert.equal(listed.body[0].prefix, created.body.key.slice(0, 10));
  assert.equal("key" in listed.body[0], false);
  await call(me.token, "DELETE", `/me/api-keys/${created.body.id}`);
  assert.equal((await call(created.body.key, "GET", "/items")).status, 401);
  await pool.query("UPDATE users SET role = 'member' WHERE id = $1", [me.id]);
});

test("webhooks refuse private addresses and queue events for delivery", async () => {
  const me = await newUser();
  for (const url of [
    "https://127.0.0.1:5432/steal",
    "https://[::ffff:7f00:1]:5432/steal",
    "https://[::ffff:10.0.0.1]/steal",
  ]) {
    const internal = await call(me.token, "POST", "/me/webhooks", {
      url,
      events: ["item.created"],
    });
    assert.equal(internal.status, 422, url);
    assert.match(internal.body.message, /public address/);
  }
  const plain = await call(me.token, "POST", "/me/webhooks", {
    url: "http://93.184.216.34/hooks/orbyn",
    events: ["item.created"],
  });
  assert.equal(plain.status, 422);
  assert.match(plain.body.message, /start with https/);
  const hook = await call(me.token, "POST", "/me/webhooks", {
    url: "https://93.184.216.34/hooks/orbyn",
    events: ["item.created", "item.completed"],
  });
  assert.equal(hook.status, 201, hook.raw.body);
  assert.match(hook.body.secret, /^whsec_/);
  await call(me.token, "POST", "/items", item({ title: "Ship it" }));
  const queued = (
    await pool.query<{ event: string; payload: Json }>(
      "SELECT event, payload FROM webhook_deliveries WHERE webhook_id = $1",
      [hook.body.id],
    )
  ).rows;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].event, "item.created");
  assert.equal(queued[0].payload.data.title, "Ship it");
  const listed = await call(me.token, "GET", "/me/webhooks");
  assert.equal("secret" in listed.body[0], false);
});

test("the calendar feed serves an iCalendar file to other apps", async () => {
  const me = await newUser();
  await call(
    me.token,
    "POST",
    "/items",
    item({
      title: "Yoga, Tuesdays",
      kind: "event",
      due_at: local(1, 18),
      end_at: local(1, 19),
      rrule: "FREQ=WEEKLY",
      timezone: TZ,
    }),
  );
  const feed = await call(me.token, "POST", "/me/calendar-feed");
  assert.equal(feed.status, 200);
  const path = new URL(feed.body.url).pathname;
  const ics = await call(null, "GET", path);
  assert.equal(ics.status, 200);
  assert.match(String(ics.raw.headers["content-type"]), /text\/calendar/);
  assert.match(ics.raw.body, /BEGIN:VCALENDAR/);
  assert.match(ics.raw.body, /SUMMARY:Yoga\\, Tuesdays/);
  assert.match(ics.raw.body, /RRULE:FREQ=WEEKLY/);
  assert.match(ics.raw.body, /DTSTART;TZID=Australia\/Melbourne:/);
  await call(me.token, "DELETE", "/me/calendar-feed");
  assert.equal((await call(null, "GET", path)).status, 404);
});

test("focus time adds up and one occurrence can be skipped", async () => {
  const me = await newUser();
  const task = await call(
    me.token,
    "POST",
    "/items",
    item({ title: "Write chapter" }),
  );
  await call(me.token, "POST", `/items/${task.body.id}/time`, { minutes: 25 });
  const logged = await call(me.token, "POST", `/items/${task.body.id}/time`, {
    minutes: 20,
  });
  assert.equal(logged.body.spent_minutes, 45);

  const event = await call(
    me.token,
    "POST",
    "/items",
    item({
      title: "Gym",
      kind: "event",
      due_at: "2026-09-21T07:00:00+10:00",
      end_at: "2026-09-21T08:00:00+10:00",
      rrule: "FREQ=DAILY;COUNT=3",
      timezone: TZ,
    }),
  );
  const skipped = await call(me.token, "POST", `/items/${event.body.id}/skip`, {
    occurrence: "2026-09-22T07:00:00+10:00",
  });
  assert.equal(skipped.status, 200, skipped.raw.body);
  const view = await call(
    me.token,
    "GET",
    `/calendar?from=${encodeURIComponent("2026-09-20T00:00:00+10:00")}&to=${encodeURIComponent("2026-09-25T00:00:00+10:00")}`,
  );
  assert.deepEqual(
    view.body.entries
      .filter((e: Json) => e.item_id === event.body.id)
      .map((e: Json) => e.start_at),
    ["2026-09-20T21:00:00.000Z", "2026-09-22T21:00:00.000Z"],
  );
  assert.equal(
    (
      await call(me.token, "POST", `/items/${task.body.id}/skip`, {
        occurrence: "2026-09-22T07:00:00+10:00",
      })
    ).status,
    409,
  );
});
