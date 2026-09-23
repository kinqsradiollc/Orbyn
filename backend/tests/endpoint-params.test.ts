import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Where the apps and the API disagreed on a parameter: search on the
 * bookings export, sign-in and sign-up input, field names in validation
 * errors, frame weekdays under a repeat rule, and the calendar feed link
 * behind the /api proxy.
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { addDays, localDateKey } = await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.9.${Math.floor(++caller / 250)}.${caller % 250}`;

type Json = Record<string, any>;
async function call(
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  const r = await app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
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
    email: `params-${randomUUID()}@example.com`,
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

const day = (offset: number) => addDays(localDateKey(new Date(), TZ), offset);

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

test("the bookings export follows the search box", async () => {
  const host = await newUser();
  const page = await call(host.token, "POST", "/booking-pages", {
    slug: `pg-${randomUUID().slice(0, 8)}`,
    title: "Intro call",
    durations: [30],
    min_notice_minutes: 0,
    window_days: 14,
  });
  assert.equal(page.status, 201, page.raw.body);
  const open = await call(
    null,
    "GET",
    `/book/${page.body.slug}?duration=30&timezone=${encodeURIComponent(TZ)}&date=${day(1)}&days=1`,
  );
  const starts = open.body.slots.map((s: Json) => s.start_at) as string[];
  for (const [start, name] of [
    [starts[0], "Rita Moreno"],
    [starts[8], "Omar Little"],
  ]) {
    const booked = await call(null, "POST", `/book/${page.body.slug}`, {
      start_at: start,
      duration: 30,
      name,
      email: `${name.split(" ")[0].toLowerCase()}@example.com`,
      timezone: TZ,
    });
    assert.equal(booked.status, 201, booked.raw.body);
  }
  const csv = await call(
    host.token,
    "GET",
    "/bookings/export.csv?view=all&q=rita",
  );
  assert.equal(csv.status, 200, csv.raw.body);
  const lines = (csv.raw.body as string).trim().split("\r\n");
  assert.equal(lines.length, 2);
  assert.match(lines[1], /Rita Moreno/);
});

test("sign-up and sign-in take the input the apps send", async () => {
  const email = `params-${randomUUID()}@example.com`;
  // A blank name (the field was left empty) and a padded, capitalised email.
  const reg = await call(null, "POST", "/auth/register", {
    email: `  ${email.toUpperCase()} `,
    password: "a-long-test-password",
    name: "   ",
  });
  assert.equal(reg.status, 201, reg.raw.body);
  assert.equal(reg.body.user.email, email);
  assert.equal(reg.body.user.name, "My space");
  // A wrong password shorter than the sign-up minimum is just incorrect.
  const short = await call(null, "POST", "/auth/login", {
    email,
    password: "short",
  });
  assert.equal(short.status, 401, short.raw.body);
  assert.match(short.body.message, /incorrect/);
  const ok = await call(null, "POST", "/auth/login", {
    email: `${email} `,
    password: "a-long-test-password",
  });
  assert.equal(ok.status, 200, ok.raw.body);
});

test("validation errors name the field to fix", async () => {
  const me = await newUser();
  const bad = await call(me.token, "POST", "/booking-pages", {
    slug: "Not A Slug!",
    title: "Bad",
    durations: [30],
  });
  assert.equal(bad.status, 422);
  // Plain words that still name the field, and the request id for the logs.
  assert.match(bad.body.message, /^Slug: Use lowercase letters/);
  assert.ok(bad.body.request_id);
});

test("validation errors are plain sentences, with the detail kept out of sight", async () => {
  const me = await newUser();
  const missing = await call(me.token, "POST", "/items", { kind: "task" });
  assert.equal(missing.status, 422);
  assert.equal(missing.body.message, "Title is missing.");
  const long = await call(me.token, "POST", "/items", {
    title: "x".repeat(300),
  });
  assert.equal(long.body.message, "Title is too long: 200 characters at most.");
  // The raw issues only go out with DEBUG_ERRORS on (off in tests).
  assert.equal(long.body.detail, undefined);
  const nowhere = await call(me.token, "GET", "/no-such-route");
  assert.equal(nowhere.status, 404);
  assert.equal(nowhere.body.message, "That isn't here any more.");
});

test("a frame with a repeat rule takes its weekdays from the rule", async () => {
  const me = await newUser();
  const frame = await call(me.token, "POST", "/planner/frames", {
    name: "Deep work",
    days: [1, 2, 3, 4, 5],
    start_time: "09:00",
    end_time: "11:00",
    rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
  });
  assert.equal(frame.status, 201, frame.raw.body);
  assert.deepEqual(frame.body.days, [1, 3]);
  const edited = await call(
    me.token,
    "PUT",
    `/planner/frames/${frame.body.id}`,
    { days: [0, 6], rrule: "FREQ=WEEKLY;BYDAY=FR" },
  );
  assert.equal(edited.status, 200, edited.raw.body);
  assert.deepEqual(edited.body.days, [5]);
});

test("the calendar feed link keeps the proxy's prefix and scheme", async () => {
  const me = await newUser();
  const feed = await call(me.token, "POST", "/me/calendar-feed", undefined, {
    "x-forwarded-host": "orbyn.example",
    "x-forwarded-proto": "https",
    "x-forwarded-prefix": "/api",
  });
  assert.equal(feed.status, 200, feed.raw.body);
  assert.match(
    feed.body.url,
    /^https:\/\/orbyn\.example\/api\/calendar\/feed\/.+\.ics$/,
  );
});
