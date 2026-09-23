import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * The planner zone follows the device until someone picks one: without it,
 * everything the server writes (agendas, digests, reminders) and working
 * hours were in UTC for anyone who never opened Planning settings.
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
let caller = 0;
const address = () => `10.15.${Math.floor(++caller / 250)}.${caller % 250}`;

async function call(
  token: string,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
) {
  const r = await app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: r.statusCode, body: r.body ? r.json() : null, raw: r };
}
async function newUser() {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: address(),
    payload: {
      email: `tz-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Traveller",
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().token as string;
}
const zone = async (token: string) =>
  (await call(token, "GET", "/planner/prefs")).body.timezone as string;

before(() => migrate());
after(async () => {
  await app.close();
  await pool.end();
});

test("the device's zone is adopted until one is picked in settings", async () => {
  const me = await newUser();
  assert.equal(await zone(me), "UTC");
  const first = await call(me, "POST", "/me/timezone", {
    timezone: "Australia/Melbourne",
  });
  assert.equal(first.status, 200, first.raw.body);
  assert.equal(first.body.adopted, true);
  assert.equal(await zone(me), "Australia/Melbourne");
  // Nothing to do the second time, and nonsense is ignored.
  assert.equal(
    (
      await call(me, "POST", "/me/timezone", {
        timezone: "Australia/Melbourne",
      })
    ).body.adopted,
    false,
  );
  assert.equal(
    (await call(me, "POST", "/me/timezone", { timezone: "Mars/Olympus" })).body
      .adopted,
    false,
  );
  // Picking a zone in settings is a choice the device never overrides —
  // even UTC.
  await call(me, "PUT", "/planner/prefs", { timezone: "UTC" });
  assert.equal(
    (await call(me, "POST", "/me/timezone", { timezone: "Europe/London" })).body
      .adopted,
    false,
  );
  assert.equal(await zone(me), "UTC");
});

test("an agenda written in the wrong zone is written again once the zone is right", async () => {
  const me = await newUser();
  // Yesterday's page is part of the diary and must survive.
  const userId = (await call(me, "GET", "/me")).body.id;
  const yesterday = (
    await pool.query<{ id: string }>(
      `INSERT INTO docs (user_id, title, kind, content, created_at)
       VALUES ($1, 'Yesterday', 'agenda', '[]'::jsonb, now() - interval '20 hours') RETURNING id`,
      [userId],
    )
  ).rows[0].id;
  const utc = (await call(me, "GET", "/agenda/today")).body;
  await call(me, "POST", "/me/timezone", { timezone: "Pacific/Kiritimati" });
  const fixed = (await call(me, "GET", "/agenda/today")).body;
  assert.notEqual(fixed.id, utc.id, "the untouched page was replaced");
  assert.equal(
    (await pool.query("SELECT 1 FROM docs WHERE id = $1", [yesterday]))
      .rowCount,
    1,
    "yesterday's agenda is kept",
  );
});

test("opening the agenda with the device's zone writes it in that zone", async () => {
  const me = await newUser();
  const doc = (
    await call(me, "GET", "/agenda/today?timezone=Pacific%2FKiritimati")
  ).body;
  const expected = new Date().toLocaleDateString("en-GB", {
    timeZone: "Pacific/Kiritimati",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  assert.equal(doc.title, expected);
  assert.equal(await zone(me), "Pacific/Kiritimati");
});
