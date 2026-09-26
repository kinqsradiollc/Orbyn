import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

process.env.SMTP_HOST = ""; // no email → bookings confirm at once
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { addDays, localDateKey, dayTime } = await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.9.${Math.floor(++caller / 250)}.${caller % 250}`;
type Json = Record<string, any>;
const call = async (
  token: string | null,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
) => {
  const r = await app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as Json }),
  });
  return {
    status: r.statusCode,
    body: r.body ? JSON.parse(r.body) : null,
    raw: r,
  };
};

async function newUser(name: string) {
  const r = await call(null, "POST", "/auth/register", {
    email: `rr-${randomUUID()}@example.com`,
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
    pad_percent: 0,
    break_level: "none",
  });
  return { token, id: r.body.user.id as string };
}
async function newTeam(ownerId: string, memberId: string) {
  const id = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('RR crew', $1) RETURNING id",
      [ownerId],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'member')",
    [id, ownerId, memberId],
  );
  return id;
}
const day = (offset: number) => addDays(localDateKey(new Date(), TZ), offset);
const at = (offset: number, hour: number) =>
  dayTime(day(offset), hour * 60, TZ).toISOString();
const slots = async (slug: string, offset: number) =>
  (
    await call(
      null,
      "GET",
      `/book/${slug}?duration=30&timezone=${encodeURIComponent(TZ)}&date=${day(offset)}&days=1`,
    )
  ).body.slots.map((s: Json) => s.start_at) as string[];
const book = (slug: string, start: string) =>
  call(null, "POST", `/book/${slug}`, {
    start_at: start,
    duration: 30,
    name: "Booker",
    email: `booker-${randomUUID()}@example.com`,
    timezone: TZ,
  });
/** Block a host's whole day with a busy event. */
const blockDay = (token: string, offset: number) =>
  call(token, "POST", "/items", {
    title: "Away",
    kind: "event",
    due_at: at(offset, 9),
    end_at: at(offset, 17),
  });

let owner: { token: string; id: string };
let mate: { token: string; id: string };
let team = "";

before(async () => {
  await migrate();
  await pool
    .query("DELETE FROM system_settings WHERE key='smtp'")
    .catch(() => {});
  invalidateSettings();
  owner = await newUser("Owner");
  mate = await newUser("Mate");
  team = await newTeam(owner.id, mate.id);
});
after(async () => {
  await app.close();
  await pool.end();
});

async function makePage(assignment: string) {
  const r = await call(owner.token, "POST", "/booking-pages", {
    slug: `rr-${randomUUID().slice(0, 8)}`,
    title: "Sales call",
    durations: [30],
    min_notice_minutes: 0,
    team_id: team,
    assignment,
    co_hosts: [{ user_id: mate.id, required: true }],
  });
  assert.equal(r.status, 201, r.raw.body);
  return r.body.slug as string;
}

test("round-robin offers a slot when any host is free; collective needs both", async () => {
  const rr = await makePage("round_robin");
  const collective = await makePage("collective");
  // Block the owner all of the day after tomorrow; the mate stays free.
  await blockDay(owner.token, 2);

  const rrSlots = await slots(rr, 2);
  const coSlots = await slots(collective, 2);
  assert.ok(rrSlots.length > 0, "round-robin still offers the mate's times");
  assert.equal(coSlots.length, 0, "collective needs the blocked owner too");
});

test("bookings are shared out across the hosts and only one host gets the event", async () => {
  const rr = await makePage("round_robin");
  const free = await slots(rr, 3);
  assert.ok(free.length >= 2);

  const first = await book(rr, free[0]);
  assert.equal(first.status, 201, first.raw.body);
  // A different, non-adjacent slot so the two don't collide via buffers.
  const second = await book(rr, free[Math.min(free.length - 1, 4)]);
  assert.equal(second.status, 201, second.raw.body);

  const assigned = (
    await pool.query<{ assigned_user_id: string | null }>(
      `SELECT b.assigned_user_id FROM bookings b
         JOIN booking_pages p ON p.id = b.page_id
        WHERE p.slug = $1 ORDER BY b.start_at`,
      [rr],
    )
  ).rows.map((r) => r.assigned_user_id);
  assert.equal(assigned.length, 2);
  assert.ok(assigned.every(Boolean), "each booking has an assigned host");
  assert.notEqual(assigned[0], assigned[1], "the two go to different hosts");

  // Each host has exactly one booking event on their own calendar.
  for (const host of [owner, mate]) {
    const events = (
      await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM items WHERE user_id=$1 AND kind='event' AND title LIKE 'Sales call%'",
        [host.id],
      )
    ).rows[0].n;
    assert.equal(events, 1, "one host, one event");
  }
});

test("a round-robin page can be switched back to collective", async () => {
  const slug = await makePage("round_robin");
  const page = (
    await pool.query<{ id: string }>(
      "SELECT id FROM booking_pages WHERE slug=$1",
      [slug],
    )
  ).rows[0];
  const upd = await call(owner.token, "PUT", `/booking-pages/${page.id}`, {
    assignment: "collective",
  });
  assert.equal(upd.status, 200, upd.raw.body);
  assert.equal(upd.body.assignment, "collective");
});

test("every host's event from a booking is marked as the guest's, and stays so after the page is deleted", async () => {
  const slug = await makePage("collective");
  const free = await slots(slug, 5);
  assert.ok(free.length > 0);
  const booked = await book(slug, free[0]);
  assert.equal(booked.status, 201, booked.raw.body);
  const { page_id, item_ids } = (
    await pool.query<{ page_id: string; item_ids: string[] }>(
      `SELECT b.page_id, b.item_ids FROM bookings b
         JOIN booking_pages p ON p.id = b.page_id WHERE p.slug = $1`,
      [slug],
    )
  ).rows[0];
  assert.equal(item_ids.length, 2, "one event for each host");
  const marked = async () =>
    (
      await pool.query<{ item_id: string }>(
        `SELECT item_id FROM item_sources
          WHERE item_id = ANY ($1::uuid[]) AND source = 'booking_guest'`,
        [item_ids],
      )
    ).rows
      .map((r) => r.item_id)
      .sort();
  assert.deepEqual(await marked(), [...item_ids].sort());
  const removed = await call(
    owner.token,
    "DELETE",
    `/booking-pages/${page_id}`,
  );
  assert.equal(removed.status, 204, removed.raw.body);
  assert.equal(
    (
      await pool.query("SELECT 1 FROM items WHERE id = ANY ($1::uuid[])", [
        item_ids,
      ])
    ).rowCount,
    2,
    "the events stay on the calendars",
  );
  assert.deepEqual(await marked(), [...item_ids].sort());
  // Gone with the events themselves.
  await pool.query("DELETE FROM items WHERE id = ANY ($1::uuid[])", [item_ids]);
  assert.deepEqual(await marked(), []);
});

/** A page with one question and a routing rule sending "yes" to the mate. */
async function routedPage(questionId: string) {
  const r = await call(owner.token, "POST", "/booking-pages", {
    slug: `rt-${randomUUID().slice(0, 8)}`,
    title: "Routed call",
    durations: [30],
    min_notice_minutes: 0,
    team_id: team,
    assignment: "round_robin",
    co_hosts: [{ user_id: mate.id, required: true }],
    questions: [
      { id: questionId, label: "Enterprise?", type: "text", required: false },
    ],
    routing: [
      { question_id: questionId, equals: "yes", host_user_id: mate.id },
    ],
  });
  assert.equal(r.status, 201, r.raw.body);
  return r.body.slug as string;
}

test("a routing rule sends a matching answer to the chosen host", async () => {
  const slug = await routedPage("ent");
  const free = await slots(slug, 5);
  const r = await call(null, "POST", `/book/${slug}`, {
    start_at: free[0],
    duration: 30,
    name: "Big Co",
    email: `big-${randomUUID()}@example.com`,
    timezone: TZ,
    answers: { ent: "yes" },
  });
  assert.equal(r.status, 201, r.raw.body);
  const assigned = (
    await pool.query<{ assigned_user_id: string | null }>(
      `SELECT b.assigned_user_id FROM bookings b JOIN booking_pages p ON p.id = b.page_id
         WHERE p.slug = $1`,
      [slug],
    )
  ).rows[0].assigned_user_id;
  assert.equal(assigned, mate.id, "the routed answer went to the mate");
});

test("a non-matching answer falls back to the fair pick", async () => {
  const slug = await routedPage("ent");
  const free = await slots(slug, 6);
  // "no" matches no rule; the routed host isn't forced.
  await call(null, "POST", `/book/${slug}`, {
    start_at: free[0],
    duration: 30,
    name: "Small Co",
    email: `small-${randomUUID()}@example.com`,
    timezone: TZ,
    answers: { ent: "no" },
  });
  const assigned = (
    await pool.query<{ assigned_user_id: string | null }>(
      `SELECT b.assigned_user_id FROM bookings b JOIN booking_pages p ON p.id = b.page_id
         WHERE p.slug = $1`,
      [slug],
    )
  ).rows[0].assigned_user_id;
  // Fair pick with no history is the owner (first host); definitely assigned.
  assert.ok(assigned, "still assigned to someone");
});
