import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Calendar and events end to end: all-day and free events, colours and
 * several alerts; editing one occurrence or the rest of a series; quick add
 * on the server; people invited by email and their answers; the calendar
 * feed out (and read back by our own ICS parser); calendars subscribed to by
 * link; event search; and teammates' busy times over your calendar.
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { enqueue } = await import("../src/worker/scheduler.js");
const { parseIcs } = await import("../src/modules/planner/icsParse.js");
const { outbound } = await import("../src/lib/netguard.js");
const { addDays, localDateKey, dayTime } = await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.11.${Math.floor(++caller / 250)}.${caller % 250}`;

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

async function newUser(name = "Planner") {
  const r = await call(null, "POST", "/auth/register", {
    email: `cal-${randomUUID()}@example.com`,
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

async function newTeam(ownerId: string, members: string[] = []) {
  const id = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Calendar crew', $1) RETURNING id",
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
const iso = (v: string) => new Date(v).toISOString();
/** "20260916T090000" for a Melbourne day and hour. */
const stamp = (offset: number, hour: number) =>
  `${day(offset).replaceAll("-", "")}T${String(hour).padStart(2, "0")}0000`;
const unfold = (s: string) => s.replace(/\r\n[ \t]/g, "");

async function create(token: string, data: Json) {
  const r = await call(token, "POST", "/items", data);
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}
/** The fields `PUT /items/:id` needs, from a saved item. */
const body = (item: Json, extra: Json = {}) => ({
  title: item.title,
  notes: item.notes,
  kind: item.kind,
  status: item.status,
  priority: item.priority,
  due_at: item.due_at,
  end_at: item.end_at,
  team_id: item.team_id ?? null,
  version: item.version,
  ...extra,
});
async function entries(token: string, from: number, to: number) {
  const r = await call(token, "GET", `/calendar?${range(from, to)}`);
  assert.equal(r.status, 200, r.raw.body);
  return r.body as Json;
}
async function busyOf(token: string, userId: string, from: number, to: number) {
  const r = await call(
    token,
    "GET",
    `/availability?user_ids=${userId}&${range(from, to)}`,
  );
  assert.equal(r.status, 200, r.raw.body);
  return r.body[0]?.busy as Json[];
}
async function feedPath(token: string, busy = false) {
  const r = await call(token, "POST", "/me/calendar-feed", { busy });
  assert.equal(r.status, 200, r.raw.body);
  return new URL(r.body.url).pathname;
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

test("events can be all-day, free, coloured and have several alerts; older apps' reminder still works", async () => {
  const me = await newUser();
  const notMidnight = await call(me.token, "POST", "/items", {
    title: "Holiday",
    kind: "event",
    all_day: true,
    due_at: local(1, 9),
  });
  assert.equal(notMidnight.status, 422);
  assert.match(notMidnight.body.message, /midnight/);
  // All-day items keep their days in the planner's zone; an event lasts a day.
  const holiday = await create(me.token, {
    title: "Holiday",
    kind: "event",
    all_day: true,
    due_at: local(1, 0),
  });
  assert.equal(holiday.all_day, true);
  assert.equal(holiday.timezone, TZ);
  assert.equal(iso(holiday.end_at), iso(local(2, 0)));
  assert.deepEqual(holiday.alerts, [30]);
  assert.equal(holiday.reminder_minutes, 30);

  const free = await create(me.token, {
    title: "Optional talk",
    kind: "event",
    due_at: local(1, 13),
    end_at: local(1, 14),
    busy: false,
    color: "#aa3355",
    alerts: [60, 10, 10],
  });
  assert.equal(free.busy, false);
  assert.equal(free.color, "#aa3355");
  assert.deepEqual(free.alerts, [10, 60]);
  assert.equal(free.reminder_minutes, 10);
  const meeting = await create(me.token, {
    title: "Planning meeting",
    kind: "event",
    due_at: local(1, 15),
    end_at: local(1, 16),
  });
  assert.equal(meeting.busy, true);
  assert.equal(meeting.color, null);

  // An older app sends only reminder_minutes: it sets the one alert on a new
  // item, and on an edit replaces the soonest alert, keeping the others.
  const legacy = await create(me.token, {
    title: "Old app task",
    due_at: local(2, 9),
    reminder_minutes: 15,
  });
  assert.deepEqual(legacy.alerts, [15]);
  const edited = await call(
    me.token,
    "PUT",
    `/items/${free.id}`,
    body(free, { reminder_minutes: 5 }),
  );
  assert.equal(edited.status, 200, edited.raw.body);
  assert.deepEqual(edited.body.alerts, [5, 60]);
  assert.equal(
    edited.body.busy,
    false,
    "omitted event fields keep their values",
  );
  assert.equal(edited.body.color, "#aa3355");
  const same = await call(
    me.token,
    "PUT",
    `/items/${free.id}`,
    body(edited.body, { reminder_minutes: 5 }),
  );
  assert.deepEqual(same.body.alerts, [5, 60]);

  for (const bad of [
    { alerts: [1, 2, 3, 4, 5, 6] },
    { alerts: [50000] },
    { color: "red" },
    { attendees: [{ email: "someone@example.com" }] },
    { all_day: true },
  ])
    assert.equal(
      (await call(me.token, "POST", "/items", { title: "Bad", ...bad })).status,
      422,
      JSON.stringify(bad),
    );

  // All-day and free events don't count as busy or get buffers; others do.
  await call(me.token, "PUT", "/planner/prefs", { buffer_before_minutes: 10 });
  const cal = await entries(me.token, 1, 2);
  const entry = (id: string) => cal.entries.find((e: Json) => e.item_id === id);
  assert.equal(entry(holiday.id).all_day, true);
  assert.equal(entry(holiday.id).busy, false);
  assert.equal(entry(free.id).busy, false);
  assert.equal(entry(free.id).color, "#aa3355");
  assert.deepEqual(entry(free.id).alerts, [5, 60]);
  assert.equal(entry(meeting.id).busy, true);
  assert.deepEqual(
    cal.derived.map((d: Json) => d.item_id),
    [meeting.id],
  );
  assert.deepEqual(await busyOf(me.token, me.id, 1, 2), [
    { start_at: iso(local(1, 14, 50)), end_at: iso(local(1, 16)) },
  ]);

  // Default alerts apply to new items given none.
  const prefs = await call(me.token, "PUT", "/planner/prefs", {
    default_alerts: { event: [15, 1440] },
  });
  assert.equal(prefs.status, 200, prefs.raw.body);
  assert.deepEqual(prefs.body.default_alerts, {
    event: [15, 1440],
    task: [30],
    all_day: [30],
  });
  const later = await create(me.token, {
    title: "Later",
    kind: "event",
    due_at: local(3, 9),
  });
  assert.deepEqual(later.alerts, [15, 1440]);
  const quiet = await create(me.token, { title: "Quiet", alerts: [] });
  assert.deepEqual(quiet.alerts, []);
  assert.equal(quiet.reminder_minutes, null);
});

test("each alert sends its own reminder, once, and follows a changed occurrence", async () => {
  const me = await newUser();
  const due = new Date(Date.now() + 50 * 60_000);
  due.setUTCSeconds(0, 0);
  const item = await create(me.token, {
    title: "Two alerts",
    due_at: due.toISOString(),
    alerts: [30, 60],
  });
  const refs = async (id: string) =>
    (
      await pool.query<{ ref: string }>(
        "SELECT ref FROM notifications WHERE item_id = $1 AND channel = 'inapp' AND kind = 'reminder' ORDER BY ref",
        [id],
      )
    ).rows.map((r) => r.ref);
  await enqueue();
  await enqueue();
  assert.deepEqual(await refs(item.id), ["60"]);
  // Twenty minutes before, the 30-minute alert comes due as well.
  await pool.query(
    "UPDATE items SET due_at = now() + interval '20 minutes' WHERE id = $1",
    [item.id],
  );
  await enqueue();
  await enqueue();
  assert.deepEqual(await refs(item.id), ["30", "60"]);

  // An item made just before it's due gets one reminder, not every alert.
  const soon = await create(me.token, {
    title: "Soon",
    due_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    alerts: [10, 60, 1440],
  });
  await enqueue();
  assert.deepEqual(await refs(soon.id), ["10"]);

  // A repeating event's current occurrence, changed on its own, is reminded
  // with its own title; cancelling it stops the reminder.
  const start = new Date(Date.now() + 10 * 60_000);
  start.setUTCSeconds(0, 0);
  const series = await create(me.token, {
    title: "Daily check",
    kind: "event",
    due_at: start.toISOString(),
    rrule: "FREQ=DAILY;COUNT=3",
    alerts: [30],
  });
  const moved = await call(
    me.token,
    "PUT",
    `/items/${series.id}?scope=this&occurrence=${encodeURIComponent(start.toISOString())}`,
    body(series, { title: "Daily check (in the lab)" }),
  );
  assert.equal(moved.status, 200, moved.raw.body);
  await enqueue();
  const reminder = (await call(me.token, "GET", "/notifications")).body.find(
    (n: Json) => n.item_id === series.id && n.kind === "reminder",
  );
  assert.equal(reminder.title, "Coming up: Daily check (in the lab)");
  assert.equal(reminder.ref, "30");
  const other = await create(me.token, {
    title: "Skipped",
    kind: "event",
    due_at: start.toISOString(),
    rrule: "FREQ=DAILY;COUNT=3",
    alerts: [30],
  });
  await call(me.token, "POST", `/items/${other.id}/skip`, {
    occurrence: start.toISOString(),
  });
  await enqueue();
  assert.deepEqual(await refs(other.id), []);
});

test("one occurrence, or it and every later one, can be changed or removed", async () => {
  const me = await newUser();
  const series = await create(me.token, {
    title: "Standup",
    kind: "event",
    due_at: local(1, 9),
    end_at: local(1, 10),
    rrule: "FREQ=DAILY;COUNT=10",
    timezone: TZ,
    location: "Room 1",
  });
  const id = series.id;
  const occ = (n: number) => iso(local(n, 9));
  const scoped = (scope: string, n: number, extra = "") =>
    `/items/${id}?scope=${scope}&occurrence=${encodeURIComponent(occ(n))}${extra}`;

  // This one: day 3 moves to 11:00 with its own title; the series stays.
  const moved = await call(
    me.token,
    "PUT",
    scoped("this", 3),
    body(series, {
      title: "Standup (late)",
      due_at: local(3, 11),
      end_at: local(3, 12),
    }),
  );
  assert.equal(moved.status, 200, moved.raw.body);
  assert.equal(moved.body.title, "Standup");
  assert.equal(moved.body.version, 2);
  const day3 = (await entries(me.token, 3, 4)).entries.find(
    (e: Json) => e.item_id === id,
  );
  assert.equal(day3.title, "Standup (late)");
  assert.equal(day3.start_at, iso(local(3, 11)));
  assert.equal(day3.end_at, iso(local(3, 12)));
  assert.equal(day3.occurrence, occ(3));
  assert.equal(day3.overridden, true);
  assert.equal(day3.location, "Room 1");
  assert.deepEqual(await busyOf(me.token, me.id, 3, 4), [
    { start_at: iso(local(3, 11)), end_at: iso(local(3, 12)) },
  ]);
  const detail = (await call(me.token, "GET", `/items/${id}`)).body;
  assert.deepEqual(detail.overrides, [
    {
      occurrence: occ(3),
      title: "Standup (late)",
      due_at: iso(local(3, 11)),
      end_at: iso(local(3, 12)),
    },
  ]);
  // Only real occurrences, and only with the current version.
  assert.equal(
    (
      await call(
        me.token,
        "PUT",
        `/items/${id}?scope=this&occurrence=${encodeURIComponent(local(3, 10))}`,
        body(moved.body),
      )
    ).status,
    422,
  );
  assert.equal(
    (await call(me.token, "PUT", scoped("this", 5), body(series))).status,
    409,
  );
  assert.equal(
    (await call(me.token, "PUT", `/items/${id}?scope=this`, body(moved.body)))
      .status,
    422,
  );

  // Delete this one: day 4 is gone.
  const removed = await call(
    me.token,
    "DELETE",
    scoped("this", 4, `&version=${moved.body.version}`),
  );
  assert.equal(removed.status, 204, removed.raw.body);

  // This and following: from day 6 on it's at 8:00.
  const current = (await call(me.token, "GET", `/items/${id}`)).body;
  const split = await call(
    me.token,
    "PUT",
    scoped("following", 6),
    body(current, { due_at: local(6, 8), end_at: local(6, 9) }),
  );
  assert.equal(split.status, 200, split.raw.body);
  assert.notEqual(split.body.id, id);
  assert.equal(split.body.rrule, "FREQ=DAILY;COUNT=5");
  assert.equal(split.body.location, "Room 1", "carried over");
  const old = (await call(me.token, "GET", `/items/${id}`)).body;
  assert.match(old.rrule, /^FREQ=DAILY;UNTIL=\d{8}T\d{6}Z$/);
  const standups = async () =>
    (await entries(me.token, 0, 12)).entries
      .filter((e: Json) => e.title.startsWith("Standup"))
      .map((e: Json) => e.start_at);
  assert.deepEqual(
    await standups(),
    [
      local(1, 9),
      local(2, 9),
      local(3, 11),
      local(5, 9),
      local(6, 8),
      local(7, 8),
      local(8, 8),
      local(9, 8),
      local(10, 8),
    ].map(iso),
  );

  // Deleting "following" ends the new series after day 7.
  const cut = await call(
    me.token,
    "DELETE",
    `/items/${split.body.id}?version=${split.body.version}&scope=following&occurrence=${encodeURIComponent(local(8, 8))}`,
  );
  assert.equal(cut.status, 204, cut.raw.body);
  assert.deepEqual((await standups()).slice(-2), [
    iso(local(6, 8)),
    iso(local(7, 8)),
  ]);

  // The feed carries the changed and the removed occurrence.
  const ics = unfold(
    (await call(null, "GET", await feedPath(me.token))).raw.body,
  );
  assert.ok(
    ics.includes(`RECURRENCE-ID;TZID=${TZ}:${stamp(3, 9)}`),
    "RECURRENCE-ID for the moved one",
  );
  assert.ok(ics.includes(`EXDATE;TZID=${TZ}:${stamp(4, 9)}`));
  assert.ok(ics.includes("SUMMARY:Standup (late)"));

  // Editing the whole series (no scope) works as before.
  const latest = (await call(me.token, "GET", `/items/${id}`)).body;
  const all = await call(
    me.token,
    "PUT",
    `/items/${id}`,
    body(latest, { title: "Morning standup" }),
  );
  assert.equal(all.status, 200, all.raw.body);
  assert.equal(all.body.title, "Morning standup");
});

test("quick add parses on the server and creates the item", async () => {
  const me = await newUser();
  const mate = await newUser("Anna Lee");
  const team = await newTeam(me.id, [mate.id]);
  const list = await call(me.token, "POST", "/lists", {
    name: "Launch",
    team_id: team,
  });
  assert.equal(list.status, 201, list.raw.body);
  const preview = await call(me.token, "POST", "/items/quick", {
    text: "Ship notes >Launch @anna tomorrow !!!",
    timezone: TZ,
    preview: true,
  });
  assert.equal(preview.status, 200, preview.raw.body);
  assert.equal(preview.body.input.title, "Ship notes");
  assert.equal(preview.body.input.team_id, team);
  assert.equal(preview.body.input.list_id, list.body.id);
  assert.equal(preview.body.input.assignee_id, mate.id);
  assert.equal(preview.body.input.priority, "high");
  assert.equal(preview.body.input.due_at, iso(local(1, 0)));
  assert.deepEqual(
    preview.body.chips.map((c: Json) => c.kind),
    ["kind", "list", "person", "date", "priority"],
  );
  // Nothing was saved by the preview.
  assert.equal((await call(me.token, "GET", "/items")).body.length, 0);

  const created = await call(me.token, "POST", "/items/quick", {
    text: "Lunch with @guest@example.com tomorrow 1-2pm ;Cafe Roma",
    timezone: TZ,
  });
  assert.equal(created.status, 201, created.raw.body);
  const item = created.body.item;
  assert.equal(item.title, "Lunch");
  assert.equal(item.kind, "event");
  assert.equal(item.location, "Cafe Roma");
  assert.equal(iso(item.due_at), iso(local(1, 13)));
  assert.equal(iso(item.end_at), iso(local(1, 14)));
  const detail = (await call(me.token, "GET", `/items/${item.id}`)).body;
  assert.deepEqual(
    detail.attendees.map((a: Json) => [a.email, a.status]),
    [["guest@example.com", "needs_action"]],
  );
  // Without a zone it uses the planner's.
  const zoned = await call(me.token, "POST", "/items/quick", {
    text: "Pay rent friday",
  });
  assert.equal(zoned.body.item.timezone, TZ);
  assert.equal(
    (await call(me.token, "POST", "/items/quick", { text: "tomorrow 3pm" }))
      .status,
    422,
  );
});

test("people invited by email get invitations, answer by link, and hear about changes", async () => {
  // Register the inviter while mail is off, so they start confirmed; the
  // invitations below still need SMTP set up when the event is created.
  const me = await newUser();
  // Invitations only go out with SMTP set up; the lane never needs to reach it here.
  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ('smtp', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [
      JSON.stringify({
        host: "smtp.invalid",
        port: 2525,
        user: "",
        secure: false,
        from: "Orbyn <calendar@orbyn.test>",
        password_encrypted: null,
      }),
    ],
  );
  invalidateSettings();
  try {
    const event = await create(me.token, {
      title: "Design review",
      kind: "event",
      due_at: local(2, 10),
      end_at: local(2, 11),
      location: "Room 4",
      attendees: [
        { email: "Guest@Example.com", name: "Guest" },
        { email: "sam@example.com" },
      ],
    });
    const invites = async () =>
      (
        await pool.query<{
          destination: string;
          title: string;
          body: string;
          ical: string;
          ref: string;
          item_id: string | null;
        }>(
          `SELECT destination, title, body, ical, ref, item_id FROM notifications
           WHERE kind = 'invite' AND user_id = $1 ORDER BY created_at, destination`,
          [me.id],
        )
      ).rows.map((n) => ({ ...n, ical: unfold(n.ical) }));
    let sent = await invites();
    assert.deepEqual(
      sent.map((n) => n.destination),
      ["guest@example.com", "sam@example.com"],
    );
    const guest = sent[0];
    assert.equal(guest.title, "Invitation: Design review");
    assert.match(guest.ical, /METHOD:REQUEST/);
    assert.match(guest.ical, new RegExp(`UID:${event.id}@orbyn`));
    assert.match(guest.ical, /SEQUENCE:1/);
    assert.match(
      guest.ical,
      /ORGANIZER;CN="Planner":mailto:calendar@orbyn\.test/,
    );
    assert.match(
      guest.ical,
      /ATTENDEE;CN="Guest";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:guest@example\.com/,
    );
    assert.match(guest.body, /Where: Room 4/);
    const token = guest.body.match(/\/rsvp\/([A-Za-z0-9_-]+)\?r=accepted/)![1];

    const view = await call(null, "GET", `/rsvp/${token}`);
    assert.equal(view.status, 200, view.raw.body);
    assert.equal(view.body.title, "Design review");
    assert.equal(view.body.organizer, "Planner");
    assert.equal(view.body.status, "needs_action");
    assert.equal(view.body.timezone, TZ);
    assert.equal(view.body.start_at, iso(local(2, 10)));
    assert.equal(
      (await call(null, "GET", `/rsvp/${"x".repeat(32)}`)).status,
      404,
    );
    const answer = await call(null, "POST", `/rsvp/${token}`, {
      status: "accepted",
    });
    assert.equal(answer.status, 200, answer.raw.body);
    assert.equal(answer.body.status, "accepted");
    assert.equal(
      (await call(null, "POST", `/rsvp/${token}`, { status: "maybe" })).status,
      422,
    );
    await call(null, "POST", `/rsvp/${token}`, { status: "tentative" });
    const notices = (await call(me.token, "GET", "/notifications")).body.filter(
      (n: Json) => n.kind === "rsvp",
    );
    assert.equal(notices.length, 1, "one notice per person, refreshed");
    assert.equal(notices[0].item_id, event.id);
    assert.match(notices[0].title, /^Guest might come: Design review/);
    const detail = (await call(me.token, "GET", `/items/${event.id}`)).body;
    assert.deepEqual(
      detail.attendees.map((a: Json) => [a.email, a.status]),
      [
        ["guest@example.com", "tentative"],
        ["sam@example.com", "needs_action"],
      ],
    );

    // A new time sends updated invitations with a higher SEQUENCE.
    const moved = await call(
      me.token,
      "PUT",
      `/items/${event.id}`,
      body(event, { due_at: local(2, 14), end_at: local(2, 15) }),
    );
    assert.equal(moved.status, 200, moved.raw.body);
    sent = await invites();
    const updated = sent.filter((n) => n.title.startsWith("Updated"));
    assert.equal(updated.length, 2);
    assert.match(updated[0].ical, /SEQUENCE:2/);
    assert.match(updated[0].ical, /PARTSTAT=TENTATIVE/);
    // Editing the notes alone doesn't email anyone.
    await call(
      me.token,
      "PUT",
      `/items/${event.id}`,
      body(moved.body, { notes: "Bring the prototype" }),
    );
    assert.equal((await invites()).length, sent.length);

    // Taking someone off sends them a cancellation.
    const latest = (await call(me.token, "GET", `/items/${event.id}`)).body;
    await call(
      me.token,
      "PUT",
      `/items/${event.id}`,
      body(latest, {
        attendees: [{ email: "guest@example.com", name: "Guest" }],
      }),
    );
    const off = (await invites()).find(
      (n) => n.ref === "CANCEL:sam@example.com",
    )!;
    assert.match(off.ical, /METHOD:CANCEL/);
    assert.match(off.ical, /STATUS:CANCELLED/);
    assert.equal(off.item_id, event.id);

    // Deleting the event cancels it for everyone left.
    const final = (await call(me.token, "GET", `/items/${event.id}`)).body;
    assert.equal(
      (
        await call(
          me.token,
          "DELETE",
          `/items/${event.id}?version=${final.version}`,
        )
      ).status,
      204,
    );
    const gone = (await invites()).filter(
      (n) => n.ref === "CANCEL:guest@example.com",
    );
    assert.equal(gone.length, 1);
    assert.equal(gone[0].item_id, null);
    assert.equal((await call(null, "GET", `/rsvp/${token}`)).status, 404);
  } finally {
    await pool.query("DELETE FROM system_settings WHERE key = 'smtp'");
    invalidateSettings();
    await pool.query(
      "UPDATE notifications SET state = 'cancelled' WHERE kind = 'invite' AND state = 'pending'",
    );
  }
  // Without SMTP nothing is queued, and the event is saved all the same.
  const quiet = await create(me.token, {
    title: "No mail",
    kind: "event",
    due_at: local(3, 10),
    attendees: [{ email: "quiet@example.com" }],
  });
  const queued = await pool.query(
    "SELECT 1 FROM notifications WHERE kind = 'invite' AND destination = 'quiet@example.com'",
  );
  assert.equal(queued.rowCount, 0);
  assert.equal(
    (await call(me.token, "GET", `/items/${quiet.id}`)).body.attendees.length,
    1,
  );
});

test("the calendar feed has all-day dates, free time, alerts and changed occurrences, and reads back through our ICS parser", async () => {
  const me = await newUser();
  await create(me.token, {
    title: "Holiday",
    kind: "event",
    all_day: true,
    due_at: local(3, 0),
  });
  await create(me.token, {
    title: "Optional talk",
    kind: "event",
    due_at: local(1, 13),
    end_at: local(1, 14),
    busy: false,
    alerts: [10, 60],
  });
  const series = await create(me.token, {
    title: "Standup",
    kind: "event",
    due_at: local(1, 9),
    end_at: local(1, 10),
    rrule: "FREQ=DAILY;COUNT=3",
    timezone: TZ,
  });
  const moved = await call(
    me.token,
    "PUT",
    `/items/${series.id}?scope=this&occurrence=${encodeURIComponent(iso(local(2, 9)))}`,
    body(series, {
      title: "Standup (moved)",
      due_at: local(2, 11),
      end_at: local(2, 12),
    }),
  );
  assert.equal(moved.status, 200, moved.raw.body);
  await call(me.token, "POST", `/items/${series.id}/skip`, {
    occurrence: local(3, 9),
  });
  const work = await create(me.token, { title: "Write report" });
  await call(me.token, "POST", "/blocks", {
    item_id: work.id,
    start_at: local(1, 15),
    end_at: local(1, 16),
  });
  const slides = await create(me.token, {
    title: "Draft slides",
    kind: "task",
    due_at: local(6, 17),
  });
  await call(me.token, "POST", "/blocks", {
    item_id: slides.id,
    start_at: local(5, 10),
    end_at: local(5, 11),
  });

  const path = await feedPath(me.token);
  const read = async (url: string) => {
    const r = await call(null, "GET", url);
    assert.equal(r.status, 200, r.raw.body);
    assert.match(String(r.raw.headers["content-type"]), /text\/calendar/);
    return unfold(r.raw.body);
  };
  let ics = await read(path);
  assert.ok(ics.includes(`DTSTART;VALUE=DATE:${day(3).replaceAll("-", "")}`));
  assert.ok(ics.includes(`DTEND;VALUE=DATE:${day(4).replaceAll("-", "")}`));
  assert.match(ics, /TRANSP:TRANSPARENT/);
  assert.match(ics, /TRANSP:OPAQUE/);
  assert.match(ics, /TRIGGER:-PT10M/);
  assert.match(ics, /TRIGGER:-PT60M/);
  assert.match(ics, /RRULE:FREQ=DAILY;COUNT=3/);
  assert.ok(ics.includes(`RECURRENCE-ID;TZID=${TZ}:${stamp(2, 9)}`));
  assert.ok(ics.includes(`EXDATE;TZID=${TZ}:${stamp(3, 9)}`));
  assert.doesNotMatch(ics, /Focus: Write report/);

  // Time blocks are an option of the feed.
  const settings = await call(me.token, "PUT", "/me/calendar-feed", {
    include_blocks: true,
  });
  assert.deepEqual(settings.body, {
    enabled: true,
    busy_enabled: false,
    include_blocks: true,
  });
  ics = await read(path);
  assert.match(ics, /SUMMARY:Focus: Write report/);
  // A session says when its task is due; one with no deadline says nothing.
  const session = (title: string) =>
    ics
      .split("BEGIN:VEVENT")
      .find((event) => event.includes(`SUMMARY:Focus: ${title}`))!;
  assert.match(
    session("Draft slides"),
    /DESCRIPTION:Due \w{3} \d{1,2} \w{3}\\, \d{1,2}:\d{2} [ap]m/,
  );
  assert.doesNotMatch(session("Write report"), /DESCRIPTION:/);

  // Round trip: what we publish, our own parser reads back.
  const parsed = parseIcs(ics, TZ);
  const one = (title: string) => {
    const found = parsed.filter((e) => e.title === title);
    assert.equal(found.length, 1, title);
    return found[0];
  };
  assert.equal(one("Holiday").all_day, true);
  assert.equal(one("Holiday").starts_at, iso(local(3, 0)));
  assert.equal(one("Holiday").ends_at, iso(local(4, 0)));
  assert.equal(one("Optional talk").transparent, true);
  assert.equal(one("Optional talk").starts_at, iso(local(1, 13)));
  const master = one("Standup");
  assert.equal(master.rrule, "FREQ=DAILY;COUNT=3");
  assert.equal(master.timezone, TZ);
  assert.deepEqual(
    [...master.exdates].sort(),
    [iso(local(2, 9)), iso(local(3, 9))].sort(),
  );
  const changed = one("Standup (moved)");
  assert.equal(changed.recurrence_id, iso(local(2, 9)));
  assert.equal(changed.starts_at, iso(local(2, 11)));
  assert.equal(one("Focus: Write report").ends_at, iso(local(1, 16)));

  // The busy-only link shows when, never what.
  const busyPath = await feedPath(me.token, true);
  const busy = await read(busyPath);
  assert.doesNotMatch(busy, /Standup|Holiday|Optional|Write report/);
  const intervals = parseIcs(busy, TZ);
  assert.ok(intervals.every((e) => e.title === "Busy"));
  assert.deepEqual(
    intervals
      .filter(
        (e) =>
          e.starts_at >= iso(local(1, 0)) && e.starts_at < iso(local(4, 0)),
      )
      .map((e) => [e.starts_at, e.ends_at]),
    [
      [iso(local(1, 9)), iso(local(1, 10))],
      [iso(local(1, 15)), iso(local(1, 16))],
      [iso(local(2, 11)), iso(local(2, 12))],
    ],
  );
  assert.doesNotMatch(await read(`${path}?busy=1`), /Standup/);
  assert.equal(
    (await call(me.token, "GET", "/me/calendar-feed")).body.busy_enabled,
    true,
  );
  await call(me.token, "DELETE", "/me/calendar-feed?busy=1");
  assert.equal((await call(null, "GET", busyPath)).status, 404);
  assert.equal((await call(null, "GET", path)).status, 200);
});

test("the ICS parser reads folded lines, zones, dates, durations, repeats and changes", () => {
  const feed = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:weekly@example",
    'DTSTART;TZID="W. Europe Standard Time":20260907T090000',
    "DURATION:PT1H30M",
    "RRULE:FREQ=WEEKLY;BYDAY=MO;WKST=MO;UNTIL=20261005T090000",
    "EXDATE;TZID=Europe/Berlin:20260914T090000,20260921T090000",
    "SUMMARY:Weekly sync\\, with notes",
    "LOCATION:Room 2\\; floor 3",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "SUMMARY:Not an event",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:weekly@example",
    "RECURRENCE-ID;TZID=Europe/Berlin:20260928T090000",
    "DTSTART;TZID=Europe/Berlin:20260928T110000",
    "DTEND;TZID=Europe/Berlin:20260928T120000",
    "SUMMARY:Weekly sync (moved)",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:weekly@example",
    "RECURRENCE-ID;TZID=Europe/Berlin:20261005T090000",
    "STATUS:CANCELLED",
    "DTSTART;TZID=Europe/Berlin:20261005T090000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:holiday@example",
    "DTSTART;VALUE=DATE:20261225",
    "SUMMARY:Christmas",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:odd@example",
    "DTSTART:20261001T230000Z",
    "DTEND:20261002T000000Z",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2MO",
    "SUMMARY:A very long title that goes on and on so that the line has to be fol",
    " ded by the calendar app",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:gone@example",
    "DTSTART:20261001T230000Z",
    "STATUS:CANCELLED",
    "SUMMARY:Cancelled",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:No start",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const events = parseIcs(feed, TZ);
  assert.deepEqual(
    events.map((e) => e.title),
    [
      "Weekly sync, with notes",
      "Weekly sync (moved)",
      "Christmas",
      "A very long title that goes on and on so that the line has to be folded by the calendar app",
    ],
  );
  const [weekly, moved, christmas, odd] = events;
  assert.equal(weekly.timezone, "Europe/Berlin");
  assert.equal(weekly.starts_at, "2026-09-07T07:00:00.000Z");
  assert.equal(weekly.ends_at, "2026-09-07T08:30:00.000Z");
  assert.equal(weekly.location, "Room 2; floor 3");
  // WKST dropped; the local UNTIL is now UTC.
  assert.equal(weekly.rrule, "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261005T070000Z");
  assert.deepEqual(weekly.exdates, [
    "2026-09-14T07:00:00.000Z",
    "2026-09-21T07:00:00.000Z",
    "2026-09-28T07:00:00.000Z",
    "2026-10-05T07:00:00.000Z",
  ]);
  assert.equal(moved.recurrence_id, "2026-09-28T07:00:00.000Z");
  assert.equal(moved.starts_at, "2026-09-28T09:00:00.000Z");
  assert.equal(christmas.all_day, true);
  assert.equal(christmas.transparent, true);
  assert.equal(christmas.starts_at, iso(`2026-12-25T00:00:00+11:00`));
  assert.equal(christmas.ends_at, iso(`2026-12-26T00:00:00+11:00`));
  // A rule outside Orbyn's subset keeps only its first occurrence.
  assert.equal(odd.rrule, null);
});

test("calendars from other apps: public links only, fetched, shown, and busy only when asked", async (t) => {
  const me = await newUser();
  for (const url of [
    "http://127.0.0.1/cal.ics",
    "https://10.1.2.3/cal.ics",
    "webcal://192.168.1.10/cal.ics",
    "http://[::1]/cal.ics",
    "https://[::ffff:7f00:1]/cal.ics",
    "https://[::ffff:169.254.169.254]/cal.ics",
    "ftp://example.com/cal.ics",
    // Public, but plain http.
    "http://93.184.216.34/cal.ics",
  ]) {
    const refused = await call(me.token, "POST", "/me/calendar-subscriptions", {
      url,
      name: "Nope",
    });
    assert.equal(refused.status, 422, url);
  }

  // The source: another person's Orbyn feed.
  const other = await newUser();
  await create(other.token, {
    title: "Team offsite",
    kind: "event",
    due_at: local(2, 10),
    end_at: local(2, 12),
  });
  await create(other.token, {
    title: "Public holiday",
    kind: "event",
    all_day: true,
    due_at: local(3, 0),
  });
  await create(other.token, {
    title: "Gym",
    kind: "event",
    due_at: local(1, 7),
    end_at: local(1, 8),
    rrule: "FREQ=DAILY;COUNT=2",
    timezone: TZ,
  });
  const source = (await call(null, "GET", await feedPath(other.token))).raw
    .body;
  const seen: string[] = [];
  const pinned: (string | undefined)[] = [];
  let answer: (
    url: string,
    init?: { headers?: HeadersInit },
  ) => Response = () =>
    new Response(source, {
      status: 200,
      headers: { etag: '"v1"', "content-type": "text/calendar" },
    });
  // Stands in for the network: every call arrives already checked, with the
  // address it will connect to.
  t.mock.method(
    outbound,
    "request",
    async (
      checked: { url: URL; pinned: { address: string } | null },
      init?: { headers?: HeadersInit },
    ) => {
      seen.push(checked.url.toString());
      pinned.push(checked.pinned?.address);
      return answer(checked.url.toString(), init);
    },
  );

  const sub = await call(me.token, "POST", "/me/calendar-subscriptions", {
    url: "webcal://93.184.216.34/team.ics",
    name: "Team",
    color: "#123456",
    busy: false,
  });
  assert.equal(sub.status, 201, sub.raw.body);
  assert.equal(sub.body.url, "https://93.184.216.34/team.ics");
  assert.equal(sub.body.busy, false);
  // Read as soon as it's added.
  assert.notEqual(sub.body.last_fetched_at, null);
  assert.equal(sub.body.event_count, 3);
  const refresh = () =>
    call(me.token, "POST", `/me/calendar-subscriptions/${sub.body.id}/refresh`);
  const first = await refresh();
  assert.equal(first.status, 200, first.raw.body);
  assert.equal(first.body.last_error, null);
  assert.equal(first.body.event_count, 3);
  assert.deepEqual(seen, [
    "https://93.184.216.34/team.ics",
    "https://93.184.216.34/team.ics",
  ]);
  // Each call connects to the address that was checked.
  assert.deepEqual(pinned, ["93.184.216.34", "93.184.216.34"]);

  const shown = async () =>
    ((await entries(me.token, 1, 4)).external as Json[]).map((e) => [
      e.title,
      e.start_at,
      e.all_day,
      e.busy,
    ]);
  assert.deepEqual(await shown(), [
    ["Gym", iso(local(1, 7)), false, false],
    ["Gym", iso(local(2, 7)), false, false],
    ["Team offsite", iso(local(2, 10)), false, false],
    ["Public holiday", iso(local(3, 0)), true, false],
  ]);
  const one = (await entries(me.token, 2, 3)).external.find(
    (e: Json) => e.title === "Team offsite",
  );
  assert.equal(one.name, "Team");
  assert.equal(one.color, "#123456");
  assert.equal(one.subscription_id, sub.body.id);
  // Not busy when turned off; then only as intervals, and never the all-day one.
  assert.deepEqual(await busyOf(me.token, me.id, 1, 4), []);
  const busy = await call(
    me.token,
    "PUT",
    `/me/calendar-subscriptions/${sub.body.id}`,
    { busy: true },
  );
  assert.equal(busy.body.busy, true);
  assert.deepEqual(await busyOf(me.token, me.id, 1, 4), [
    { start_at: iso(local(1, 7)), end_at: iso(local(1, 8)) },
    { start_at: iso(local(2, 7)), end_at: iso(local(2, 8)) },
    { start_at: iso(local(2, 10)), end_at: iso(local(2, 12)) },
  ]);
  const found = await call(me.token, "GET", "/calendar/search?q=offsite");
  assert.deepEqual(
    found.body.results.map((r: Json) => [r.source, r.title]),
    [["external", "Team offsite"]],
  );

  // A second fetch asks only for changes; "not modified" keeps the events.
  answer = (_url, init) => {
    assert.equal(new Headers(init?.headers).get("if-none-match"), '"v1"');
    return new Response(null, { status: 304 });
  };
  const again = await refresh();
  assert.equal(again.body.event_count, 3);
  assert.equal(again.body.last_error, null);

  // A redirect to a private address is refused, however it's written, and
  // the last events stay.
  for (const location of [
    "https://127.0.0.1/steal",
    "https://[::ffff:127.0.0.1]/steal",
    "https://[::ffff:7f00:1]/steal",
    "https://2130706433/steal",
  ]) {
    answer = () => new Response(null, { status: 302, headers: { location } });
    const redirected = await refresh();
    assert.match(redirected.body.last_error, /public address/, location);
    assert.equal(redirected.body.event_count, 3);
  }
  // So is one that drops to plain http.
  answer = () =>
    new Response(null, {
      status: 302,
      headers: { location: "http://93.184.216.34/team.ics" },
    });
  assert.match((await refresh()).body.last_error, /start with https/);
  assert.ok(!seen.some((url) => /127\.0\.0\.1|\[::ffff|^http:/.test(url)));
  assert.equal((await shown()).length, 4);
  answer = () => new Response("<html>Not a calendar</html>", { status: 200 });
  assert.match((await refresh()).body.last_error, /iCalendar/);
  answer = () => new Response("nope", { status: 404 });
  assert.match((await refresh()).body.last_error, /answered 404/);

  // It's yours alone.
  const path = `/me/calendar-subscriptions/${sub.body.id}`;
  assert.equal(
    (await call(other.token, "PUT", path, { name: "Mine" })).status,
    404,
  );
  assert.equal((await call(other.token, "DELETE", path)).status, 404);
  assert.equal(
    (await call(other.token, "GET", "/me/calendar-subscriptions")).body.length,
    0,
  );
  assert.equal((await call(me.token, "DELETE", path)).status, 204);
  assert.deepEqual(await shown(), []);
});

test("search finds past and future events and single-occurrence changes, only your own", async () => {
  const me = await newUser();
  const stranger = await newUser();
  await create(me.token, {
    title: "Dentist",
    kind: "event",
    due_at: local(-40, 9),
    end_at: local(-40, 10),
  });
  await create(me.token, {
    title: "Dentist follow-up",
    kind: "event",
    due_at: local(20, 9),
    end_at: local(20, 10),
  });
  await create(me.token, {
    title: "Dentist",
    kind: "event",
    due_at: local(400, 9),
  });
  const yoga = await create(me.token, {
    title: "Yoga",
    kind: "event",
    due_at: local(1, 7),
    end_at: local(1, 8),
    rrule: "FREQ=DAILY;COUNT=5",
    timezone: TZ,
  });
  await call(
    me.token,
    "PUT",
    `/items/${yoga.id}?scope=this&occurrence=${encodeURIComponent(iso(local(2, 7)))}`,
    body(yoga, { title: "Hot yoga" }),
  );
  const search = async (query: string, token = me.token) => {
    const r = await call(token, "GET", `/calendar/search?${query}`);
    assert.equal(r.status, 200, r.raw.body);
    return r.body.results as Json[];
  };
  assert.deepEqual(
    (await search("q=dentist")).map((r) => [r.source, r.title, r.start_at]),
    [
      ["item", "Dentist", iso(local(-40, 9))],
      ["item", "Dentist follow-up", iso(local(20, 9))],
    ],
  );
  const hot = await search("q=hot");
  assert.equal(hot.length, 1);
  assert.equal(hot[0].occurrence, iso(local(2, 7)));
  assert.equal(hot[0].overridden, true);
  assert.equal((await search("q=yoga")).length, 5);
  assert.deepEqual(
    (
      await search(
        `q=dentist&from=${encodeURIComponent(local(300, 0))}&to=${encodeURIComponent(local(500, 0))}`,
      )
    ).map((r) => r.start_at),
    [iso(local(400, 9))],
  );
  assert.deepEqual(await search("q=dentist", stranger.token), []);
  assert.equal((await call(me.token, "GET", "/calendar/search")).status, 422);
});

test("teammates' busy times can be laid over your calendar, and nobody else's", async () => {
  const me = await newUser();
  const mate = await newUser("Mate");
  const stranger = await newUser();
  await newTeam(me.id, [mate.id]);
  await create(mate.token, {
    title: "Secret interview",
    kind: "event",
    due_at: local(1, 10),
    end_at: local(1, 11),
  });
  await create(mate.token, {
    title: "Optional lunch",
    kind: "event",
    due_at: local(1, 12),
    end_at: local(1, 13),
    busy: false,
  });
  await create(stranger.token, {
    title: "Stranger's meeting",
    kind: "event",
    due_at: local(1, 10),
    end_at: local(1, 11),
  });
  const r = await call(
    me.token,
    "GET",
    `/availability?user_ids=${mate.id},${stranger.id},${randomUUID()}&${range(1, 2)}`,
  );
  assert.equal(r.status, 200, r.raw.body);
  assert.deepEqual(r.body, [
    {
      user_id: mate.id,
      name: "Mate",
      timezone: TZ,
      busy: [{ start_at: iso(local(1, 10)), end_at: iso(local(1, 11)) }],
    },
  ]);
  assert.doesNotMatch(r.raw.body, /Secret|lunch/);
  const eleven = Array.from({ length: 11 }, () => randomUUID()).join(",");
  assert.equal(
    (
      await call(
        me.token,
        "GET",
        `/availability?user_ids=${eleven}&${range(1, 2)}`,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await call(
        me.token,
        "GET",
        `/availability?user_ids=${mate.id}&${range(1, 33)}`,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await call(
        null,
        "GET",
        `/availability?user_ids=${mate.id}&${range(1, 2)}`,
      )
    ).status,
    401,
  );
});

test("client editor payloads preserve default alerts and strip response-only event fields", async () => {
  const { freshItem, itemBody, allDayRange, itemData } =
    await import("@orbyn/core");
  const me = await newUser();
  const prefs = await call(me.token, "PUT", "/planner/prefs", {
    default_alerts: { task: [], event: [40320], all_day: [1440] },
  });
  assert.equal(prefs.status, 200, prefs.raw.body);
  const task = await create(me.token, {
    ...freshItem(),
    title: "No default task alerts",
  });
  assert.deepEqual(task.alerts, []);
  const event = await create(me.token, {
    ...freshItem(),
    title: "Four week reminder",
    kind: "event",
    due_at: local(2, 9),
    attendees: [{ email: "editor-guest@example.com", name: "Guest" }],
    links: [{ url: "https://example.com/agenda", title: "Agenda" }],
  });
  assert.deepEqual(event.alerts, [40320]);
  assert.equal(event.reminder_minutes, 40320);
  const detail = await call(me.token, "GET", `/items/${event.id}`);
  assert.equal(detail.status, 200, detail.raw.body);
  const payload = itemBody(detail.body);
  assert.equal("reminder_minutes" in payload, false);
  assert.deepEqual(payload.attendees, [
    { email: "editor-guest@example.com", name: "Guest" },
  ]);
  assert.deepEqual(payload.links, [
    { url: "https://example.com/agenda", title: "Agenda" },
  ]);
  const { version, ...fields } = payload;
  assert.equal(itemData.safeParse(fields).success, true);
  const edited = await call(me.token, "PUT", `/items/${event.id}`, {
    ...payload,
    title: "Edited title",
  });
  assert.equal(edited.status, 200, edited.raw.body);
  assert.deepEqual(edited.body.alerts, [40320]);
  const savedDetail = await call(me.token, "GET", `/items/${event.id}`);
  assert.equal(savedDetail.body.attendees.length, 1);
  assert.equal(savedDetail.body.links.length, 1);
  // An all-day edit retains the item's zone even on a device in another zone.
  const dates = allDayRange("2026-10-04", "2026-10-04", TZ);
  assert.equal(
    Date.parse(dates.end_at) - Date.parse(dates.due_at),
    23 * 3_600_000,
  );
  const holiday = await create(me.token, {
    ...freshItem(),
    title: "DST day",
    kind: "event",
    all_day: true,
    timezone: TZ,
    ...dates,
  });
  assert.deepEqual(holiday.alerts, [1440]);
  const result = await call(me.token, "PUT", `/items/${holiday.id}`, {
    ...itemBody(holiday as any),
    title: "Same day, new title",
    ...dates,
  });
  assert.equal(result.status, 200, result.raw.body);
  assert.equal(result.body.timezone, TZ);
  assert.equal(iso(result.body.due_at), dates.due_at);
  // Older callers without an alerts array still round-trip their single reminder.
  const legacy = { ...task, alerts: undefined, reminder_minutes: 60 };
  assert.equal(itemBody(legacy as any).reminder_minutes, 60);
});
