import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

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

test("writes are refused (read-only)", async () => {
  const r = await dav("PUT", "/dav/cal/default/new.ics", "BEGIN:VCALENDAR");
  assert.equal(r.statusCode, 403);
});
