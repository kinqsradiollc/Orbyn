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

test("editing a team event from a calendar app keeps it in the team, with what the .ics leaves out", async () => {
  // Three people on one team, each with a key for their calendar app.
  const person = async (name: string) => {
    const address = `dav-${name.toLowerCase()}-${randomUUID()}@example.com`;
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: address, password: "a-long-test-password", name },
    });
    const token = reg.json().token as string;
    const made = await app.inject({
      method: "POST",
      url: "/me/api-keys",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Calendar" },
    });
    const key = made.json().key as string;
    const auth = "Basic " + Buffer.from(`${address}:${key}`).toString("base64");
    return {
      id: reg.json().user.id as string,
      email: address,
      api: (
        method: "GET" | "POST" | "PUT" | "DELETE",
        url: string,
        payload?: object,
      ) =>
        app.inject({
          method,
          url,
          headers: { authorization: `Bearer ${token}` },
          ...(payload ? { payload } : {}),
        }),
      dav: (method: "GET" | "PUT" | "DELETE", url: string, body?: string) =>
        app.inject({
          method,
          url,
          headers: {
            authorization: auth,
            ...(body ? { "content-type": "text/calendar" } : {}),
          },
          ...(body ? { payload: body } : {}),
        }),
    };
  };
  const owner = await person("Owner");
  const member = await person("Member");
  const viewer = await person("Viewer");
  const team = (await owner.api("POST", "/teams", { name: "Studio" })).json();
  for (const [who, role] of [
    [member, "member"],
    [viewer, "viewer"],
  ] as const)
    assert.equal(
      (
        await owner.api("POST", `/teams/${team.id}/members`, {
          email: who.email,
          role,
        })
      ).statusCode,
      201,
    );
  const list = (
    await owner.api("POST", "/lists", { name: "Studio work", team_id: team.id })
  ).json();
  const tag = (
    await owner.api("POST", "/tags", { name: "client", team_id: team.id })
  ).json();
  const start = Date.now() + 4 * 86_400_000;
  const teamEvent = async (by: typeof owner, title: string) => {
    const made = await by.api("POST", "/items", {
      title,
      kind: "event",
      team_id: team.id,
      due_at: new Date(start).toISOString(),
      end_at: new Date(start + 3_600_000).toISOString(),
      notes: "Bring the drafts.",
      location: "Studio",
      meeting_url: "https://meet.example.com/studio",
      priority: "high",
      list_id: list.id,
      tag_ids: [tag.id],
      alerts: [10, 60],
      color: "#376c51",
      busy: false,
      attendees: [{ email: "guest@example.com", name: "Guest" }],
    });
    assert.equal(made.statusCode, 201, made.body);
    return made.json() as { id: string; user_id: string };
  };
  // What the calendar app sends back: the event as served, one field changed.
  const edited = async (by: typeof owner, id: string, title: string) => {
    const got = await by.dav("GET", `/dav/cal/default/${id}.ics`);
    assert.equal(got.statusCode, 200, got.body);
    assert.match(got.body, /DESCRIPTION:Bring the drafts\.\\n\\nhttps:/);
    return got.body.replace(/SUMMARY:[^\r\n]*/, `SUMMARY:${title}`);
  };
  const kept = async (id: string, title: string, userId: string) => {
    // Everyone on the team still has it, as it was apart from the title.
    for (const who of [owner, member, viewer]) {
      const r = await who.api("GET", `/items/${id}`);
      assert.equal(r.statusCode, 200, r.body);
    }
    const item = (await member.api("GET", `/items/${id}`)).json();
    assert.equal(item.title, title);
    assert.equal(item.team_id, team.id);
    assert.equal(item.user_id, userId);
    assert.equal(item.priority, "high");
    assert.equal(item.status, "todo");
    assert.equal(item.list_id, list.id);
    assert.deepEqual(item.tag_ids, [tag.id]);
    assert.deepEqual(item.alerts, [10, 60]);
    assert.equal(item.color, "#376c51");
    assert.equal(item.busy, false);
    assert.equal(item.location, "Studio");
    assert.equal(item.meeting_url, "https://meet.example.com/studio");
    // The link the feed adds to the description isn't copied into the notes.
    assert.equal(item.notes, "Bring the drafts.");
    assert.deepEqual(
      (item.attendees ?? []).map((a: { email: string }) => a.email),
      ["guest@example.com"],
    );
  };

  // A member edits a teammate's team event from Apple Calendar.
  const owners = await teamEvent(owner, "Client review");
  const put = await member.dav(
    "PUT",
    `/dav/cal/default/${owners.id}.ics`,
    await edited(member, owners.id, "Client review (moved)"),
  );
  assert.equal(put.statusCode, 204, put.body);
  await kept(owners.id, "Client review (moved)", owner.id);
  // Twice, so nothing piles up in the notes on a second round trip.
  assert.equal(
    (
      await member.dav(
        "PUT",
        `/dav/cal/default/${owners.id}.ics`,
        await edited(member, owners.id, "Client review (moved again)"),
      )
    ).statusCode,
    204,
  );
  await kept(owners.id, "Client review (moved again)", owner.id);

  // The owner edits a member's: it stays the team's, and the member's.
  const members = await teamEvent(member, "Studio standup");
  assert.equal(
    (
      await owner.dav(
        "PUT",
        `/dav/cal/default/${members.id}.ics`,
        await edited(owner, members.id, "Studio standup (owner)"),
      )
    ).statusCode,
    204,
  );
  await kept(members.id, "Studio standup (owner)", member.id);

  // A viewer sees team events but can't change or remove them.
  const refused = await viewer.dav(
    "PUT",
    `/dav/cal/default/${members.id}.ics`,
    await edited(viewer, members.id, "Taken over"),
  );
  assert.equal(refused.statusCode, 403, refused.body);
  assert.equal(
    (await viewer.dav("DELETE", `/dav/cal/default/${members.id}.ics`))
      .statusCode,
    403,
  );
  await kept(members.id, "Studio standup (owner)", member.id);

  // A member may remove a team event, as in the app.
  assert.equal(
    (await member.dav("DELETE", `/dav/cal/default/${owners.id}.ics`))
      .statusCode,
    204,
  );
  assert.equal((await owner.api("GET", `/items/${owners.id}`)).statusCode, 404);
});
