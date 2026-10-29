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
const { deliverBookingEmailOne } =
  await import("../src/worker/booking-email.js");
const { addDays, localDateKey, dayTime, colors } = await import("@orbyn/core");
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

async function fixture(assignment = "collective", approval = false) {
  const owner = await newUser();
  const mate = await newUser();
  const team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams(name,created_by) VALUES('Reconcile fixture',$1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
    [team, owner.id, mate.id],
  );
  const page = await newPage(owner.token, {
    team_id: team,
    assignment,
    requires_approval: approval,
    co_hosts: [{ user_id: mate.id, required: true }],
    questions: [{ id: "route", label: "Route", type: "text", required: false }],
    routing:
      assignment === "round_robin"
        ? [{ question_id: "route", equals: "yes", host_user_id: mate.id }]
        : [],
  });
  const booked = await book(page.slug, local(7, 10), {
    answers: { route: "yes" },
  });
  assert.equal(booked.status, 201, booked.raw.body);
  const id = booked.body.id as string;
  const remove = async () => {
    const res = await call(
      owner.token,
      "DELETE",
      `/teams/${team}/members/${mate.id}`,
    );
    assert.equal(res.status, 204, res.raw.body);
  };
  return { owner, mate, team, page, id, remove };
}
const row = async (id: string) =>
  (await pool.query("SELECT * FROM bookings WHERE id=$1", [id])).rows[0];
const items = async (id: string) =>
  (
    await pool.query(
      "SELECT i.* FROM items i JOIN bookings b ON i.id=ANY(b.item_ids) WHERE b.id=$1 ORDER BY i.id",
      [id],
    )
  ).rows;
const item = async (id: string) =>
  (await pool.query("SELECT * FROM items WHERE id=$1", [id])).rows[0];
const move = (token: string, id: string, at: string) =>
  call(token, "POST", `/bookings/${id}/reschedule`, { start_at: at });
const slotUrl = (base: string) =>
  `${base}/slots?timezone=${encodeURIComponent(TZ)}&date=${day(7)}&days=1`;

test("collective removal detaches old personal copies from move and cancellation", async () => {
  const f = await fixture();
  const copies = await items(f.id);
  const old = copies.find((i) => i.user_id === f.mate.id)!;
  const live = copies.find((i) => i.user_id === f.owner.id)!;
  await f.remove();
  const moved = await move(f.owner.token, f.id, local(7, 11));
  assert.equal(moved.status, 200, moved.raw.body);
  assert.deepEqual(
    await item(old.id),
    old,
    "departed personal copy is unchanged",
  );
  assert.equal((await item(live.id)).due_at.toISOString(), local(7, 11));
  assert.deepEqual((await row(f.id)).item_ids, [live.id]);
  // Rejoining by itself restores no booking host assignment or synchronization.
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'member')",
    [f.team, f.mate.id],
  );
  assert.equal(
    (await call(f.mate.token, "GET", `/bookings/${f.id}`)).status,
    404,
  );
  const movedAgain = await move(f.owner.token, f.id, local(7, 12));
  assert.equal(movedAgain.status, 200, movedAgain.raw.body);
  assert.deepEqual(await item(old.id), old);
  const cancelled = await call(
    f.owner.token,
    "POST",
    `/bookings/${f.id}/cancel`,
    { reason: "Changed" },
  );
  assert.equal(cancelled.status, 200, cancelled.raw.body);
  assert.deepEqual(await item(old.id), old);
  assert.equal(await item(live.id), undefined);
});

test("cancelling a legacy collective booking preserves departed personal event without prior move", async () => {
  const f = await fixture();
  const old = (await items(f.id)).find((i) => i.user_id === f.mate.id)!;
  await f.remove();
  const cancelled = await call(
    f.owner.token,
    "POST",
    `/bookings/${f.id}/cancel`,
    { reason: "Changed" },
  );
  assert.equal(cancelled.status, 200, cancelled.raw.body);
  assert.deepEqual(await item(old.id), old);
  assert.deepEqual((await row(f.id)).item_ids, []);
});

test("round-robin reassignment aligns host and public slots and creates one replacement event", async () => {
  const f = await fixture("round_robin");
  const old = (await items(f.id))[0];
  assert.equal(old.user_id, f.mate.id);
  await f.remove();
  const token = await manageToken(f.id);
  for (const [auth, url] of [
    [f.owner.token, slotUrl(`/bookings/${f.id}`)],
    [null, slotUrl(`/book/manage/${token}`)],
  ] as const) {
    const listed = await call(auth, "GET", url);
    assert.equal(listed.status, 200, listed.raw.body);
    assert.ok(listed.body.slots.some((s: Json) => s.start_at === local(7, 11)));
  }
  const moved = await call(null, "POST", `/book/manage/${token}/reschedule`, {
    start_at: local(7, 11),
  });
  assert.equal(moved.status, 200, moved.raw.body);
  assert.equal((await row(f.id)).assigned_user_id, f.owner.id);
  assert.deepEqual(await item(old.id), old);
  const replacement = await items(f.id);
  assert.equal(replacement.length, 1);
  assert.equal(replacement[0].user_id, f.owner.id);
  assert.equal(replacement[0].due_at.toISOString(), local(7, 11));
  const movedAgain = await move(f.owner.token, f.id, local(7, 12));
  assert.equal(movedAgain.status, 200, movedAgain.raw.body);
  assert.deepEqual((await row(f.id)).item_ids, [replacement[0].id]);
  assert.deepEqual(await item(old.id), old);
});

test("awaiting-approval booking replaces departed round-robin assignee at its held time", async () => {
  const f = await fixture("round_robin", true);
  await f.remove();
  const approved = await call(
    f.owner.token,
    "POST",
    `/bookings/${f.id}/approve`,
  );
  assert.equal(approved.status, 200, approved.raw.body);
  assert.equal((await row(f.id)).assigned_user_id, f.owner.id);
  assert.equal((await items(f.id)).length, 1);
  assert.equal((await items(f.id))[0].user_id, f.owner.id);
});

test("no free replacement host rolls back booking, calendar and notification effects", async () => {
  const f = await fixture("round_robin", true);
  await f.remove();
  const busy = await call(f.owner.token, "POST", "/items", {
    title: "busy",
    kind: "event",
    due_at: local(7, 9),
    end_at: local(7, 17),
  });
  assert.equal(busy.status, 201, busy.raw.body);
  const before = await row(f.id);
  const count = async () =>
    Number(
      (
        await pool.query(
          "SELECT count(*) n FROM booking_events WHERE booking_id=$1",
          [f.id],
        )
      ).rows[0].n,
    );
  const events = await count();
  const approved = await call(
    f.owner.token,
    "POST",
    `/bookings/${f.id}/approve`,
  );
  assert.equal(approved.status, 409, approved.raw.body);
  assert.deepEqual(await row(f.id), before);
  assert.equal(await count(), events);
  assert.equal((await items(f.id)).length, 0);
  const listed = await call(f.owner.token, "GET", slotUrl(`/bookings/${f.id}`));
  assert.equal(listed.status, 200, listed.raw.body);
  assert.deepEqual(listed.body.slots, []);
});

test("live assignee slots remain restricted even if another round-robin host is free", async () => {
  const f = await fixture("round_robin");
  const busy = await call(f.mate.token, "POST", "/items", {
    title: "busy",
    kind: "event",
    due_at: local(7, 11),
    end_at: local(7, 12),
  });
  assert.equal(busy.status, 201, busy.raw.body);
  const token = await manageToken(f.id);
  for (const [auth, url] of [
    [f.owner.token, slotUrl(`/bookings/${f.id}`)],
    [null, slotUrl(`/book/manage/${token}`)],
  ] as const) {
    const listed = await call(auth, "GET", url);
    assert.equal(listed.status, 200, listed.raw.body);
    assert.ok(
      !listed.body.slots.some((s: Json) => s.start_at === local(7, 11)),
    );
  }
  assert.equal((await move(f.owner.token, f.id, local(7, 11))).status, 409);
});

test("existing collective booking retains collective semantics after page switches mode", async () => {
  const f = await fixture();
  const changed = await call(
    f.owner.token,
    "PUT",
    `/booking-pages/${f.page.id}`,
    { assignment: "round_robin" },
  );
  assert.equal(changed.status, 200, changed.raw.body);
  const busy = await call(f.mate.token, "POST", "/items", {
    title: "busy",
    kind: "event",
    due_at: local(7, 11),
    end_at: local(7, 12),
  });
  assert.equal(busy.status, 201, busy.raw.body);
  const listed = await call(f.owner.token, "GET", slotUrl(`/bookings/${f.id}`));
  assert.ok(!listed.body.slots.some((s: Json) => s.start_at === local(7, 11)));
  assert.equal((await move(f.owner.token, f.id, local(7, 11))).status, 409);
  assert.equal((await move(f.owner.token, f.id, local(7, 12))).status, 200);
  assert.equal((await items(f.id)).length, 2);
  assert.equal((await row(f.id)).assigned_user_id, null);
});

test("existing round-robin booking can replace assignee after page switches to collective", async () => {
  const f = await fixture("round_robin");
  await f.remove();
  const changed = await call(
    f.owner.token,
    "PUT",
    `/booking-pages/${f.page.id}`,
    { assignment: "collective" },
  );
  assert.equal(changed.status, 200, changed.raw.body);
  const moved = await move(f.owner.token, f.id, local(7, 11));
  assert.equal(moved.status, 200, moved.raw.body);
  assert.equal((await row(f.id)).assigned_user_id, f.owner.id);
  assert.equal((await items(f.id)).length, 1);
});

test("email confirmation reconciles departed assignees before approval notices or direct confirmation", async () => {
  for (const approval of [true, false]) {
    const f = await fixture("round_robin", approval);
    // Recreate an email-pending stored booking with a known synthetic token.
    const token = `confirm-${randomUUID()}`;
    const { digest } = await import("../src/lib/auth.js");
    const copies = await items(f.id);
    await pool.query("DELETE FROM items WHERE id=ANY($1::uuid[])", [
      copies.map((i) => i.id),
    ]);
    await pool.query(
      "UPDATE bookings SET status='pending',item_ids='{}',confirm_token_hash=$2,hold_until=now()+interval '1 day' WHERE id=$1",
      [f.id, digest(token)],
    );
    await f.remove();
    const notices = async () =>
      Number(
        (
          await pool.query(
            "SELECT count(*) n FROM notifications WHERE user_id=$1 AND ref=$2",
            [f.mate.id, f.id],
          )
        ).rows[0].n,
      );
    const before = await notices();
    const confirmed = await call(null, "POST", `/book/confirm/${token}`);
    assert.equal(confirmed.status, 200, confirmed.raw.body);
    assert.equal((await row(f.id)).assigned_user_id, f.owner.id);
    assert.equal(
      (await row(f.id)).status,
      approval ? "awaiting_approval" : "confirmed",
    );
    assert.equal(await notices(), before);
    if (approval) {
      const approved = await call(
        f.owner.token,
        "POST",
        `/bookings/${f.id}/approve`,
      );
      assert.equal(approved.status, 200, approved.raw.body);
    }
    assert.equal((await items(f.id)).length, 1);
    assert.equal((await items(f.id))[0].user_id, f.owner.id);
  }
});

test("ordinary moves never recreate a live host's deleted personal copy", async () => {
  for (const assignment of ["collective", "round_robin"]) {
    const f = await fixture(assignment);
    const copies = await items(f.id);
    const removed = copies.find((i) => i.user_id === f.mate.id)!;
    await pool.query("DELETE FROM items WHERE id=$1", [removed.id]);
    const moved = await move(f.owner.token, f.id, local(7, 11));
    assert.equal(moved.status, 200, moved.raw.body);
    assert.equal(await item(removed.id), undefined);
    assert.equal(
      (await items(f.id)).some((i) => i.user_id === f.mate.id),
      false,
    );
    assert.equal(
      (await row(f.id)).assigned_user_id,
      assignment === "collective" ? null : f.mate.id,
    );
  }
});

test("ambiguous legacy null assignment does not fan out new calendar copies", async () => {
  const f = await fixture("round_robin");
  const copies = await items(f.id);
  await pool.query("DELETE FROM items WHERE id=ANY($1::uuid[])", [
    copies.map((i) => i.id),
  ]);
  // Account deletion clears this FK. Null does not prove historical page mode.
  await pool.query("UPDATE bookings SET assigned_user_id=NULL WHERE id=$1", [
    f.id,
  ]);
  const moved = await move(f.owner.token, f.id, local(7, 11));
  assert.equal(moved.status, 200, moved.raw.body);
  assert.equal((await row(f.id)).assigned_user_id, null);
  assert.deepEqual((await row(f.id)).item_ids, []);
});

test("no eligible replacement leaves confirmed booking and public personal copies unchanged", async () => {
  const f = await fixture("round_robin");
  const old = (await items(f.id))[0];
  await f.remove();
  await pool.query("DELETE FROM booking_hosts WHERE page_id=$1", [f.page.id]);
  const before = await row(f.id);
  const token = await manageToken(f.id);
  const listed = await call(null, "GET", slotUrl(`/book/manage/${token}`));
  assert.equal(listed.status, 200, listed.raw.body);
  assert.deepEqual(listed.body.slots, []);
  const moved = await move(f.owner.token, f.id, local(7, 11));
  assert.equal(moved.status, 409, moved.raw.body);
  assert.deepEqual(await row(f.id), before);
  assert.deepEqual(await item(old.id), old);
  // Cancellation can still end it, without mutating the departed copy.
  const cancelled = await call(null, "POST", `/book/manage/${token}/cancel`, {
    reason: "No host",
  });
  assert.equal(cancelled.status, 200, cancelled.raw.body);
  assert.deepEqual(await item(old.id), old);
});

test("a conflicting linked copy moved into a team stays busy for both slot lists and mutations", async () => {
  const f = await fixture();
  const movedScope = (await items(f.id)).find((i) => i.user_id === f.mate.id)!;
  await pool.query(
    "UPDATE items SET team_id=$2,due_at=$3,end_at=$4 WHERE id=$1",
    [movedScope.id, f.team, local(7, 11), local(7, 12)],
  );
  const before = await item(movedScope.id);
  const bookingBefore = await row(f.id);
  const token = await manageToken(f.id);
  for (const [auth, url] of [
    [f.owner.token, slotUrl(`/bookings/${f.id}`)],
    [null, slotUrl(`/book/manage/${token}`)],
  ] as const) {
    const listed = await call(auth, "GET", url);
    assert.equal(listed.status, 200, listed.raw.body);
    assert.ok(
      !listed.body.slots.some((slot: Json) => slot.start_at === local(7, 11)),
    );
  }
  for (const auth of [f.owner.token, null]) {
    const result = auth
      ? await move(auth, f.id, local(7, 11))
      : await call(null, "POST", `/book/manage/${token}/reschedule`, {
          start_at: local(7, 11),
        });
    assert.equal(result.status, 409, result.raw.body);
    assert.deepEqual(await row(f.id), bookingBefore);
    assert.deepEqual(await item(movedScope.id), before);
  }
  const moved = await move(f.owner.token, f.id, local(7, 12));
  assert.equal(moved.status, 200, moved.raw.body);
  assert.deepEqual(await item(movedScope.id), before);
  assert.equal((await row(f.id)).item_ids.includes(movedScope.id), false);
});

test("keyed reassignment replay does not repeat calendar or email effects", async () => {
  const f = await fixture("round_robin");
  await f.remove();
  const key = randomUUID();
  const send = () =>
    app.inject({
      method: "POST",
      url: `/bookings/${f.id}/reschedule`,
      remoteAddress: address(),
      headers: {
        authorization: `Bearer ${f.owner.token}`,
        "idempotency-key": key,
      },
      payload: { start_at: local(7, 11) },
    });
  const first = await send();
  assert.equal(first.statusCode, 200, first.body);
  const stored = await row(f.id);
  const state = async () => ({
    items: await items(f.id),
    events: (
      await pool.query(
        "SELECT * FROM booking_events WHERE booking_id=$1 ORDER BY created_at,id",
        [f.id],
      )
    ).rows,
    mail: (
      await pool.query(
        "SELECT * FROM booking_email_outbox WHERE booking_id=$1 ORDER BY id",
        [f.id],
      )
    ).rows,
  });
  const before = await state();
  const second = await send();
  assert.equal(second.statusCode, 200, second.body);
  assert.deepEqual(second.json(), first.json());
  assert.deepEqual(await row(f.id), stored);
  assert.deepEqual(await state(), before);
  assert.equal(stored.item_ids.length, 1);
});

test("a linked personal event without booking provenance remains busy and unchanged", async () => {
  const f = await fixture();
  const copy = (await items(f.id)).find((i) => i.user_id === f.mate.id)!;
  await pool.query("DELETE FROM item_sources WHERE item_id=$1", [copy.id]);
  await pool.query("UPDATE items SET due_at=$2,end_at=$3 WHERE id=$1", [
    copy.id,
    local(7, 11),
    local(7, 12),
  ]);
  const before = await item(copy.id);
  const token = await manageToken(f.id);
  for (const [auth, url] of [
    [f.owner.token, slotUrl(`/bookings/${f.id}`)],
    [null, slotUrl(`/book/manage/${token}`)],
  ] as const) {
    const listed = await call(auth, "GET", url);
    assert.equal(listed.status, 200, listed.raw.body);
    assert.ok(
      !listed.body.slots.some((slot: Json) => slot.start_at === local(7, 11)),
    );
  }
  assert.equal((await move(f.owner.token, f.id, local(7, 11))).status, 409);
  const moved = await move(f.owner.token, f.id, local(7, 12));
  assert.equal(moved.status, 200, moved.raw.body);
  assert.deepEqual(await item(copy.id), before);
  assert.equal((await row(f.id)).item_ids.includes(copy.id), false);
});

test("eligible linked personal copies can move into their own overlapping old time", async () => {
  const f = await fixture();
  const changed = await call(
    f.owner.token,
    "PUT",
    `/booking-pages/${f.page.id}`,
    { slot_interval_minutes: 15 },
  );
  assert.equal(changed.status, 200, changed.raw.body);
  const token = await manageToken(f.id);
  const ids = (await row(f.id)).item_ids;
  for (const [auth, url] of [
    [f.owner.token, slotUrl(`/bookings/${f.id}`)],
    [null, slotUrl(`/book/manage/${token}`)],
  ] as const) {
    const listed = await call(auth, "GET", url);
    assert.equal(listed.status, 200, listed.raw.body);
    assert.ok(
      listed.body.slots.some(
        (slot: Json) => slot.start_at === local(7, 10, 15),
      ),
    );
  }
  const moved = await call(null, "POST", `/book/manage/${token}/reschedule`, {
    start_at: local(7, 10, 15),
  });
  assert.equal(moved.status, 200, moved.raw.body);
  assert.deepEqual((await row(f.id)).item_ids.sort(), ids.sort());
  for (const copy of await items(f.id))
    assert.equal(copy.due_at.toISOString(), local(7, 10, 15));
});

test("availability exclusions hold copy scope and provenance stable until transaction completion", async () => {
  const f = await fixture();
  const copy = (await items(f.id)).find((i) => i.user_id === f.mate.id)!;
  const { bookingFor } = await import("../src/modules/booking/manage.js");
  const { bookingSlotOptions } =
    await import("../src/modules/booking/service.js");
  const user = (
    await pool.query("SELECT * FROM users WHERE id=$1", [f.owner.id])
  ).rows[0];
  const holder = await pool.connect();
  const writer = await pool.connect();
  try {
    await holder.query("BEGIN");
    const { booking, page } = await bookingFor(holder, f.id, user);
    const options = await bookingSlotOptions(holder, page, booking, true);
    assert.ok(options.ignoreItemIds?.includes(copy.id));
    for (const query of [
      "UPDATE items SET team_id=$2 WHERE id=$1",
      "DELETE FROM item_sources WHERE item_id=$1",
    ]) {
      await writer.query("BEGIN");
      await writer.query("SET LOCAL lock_timeout='150ms'");
      await assert.rejects(
        writer.query(
          query,
          query.includes("$2") ? [copy.id, f.team] : [copy.id],
        ),
        (error: unknown) => (error as { code?: string }).code === "55P03",
      );
      await writer.query("ROLLBACK");
    }
    await holder.query("COMMIT");
    await writer.query("UPDATE items SET team_id=$2 WHERE id=$1", [
      copy.id,
      f.team,
    ]);
    await writer.query("DELETE FROM item_sources WHERE item_id=$1", [copy.id]);
    const { pageById } = await import("../src/modules/booking/pages.js");
    const pageAfter = (await pageById(pool, f.page.id))!;
    assert.ok(
      !(
        await bookingSlotOptions(pool, pageAfter, await row(f.id))
      ).ignoreItemIds?.includes(copy.id),
    );
  } finally {
    await holder.query("ROLLBACK").catch(() => {});
    await writer.query("ROLLBACK").catch(() => {});
    holder.release();
    writer.release();
  }
});
