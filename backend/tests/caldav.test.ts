import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { parseICalendar } = await import("../src/modules/dav/ical.js");

const app = await buildApp();
let session = "";
let apiKey = "";
let email = "";

const basic = () =>
  "Basic " + Buffer.from(`${email}:${apiKey}`).toString("base64");
const dav = (method: string, url: string, body?: string, depth = "0") =>
  app.inject({
    method: method as "GET",
    url,
    headers: {
      authorization: basic(),
      depth,
      ...(body ? { "content-type": "application/xml" } : {}),
    },
    ...(body ? { payload: body } : {}),
  });

const putEvent = (url: string, ics: string) =>
  app.inject({
    method: "PUT",
    url,
    headers: { authorization: basic(), "content-type": "text/calendar" },
    payload: ics,
  });

const vevent = (fields: string) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    "BEGIN:VEVENT",
    fields,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

before(async () => {
  await migrate();
  email = `dav-${randomUUID()}@example.com`;
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "a-long-test-password", name: "Dav" },
  });
  session = reg.json().token;
  apiKey = (
    await app.inject({
      method: "POST",
      url: "/me/api-keys",
      headers: { authorization: `Bearer ${session}` },
      payload: { name: "CalDAV" },
    })
  ).json().key;
  // An event to serve.
  await app.inject({
    method: "POST",
    url: "/items",
    headers: { authorization: `Bearer ${session}` },
    payload: {
      title: "Design review",
      kind: "event",
      due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      end_at: new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString(),
      location: "Room 4",
    },
  });
});
after(async () => {
  await app.close();
  await pool.end();
});

test("CalDAV needs Basic auth with an API key", async () => {
  const r = await app.inject({
    method: "PROPFIND",
    url: "/dav/",
    headers: { depth: "0" },
  });
  assert.equal(r.statusCode, 401);
  assert.match(r.headers["www-authenticate"] as string, /Basic/);
  const wrong = await app.inject({
    method: "PROPFIND",
    url: "/dav/",
    headers: {
      authorization: "Basic " + Buffer.from("x:ok_nope").toString("base64"),
    },
  });
  assert.equal(wrong.statusCode, 401);
});

test("discovery points at the calendar home", async () => {
  const r = await dav("PROPFIND", "/dav/");
  assert.equal(r.statusCode, 207, r.body);
  assert.match(r.body, /calendar-home-set/);
  assert.match(r.body, /\/dav\/cal\//);
});

test("the calendar collection advertises VEVENT and a ctag", async () => {
  const r = await dav("PROPFIND", "/dav/cal/default/", undefined, "0");
  assert.equal(r.statusCode, 207, r.body);
  assert.match(r.body, /<C:calendar\/>/);
  assert.match(r.body, /VEVENT/);
  assert.match(r.body, /getctag/);
});

test("Depth 1 lists the event resources", async () => {
  const r = await dav("PROPFIND", "/dav/cal/default/", undefined, "1");
  assert.equal(r.statusCode, 207, r.body);
  assert.match(r.body, /\/dav\/cal\/default\/[0-9a-f-]+\.ics/);
});

test("a calendar-query REPORT returns the event as VEVENT data", async () => {
  const query =
    '<?xml version="1.0"?><C:calendar-query xmlns:C="urn:ietf:params:xml:data:caldav"><C:filter/></C:calendar-query>';
  const r = await dav("REPORT", "/dav/cal/default/", query, "1");
  assert.equal(r.statusCode, 207, r.body);
  assert.match(r.body, /calendar-data/);
  assert.match(r.body, /BEGIN:VEVENT/);
  assert.match(r.body, /SUMMARY:Design review/);
});

test("GET returns one event as an .ics file", async () => {
  const list = await dav("PROPFIND", "/dav/cal/default/", undefined, "1");
  const href = list.body.match(/\/dav\/cal\/default\/[0-9a-f-]+\.ics/)![0];
  const r = await dav("GET", href);
  assert.equal(r.statusCode, 200, r.body);
  assert.match(r.headers["content-type"] as string, /text\/calendar/);
  assert.match(r.body, /BEGIN:VCALENDAR/);
  assert.match(r.body, /Design review/);
});

test("the parser reads times, all-day dates and a repeat rule", () => {
  const timed = parseICalendar(
    vevent(
      "UID:p1\r\nDTSTART:20261001T090000Z\r\nDTEND:20261001T100000Z\r\nSUMMARY:Call\r\nRRULE:FREQ=WEEKLY",
    ),
    "UTC",
  )!;
  assert.equal(timed.uid, "p1");
  assert.equal(timed.title, "Call");
  assert.equal(timed.all_day, false);
  assert.equal(timed.due_at, "2026-10-01T09:00:00.000Z");
  assert.equal(timed.end_at, "2026-10-01T10:00:00.000Z");
  assert.equal(timed.rrule, "FREQ=WEEKLY");
  const allDay = parseICalendar(
    vevent("UID:p2\r\nDTSTART;VALUE=DATE:20261005\r\nSUMMARY:Holiday"),
    "UTC",
  )!;
  assert.equal(allDay.all_day, true);
  assert.equal(allDay.due_at, "2026-10-05T00:00:00.000Z");
  const zoned = parseICalendar(
    vevent(
      "UID:p3\r\nDTSTART;TZID=America/New_York:20261001T090000\r\nSUMMARY:NY",
    ),
    "UTC",
  )!;
  // 09:00 New York in October (EDT, UTC-4) is 13:00 UTC.
  assert.equal(zoned.due_at, "2026-10-01T13:00:00.000Z");
});

test("a client can create an event, which then syncs back", async () => {
  const r = await putEvent(
    "/dav/cal/default/client-evt.ics",
    vevent(
      "UID:client-evt\r\nDTSTART:20261001T090000Z\r\nDTEND:20261001T100000Z\r\nSUMMARY:Client made this\r\nLOCATION:Cafe",
    ),
  );
  assert.equal(r.statusCode, 201, r.body);
  // It keeps the client's UID as its href.
  const list = await dav("PROPFIND", "/dav/cal/default/", undefined, "1");
  assert.match(list.body, /\/dav\/cal\/default\/client-evt\.ics/);
  const got = await dav("GET", "/dav/cal/default/client-evt.ics");
  assert.equal(got.statusCode, 200, got.body);
  assert.match(got.body, /SUMMARY:Client made this/);
  assert.match(got.body, /LOCATION:Cafe/);
});

test("a second PUT to the same href edits the event", async () => {
  const r = await putEvent(
    "/dav/cal/default/client-evt.ics",
    vevent(
      "UID:client-evt\r\nDTSTART:20261001T090000Z\r\nDTEND:20261001T103000Z\r\nSUMMARY:Renamed",
    ),
  );
  assert.equal(r.statusCode, 204, r.body);
  const got = await dav("GET", "/dav/cal/default/client-evt.ics");
  assert.match(got.body, /SUMMARY:Renamed/);
  assert.doesNotMatch(got.body, /Client made this/);
});

test("an all-day event round-trips as VALUE=DATE", async () => {
  const r = await putEvent(
    "/dav/cal/default/allday.ics",
    vevent("UID:allday\r\nDTSTART;VALUE=DATE:20261005\r\nSUMMARY:Day off"),
  );
  assert.equal(r.statusCode, 201, r.body);
  const got = await dav("GET", "/dav/cal/default/allday.ics");
  assert.match(got.body, /DTSTART;VALUE=DATE:20261005/);
});

test("a bad body is a 400, not a 500", async () => {
  const r = await putEvent("/dav/cal/default/nope.ics", "not a calendar");
  assert.equal(r.statusCode, 400, r.body);
});

test("DELETE removes the event", async () => {
  const del = await dav("DELETE", "/dav/cal/default/client-evt.ics");
  assert.equal(del.statusCode, 204, del.body);
  const got = await dav("GET", "/dav/cal/default/client-evt.ics");
  assert.equal(got.statusCode, 404);
  const missing = await dav("DELETE", "/dav/cal/default/client-evt.ics");
  assert.equal(missing.statusCode, 404);
});

test("clients still can't rename or make calendars", async () => {
  assert.equal((await dav("PROPPATCH", "/dav/cal/default/")).statusCode, 403);
  assert.equal((await dav("MKCALENDAR", "/dav/cal/other/")).statusCode, 403);
});

test("CalDAV shows the events the app does: your teams' while you're on them", async () => {
  const asMe = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${session}` },
      ...(payload ? { payload } : {}),
    });
  const mate = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `dav-mate-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Mate",
    },
  });
  const mateToken = mate.json().token as string;
  const asMate = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${mateToken}` },
      ...(payload ? { payload } : {}),
    });
  const soon = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString();

  // A team the teammate runs, with me in it.
  const team = (await asMate("POST", "/teams", { name: "Crew" })).json();
  const myId = (await asMe("GET", "/me")).json().id as string;
  const myEmail = (await asMe("GET", "/me")).json().email as string;
  assert.equal(
    (
      await asMate("POST", `/teams/${team.id}/members`, {
        email: myEmail,
        role: "member",
      })
    ).statusCode,
    201,
  );
  const tagBefore = (
    await dav("PROPFIND", "/dav/cal/default/", undefined, "0")
  ).body.match(/<CS:getctag>([^<]+)</)![1];

  // The teammate's team event reaches my calendar app, as it does the app.
  const theirs = (
    await asMate("POST", "/items", {
      title: "Crew standup",
      kind: "event",
      team_id: team.id,
      due_at: soon(2),
      end_at: soon(2.01),
    })
  ).json();
  const listed = await dav("PROPFIND", "/dav/cal/default/", undefined, "1");
  assert.match(listed.body, new RegExp(`${theirs.id}\\.ics`));
  const tagAfter = listed.body.match(/<CS:getctag>([^<]+)</)![1];
  assert.notEqual(tagAfter, tagBefore);
  const report = await dav(
    "REPORT",
    "/dav/cal/default/",
    '<?xml version="1.0"?><C:calendar-query xmlns:C="urn:ietf:params:xml:data:caldav"><C:filter/></C:calendar-query>',
    "1",
  );
  assert.match(report.body, /SUMMARY:Crew standup/);

  // An event I made in the team is the team's: once I leave, it goes.
  const mine = (
    await asMe("POST", "/items", {
      title: "Crew retro",
      kind: "event",
      team_id: team.id,
      due_at: soon(3),
    })
  ).json();
  assert.equal(
    (await dav("GET", `/dav/cal/default/${mine.id}.ics`)).statusCode,
    200,
  );
  assert.equal(
    (await asMe("DELETE", `/teams/${team.id}/members/${myId}`)).statusCode,
    204,
  );
  const gone = await dav("PROPFIND", "/dav/cal/default/", undefined, "1");
  assert.doesNotMatch(gone.body, new RegExp(`${mine.id}|${theirs.id}`));
  assert.equal(
    (await dav("GET", `/dav/cal/default/${mine.id}.ics`)).statusCode,
    404,
  );
  assert.equal(
    (await dav("GET", `/dav/cal/default/${theirs.id}.ics`)).statusCode,
    404,
  );
  const afterLeaving = await dav(
    "REPORT",
    "/dav/cal/default/",
    '<?xml version="1.0"?><C:calendar-query xmlns:C="urn:ietf:params:xml:data:caldav"><C:filter/></C:calendar-query>',
    "1",
  );
  assert.doesNotMatch(afterLeaving.body, /Crew (standup|retro)/);
  // And it can't be changed or removed from there either.
  assert.equal(
    (await dav("DELETE", `/dav/cal/default/${mine.id}.ics`)).statusCode,
    404,
  );
  const stillThere = await asMate("GET", `/items/${mine.id}`);
  assert.equal(stillThere.statusCode, 200);
  assert.equal(stillThere.json().title, "Crew retro");
  // A task never shows over CalDAV, even with a date.
  const task = (
    await asMe("POST", "/items", {
      title: "Dated task",
      kind: "task",
      due_at: soon(1),
    })
  ).json();
  assert.equal(
    (await dav("GET", `/dav/cal/default/${task.id}.ics`)).statusCode,
    404,
  );
});
