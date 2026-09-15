import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Booking pages end to end: custom hours, overrides, intervals, buffers and
 * limits; questions; host approval; the booker's manage link; and the host's
 * inbox, stats, export and actions.
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { decryptSecret } = await import("../src/lib/secrets.js");
const { addDays, localDateKey, dayTime } = await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.7.${Math.floor(++caller / 250)}.${caller % 250}`;

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
    email: `book-${randomUUID()}@example.com`,
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

const day = (offset: number) => addDays(localDateKey(new Date(), TZ), offset);
/** A Melbourne wall-clock time on the day `offset` days from today. */
const local = (offset: number, hour: number, minute = 0) =>
  dayTime(day(offset), hour * 60 + minute, TZ).toISOString();

async function newPage(token: string, data: Json = {}) {
  const r = await call(token, "POST", "/booking-pages", {
    slug: `pg-${randomUUID().slice(0, 8)}`,
    title: "Intro call",
    durations: [30],
    min_notice_minutes: 0,
    window_days: 14,
    ...data,
  });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}

/** Start times the public page offers on one day. */
async function slots(slug: string, offset: number) {
  const r = await call(
    null,
    "GET",
    `/book/${slug}?duration=30&timezone=${encodeURIComponent(TZ)}&date=${day(offset)}&days=1`,
  );
  assert.equal(r.status, 200, r.raw.body);
  return r.body.slots.map((s: Json) => s.start_at) as string[];
}

const book = (slug: string, start: string, extra: Json = {}) =>
  call(null, "POST", `/book/${slug}`, {
    start_at: start,
    duration: 30,
    name: "Sam Lee",
    email: "sam@example.com",
    timezone: TZ,
    ...extra,
  });

/** The booker's manage link token, as their email would carry it. */
const manageToken = async (bookingId: string) =>
  decryptSecret(
    (
      await pool.query<{ manage_token_encrypted: string }>(
        "SELECT manage_token_encrypted FROM bookings WHERE id = $1",
        [bookingId],
      )
    ).rows[0].manage_token_encrypted,
  );

before(async () => {
  await migrate();
  // Bookings confirm straight away only when no SMTP server is set.
  await pool
    .query("DELETE FROM system_settings WHERE key = 'smtp'")
    .catch(() => {});
  invalidateSettings();
});

after(async () => {
  await app.close();
  await pool.end();
});

test("pages set their own hours, date overrides, interval and buffers", async () => {
  const host = await newUser();
  const page = await newPage(host.token, {
    availability: {
      mode: "custom",
      timezone: TZ,
      weekly: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        day: d,
        start: "13:00",
        end: "15:00",
      })),
    },
    date_overrides: [
      { date: day(2), hours: [] },
      { date: day(3), hours: [{ start: "18:00", end: "19:00" }] },
    ],
    slot_interval_minutes: 30,
    buffer_before_minutes: 15,
  });
  assert.equal(page.buffer_after_minutes, 0);
  assert.equal(page.color, "#376c51");
  assert.equal(page.event_title, "{page} with {name}");
  assert.deepEqual(await slots(page.slug, 4), [
    local(4, 13),
    local(4, 13, 30),
    local(4, 14),
    local(4, 14, 30),
  ]);
  // Closed on one day; evening hours, outside working hours, on another.
  assert.deepEqual(await slots(page.slug, 2), []);
  assert.deepEqual(await slots(page.slug, 3), [local(3, 18), local(3, 18, 30)]);
  // A meeting at 14:00 takes 14:00 and, needing 15 minutes before, 14:30 too.
  await call(host.token, "POST", "/items", {
    kind: "event",
    title: "Standup",
    due_at: local(1, 14),
    end_at: local(1, 14, 30),
  });
  assert.deepEqual(await slots(page.slug, 1), [local(1, 13), local(1, 13, 30)]);

  const alias = await newPage(host.token, { buffer_minutes: 10 });
  assert.equal(alias.buffer_before_minutes, 10);
  assert.equal(alias.buffer_after_minutes, 10);
  const bad = await call(host.token, "POST", "/booking-pages", {
    slug: `pg-${randomUUID().slice(0, 8)}`,
    title: "Bad",
    durations: [30],
    questions: [
      { id: "size", label: "Size", type: "choice", options: ["one"] },
    ],
  });
  assert.ok([400, 422].includes(bad.status), bad.raw.body);
});

test("daily and weekly limits count the page's own bookings", async () => {
  const host = await newUser();
  const page = await newPage(host.token, { max_per_week: 1 });
  const open = await slots(page.slug, 1);
  assert.ok(open.length > 1);
  assert.equal((await book(page.slug, open[0])).status, 201);
  assert.deepEqual(await slots(page.slug, 1), []);
  // A week later is another week.
  assert.ok((await slots(page.slug, 8)).length > 0);
});

test("booking questions are checked, kept and shown to the host", async () => {
  const host = await newUser();
  const page = await newPage(host.token, {
    questions: [
      { id: "company", label: "Company", type: "text", required: true },
      {
        id: "size",
        label: "Team size",
        type: "choice",
        options: ["1-10", "11-50"],
      },
    ],
    event_title: "{name} · {page}",
    confirmation_message: "Bring your roadmap.",
    color: "#7a3cff",
  });
  const pub = await call(null, "GET", `/book/${page.slug}`);
  assert.equal(pub.body.color, "#7a3cff");
  assert.deepEqual(
    pub.body.questions.map((q: Json) => q.id),
    ["company", "size"],
  );
  const [first] = await slots(page.slug, 1);
  const missing = await book(page.slug, first);
  assert.equal(missing.status, 422);
  assert.match(missing.body.message, /Company/);
  const wrong = await book(page.slug, first, {
    answers: { company: "Acme", size: "500" },
  });
  assert.equal(wrong.status, 422);
  const ok = await book(page.slug, first, {
    answers: { company: "Acme", size: "11-50", extra: "ignored" },
  });
  assert.equal(ok.status, 201, ok.raw.body);
  assert.equal(ok.body.confirmation_message, "Bring your roadmap.");
  const detail = await call(host.token, "GET", `/bookings/${ok.body.id}`);
  assert.equal(detail.status, 200, detail.raw.body);
  assert.deepEqual(detail.body.answers, { company: "Acme", size: "11-50" });
  assert.equal(detail.body.questions.length, 2);
  const events = await call(host.token, "GET", "/items?q=Sam");
  assert.equal(events.body[0].title, "Sam Lee · Intro call");
  assert.match(events.body[0].notes, /Company: Acme/);
});

test("pages that need approval hold the time until the host decides", async () => {
  const host = await newUser();
  const page = await newPage(host.token, { requires_approval: true });
  const open = await slots(page.slug, 1);
  const [first, second] = [open[0], open[8]];
  const asked = await book(page.slug, first);
  assert.equal(asked.status, 201, asked.raw.body);
  assert.equal(asked.body.status, "awaiting_approval");
  assert.equal(asked.body.needs_approval, true);
  assert.ok(!(await slots(page.slug, 1)).includes(first));
  assert.equal(
    (await call(host.token, "GET", "/items?q=Intro")).body.length,
    0,
  );

  const inbox = await call(host.token, "GET", "/bookings?view=needs_approval");
  assert.equal(inbox.body.total, 1);
  assert.equal(inbox.body.rows[0].status, "awaiting_approval");
  const pages = await call(host.token, "GET", "/booking-pages");
  assert.equal(
    pages.body.find((p: Json) => p.id === page.id).counts.needs_approval,
    1,
  );
  const notice = (await call(host.token, "GET", "/notifications")).body.find(
    (n: Json) => n.ref === asked.body.id,
  );
  assert.equal(notice.kind, "booking");
  assert.equal(notice.item_id, null);
  assert.match(notice.title, /Booking request/);
  assert.equal(
    (await call(host.token, "POST", `/notifications/${notice.id}/read`)).status,
    204,
  );

  const approved = await call(
    host.token,
    "POST",
    `/bookings/${asked.body.id}/approve`,
  );
  assert.equal(approved.status, 200, approved.raw.body);
  assert.equal(approved.body.status, "confirmed");
  assert.deepEqual(
    approved.body.events.map((e: Json) => e.kind),
    ["requested", "approved", "confirmed"],
  );
  assert.equal(approved.body.events[1].actor_name, "Planner");
  assert.equal(
    (await call(host.token, "GET", "/items?q=Intro")).body.length,
    1,
  );
  assert.equal(
    (await call(host.token, "POST", `/bookings/${asked.body.id}/approve`))
      .status,
    409,
  );

  const other = await book(page.slug, second, {
    name: "Alex Kim",
    email: "alex@example.com",
  });
  assert.ok(!(await slots(page.slug, 1)).includes(second));
  const declined = await call(
    host.token,
    "POST",
    `/bookings/${other.body.id}/decline`,
    { reason: "Out that day" },
  );
  assert.equal(declined.status, 200, declined.raw.body);
  assert.equal(declined.body.status, "declined");
  assert.equal(declined.body.cancel_reason, "Out that day");
  assert.ok((await slots(page.slug, 1)).includes(second));
  const cancelled = await call(host.token, "GET", "/bookings?view=cancelled");
  assert.equal(cancelled.body.rows[0].id, other.body.id);
});

test("bookers move or cancel from their manage link", async () => {
  const host = await newUser();
  const page = await newPage(host.token);
  const [first] = await slots(page.slug, 1);
  const booked = await book(page.slug, first);
  assert.equal(booked.status, 201, booked.raw.body);
  const token = await manageToken(booked.body.id);
  const view = await call(null, "GET", `/book/manage/${token}`);
  assert.equal(view.status, 200, view.raw.body);
  assert.equal(view.body.booking.status, "confirmed");
  assert.equal(view.body.can_reschedule, true);
  assert.equal(view.body.page.title, "Intro call");
  assert.equal("email" in view.body.booking, false);

  // The booking's own event doesn't stop it moving 15 minutes later.
  const later = new Date(Date.parse(first) + 15 * 60_000).toISOString();
  const open = await call(
    null,
    "GET",
    `/book/manage/${token}/slots?timezone=${encodeURIComponent(TZ)}&date=${day(1)}&days=1`,
  );
  assert.equal(open.status, 200, open.raw.body);
  assert.ok(open.body.slots.some((s: Json) => s.start_at === later));
  const moved = await call(null, "POST", `/book/manage/${token}/reschedule`, {
    start_at: later,
  });
  assert.equal(moved.status, 200, moved.raw.body);
  assert.equal(moved.body.booking.start_at, later);
  const events = await call(host.token, "GET", "/items?q=Intro");
  assert.equal(events.body.length, 1);
  assert.equal(new Date(events.body[0].due_at).toISOString(), later);
  const notices = (await call(host.token, "GET", "/notifications")).body.filter(
    (n: Json) => n.ref === booked.body.id,
  );
  assert.ok(notices.some((n: Json) => /Rescheduled/.test(n.title)));

  await call(host.token, "PUT", `/booking-pages/${page.id}`, {
    allow_reschedule: false,
  });
  const blocked = await call(null, "POST", `/book/manage/${token}/reschedule`, {
    start_at: first,
  });
  assert.equal(blocked.status, 403);
  assert.equal(
    (await call(null, "GET", `/book/manage/${token}`)).body.can_reschedule,
    false,
  );

  const cancelled = await call(null, "POST", `/book/manage/${token}/cancel`, {
    reason: "Sick",
  });
  assert.equal(cancelled.status, 200, cancelled.raw.body);
  assert.equal(cancelled.body.booking.status, "cancelled");
  assert.equal(cancelled.body.can_cancel, false);
  assert.equal(
    (await call(host.token, "GET", "/items?q=Intro")).body.length,
    0,
  );
  const detail = await call(host.token, "GET", `/bookings/${booked.body.id}`);
  assert.equal(detail.body.cancelled_by, "booker");
  assert.equal(detail.body.cancel_reason, "Sick");
  assert.deepEqual(
    detail.body.events.map((e: Json) => e.kind),
    ["requested", "confirmed", "rescheduled", "cancelled"],
  );
  assert.equal(
    (await call(null, "GET", "/book/manage/not-a-real-token-at-all-xxxxx"))
      .status,
    404,
  );
});

test("hosts track every booking in one inbox", async () => {
  const host = await newUser();
  const stranger = await newUser();
  const page = await newPage(host.token, { title: "Demo" });
  const other = await newPage(host.token, { title: "Office hours" });
  const open = await slots(page.slug, 2);
  const rita = await book(page.slug, open[0], {
    name: "Rita Moreno",
    email: "rita@example.com",
  });
  const omar = await book(page.slug, open[8], {
    name: "Omar Little",
    email: "omar@example.com",
  });
  const [later] = await slots(other.slug, 3);
  const zoe = await book(other.slug, later, {
    name: "Zoe Park",
    email: "zoe@example.com",
  });
  for (const b of [rita, omar, zoe]) assert.equal(b.status, 201, b.raw.body);

  const upcoming = await call(host.token, "GET", "/bookings");
  assert.equal(upcoming.body.total, 3);
  assert.deepEqual(
    upcoming.body.rows.map((r: Json) => r.name),
    ["Rita Moreno", "Omar Little", "Zoe Park"],
  );
  assert.equal(upcoming.body.rows[0].page_title, "Demo");
  assert.equal(
    (await call(host.token, "GET", "/bookings?q=rita")).body.total,
    1,
  );
  const both = await call(host.token, "GET", "/bookings?q=example.com%20omar");
  assert.deepEqual(
    both.body.rows.map((r: Json) => r.name),
    ["Omar Little"],
  );
  assert.equal(
    (await call(host.token, "GET", `/bookings?page_id=${other.id}`)).body.total,
    1,
  );
  const paged = await call(host.token, "GET", "/bookings?limit=1&offset=1");
  assert.equal(paged.body.rows.length, 1);
  assert.equal(paged.body.total, 3);
  assert.equal((await call(stranger.token, "GET", "/bookings")).body.total, 0);
  assert.equal(
    (await call(stranger.token, "GET", `/bookings/${rita.body.id}`)).status,
    404,
  );
  assert.equal(
    (await call(stranger.token, "POST", `/bookings/${rita.body.id}/cancel`, {}))
      .status,
    404,
  );

  const noted = await call(
    host.token,
    "PUT",
    `/bookings/${rita.body.id}/note`,
    {
      host_note: "Wants pricing",
    },
  );
  assert.equal(noted.body.host_note, "Wants pricing");
  const moved = await call(
    host.token,
    "POST",
    `/bookings/${rita.body.id}/reschedule`,
    { start_at: open[16] },
  );
  assert.equal(moved.status, 200, moved.raw.body);
  assert.equal(new Date(moved.body.start_at).toISOString(), open[16]);
  assert.equal(moved.body.reschedule_count, 1);
  // Omar already has that time.
  assert.equal(
    (
      await call(host.token, "POST", `/bookings/${rita.body.id}/reschedule`, {
        start_at: open[8],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(host.token, "PUT", `/bookings/${omar.body.id}/no-show`, {
        no_show: true,
      })
    ).status,
    409,
  );
  const cancelled = await call(
    host.token,
    "POST",
    `/bookings/${zoe.body.id}/cancel`,
    { reason: "Double-booked" },
  );
  assert.equal(cancelled.body.status, "cancelled");
  assert.equal(cancelled.body.cancelled_by, "host");

  // Omar's call has been and gone, and he didn't turn up.
  await pool.query(
    `UPDATE bookings SET start_at = now() - interval '2 hours',
       end_at = now() - interval '90 minutes' WHERE id = $1`,
    [omar.body.id],
  );
  const noShow = await call(
    host.token,
    "PUT",
    `/bookings/${omar.body.id}/no-show`,
    {
      no_show: true,
    },
  );
  assert.equal(noShow.status, 200, noShow.raw.body);
  assert.equal(noShow.body.no_show, true);
  assert.equal(
    (await call(host.token, "GET", "/bookings?view=past")).body.rows[0].id,
    omar.body.id,
  );
  assert.equal(
    (await call(host.token, "GET", "/bookings?view=cancelled")).body.rows[0].id,
    zoe.body.id,
  );
  assert.equal(
    (await call(host.token, "GET", "/bookings?view=all")).body.total,
    3,
  );

  const stats = await call(host.token, "GET", "/bookings/stats");
  assert.equal(stats.status, 200, stats.raw.body);
  assert.equal(stats.body.upcoming, 1);
  assert.equal(stats.body.confirmed, 2);
  assert.equal(stats.body.cancelled, 1);
  assert.equal(stats.body.no_show, 1);
  assert.equal(stats.body.last_30_days, 3);
  assert.equal(stats.body.cancellation_rate, 0.33);
  assert.equal(stats.body.next.id, rita.body.id);
  assert.deepEqual(
    stats.body.pages.map((p: Json) => [p.title, p.total]).sort(),
    [
      ["Demo", 2],
      ["Office hours", 1],
    ],
  );
  assert.equal(
    (await call(host.token, "GET", `/bookings/stats?page_id=${other.id}`)).body
      .cancelled,
    1,
  );

  const csv = await call(host.token, "GET", "/bookings/export.csv?view=all");
  assert.equal(csv.status, 200, csv.raw.body);
  assert.match(String(csv.raw.headers["content-type"]), /text\/csv/);
  const lines = (csv.raw.body as string).trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^Page,Status,Start/);
  assert.ok(
    lines.some((l) => l.includes("Rita Moreno") && l.includes("Wants pricing")),
  );
  assert.equal((await call(null, "GET", "/bookings/export.csv")).status, 401);
});
