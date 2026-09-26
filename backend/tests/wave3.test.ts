import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Wave 3 end to end: subtasks, manual order, time left and blocks counted
 * as spent, the cancelled status, links; open invites, profile pages,
 * public-page headers, booker reminders and team pages; buffer scope and
 * travel modes, peaks and padding; incremental sync with tombstones,
 * scheduled webhook events, rate-limit headers per API key and the OpenAPI
 * description.
 */
process.env.SMTP_HOST = "";
// Webhooks here point at a local address; they're only queued, never sent.
process.env.ALLOW_PRIVATE_WEBHOOKS = "true";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { decryptSecret } = await import("../src/lib/secrets.js");
const { enqueue } = await import("../src/worker/scheduler.js");
const { scanPlanningNotices } = await import("../src/worker/planning.js");
const { scanBlocksStarted, scanEventStarting } =
  await import("../src/worker/webhookEvents.js");
const { bookerReminder } = await import("../src/modules/booking/service.js");
const { addDays, dayTime, itemBody, localDateKey, weekdayOf } =
  await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.15.${Math.floor(++caller / 250)}.${caller % 250}`;

type Json = Record<string, any>;
async function call(
  token: string | null,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
  from = address(),
) {
  const r = await app.inject({
    method,
    url,
    remoteAddress: from,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as Json }),
  });
  return {
    status: r.statusCode,
    body: r.body ? (safeJson(r.body) as any) : null,
    headers: r.headers,
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
    email: `wave3-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name,
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

async function newTeam(
  ownerId: string,
  members: { id: string; role: string }[] = [],
) {
  const id = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Wave crew', $1) RETURNING id",
      [ownerId],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')",
    [id, ownerId],
  );
  for (const m of members)
    await pool.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)",
      [id, m.id, m.role],
    );
  return id;
}

const day = (offset: number) => addDays(localDateKey(new Date(), TZ), offset);
/** A Melbourne wall-clock time on the day `offset` days from today. */
const local = (offset: number, hour: number, minute = 0) =>
  dayTime(day(offset), hour * 60 + minute, TZ).toISOString();
const iso = (v: string) => new Date(v).toISOString();

async function item(token: string, data: Json) {
  const r = await call(token, "POST", "/items", { kind: "task", ...data });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}
const detail = async (token: string, id: string) =>
  (await call(token, "GET", `/items/${id}`)).body as Json;
/** Save an item with some fields changed, as the apps do. */
async function edit(token: string, id: string, changes: Json) {
  const { version, ...data } = itemBody(await detail(token, id));
  return call(token, "PUT", `/items/${id}`, { ...data, ...changes, version });
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

// ---- Tasks ------------------------------------------------------------------

test("subtasks are tasks: depth, space, loops, counts and the planner", async () => {
  const me = await newUser();
  const other = await newUser();
  const parent = await item(me.token, {
    title: "Launch",
    estimate_minutes: 120,
  });
  const child = await item(me.token, {
    title: "Write copy",
    estimate_minutes: 30,
    parent_id: parent.id,
  });
  const second = await item(me.token, {
    title: "Record video",
    estimate_minutes: 60,
    parent_id: parent.id,
  });
  const grandchild = await item(me.token, {
    title: "Draft headline",
    parent_id: child.id,
  });
  assert.equal(child.parent_id, parent.id);

  // Three levels at most, whichever way the tree grows.
  const tooDeep = await call(me.token, "POST", "/items", {
    title: "Fourth level",
    parent_id: grandchild.id,
  });
  assert.equal(tooDeep.status, 422);
  assert.match(tooDeep.body.message, /3 levels/);
  const top = await item(me.token, { title: "Programme" });
  assert.equal(
    (await edit(me.token, parent.id, { parent_id: top.id })).status,
    422,
  );
  // No loops.
  const loop = await edit(me.token, child.id, { parent_id: grandchild.id });
  assert.equal(loop.status, 422);
  assert.match(loop.body.message, /itself|own subtasks/);
  // Only tasks, in the same space, that you can see.
  assert.equal(
    (
      await call(me.token, "POST", "/items", {
        title: "Event under a task",
        kind: "event",
        due_at: local(2, 10),
        parent_id: parent.id,
      })
    ).status,
    422,
  );
  const theirs = await item(other.token, { title: "Not yours" });
  assert.equal(
    (
      await call(me.token, "POST", "/items", {
        title: "Sneaky",
        parent_id: theirs.id,
      })
    ).status,
    422,
  );
  const team = await newTeam(me.id);
  const teamTask = await item(me.token, { title: "Team goal", team_id: team });
  const mixed = await call(me.token, "POST", "/items", {
    title: "Personal under team",
    parent_id: teamTask.id,
  });
  assert.equal(mixed.status, 422);
  assert.match(mixed.body.message, /personal/);
  // A task with subtasks can't leave its space or become an event.
  assert.equal(
    (await edit(me.token, parent.id, { team_id: team })).status,
    422,
  );

  // Listing a task's subtasks, and its counts.
  const kids = await call(me.token, "GET", `/items?parent_id=${parent.id}`);
  assert.deepEqual(
    kids.body.map((i: Json) => i.id).sort(),
    [child.id, second.id].sort(),
  );
  let p = await detail(me.token, parent.id);
  assert.equal(p.child_count, 2);
  assert.equal(p.children_done, 0);

  // The planner plans the subtasks; the parent only what its estimate has
  // beyond them (120 − (30 + 60)); a subtask with its own open subtask only
  // what's beyond that (30 − 30 = nothing).
  const plan = await call(me.token, "POST", "/planner/preview", {
    start_date: day(1),
    days: 1,
    pad_percent: 0,
    split: false,
    use_frames: false,
    item_ids: [parent.id, child.id, second.id, grandchild.id],
  });
  assert.equal(plan.status, 200, plan.raw.body);
  const minutes = (id: string) =>
    plan.body.blocks
      .filter((b: Json) => b.item_id === id)
      .reduce(
        (sum: number, b: Json) =>
          sum + (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60000,
        0,
      );
  assert.equal(minutes(parent.id), 30);
  assert.equal(minutes(second.id), 60);
  assert.equal(minutes(grandchild.id), 30);
  assert.equal(minutes(child.id), 0);

  assert.equal(
    (await edit(me.token, second.id, { status: "done" })).status,
    200,
  );
  assert.equal(
    (await edit(me.token, child.id, { status: "cancelled" })).status,
    200,
  );
  p = await detail(me.token, parent.id);
  assert.equal(p.child_count, 1, "cancelled subtasks aren't counted");
  assert.equal(p.children_done, 1);

  // Deleting a task deletes its subtasks, and sync hears about each one.
  const del = await call(
    me.token,
    "DELETE",
    `/items/${parent.id}?version=${p.version}`,
  );
  assert.equal(del.status, 204);
  assert.equal((await call(me.token, "GET", `/items/${child.id}`)).status, 404);
  const gone = (
    await pool.query<{ item_id: string }>(
      "SELECT item_id FROM deleted_items WHERE item_id = ANY ($1::uuid[])",
      [[parent.id, child.id, second.id, grandchild.id]],
    )
  ).rows;
  assert.equal(gone.length, 4);
});

test("manual order moves items without changing their version", async () => {
  const me = await newUser();
  const list = (await call(me.token, "POST", "/lists", { name: "Errands" }))
    .body;
  const [a, b, c] = [
    await item(me.token, { title: "A", list_id: list.id }),
    await item(me.token, { title: "B", list_id: list.id }),
    await item(me.token, { title: "C", list_id: list.id }),
  ];
  const order = async () =>
    (
      await call(me.token, "GET", `/items?list_id=${list.id}&sort=position`)
    ).body.map((i: Json) => i.title);
  assert.deepEqual(await order(), ["A", "B", "C"]);

  const moved = await call(me.token, "PUT", `/items/${c.id}/position`, {
    before_id: a.id,
  });
  assert.equal(moved.status, 200, moved.raw.body);
  assert.equal(moved.body.version, c.version, "the version doesn't change");
  assert.deepEqual(await order(), ["C", "A", "B"]);
  await call(me.token, "PUT", `/items/${c.id}/position`, { after_id: b.id });
  assert.deepEqual(await order(), ["A", "B", "C"]);
  await call(me.token, "PUT", `/items/${b.id}/position`, { position: 0 });
  assert.deepEqual(await order(), ["B", "A", "C"]);

  // Only next to items in the same place, and one way at a time.
  const elsewhere = await item(me.token, { title: "No list" });
  assert.equal(
    (
      await call(me.token, "PUT", `/items/${a.id}/position`, {
        before_id: elsewhere.id,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call(me.token, "PUT", `/items/${a.id}/position`, {
        before_id: b.id,
        position: 1,
      })
    ).status,
    422,
  );
  // An open editor still saves: the version it holds is current.
  assert.equal((await edit(me.token, a.id, { title: "A2" })).status, 200);
});

test("time left, blocks counted as spent once, and cancelled tasks", async () => {
  const me = await newUser();
  const t = await item(me.token, { title: "Report", estimate_minutes: 90 });
  await call(me.token, "POST", `/items/${t.id}/time`, { minutes: 30 });
  const listed = (await call(me.token, "GET", "/items")).body.find(
    (i: Json) => i.id === t.id,
  );
  assert.equal(listed.remaining_minutes, 60);
  assert.equal((await detail(me.token, t.id)).remaining_minutes, 60);

  // Blocks count as spent only when asked, and only once.
  const block = async (id: string, from: string, to: string) =>
    pool.query(
      `INSERT INTO time_blocks (item_id, user_id, start_at, end_at)
       VALUES ($1, $2, now() + $3::interval, now() + $4::interval)`,
      [id, me.id, from, to],
    );
  const plain = await item(me.token, {
    title: "Plain",
    estimate_minutes: 120,
  });
  await block(plain.id, "-2 hours", "-1 hour");
  await edit(me.token, plain.id, { status: "done" });
  assert.equal((await detail(me.token, plain.id)).spent_minutes, 0);

  const prefs = await call(me.token, "PUT", "/planner/prefs", {
    count_blocks_as_spent: true,
  });
  assert.equal(prefs.body.count_blocks_as_spent, true);
  const counted = await item(me.token, {
    title: "Counted",
    estimate_minutes: 120,
  });
  await block(counted.id, "-3 hours", "-2 hours");
  await block(counted.id, "1 hour", "2 hours");
  await edit(me.token, counted.id, { status: "done" });
  let d = await detail(me.token, counted.id);
  assert.equal(d.spent_minutes, 60);
  assert.equal(d.remaining_minutes, 60);
  const future = await pool.query(
    "SELECT 1 FROM time_blocks WHERE item_id = $1 AND start_at > now()",
    [counted.id],
  );
  assert.equal(future.rowCount, 0, "future blocks go when it's done");
  await edit(me.token, counted.id, { status: "todo" });
  await edit(me.token, counted.id, { status: "done" });
  d = await detail(me.token, counted.id);
  assert.equal(d.spent_minutes, 60, "each block counts once");

  // Cancelled tasks are closed: no planning, no risk, no score, no reminders.
  const risky = await item(me.token, {
    title: "Huge thing",
    estimate_minutes: 6000,
    due_at: local(1, 12),
  });
  const review = async () =>
    (await call(me.token, "GET", "/planner/review")).body.at_risk.map(
      (a: Json) => a.item_id,
    );
  assert.ok((await review()).includes(risky.id));
  await block(risky.id, "3 hours", "4 hours");
  assert.equal(
    (await edit(me.token, risky.id, { status: "cancelled" })).status,
    200,
  );
  assert.ok(!(await review()).includes(risky.id));
  const cancelled = (await call(me.token, "GET", "/items")).body.find(
    (i: Json) => i.id === risky.id,
  );
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.score, null);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM time_blocks WHERE item_id = $1 AND start_at > now()",
        [risky.id],
      )
    ).rowCount,
    0,
    "cancelling frees its future time",
  );
  const plan = await call(me.token, "POST", "/planner/preview", {
    start_date: day(1),
    days: 1,
    item_ids: [risky.id],
  });
  assert.ok(!plan.body.tasks.some((x: Json) => x.item_id === risky.id));

  const soon = new Date(Date.now() + 10 * 60_000).toISOString();
  const open = await item(me.token, {
    title: "Open soon",
    due_at: soon,
    alerts: [30],
  });
  const closed = await item(me.token, {
    title: "Cancelled soon",
    due_at: soon,
    alerts: [30],
    status: "cancelled",
  });
  await enqueue();
  const reminders = async (id: string) =>
    (
      await pool.query(
        "SELECT 1 FROM notifications WHERE item_id = $1 AND kind = 'reminder'",
        [id],
      )
    ).rowCount;
  assert.ok((await reminders(open.id))! > 0);
  assert.equal(await reminders(closed.id), 0);
});

test("links on a task", async () => {
  const me = await newUser();
  const t = await item(me.token, {
    title: "Spec review",
    links: [
      { url: "https://example.com/spec", title: "Spec" },
      { url: "http://intranet.example/board" },
    ],
  });
  let d = await detail(me.token, t.id);
  assert.deepEqual(
    d.links.map((l: Json) => [l.url, l.title, l.position]),
    [
      ["https://example.com/spec", "Spec", 0],
      ["http://intranet.example/board", "", 1],
    ],
  );
  // Leaving them out keeps them; sending a list replaces it.
  await edit(me.token, t.id, { title: "Spec review v2" });
  assert.equal((await detail(me.token, t.id)).links.length, 2);
  const { links: _links, ...body } = itemBody(await detail(me.token, t.id));
  void _links;
  await call(me.token, "PUT", `/items/${t.id}`, {
    ...body,
    links: [{ url: "https://example.com/new" }],
  });
  d = await detail(me.token, t.id);
  assert.deepEqual(
    d.links.map((l: Json) => l.url),
    ["https://example.com/new"],
  );
  assert.equal(
    (
      await call(me.token, "POST", "/items", {
        title: "Bad link",
        links: [{ url: "ftp://example.com/file" }],
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call(me.token, "POST", "/items", {
        title: "Too many",
        links: Array.from({ length: 21 }, (_, i) => ({
          url: `https://example.com/${i}`,
        })),
      })
    ).status,
    422,
  );
});

// ---- Booking ------------------------------------------------------------------

test("open invites: book a window, move within the windows, reopen, expire", async () => {
  const host = await newUser("Host");
  await item(host.token, {
    title: "Standup",
    kind: "event",
    due_at: local(2, 10),
    end_at: local(2, 10, 30),
  });
  const windows = [
    { start_at: local(2, 10), end_at: local(2, 11) },
    { start_at: local(3, 14), end_at: local(3, 15) },
  ];
  const made = await call(host.token, "POST", "/open-invites", {
    title: "Coffee chat",
    duration: 30,
    windows,
  });
  assert.equal(made.status, 201, made.raw.body);
  assert.equal(made.body.status, "open");
  assert.equal(made.body.expires_at, iso(local(3, 15)));
  const token = made.body.url.split("/invite/")[1] as string;

  const view = await call(
    null,
    "GET",
    `/invite/${token}?timezone=${encodeURIComponent(TZ)}`,
  );
  assert.equal(view.status, 200, view.raw.body);
  assert.equal(view.headers["x-robots-tag"], "noindex, nofollow");
  assert.deepEqual(view.body.hosts, ["Host"]);
  // The windows minus the host's busy time, on the quarter hour.
  assert.deepEqual(
    view.body.slots.map((s: Json) => s.start_at),
    [local(2, 10, 30), local(3, 14), local(3, 14, 15), local(3, 14, 30)].map(
      iso,
    ),
  );

  const pick = (start: string) =>
    call(null, "POST", `/invite/${token}`, {
      start_at: start,
      name: "Sam Lee",
      email: "sam@example.com",
      timezone: TZ,
    });
  assert.equal((await pick(local(2, 10))).status, 409, "the host is busy");
  const booked = await pick(local(3, 14));
  assert.equal(booked.status, 201, booked.raw.body);
  assert.equal(booked.body.status, "confirmed");
  assert.equal((await pick(local(2, 10, 30))).status, 409, "used once");
  const mine = await call(host.token, "GET", `/open-invites/${made.body.id}`);
  assert.equal(mine.body.status, "booked");
  assert.equal(mine.body.booking.start_at, iso(local(3, 14)));
  const events = (await call(host.token, "GET", "/items")).body.filter(
    (i: Json) => i.title === "Coffee chat with Sam Lee",
  );
  assert.equal(events.length, 1);
  // It's in the host's bookings inbox too.
  const inbox = await call(host.token, "GET", "/bookings?view=upcoming");
  assert.ok(inbox.body.rows.some((b: Json) => b.id === booked.body.id));

  // The booker moves it, but only within the invite's windows.
  const manage = await decryptSecret(
    (
      await pool.query<{ manage_token_encrypted: string }>(
        "SELECT manage_token_encrypted FROM bookings WHERE id = $1",
        [booked.body.id],
      )
    ).rows[0].manage_token_encrypted,
  );
  const managed = await call(null, "GET", `/book/manage/${manage}`);
  assert.equal(managed.body.page.invite, true);
  assert.equal(managed.body.can_reschedule, true);
  const slots = await call(
    null,
    "GET",
    `/book/manage/${manage}/slots?date=${day(2)}&days=3&timezone=${encodeURIComponent(TZ)}`,
  );
  for (const s of slots.body.slots)
    assert.ok(
      windows.some(
        (w) =>
          Date.parse(s.start_at) >= Date.parse(w.start_at) &&
          Date.parse(s.end_at) <= Date.parse(w.end_at),
      ),
    );
  assert.equal(
    (
      await call(null, "POST", `/book/manage/${manage}/reschedule`, {
        start_at: local(3, 16),
      })
    ).status,
    409,
  );
  const moved = await call(null, "POST", `/book/manage/${manage}/reschedule`, {
    start_at: local(2, 10, 30),
  });
  assert.equal(moved.status, 200, moved.raw.body);
  assert.equal(moved.body.booking.start_at, iso(local(2, 10, 30)));

  // Cancelling reopens the invite, so they can pick again.
  const cancelled = await call(null, "POST", `/book/manage/${manage}/cancel`, {
    reason: "",
  });
  assert.equal(cancelled.status, 200, cancelled.raw.body);
  const reopened = await call(
    host.token,
    "GET",
    `/open-invites/${made.body.id}`,
  );
  assert.equal(reopened.body.status, "open");
  assert.equal(reopened.body.booking, null);

  // When its time runs out it expires.
  await pool.query(
    "UPDATE open_invites SET expires_at = now() - interval '1 minute' WHERE id = $1",
    [made.body.id],
  );
  const expired = await call(null, "GET", `/invite/${token}`);
  assert.equal(expired.body.status, "expired");
  assert.deepEqual(expired.body.slots, []);
  assert.equal((await pick(local(3, 14))).status, 410);
  await enqueue();
  assert.equal(
    (
      await pool.query<{ status: string }>(
        "SELECT status FROM open_invites WHERE id = $1",
        [made.body.id],
      )
    ).rows[0].status,
    "expired",
  );

  // Windows must lie ahead; an invite can be withdrawn.
  assert.equal(
    (
      await call(host.token, "POST", "/open-invites", {
        title: "Too late",
        duration: 30,
        windows: [{ start_at: local(-2, 10), end_at: local(-2, 11) }],
      })
    ).status,
    422,
  );
  const other = await call(host.token, "POST", "/open-invites", {
    title: "Walk",
    duration: 15,
    windows: [{ start_at: local(4, 9), end_at: local(4, 10) }],
  });
  assert.equal(
    (await call(host.token, "DELETE", `/open-invites/${other.body.id}`)).status,
    204,
  );
  const withdrawn = await call(
    null,
    "GET",
    `/invite/${other.body.url.split("/invite/")[1]}`,
  );
  assert.equal(withdrawn.body.status, "cancelled");
  const outsider = await newUser();
  assert.equal(
    (await call(outsider.token, "GET", `/open-invites/${other.body.id}`))
      .status,
    404,
  );
});

test("profile pages list active booking pages; handles are checked", async () => {
  const me = await newUser("Anna Park");
  const handle = `anna-${randomUUID().slice(0, 8)}`;
  const saved = await call(me.token, "PUT", "/me/profile", {
    handle: handle.toUpperCase(),
    bio: "Product design, mostly.",
  });
  assert.equal(saved.status, 200, saved.raw.body);
  assert.equal(saved.body.handle, handle);
  assert.match(saved.body.url, new RegExp(`/u/${handle}$`));
  assert.equal((await call(me.token, "GET", "/me")).body.handle, handle);
  assert.equal(
    (await call(me.token, "PUT", "/me/profile", { handle: "admin" })).status,
    422,
  );
  assert.equal(
    (await call(me.token, "PUT", "/me/profile", { handle: "no--dashes" }))
      .status,
    422,
  );
  const rival = await newUser();
  assert.equal(
    (await call(rival.token, "PUT", "/me/profile", { handle })).status,
    409,
  );

  const slug = `pg-${randomUUID().slice(0, 8)}`;
  await call(me.token, "POST", "/booking-pages", {
    slug,
    title: "Intro call",
    description: "Twenty minutes to see if we fit.",
    durations: [20, 40],
  });
  await call(me.token, "POST", "/booking-pages", {
    slug: `off-${randomUUID().slice(0, 8)}`,
    title: "Switched off",
    durations: [30],
    active: false,
  });
  const page = await call(null, "GET", `/u/${handle}`);
  assert.equal(page.status, 200, page.raw.body);
  assert.equal(page.headers["x-robots-tag"], "noindex, nofollow");
  assert.equal(page.body.name, "Anna Park");
  assert.equal(page.body.bio, "Product design, mostly.");
  assert.deepEqual(page.body.pages, [
    {
      title: "Intro call",
      slug,
      description: "Twenty minutes to see if we fit.",
      durations: [20, 40],
      color: "#376c51",
    },
  ]);
  assert.equal(
    (await call(null, "GET", `/u/nobody-${randomUUID().slice(0, 6)}`)).status,
    404,
  );
});

test("public pages aren't indexed; only they can be framed on the web", async () => {
  const me = await newUser();
  const slug = `pg-${randomUUID().slice(0, 8)}`;
  await call(me.token, "POST", "/booking-pages", {
    slug,
    title: "Chat",
    durations: [30],
  });
  const page = await call(null, "GET", `/book/${slug}?timezone=UTC`);
  assert.equal(page.status, 200);
  assert.equal(page.headers["x-robots-tag"], "noindex, nofollow");
  const missing = await call(null, "GET", "/rsvp/not-a-real-token-at-all-123");
  assert.equal(missing.headers["x-robots-tag"], "noindex, nofollow");
  const own = await call(me.token, "GET", "/items");
  assert.equal(own.headers["x-robots-tag"], undefined);

  // The web container lets the public pages be framed, and nothing else.
  for (const file of [
    "../../desktop/nginx.conf",
    "../../deploy/k8s/web.yaml",
  ]) {
    const conf = await readFile(new URL(file, import.meta.url), "utf8");
    const block = conf.match(
      /location ~ \^\/\(book\|invite\|u\|rsvp\)\/ \{([^}]*)\}/,
    );
    assert.ok(block, `${file} has a location for the public pages`);
    assert.match(block[1], /frame-ancestors \*/);
    assert.match(block[1], /X-Robots-Tag "noindex, nofollow"/);
    assert.doesNotMatch(block[1], /X-Frame-Options/);
    assert.match(conf, /add_header X-Frame-Options DENY always;/);
  }
});

test("bookers get reminders before their meeting, once per value", async () => {
  const host = await newUser("Host");
  const defaults = await call(host.token, "POST", "/booking-pages", {
    slug: `pg-${randomUUID().slice(0, 8)}`,
    title: "Default reminders",
    durations: [30],
  });
  assert.deepEqual(defaults.body.remind_before_minutes, [1440, 60]);
  assert.equal(
    (
      await call(host.token, "POST", "/booking-pages", {
        slug: `pg-${randomUUID().slice(0, 8)}`,
        title: "Too many",
        durations: [30],
        remind_before_minutes: [10, 20, 30, 40],
      })
    ).status,
    422,
  );
  const page = await call(host.token, "POST", "/booking-pages", {
    slug: `pg-${randomUUID().slice(0, 8)}`,
    title: "Planning session",
    durations: [30],
    min_notice_minutes: 0,
    remind_before_minutes: [60, 10080],
  });
  assert.deepEqual(page.body.remind_before_minutes, [10080, 60]);
  const booked = await call(null, "POST", `/book/${page.body.slug}`, {
    start_at: local(2, 10),
    duration: 30,
    name: "Sam Lee",
    email: "sam@example.com",
    timezone: TZ,
  });
  assert.equal(booked.status, 201, booked.raw.body);
  const invite = await call(host.token, "POST", "/open-invites", {
    title: "Catch-up",
    duration: 30,
    windows: [{ start_at: local(3, 11), end_at: local(3, 12) }],
    remind_before_minutes: [10080],
  });
  const fromInvite = await call(
    null,
    "POST",
    `/invite/${invite.body.url.split("/invite/")[1]}`,
    { start_at: local(3, 11), name: "Kim", email: "kim@example.com" },
  );
  assert.equal(fromInvite.status, 201, fromInvite.raw.body);
  // As if both were booked a while ago, so the week-before reminder is due.
  await pool.query(
    "UPDATE bookings SET created_at = now() - interval '8 days' WHERE id = ANY ($1::uuid[])",
    [[booked.body.id, fromInvite.body.id]],
  );
  const rows = async (id: string) =>
    (
      await pool.query<{ ref: string; destination: string; channel: string }>(
        "SELECT ref, destination, channel FROM notifications WHERE kind = 'booker_reminder' AND ref LIKE $1",
        [`${id}:%`],
      )
    ).rows;
  // Nothing without SMTP.
  await enqueue();
  assert.equal((await rows(booked.body.id)).length, 0);
  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ('smtp', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [
      JSON.stringify({
        host: "smtp.invalid",
        port: 2525,
        user: "",
        secure: false,
        from: "Orbyn <book@orbyn.test>",
        password_encrypted: null,
      }),
    ],
  );
  invalidateSettings();
  try {
    await enqueue();
    await enqueue();
    const queued = await rows(booked.body.id);
    assert.equal(queued.length, 1);
    assert.match(queued[0].ref, /:10080$/);
    assert.equal(queued[0].destination, "sam@example.com");
    assert.equal(queued[0].channel, "email");
    assert.equal((await rows(fromInvite.body.id)).length, 1);

    const db = await pool.connect();
    try {
      const mail = await bookerReminder(db, queued[0].ref);
      assert.equal(mail?.title, "Reminder: Planning session");
      assert.match(mail!.body, /\/book\/manage\//);
      // A cancelled booking's reminder doesn't go.
      await call(host.token, "POST", `/bookings/${booked.body.id}/cancel`, {});
      assert.equal(await bookerReminder(db, queued[0].ref), null);
    } finally {
      db.release();
    }
  } finally {
    await pool.query("DELETE FROM system_settings WHERE key = 'smtp'");
    invalidateSettings();
  }
});

test("team pages: team owners and admins manage them, hosts are members", async () => {
  const owner = await newUser("Owner");
  const admin = await newUser("Admin");
  const member = await newUser("Member");
  const outsider = await newUser("Outsider");
  const team = await newTeam(owner.id, [
    { id: admin.id, role: "admin" },
    { id: member.id, role: "member" },
  ]);
  const slug = `team-${randomUUID().slice(0, 8)}`;
  const made = await call(admin.token, "POST", "/booking-pages", {
    slug,
    title: "Support call",
    durations: [30],
    team_id: team,
    co_hosts: [{ user_id: member.id }],
  });
  assert.equal(made.status, 201, made.raw.body);
  assert.equal(made.body.team_id, team);
  assert.equal(made.body.team_name, "Wave crew");
  assert.equal(
    (
      await call(member.token, "POST", "/booking-pages", {
        slug: `team-${randomUUID().slice(0, 8)}`,
        title: "Mine",
        durations: [30],
        team_id: team,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(admin.token, "POST", "/booking-pages", {
        slug: `team-${randomUUID().slice(0, 8)}`,
        title: "With a stranger",
        durations: [30],
        team_id: team,
        co_hosts: [{ user_id: outsider.id }],
      })
    ).status,
    422,
  );
  // Every member sees it; only owners and admins change it.
  const listed = (await call(member.token, "GET", "/booking-pages")).body.find(
    (p: Json) => p.id === made.body.id,
  );
  assert.equal(listed.can_edit, false);
  assert.equal(
    (
      await call(member.token, "PUT", `/booking-pages/${made.body.id}`, {
        title: "Hijacked",
      })
    ).status,
    404,
  );
  const renamed = await call(
    owner.token,
    "PUT",
    `/booking-pages/${made.body.id}`,
    {
      title: "Support hour",
    },
  );
  assert.equal(renamed.status, 200, renamed.raw.body);
  assert.equal(renamed.body.title, "Support hour");
  assert.ok(
    !(await call(outsider.token, "GET", "/booking-pages")).body.some(
      (p: Json) => p.id === made.body.id,
    ),
  );
  // Personal pages work as before.
  assert.equal(
    (
      await call(outsider.token, "POST", "/booking-pages", {
        slug: `me-${randomUUID().slice(0, 8)}`,
        title: "Just me",
        durations: [30],
      })
    ).status,
    201,
  );
});

// ---- Buffers and travel -------------------------------------------------------

test("buffer scope, and travel by mode with peak times and padding", async () => {
  const me = await newUser();
  const offsets = Array.from({ length: 7 }, (_, i) => i + 1);
  const weekday = offsets.find((k) =>
    [1, 2, 3, 4, 5].includes(weekdayOf(day(k))),
  )!;
  const saturday = offsets.find((k) => weekdayOf(day(k)) === 6)!;
  const prefs = await call(me.token, "PUT", "/planner/prefs", {
    buffer_before_minutes: 10,
    buffer_after_minutes: 10,
    buffer_scope: { only_with_others: true },
    travel_padding_minutes: 5,
  });
  assert.equal(prefs.status, 200, prefs.raw.body);
  assert.deepEqual(prefs.body.buffer_scope, {
    personal: true,
    team_ids: null,
    list_ids: [],
    min_minutes: 0,
    only_with_others: true,
  });
  const place = await call(me.token, "POST", "/planner/places", {
    label: "Office",
    match: "Collins St",
    travel_minutes: 20,
    mode: "transit",
    peak_minutes: 40,
  });
  assert.equal(place.status, 201, place.raw.body);
  assert.equal(place.body.mode, "transit");
  assert.equal(place.body.peak_minutes, 40);

  const event = (offset: number, hour: number, minute: number, extra: Json) =>
    item(me.token, {
      kind: "event",
      title: `Event ${hour}:${minute}`,
      due_at: local(offset, hour, minute),
      end_at: local(offset, hour, minute + 30),
      ...extra,
    });
  const alone = await event(weekday, 12, 0, {});
  const meeting = await event(weekday, 14, 0, {
    meeting_url: "https://meet.example.com/abc",
  });
  const commute = await event(weekday, 8, 30, { location: "12 Collins St" });
  const weekend = await event(saturday, 8, 30, { location: "Collins St" });

  const derived = async (offset: number) =>
    (
      await call(
        me.token,
        "GET",
        `/calendar?from=${encodeURIComponent(local(offset, 0))}&to=${encodeURIComponent(local(offset + 1, 0))}`,
      )
    ).body.derived as Json[];
  const day1 = await derived(weekday);
  const of = (id: string, kind: string) =>
    day1
      .filter((d) => d.item_id === id && d.kind === kind)
      .map((d) => [d.start_at, d.end_at]);
  assert.deepEqual(of(alone.id, "buffer"), [], "no one else: no buffers");
  assert.deepEqual(of(meeting.id, "buffer"), [
    [iso(local(weekday, 13, 50)), iso(local(weekday, 14))],
    [iso(local(weekday, 14, 30)), iso(local(weekday, 14, 40))],
  ]);
  // Peak hours on a weekday: 40 minutes plus 5 padding; back at 09:00 is
  // outside them: 20 plus 5.
  assert.deepEqual(of(commute.id, "travel"), [
    [iso(local(weekday, 7, 45)), iso(local(weekday, 8, 30))],
    [iso(local(weekday, 9)), iso(local(weekday, 9, 25))],
  ]);
  const sat = (await derived(saturday)).filter(
    (d) => d.item_id === weekend.id && d.kind === "travel",
  );
  assert.deepEqual(
    [sat[0].start_at, sat[0].end_at],
    [iso(local(saturday, 8, 5)), iso(local(saturday, 8, 30))],
    "no peak at weekends",
  );

  // Shorter events than the scope's minimum get none.
  await call(me.token, "PUT", "/planner/prefs", {
    buffer_scope: { min_minutes: 60 },
  });
  assert.deepEqual(
    (await derived(weekday)).filter((d) => d.kind === "buffer"),
    [],
  );
});

// ---- API ---------------------------------------------------------------------------

test("incremental sync pages through changes and lists deletions", async () => {
  const owner = await newUser();
  const member = await newUser();
  const outsider = await newUser();
  const team = await newTeam(owner.id, [{ id: member.id, role: "member" }]);
  const mark = (
    await pool.query<{ t: Date }>("SELECT now() AS t")
  ).rows[0].t.toISOString();
  const a = await item(owner.token, { title: "A" });
  const b = await item(owner.token, { title: "B" });
  const c = await item(owner.token, { title: "C" });

  const page = (token: string, query: string) =>
    call(token, "GET", `/items?${query}`);
  const first = await page(
    owner.token,
    `updated_after=${encodeURIComponent(mark)}&limit=2`,
  );
  assert.equal(first.status, 200, first.raw.body);
  assert.deepEqual(
    first.body.items.map((i: Json) => i.id),
    [a.id, b.id],
  );
  assert.equal(first.body.has_more, true);
  const second = await page(
    owner.token,
    `cursor=${first.body.next_cursor}&limit=2`,
  );
  assert.deepEqual(
    second.body.items.map((i: Json) => i.id),
    [c.id],
  );
  assert.equal(second.body.has_more, false);
  const idle = await page(owner.token, `cursor=${second.body.next_cursor}`);
  assert.deepEqual(idle.body.items, []);
  assert.equal(idle.body.next_cursor, second.body.next_cursor);

  // A deletion is listed as a tombstone, when asked for.
  const bNow = await detail(owner.token, b.id);
  await call(owner.token, "DELETE", `/items/${b.id}?version=${bNow.version}`);
  // Moving an item doesn't change its version but does count as a change,
  // for it and for the items whose place it took (A goes after C).
  await call(owner.token, "PUT", `/items/${a.id}/position`, { position: 9 });
  const changes = await page(
    owner.token,
    `cursor=${second.body.next_cursor}&include_deleted=1`,
  );
  assert.deepEqual(
    changes.body.deleted.map((d: Json) => d.id),
    [b.id],
  );
  assert.deepEqual(
    changes.body.items.map((i: Json) => i.id).sort(),
    [a.id, c.id].sort(),
  );
  assert.equal(
    changes.body.items.find((i: Json) => i.id === a.id).version,
    a.version,
  );
  const without = await page(owner.token, `cursor=${second.body.next_cursor}`);
  assert.deepEqual(without.body.deleted, []);

  // Team items: members hear about them, and about their deletion; others don't.
  const shared = await item(owner.token, { title: "Shared", team_id: team });
  const memberSees = await page(
    member.token,
    `updated_after=${encodeURIComponent(mark)}&include_deleted=1`,
  );
  assert.deepEqual(
    memberSees.body.items.map((i: Json) => i.id),
    [shared.id],
  );
  await call(owner.token, "DELETE", `/items/${shared.id}?version=1`);
  const memberLater = await page(
    member.token,
    `cursor=${memberSees.body.next_cursor}&include_deleted=1`,
  );
  assert.deepEqual(
    memberLater.body.deleted.map((d: Json) => d.id),
    [shared.id],
  );
  const stranger = await page(
    outsider.token,
    `updated_after=${encodeURIComponent(mark)}&include_deleted=1`,
  );
  assert.deepEqual(stranger.body.items, []);
  assert.deepEqual(stranger.body.deleted, []);

  assert.equal((await page(owner.token, "cursor=not-a-cursor")).status, 422);
  // Without the sync parameters, the list is as it always was.
  assert.ok(Array.isArray((await page(owner.token, "limit=5")).body));
});

test("event.starting, block.started and task.at_risk are queued once", async () => {
  const me = await newUser();
  const hook = await call(me.token, "POST", "/me/webhooks", {
    url: "http://127.0.0.1:9/hook",
    events: ["event.starting", "block.started", "task.at_risk"],
    lead_minutes: 30,
  });
  assert.equal(hook.status, 201, hook.raw.body);
  assert.equal(hook.body.lead_minutes, 30);
  const soon = (minutes: number) =>
    new Date(Date.now() + minutes * 60_000).toISOString();
  const starting = await item(me.token, {
    kind: "event",
    title: "Board meeting",
    due_at: soon(20),
    end_at: soon(80),
  });
  await item(me.token, {
    kind: "event",
    title: "Later",
    due_at: soon(50),
    end_at: soon(60),
  });
  await item(me.token, {
    kind: "event",
    title: "Free time",
    due_at: soon(10),
    end_at: soon(20),
    busy: false,
  });
  const task = await item(me.token, {
    title: "Enormous",
    estimate_minutes: 10080,
    due_at: local(1, 12),
  });
  await pool.query(
    `INSERT INTO time_blocks (item_id, user_id, start_at, end_at)
     VALUES ($1, $2, now() - interval '1 minute', now() + interval '29 minutes')`,
    [task.id, me.id],
  );
  for (let i = 0; i < 2; i++) {
    await scanEventStarting();
    await scanBlocksStarted();
    await scanPlanningNotices(new Date(), [me.id]);
  }
  const queued = (
    await pool.query<{ event: string; payload: Json }>(
      "SELECT event, payload FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY event",
      [hook.body.id],
    )
  ).rows;
  assert.deepEqual(
    queued.map((q) => q.event),
    ["block.started", "event.starting", "task.at_risk"],
  );
  const byEvent = Object.fromEntries(queued.map((q) => [q.event, q.payload]));
  assert.equal(byEvent["event.starting"].data.item_id, starting.id);
  assert.equal(byEvent["event.starting"].data.lead_minutes, 30);
  assert.equal(byEvent["block.started"].data.item_id, task.id);
  assert.equal(byEvent["task.at_risk"].data.item_id, task.id);

  const changed = await call(me.token, "PUT", `/me/webhooks/${hook.body.id}`, {
    lead_minutes: 60,
  });
  assert.equal(changed.body.lead_minutes, 60);
  assert.equal(
    (
      await call(me.token, "PUT", `/me/webhooks/${hook.body.id}`, {
        lead_minutes: 121,
      })
    ).status,
    422,
  );
});

test("rate limits count per API key and say so in headers", async () => {
  const me = await newUser();
  const key = (await call(me.token, "POST", "/me/api-keys", { name: "Zapier" }))
    .body.key as string;
  const one = await call(key, "GET", "/me", undefined, "10.99.0.1");
  assert.equal(one.status, 200);
  const limit = Number(one.headers["ratelimit-limit"]);
  assert.ok(limit > 0);
  const left = Number(one.headers["ratelimit-remaining"]);
  assert.ok(one.headers["ratelimit-reset"] !== undefined);
  // The same key from another address shares its allowance.
  const two = await call(key, "GET", "/me", undefined, "10.99.0.2");
  assert.equal(Number(two.headers["ratelimit-remaining"]), left - 1);
  // A session from a fresh address has its own.
  const session = await call(me.token, "GET", "/me", undefined, "10.99.0.3");
  assert.equal(Number(session.headers["ratelimit-remaining"]), limit - 1);

  // Past a route's limit: 429 with Retry-After.
  let last = one;
  for (let i = 0; i < 11; i++)
    last = await call(
      key,
      "POST",
      "/me/api-keys",
      { name: `Key ${i}` },
      `10.99.1.${i}`,
    );
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers["retry-after"]) > 0);
});

test("the OpenAPI description is served and parses", async () => {
  const r = await call(null, "GET", "/openapi.yaml");
  assert.equal(r.status, 200);
  assert.match(String(r.headers["content-type"]), /yaml/);
  const { parse } = await import("yaml");
  const spec = parse(r.raw.body);
  assert.match(spec.openapi, /^3\.1\./);
  for (const path of [
    "/auth/login",
    "/items",
    "/items/quick",
    "/items/{id}",
    "/items/{id}/position",
    "/lists",
    "/tags",
    "/blocks",
    "/calendar",
    "/calendar/search",
    "/me/webhooks",
    // Sign in with Orbyn and outside agents (A2).
    "/.well-known/oauth-authorization-server",
    "/oauth/authorize/check",
    "/oauth/authorize",
    "/oauth/authorize/deny",
    "/oauth/token",
    "/oauth/revoke",
    "/oauth/register",
    "/me/reauth",
    "/me/reauth/options",
    "/teams/{id}/agents",
    "/teams/{id}/agent-access",
    "/admin/agents",
    "/admin/agents/clients",
    "/admin/agents/usage",
    "/admin/users/{id}/agents/{grantId}",
  ])
    assert.ok(spec.paths[path], `documents ${path}`);
  assert.ok(spec.components.securitySchemes.bearer);
  assert.ok(spec.webhooks["event.starting"]);
});
