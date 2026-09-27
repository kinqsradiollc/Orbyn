import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";

/**
 * H6a: every feature, no gaps, by extending the tools there are. Tasks
 * (alerts, colour, links, targets, status, all-day, busy and meeting link;
 * changing or stopping a repeat; one occurrence or it and later ones; a new
 * parent; moving checklist steps), sessions (pin, duplicate, roll forward,
 * start, check in), every planner setting, keep-originals and calendar
 * subscriptions, the day's agenda page, and notices through ack_inbox (the
 * old mark_notifications_read folded into it). Each with its refusals and
 * its undo.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { AGENT_TOOLSETS } = await import("@orbyn/core");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

let olga: Person;
let mo: Person;
let crew = "";
const keys: Record<string, string> = {};
const grants: Record<string, string> = {};
const ALL = [...AGENT_TOOLSETS];

type Result = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};

async function tool(
  key: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Result> {
  limiter.reset();
  strikes.reset();
  const r = await h.tool(key, name, args);
  assert.ok(r, `${name}: no result`);
  return r as Result;
}

const code = (r: Result) => r._meta?.["orbyn/error"]?.code as string;
const ok = (r: Result, what = "call") => {
  assert.ok(!r.isError, `${what}: ${r.content?.[0]?.text}`);
  return r.structuredContent;
};
const refused = (r: Result, want: string, what = "call") => {
  assert.equal(r.isError, true, `${what} should be refused`);
  assert.equal(code(r), want, `${what}: ${r.content?.[0]?.text}`);
};

/** Undo the latest change `grant` made with `name`, as the person. */
async function undoLast(grant: string, name: string) {
  const act = (
    await pool.query<{ id: string }>(
      "SELECT id FROM agent_activity WHERE tool = $1 AND grant_id = $2 ORDER BY id DESC LIMIT 1",
      [name, grant],
    )
  ).rows[0];
  assert.ok(act, `no ${name} change to undo`);
  const r = await h.call(
    olga.token,
    "POST",
    `/me/agents/activity/${act.id}/undo`,
  );
  assert.equal(r.statusCode, 200, r.body);
}

const item = async (id: string) =>
  (
    await pool.query("SELECT * FROM items WHERE id = $1", [
      id.replace(/^\w+:/, ""),
    ])
  ).rows[0];
const version = async (id: string) => (await item(id)).version as number;

/** A task (or event) of Olga's own, made through the app. */
async function made(body: Record<string, unknown>) {
  const r = await h.call(olga.token, "POST", "/items", body);
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as { id: string; version: number };
}

/** The next UTC day `days` ahead at `hour`:00. */
const at = (days: number, hour: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

before(async () => {
  await migrate();
  olga = await h.register("h6a-olga", "Olga");
  mo = await h.register("h6a-mo", "Mo");
  crew = await h.team(olga, "H6a crew", [[mo, "member"]]);
  const make = async (name: string, body: Record<string, unknown>) => {
    const k = await h.agentKey(olga, { team_ids: [crew], ...body });
    keys[name] = k.key;
    grants[name] = k.id;
  };
  await make("full", { access: "write", toolsets: ALL });
  await make("suggest", { access: "write", toolsets: ALL, trust: "suggest" });
  await make("read", { access: "read", toolsets: ALL });
  await make("teamOnly", { access: "write", toolsets: ALL, personal: false });
});

after(async () => {
  network.restore();
  await app.close();
  await pool.end();
});

test("tasks: alerts, colour, links, targets, status, all-day, busy and meeting link, with undo", async () => {
  // On create.
  const added = ok(
    await tool(keys.full, "create_tasks", {
      tasks: [
        {
          title: "Standup",
          kind: "event",
          due_at: at(2, 9),
          end_at: at(2, 10),
          alerts: [10, 0],
          color: "#376c51",
          links: [{ url: "https://example.com/agenda", title: "Agenda" }],
          busy: false,
          meeting_url: "https://meet.example.com/abc",
        },
      ],
    }),
  );
  const ev = await item(added.done[0].id);
  assert.deepEqual(ev.alerts.map(Number), [0, 10]);
  assert.equal(ev.color, "#376c51");
  assert.equal(ev.busy, false);
  assert.equal(ev.meeting_url, "https://meet.example.com/abc");
  const links = await pool.query(
    "SELECT url, title FROM item_links WHERE item_id = $1",
    [ev.id],
  );
  assert.deepEqual(links.rows, [
    { url: "https://example.com/agenda", title: "Agenda" },
  ]);

  // On update: a task's status, targets, all-day, alerts, colour and links.
  const t = await made({ title: "Signups", due_at: at(3, 12) });
  ok(
    await tool(keys.full, "update_tasks", {
      changes: [
        {
          id: `task:${t.id}`,
          version: t.version,
          status: "in_progress",
          target_value: 500,
          current_value: 320,
          value_unit: "people",
          all_day: true,
          due_at: at(3, 0),
          alerts: [60],
          color: "#123456",
          links: [{ url: "https://example.com/form" }],
        },
      ],
    }),
  );
  let now = await item(t.id);
  assert.equal(now.status, "in_progress");
  assert.equal(now.target_value, 500);
  assert.equal(now.current_value, 320);
  assert.equal(now.value_unit, "people");
  assert.equal(now.all_day, true);
  assert.deepEqual(now.alerts.map(Number), [60]);
  assert.equal(now.color, "#123456");
  // Undo puts every field back, links included.
  await undoLast(grants.full, "update_tasks");
  now = await item(t.id);
  assert.equal(now.status, "todo");
  assert.equal(now.target_value, null);
  assert.equal(now.all_day, false);
  assert.equal(now.color, null);
  assert.equal(
    (await pool.query("SELECT 1 FROM item_links WHERE item_id = $1", [t.id]))
      .rowCount,
    0,
  );
  // A bad colour or link is refused, and nothing changes.
  refused(
    await tool(keys.full, "update_tasks", {
      changes: [{ id: `task:${t.id}`, version: now.version, color: "green" }],
    }),
    "INVALID",
    "a colour that isn't #rrggbb",
  );
  // A read connection can't; a suggest-only one files a proposal.
  refused(
    await tool(keys.read, "update_tasks", {
      changes: [{ id: `task:${t.id}`, version: now.version, alerts: [5] }],
    }),
    "FORBIDDEN",
    "a read connection",
  );
  const suggested = ok(
    await tool(keys.suggest, "update_tasks", {
      changes: [{ id: `task:${t.id}`, version: now.version, alerts: [5] }],
    }),
  );
  assert.equal(suggested.status, "pending_review");
  assert.notDeepEqual((await item(t.id)).alerts.map(Number), [5]);
});

test("tasks: change or stop a repeat, and edit one occurrence or it and later ones", async () => {
  const start = at(1, 8);
  const r = await made({
    title: "Gym",
    kind: "event",
    due_at: start,
    end_at: new Date(Date.parse(start) + 3_600_000).toISOString(),
    rrule: "FREQ=DAILY",
  });
  // One occurrence: only it changes; undo takes the change back.
  const second = new Date(Date.parse(start) + 86_400_000).toISOString();
  const one = ok(
    await tool(keys.full, "update_tasks", {
      changes: [
        {
          id: `event:${r.id}`,
          version: r.version,
          scope: "this",
          occurrence: second,
          title: "Gym (legs)",
        },
      ],
    }),
  );
  assert.match(one.done[0].change, /occurrence/);
  const override = await pool.query(
    "SELECT data FROM item_overrides WHERE item_id = $1 AND occurrence = $2",
    [r.id, second],
  );
  assert.equal(override.rows[0].data.title, "Gym (legs)");
  assert.equal((await item(r.id)).title, "Gym");
  await undoLast(grants.full, "update_tasks");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM item_overrides WHERE item_id = $1 AND occurrence = $2",
        [r.id, second],
      )
    ).rowCount,
    0,
  );
  // Not an occurrence of it, or no occurrence given: refused.
  refused(
    await tool(keys.full, "update_tasks", {
      changes: [
        {
          id: `event:${r.id}`,
          version: await version(r.id),
          scope: "this",
          occurrence: at(1, 11),
          title: "x",
        },
      ],
    }),
    "INVALID",
    "a time that isn't an occurrence",
  );
  refused(
    await tool(keys.full, "update_tasks", {
      changes: [
        {
          id: `event:${r.id}`,
          version: await version(r.id),
          scope: "this",
          title: "x",
        },
      ],
    }),
    "INVALID",
    "scope without occurrence",
  );
  // This and following: a new series from the third day on.
  const third = new Date(Date.parse(start) + 2 * 86_400_000).toISOString();
  const later = ok(
    await tool(keys.full, "update_tasks", {
      changes: [
        {
          id: `event:${r.id}`,
          version: await version(r.id),
          scope: "following",
          occurrence: third,
          title: "Gym (new plan)",
        },
      ],
    }),
  );
  const fresh = later.done[0].id as string;
  assert.notEqual(fresh.replace(/^\w+:/, ""), r.id);
  assert.equal((await item(fresh)).title, "Gym (new plan)");
  assert.match((await item(r.id)).rrule, /UNTIL=/);
  // Change the repeat, then stop it.
  ok(
    await tool(keys.full, "update_tasks", {
      changes: [
        {
          id: fresh,
          version: await version(fresh),
          rrule: "FREQ=WEEKLY",
        },
      ],
    }),
  );
  assert.equal((await item(fresh)).rrule, "FREQ=WEEKLY");
  ok(
    await tool(keys.full, "update_tasks", {
      changes: [{ id: fresh, version: await version(fresh), rrule: null }],
    }),
  );
  assert.equal((await item(fresh)).rrule, null);
  await undoLast(grants.full, "update_tasks");
  assert.equal((await item(fresh)).rrule, "FREQ=WEEKLY");
  // A teammate's repeating task: changing part of it asks first, which a
  // key can't do in the chat.
  const mos = (
    await h.call(mo.token, "POST", "/items", {
      title: "Mo's review",
      team_id: crew,
      due_at: start,
      rrule: "FREQ=DAILY",
    })
  ).json();
  refused(
    await tool(keys.full, "update_tasks", {
      changes: [
        {
          id: `task:${mos.id}`,
          version: mos.version,
          scope: "this",
          occurrence: start,
          title: "Olga's now",
        },
      ],
    }),
    "FORBIDDEN",
    "part of a teammate's series",
  );
});

test("tasks: move a subtask to another parent or the top, never under itself", async () => {
  const a = await made({ title: "Essay" });
  const b = await made({ title: "Research" });
  const sub = await made({ title: "Outline", parent_id: a.id });
  ok(
    await tool(keys.full, "update_tasks", {
      changes: [{ id: `task:${sub.id}`, version: sub.version, parent: b.id }],
    }),
  );
  assert.equal((await item(sub.id)).parent_id, b.id);
  ok(
    await tool(keys.full, "update_tasks", {
      changes: [
        { id: `task:${sub.id}`, version: await version(sub.id), parent: null },
      ],
    }),
  );
  assert.equal((await item(sub.id)).parent_id, null);
  await undoLast(grants.full, "update_tasks");
  assert.equal((await item(sub.id)).parent_id, b.id);
  // A task can't go under its own subtask.
  refused(
    await tool(keys.full, "update_tasks", {
      changes: [
        { id: `task:${b.id}`, version: await version(b.id), parent: sub.id },
      ],
    }),
    "INVALID",
    "a cycle",
  );
  assert.equal((await item(b.id)).parent_id, null);
});

test("checklists: steps move to a place, and undo puts the order back", async () => {
  const t = await made({ title: "Pack" });
  ok(
    await tool(keys.full, "edit_checklist", {
      task: `task:${t.id}`,
      add: ["Passport", "Charger", "Socks"],
    }),
  );
  const order = async () =>
    (
      await pool.query<{ id: string; title: string }>(
        "SELECT id, title FROM item_steps WHERE item_id = $1 ORDER BY position",
        [t.id],
      )
    ).rows;
  const steps = await order();
  const socks = steps.find((s) => s.title === "Socks")!;
  ok(
    await tool(keys.full, "edit_checklist", {
      task: `task:${t.id}`,
      move: [{ id: socks.id, position: 0 }],
    }),
  );
  assert.deepEqual(
    (await order()).map((s) => s.title),
    ["Socks", "Passport", "Charger"],
  );
  await undoLast(grants.full, "edit_checklist");
  assert.deepEqual(
    (await order()).map((s) => s.title),
    ["Passport", "Charger", "Socks"],
  );
  // A step that isn't on this task is refused.
  refused(
    await tool(keys.full, "edit_checklist", {
      task: `task:${t.id}`,
      move: [{ id: "00000000-0000-4000-8000-000000000000", position: 0 }],
    }),
    "NOT_FOUND",
    "someone else's step",
  );
});

test("sessions: pin, duplicate, roll forward, start and check in, attributed and undoable", async () => {
  const t = await made({ title: "Thesis", estimate_minutes: 240 });
  const block = async (start: Date, end: Date) =>
    (
      await pool.query<{ id: string }>(
        "INSERT INTO time_blocks (item_id, user_id, start_at, end_at, source) VALUES ($1, $2, $3, $4, 'planner') RETURNING id",
        [t.id, olga.id, start, end],
      )
    ).rows[0].id;
  const hour = 3_600_000;
  const past = await block(
    new Date(Date.now() - 3 * hour),
    new Date(Date.now() - 2 * hour),
  );
  const onNow = await block(
    new Date(Date.now() - 10 * 60_000),
    new Date(Date.now() + 50 * 60_000),
  );
  const soon = await block(
    new Date(Date.parse(at(2, 10))),
    new Date(Date.parse(at(2, 11))),
  );
  const row = async (id: string) =>
    (await pool.query("SELECT * FROM time_blocks WHERE id = $1", [id])).rows[0];

  // Pin: replanning leaves it. Unpin, and undo.
  ok(
    await tool(keys.full, "reschedule_sessions", {
      changes: [{ session: soon, action: "pin" }],
    }),
  );
  assert.equal((await row(soon)).source, "manual");
  await undoLast(grants.full, "reschedule_sessions");
  assert.equal((await row(soon)).source, "planner");

  // Duplicate at a time; undo removes the copy.
  const copy = ok(
    await tool(keys.full, "reschedule_sessions", {
      changes: [{ session: soon, action: "duplicate", start_at: at(3, 14) }],
    }),
  );
  const copyId = /session ([0-9a-f-]{36})/.exec(copy.done[0].change)![1];
  assert.notEqual(copyId, soon);
  assert.equal((await row(copyId)).item_id, t.id);
  await undoLast(grants.full, "reschedule_sessions");
  assert.equal(await row(copyId), undefined);

  // Roll forward: only a session that has ended.
  refused(
    await tool(keys.full, "reschedule_sessions", {
      changes: [{ session: soon, action: "roll_forward" }],
    }),
    "INVALID",
    "rolling forward a session to come",
  );
  const rolled = ok(
    await tool(keys.full, "reschedule_sessions", {
      changes: [{ session: past, action: "roll_forward" }],
    }),
  );
  assert.match(rolled.done[0].change, /Rolled forward/);

  // Start the one that's on now.
  ok(
    await tool(keys.full, "reschedule_sessions", {
      changes: [{ session: onNow, action: "start" }],
    }),
  );
  assert.notEqual((await row(onNow)).started_at, null);
  // A session to come can't start yet.
  refused(
    await tool(keys.full, "reschedule_sessions", {
      changes: [{ session: soon, action: "start" }],
    }),
    "INVALID",
    "starting a session days away",
  );

  // Check in the past one: its time counts; undo takes it back.
  const spentBefore = (await item(t.id)).spent_minutes;
  ok(
    await tool(keys.full, "reschedule_sessions", {
      changes: [
        {
          session: past,
          action: "check_in",
          outcome: "more",
          more_minutes: 90,
        },
      ],
    }),
  );
  assert.equal((await row(past)).outcome, "more");
  assert.ok((await item(t.id)).spent_minutes > spentBefore);
  // Attributed to the agent.
  const activity = await pool.query(
    "SELECT tool FROM agent_activity WHERE grant_id = $1 AND tool = 'reschedule_sessions'",
    [grants.full],
  );
  assert.ok(activity.rowCount! >= 4);
  await undoLast(grants.full, "reschedule_sessions");
  assert.equal((await row(past)).outcome, null);
  assert.equal((await item(t.id)).spent_minutes, spentBefore);
  // A check-in needs an outcome.
  refused(
    await tool(keys.full, "reschedule_sessions", {
      changes: [{ session: past, action: "check_in" }],
    }),
    "INVALID",
    "a check-in without an outcome",
  );
  // get_work_patterns lists the unfinished session with its id.
  const patterns = ok(await tool(keys.full, "get_work_patterns", {}));
  assert.ok(
    patterns.unfinished.some(
      (u: any) => u.session === past && u.checked_in === false,
    ),
  );
  // A suggest-only connection can't; nor can anyone reach Mo's sessions.
  refused(
    await tool(keys.suggest, "reschedule_sessions", {
      changes: [{ session: soon, action: "pin" }],
    }),
    "FORBIDDEN",
    "a suggest-only connection",
  );
  const mosTask = (
    await h.call(mo.token, "POST", "/items", { title: "Mo's", team_id: crew })
  ).json();
  const mos = (
    await pool.query<{ id: string }>(
      "INSERT INTO time_blocks (item_id, user_id, start_at, end_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [mosTask.id, mo.id, at(2, 12), at(2, 13)],
    )
  ).rows[0].id;
  refused(
    await tool(keys.full, "reschedule_sessions", {
      changes: [{ session: mos, action: "check_in", outcome: "done" }],
    }),
    "NOT_FOUND",
    "a teammate's session",
  );
});

test("settings: every planner setting, keep originals and calendars by link, with undo", async () => {
  const before = (await h.call(olga.token, "GET", "/planner/prefs")).json();
  ok(
    await tool(keys.full, "update_planner_settings", {
      settings: {
        timezone: "Europe/Berlin",
        extra_timezones: ["Asia/Tokyo"],
        pinned_user_ids: [mo.id],
        calendar_sets: [{ id: "uni", name: "Uni", team_ids: [crew] }],
        default_alerts: { event: [15] },
        planner_notices: { email: true },
        buffer_scope: { only_with_others: true },
        travel_padding_minutes: 10,
        count_blocks_as_spent: true,
        session_reminder_minutes: 5,
        digest: { morning: true, morning_time: "07:30" },
      },
    }),
  );
  const now = (await h.call(olga.token, "GET", "/planner/prefs")).json();
  assert.equal(now.timezone, "Europe/Berlin");
  assert.deepEqual(now.extra_timezones, ["Asia/Tokyo"]);
  assert.deepEqual(now.pinned_user_ids, [mo.id]);
  assert.equal(now.calendar_sets[0].name, "Uni");
  assert.deepEqual(now.default_alerts.event, [15]);
  assert.equal(now.planner_notices.email, true);
  assert.equal(now.buffer_scope.only_with_others, true);
  assert.equal(now.travel_padding_minutes, 10);
  assert.equal(now.count_blocks_as_spent, true);
  assert.equal(now.session_reminder_minutes, 5);
  assert.equal(now.digest.morning, true);
  assert.equal(now.digest.morning_time, "07:30");
  await undoLast(grants.full, "update_planner_settings");
  const back = (await h.call(olga.token, "GET", "/planner/prefs")).json();
  assert.equal(back.timezone, before.timezone);
  assert.deepEqual(back.extra_timezones, before.extra_timezones);
  assert.equal(back.session_reminder_minutes, before.session_reminder_minutes);
  // Out of range: refused, nothing saved.
  refused(
    await tool(keys.full, "update_planner_settings", {
      settings: { session_reminder_minutes: 7 },
    }),
    "INVALID",
    "a session reminder the app doesn't offer",
  );
  // Keep originals.
  ok(
    await tool(keys.full, "update_planner_settings", { keep_originals: true }),
  );
  const keep = async () =>
    (
      await pool.query("SELECT keep_originals FROM users WHERE id = $1", [
        olga.id,
      ])
    ).rows[0].keep_originals;
  assert.equal(await keep(), true);
  await undoLast(grants.full, "update_planner_settings");
  assert.equal(await keep(), false);
  // Subscribe by link: the app's own check first (a private address is refused).
  refused(
    await tool(keys.full, "update_planner_settings", {
      subscribe: { url: "https://192.168.1.10/cal.ics", name: "Home" },
    }),
    "INVALID",
    "a private address",
  );
  const sub = ok(
    await tool(keys.full, "update_planner_settings", {
      subscribe: {
        url: "webcal://93.184.216.34/uni.ics",
        name: "Timetable",
        kind: "classes",
      },
    }),
  );
  const calId = (sub.done[0].id as string).replace("calendar:", "");
  const row = await pool.query(
    "SELECT url, kind FROM calendar_subscriptions WHERE id = $1 AND user_id = $2",
    [calId, olga.id],
  );
  assert.equal(row.rows[0].url, "https://93.184.216.34/uni.ics");
  assert.equal(row.rows[0].kind, "classes");
  // Listed, without its link.
  const listed = ok(await tool(keys.full, "get_work_patterns", {}));
  const cal = listed.calendars.find((c: any) => c.id === calId);
  assert.equal(cal.name, "Timetable");
  assert.ok(!JSON.stringify(listed).includes("93.184.216.34"));
  // Unsubscribe, and undo brings it back.
  ok(
    await tool(keys.full, "update_planner_settings", { unsubscribe: [calId] }),
  );
  const count = async () =>
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM calendar_subscriptions WHERE id = $1",
        [calId],
      )
    ).rows[0].n;
  assert.equal(await count(), 0);
  await undoLast(grants.full, "update_planner_settings");
  assert.equal(await count(), 1);
  // Someone else's calendar can't be reached.
  refused(
    await tool(keys.full, "update_planner_settings", {
      unsubscribe: ["00000000-0000-4000-8000-000000000000"],
    }),
    "NOT_FOUND",
    "a calendar that isn't hers",
  );
  // Settings are the person's own: a team-only or suggest-only connection can't.
  assert.equal(
    (
      await tool(keys.teamOnly, "update_planner_settings", {
        keep_originals: true,
      })
    ).isError,
    true,
  );
  refused(
    await tool(keys.suggest, "update_planner_settings", {
      settings: { travel_padding_minutes: 5 },
    }),
    "FORBIDDEN",
    "a suggest-only connection",
  );
});

test("the agenda page: written from the calendar, again for today, never the hosted brief", async () => {
  const first = ok(
    await tool(keys.full, "create_doc", { title: "today", kind: "agenda" }),
  );
  assert.equal(first.done[0].change, "Written");
  const again = ok(
    await tool(keys.full, "create_doc", { title: "Today", kind: "agenda" }),
  );
  assert.equal(again.done[0].id, first.done[0].id);
  assert.match(again.done[0].change, /again/);
  const ahead = new Date(Date.now() + 3 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const day = ok(
    await tool(keys.full, "create_doc", { title: ahead, kind: "agenda" }),
  );
  assert.notEqual(day.done[0].id, first.done[0].id);
  // Undo moves the page it wrote to Trash.
  await undoLast(grants.full, "create_doc");
  const trashed = await pool.query(
    "SELECT deleted_at FROM docs WHERE id = $1",
    [day.done[0].id.replace("doc:", "")],
  );
  assert.notEqual(trashed.rows[0].deleted_at, null);
  refused(
    await tool(keys.full, "create_doc", { title: "someday", kind: "agenda" }),
    "INVALID",
    "a title that isn't a day",
  );
  refused(
    await tool(keys.full, "create_doc", {
      title: "2020-01-01",
      kind: "agenda",
    }),
    "INVALID",
    "a day out of reach",
  );
  refused(
    await tool(keys.teamOnly, "create_doc", { title: "today", kind: "agenda" }),
    "FORBIDDEN",
    "a connection without Personal",
  );
  // Nothing reached the network (no hosted brief).
  assert.ok(!network.calls.some((c) => !c.includes("93.184.216.34")));
});

test("notices: ack_inbox marks them read (mark_notifications_read folded in, still answering)", async () => {
  const notice = async (ref: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO notifications (user_id, item_version, channel, destination, title, body, state, kind, ref)
         VALUES ($1, 0, 'inapp', $3, 'Mentioned', 'x', 'sent', 'mention', $2) RETURNING id`,
        [olga.id, ref, olga.id],
      )
    ).rows[0].id;
  const unread = async () =>
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND channel = 'inapp' AND NOT read",
        [olga.id],
      )
    ).rows[0].n;
  const one = await notice("h6a-1");
  await notice("h6a-2");
  const byId = ok(await tool(keys.full, "ack_inbox", { notices: [one] }));
  assert.equal(byId.notices_read, 1);
  const all = ok(await tool(keys.full, "ack_inbox", { notices: "all" }));
  assert.ok(all.notices_read >= 1);
  assert.equal(await unread(), 0);
  refused(await tool(keys.full, "ack_inbox", {}), "INVALID", "nothing named");
  refused(
    await tool(keys.full, "ack_inbox", { ids: ["inbox:1"] }),
    "INVALID",
    "inbox ids without an action",
  );
  await notice("h6a-3");
  refused(
    await tool(keys.suggest, "ack_inbox", { notices: "all" }),
    "FORBIDDEN",
    "a suggest-only connection",
  );
  refused(
    await tool(keys.teamOnly, "ack_inbox", { notices: "all" }),
    "FORBIDDEN",
    "a connection without Personal",
  );
  // The old name: not listed, still answering.
  const listed = (await h.legacy(keys.full, "tools/list")).body.result.tools;
  assert.ok(!listed.some((t: any) => t.name === "mark_notifications_read"));
  const old = ok(
    await tool(keys.full, "mark_notifications_read", { all: true }),
  );
  assert.match(old.done[0].change, /1 marked read/);
  assert.equal(await unread(), 0);
});
