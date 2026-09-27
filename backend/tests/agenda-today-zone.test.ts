import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * The agenda's "today" is today in the account's zone, the same day the
 * Today list, the header and the agents use — reproduced for the case that
 * was reported: an account in Melbourne on Sunday 27 September 2026, in the
 * evening and late at night, with Monday's page already written ahead, and
 * a device somewhere else. Also the midnight roll-over and daylight saving
 * (Melbourne goes forward on Sunday 4 October 2026, back on 5 April).
 */
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { agendaDayOf, agendaOn, writeAgendaOn, writeTodaysAgenda } =
  await import("../src/modules/docs/agenda.js");
const { adoptDeviceZone, dayZoneFor } =
  await import("../src/modules/planner/timezone.js");
const { todayFor } = await import("../src/modules/planner/today.js");
const {
  addDays,
  agendaTitleOn,
  agendaTodayAt,
  dayZone,
  localDateKey,
  nextDayStart,
} = await import("@orbyn/core");

const app = await buildApp();
const MEL = "Australia/Melbourne";
const LA = "America/Los_Angeles";

/** Sunday 27 Sept 2026 in Melbourne (AEST, UTC+10). */
const SUN_EVENING = new Date("2026-09-27T10:30:00Z"); // 20:30
const SUN_LATE = new Date("2026-09-27T13:45:00Z"); // 23:45
const MON_EARLY = new Date("2026-09-27T14:30:00Z"); // Mon 00:30

async function register(name: string) {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `zone-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  return { token: r.json().token as string, id: r.json().user.id as string };
}

let me = { token: "", id: "" };

before(async () => {
  await migrate();
  me = await register("Melbourne");
  const r = await app.inject({
    method: "PUT",
    url: "/planner/prefs",
    headers: { authorization: `Bearer ${me.token}` },
    payload: { timezone: MEL },
  });
  assert.equal(r.statusCode, 200, r.body);
});
after(async () => {
  await app.close();
  await pool.end();
});

test("Sunday evening and late night in Melbourne: today is Sunday, with Monday's page written ahead", async () => {
  // Monday's page, written ahead from the evening before (stepping ›).
  const monday = await writeAgendaOn(me.id, "2026-09-28", SUN_EVENING);
  assert.ok(monday);
  assert.equal(monday.doc.agenda_date, "2026-09-28");
  assert.equal(monday.doc.title, "Monday 28 September");

  for (const now of [SUN_EVENING, SUN_LATE]) {
    const today = await writeTodaysAgenda(me.id, { now });
    assert.equal(today.doc.agenda_date, "2026-09-27", now.toISOString());
    assert.equal(today.doc.title, "Sunday 27 September");
    assert.notEqual(today.doc.id, monday.doc.id, "not the newest page");
    // Its opening line is about today, not about Monday.
    const first = (today.doc.content ?? [])[0];
    assert.ok(first && first.type !== "divider");
    assert.doesNotMatch(first.text, /Monday/);

    const day = await agendaDayOf(me.id, "2026-09-27", now);
    assert.equal(day?.when, "today");
    assert.equal(day?.today, "2026-09-27");
    assert.equal((await agendaDayOf(me.id, "2026-09-28", now))?.when, "future");
    // Stepping › shows Monday's own page, still Monday's.
    const ahead = await agendaOn(me.id, "2026-09-28", now);
    assert.equal(ahead?.id, monday.doc.id);
    assert.equal(ahead?.title, "Monday 28 September");
    assert.equal((await agendaOn(me.id, "2026-09-27", now))?.id, today.doc.id);
  }

  // Past midnight in Melbourne it is Monday, and the page written ahead
  // (untouched) is today's, brought up to date.
  const mon = await writeTodaysAgenda(me.id, { now: MON_EARLY });
  assert.equal(mon.doc.id, monday.doc.id);
  assert.equal(mon.doc.agenda_date, "2026-09-28");
  assert.equal(mon.doc.title, "Monday 28 September");
});

test("a device in another zone doesn't move the account's today", async () => {
  // The account picked Melbourne, so a phone in Los Angeles isn't adopted.
  assert.equal((await adoptDeviceZone(me.id, LA)).adopted, false);
  assert.equal(await dayZoneFor(pool, me.id, LA), MEL);
  // Sunday 23:45 in Melbourne is Sunday 06:45 in Los Angeles; Monday 00:30
  // in Melbourne is still Sunday there. Today follows Melbourne in both.
  for (const [now, day] of [
    [SUN_LATE, "2026-09-27"],
    [MON_EARLY, "2026-09-28"],
  ] as const) {
    const zone = await dayZoneFor(pool, me.id, LA);
    const list = await todayFor(pool, me.id, now, zone);
    assert.equal(list.day, day);
    assert.equal(list.timezone, MEL);
    assert.equal(
      (await writeTodaysAgenda(me.id, { now })).doc.agenda_date,
      day,
      "the agenda and the Today list name the same day",
    );
  }
  assert.equal(localDateKey(MON_EARLY, LA), "2026-09-27");

  // An account with no zone of its own yet reads the device's.
  const fresh = await register("Fresh");
  assert.equal(await dayZoneFor(pool, fresh.id, LA), LA);
  assert.equal(await dayZoneFor(pool, fresh.id), "UTC");
  assert.equal(dayZone("UTC", true, LA), "UTC", "a chosen UTC stays");
  assert.equal(dayZone("Not/AZone", false, LA), LA);
  assert.equal(dayZone(MEL, false, LA), MEL);
});

test("the agenda turns over at the account's midnight, and never back", () => {
  // Left open on Sunday evening: the next check is at Melbourne's midnight.
  const midnight = nextDayStart(SUN_EVENING, MEL);
  assert.equal(midnight.toISOString(), "2026-09-27T14:00:00.000Z");
  assert.equal(agendaTodayAt("2026-09-27", SUN_LATE, MEL), "2026-09-27");
  assert.equal(
    agendaTodayAt("2026-09-27", new Date(midnight.getTime() + 5_000), MEL),
    "2026-09-28",
  );
  // Not the device's midnight: Los Angeles turns over 17 hours later.
  assert.equal(
    nextDayStart(SUN_EVENING, LA).toISOString(),
    "2026-09-28T07:00:00.000Z",
  );
  // A device behind the account never pulls today back.
  assert.equal(agendaTodayAt("2026-09-28", MON_EARLY, LA), "2026-09-28");
});

test("daylight saving: 23- and 25-hour days turn over at their own midnight", async () => {
  // Melbourne goes forward at 02:00 on Sunday 4 October 2026.
  const sat = new Date("2026-10-03T12:00:00Z"); // Sat 22:00 AEST
  assert.equal(
    nextDayStart(sat, MEL).toISOString(),
    "2026-10-03T14:00:00.000Z",
  );
  const sun = new Date("2026-10-04T01:00:00Z"); // Sun 12:00 AEDT
  const next = nextDayStart(sun, MEL);
  assert.equal(next.toISOString(), "2026-10-04T13:00:00.000Z");
  assert.equal(
    next.getTime() - nextDayStart(sat, MEL).getTime(),
    23 * 3_600_000,
  );
  assert.equal(localDateKey(next, MEL), "2026-10-05");
  // And back at 03:00 on Sunday 5 April 2026: a 25-hour day.
  const apr = new Date("2026-04-04T14:00:00Z"); // Sun 01:00 AEDT
  assert.equal(
    nextDayStart(apr, MEL).getTime() -
      nextDayStart(new Date("2026-04-04T12:00:00Z"), MEL).getTime(),
    25 * 3_600_000,
  );

  // Stepping day by day across the change names each day once.
  const days = [0, 1, 2].map((n) => addDays("2026-10-03", n));
  assert.deepEqual(days, ["2026-10-03", "2026-10-04", "2026-10-05"]);
  assert.deepEqual(days.map(agendaTitleOn), [
    "Saturday 3 October",
    "Sunday 4 October",
    "Monday 5 October",
  ]);
  // The server agrees at the edges of the short day.
  const before = new Date("2026-10-03T13:59:00Z"); // Sat 23:59 AEST
  const after = new Date("2026-10-04T12:59:00Z"); // Sun 23:59 AEDT
  assert.equal((await agendaDayOf(me.id, "2026-10-03", before))?.when, "today");
  assert.equal((await agendaDayOf(me.id, "2026-10-04", after))?.when, "today");
  const ahead = await writeAgendaOn(me.id, "2026-10-04", before);
  assert.equal(ahead?.doc.title, "Sunday 4 October");
});
