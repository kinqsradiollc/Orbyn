import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * The later planning features (P5): session check-in, sessions in a
 * project's History (planned, moved, started, removed, with where each came
 * from), reminders when a session starts, whole-day deadlines in the
 * calendar feed, milestones, @mentions in pages with "Mentioned in",
 * keeping a project out of the assistant, and saved project chats.
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { keptBlocks } = await import("../src/modules/planner/learning.js");
const { enqueue } = await import("../src/worker/scheduler.js");
const { scrubKeptOut, keptOutFor, KeptOutError } =
  await import("../src/lib/assistant-off.js");
const visibility = await import("../src/lib/visibility.js");
const { runTool } = await import("../src/modules/ai/agent/tools.js");
const {
  addDays,
  localDateKey,
  mentionMarkdown,
  mentionQuery,
  mentionedPerson,
  milestoneStatus,
  activityOriginLabel,
  chatTitle,
} = await import("@orbyn/core");
const app = await buildApp();

let caller = 0;
const address = () => `10.71.${Math.floor(++caller / 250)}.${caller % 250}`;
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
  let body: any = null;
  try {
    body = r.body ? JSON.parse(r.body) : null;
  } catch {
    body = r.body;
  }
  return { status: r.statusCode, body, raw: r };
}

async function person(name = "Planner") {
  const r = await call(null, "POST", "/auth/register", {
    email: `later-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name,
  });
  assert.equal(r.status, 201, r.raw.body);
  return { token: r.body.token as string, id: r.body.user.id as string };
}

async function task(token: string, data: Json) {
  const r = await call(token, "POST", "/items", { kind: "task", ...data });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}

async function project(token: string, data: Json = {}) {
  const r = await call(token, "POST", "/projects", {
    name: `Project ${randomUUID().slice(0, 6)}`,
    ...data,
  });
  assert.equal(r.status, 201, r.raw.body);
  return r.body as Json;
}

async function team(
  owner: { id: string },
  members: { id: string; role: string }[],
) {
  const id = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Crew', $1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')",
    [id, owner.id],
  );
  for (const m of members)
    await pool.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)",
      [id, m.id, m.role],
    );
  return id;
}

const at = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

/** A session inserted as it would be, at any time (the API refuses none). */
async function session(
  userId: string,
  itemId: string,
  from: number,
  to: number,
) {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO time_blocks (item_id, user_id, start_at, end_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [itemId, userId, at(from), at(to)],
    )
  ).rows[0].id;
}

const history = async (token: string, projectId: string) => {
  const r = await call(token, "GET", `/projects/${projectId}/activity`);
  assert.equal(r.status, 200, r.raw.body);
  return r.body as Json[];
};

before(async () => {
  await migrate();
});
after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
});

// ------------------------------------------------------------ check-in ---

test("a session's check-in counts its time once, and the planner learns from it", async () => {
  const me = await person();
  const other = await person();
  const t = await task(me.token, {
    title: "Write essay",
    estimate_minutes: 120,
  });
  const past = await session(me.id, t.id, -180, -120);

  assert.equal((await call(null, "GET", "/blocks/check-ins")).status, 401);
  const waiting = (await call(me.token, "GET", "/blocks/check-ins")).body;
  const row = waiting.find((w: Json) => w.id === past);
  assert.ok(row, "the ended session waits for a check-in");
  assert.equal(row.minutes, 60);
  assert.equal(row.remaining_minutes, 120);
  // Never someone else's.
  assert.ok(
    !(await call(other.token, "GET", "/blocks/check-ins")).body.some(
      (w: Json) => w.id === past,
    ),
  );

  const url = `/blocks/${past}/check-in`;
  assert.equal(
    (await call(null, "POST", url, { outcome: "done" })).status,
    401,
  );
  assert.equal(
    (await call(me.token, "POST", url, { outcome: "finished" })).status,
    422,
  );
  assert.equal(
    (await call(me.token, "POST", url, { outcome: "done", more_minutes: 30 }))
      .status,
    422,
  );
  assert.equal(
    (await call(other.token, "POST", url, { outcome: "done" })).status,
    404,
  );

  const done = await call(me.token, "POST", url, { outcome: "done" });
  assert.equal(done.status, 200, done.raw.body);
  assert.equal(done.body.counted_minutes, 60);
  assert.equal(done.body.remaining_minutes, 60);
  const spent = async () =>
    (
      await pool.query<{ spent_minutes: number; estimate_minutes: number }>(
        "SELECT spent_minutes, estimate_minutes FROM items WHERE id = $1",
        [t.id],
      )
    ).rows[0];
  assert.equal((await spent()).spent_minutes, 60);
  assert.ok(
    !(await call(me.token, "GET", "/blocks/check-ins")).body.some(
      (w: Json) => w.id === past,
    ),
    "answered sessions aren't asked about again",
  );
  const learned = async () =>
    (
      await keptBlocks(
        pool,
        me.id,
        new Date(Date.now() - 86_400_000),
        new Date(),
        "UTC",
      )
    ).blocks.find((b) => b.item_id === t.id)!;
  assert.equal((await learned()).kept, 60);

  // Changing the answer takes back what the first one counted.
  const skipped = await call(me.token, "POST", url, { outcome: "skipped" });
  assert.equal(skipped.body.counted_minutes, 0);
  assert.equal((await spent()).spent_minutes, 0);
  assert.equal((await learned()).kept, 0);
  // Completing the task later doesn't count a skipped session.
  const block = (
    await pool.query("SELECT counted FROM time_blocks WHERE id = $1", [past])
  ).rows[0];
  assert.equal(block.counted, false);

  // "Need more": the time counts, and the task needs that much more.
  const more = await call(me.token, "POST", url, {
    outcome: "more",
    more_minutes: 90,
  });
  assert.equal(more.status, 200);
  assert.equal(more.body.remaining_minutes, 90);
  assert.deepEqual(await spent(), { spent_minutes: 60, estimate_minutes: 150 });

  // Focus already logged inside the session isn't counted twice.
  const t2 = await task(me.token, { title: "Revise", estimate_minutes: 60 });
  const s2 = await session(me.id, t2.id, -100, -40);
  await pool.query(
    `INSERT INTO focus_sessions (id, user_id, item_id, kind, started_at, ended_at,
       planned_minutes, minutes, completed)
     VALUES ($1, $2, $3, 'work', $4, $5, 25, 20, true)`,
    [randomUUID(), me.id, t2.id, at(-90), at(-70)],
  );
  const counted = await call(me.token, "POST", `/blocks/${s2}/check-in`, {
    outcome: "done",
  });
  assert.equal(counted.body.counted_minutes, 40);

  // A session that hasn't started can't be checked in.
  const later = await session(me.id, t.id, 60, 120);
  assert.equal(
    (
      await call(me.token, "POST", `/blocks/${later}/check-in`, {
        outcome: "done",
      })
    ).status,
    409,
  );
});

// ------------------------------------------------------ session history ---

test("sessions show in a project's History with where they came from, to their owner only", async () => {
  const owner = await person("Owner");
  const member = await person("Member");
  const teamId = await team(owner, [{ id: member.id, role: "member" }]);
  const p = await project(member.token, { team_id: teamId });
  const t = await task(member.token, {
    title: "Draft the brief",
    team_id: teamId,
    project_id: p.id,
    assignee_id: member.id,
  });

  // Planned by hand in the app.
  const made = await call(member.token, "POST", "/blocks", {
    item_id: t.id,
    start_at: at(-5),
    end_at: at(55),
  });
  assert.equal(made.status, 201, made.raw.body);
  let rows = await history(member.token, p.id);
  const planned = rows.find((r) => r.kind === "session_planned");
  assert.ok(planned, JSON.stringify(rows.map((r) => r.summary)));
  assert.equal(planned.summary, "Session planned: Draft the brief");
  assert.equal(planned.entity_type, "session");
  assert.equal(planned.entity_id, t.id);
  assert.equal(planned.origin, "app");
  assert.equal(planned.actor_name, "Member");

  // Started, from its reminder.
  const start = `/blocks/${made.body.id}/start`;
  assert.equal((await call(null, "POST", start)).status, 401);
  assert.equal((await call(owner.token, "POST", start)).status, 404);
  assert.equal(
    (await call(member.token, "POST", start, { from: "email" })).status,
    422,
  );
  const started = await call(member.token, "POST", start, { from: "reminder" });
  assert.equal(started.status, 200, started.raw.body);
  const again = await call(member.token, "POST", start, { from: "reminder" });
  assert.equal(again.body.started_at, started.body.started_at);
  rows = await history(member.token, p.id);
  const began = rows.filter((r) => r.kind === "session_started");
  assert.equal(began.length, 1, "starting twice is one entry");
  assert.equal(began[0].origin, "reminder");

  // Moved, then removed.
  await call(member.token, "PUT", `/blocks/${made.body.id}`, {
    start_at: at(120),
    end_at: at(180),
  });
  await call(member.token, "DELETE", `/blocks/${made.body.id}`);
  rows = await history(member.token, p.id);
  assert.ok(rows.some((r) => r.kind === "session_moved"));
  assert.ok(
    rows.some(
      (r) =>
        r.kind === "session_removed" &&
        r.summary === "Session removed: Draft the brief",
    ),
  );

  // A later session can't be started yet.
  const soon = await session(member.id, t.id, 120, 180);
  assert.equal(
    (await call(member.token, "POST", `/blocks/${soon}/start`)).status,
    409,
  );

  // The team owner sees the project's History, but none of the member's sessions.
  const seen = await history(owner.token, p.id);
  assert.ok(seen.length > 0);
  assert.ok(!seen.some((r) => r.entity_type === "session"));

  // Placed together, one entry says how many; the planner and the assistant
  // are named as where they came from.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('orbyn.user_id', $1, true)", [
      member.id,
    ]);
    await client.query(
      `INSERT INTO time_blocks (item_id, user_id, start_at, end_at, source)
       VALUES ($1, $2, $3, $4, 'planner'), ($1, $2, $5, $6, 'planner')`,
      [t.id, member.id, at(1440), at(1500), at(1560), at(1620)],
    );
    await client.query("SELECT set_config('orbyn.origin', 'assistant', true)");
    await client.query(
      "UPDATE time_blocks SET start_at = start_at + interval '1 hour', end_at = end_at + interval '1 hour' WHERE item_id = $1 AND source = 'planner'",
      [t.id],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  rows = await history(member.token, p.id);
  const two = rows.find(
    (r) => r.summary === "2 sessions planned: Draft the brief",
  );
  assert.ok(two, JSON.stringify(rows.map((r) => r.summary)));
  assert.equal(two.origin, "planner");
  assert.equal(activityOriginLabel(two), "by the planner");
  const moved = rows.find(
    (r) => r.summary === "2 sessions moved: Draft the brief",
  );
  assert.equal(moved?.origin, "assistant");

  // Deleting the task logs the task, not each of its sessions.
  const removals = async () =>
    (
      await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM project_activity
          WHERE kind = 'session_removed' AND entity_id = $1`,
        [t.id],
      )
    ).rows[0].n;
  const removedBefore = await removals();
  const version = (
    await pool.query<{ version: number }>(
      "SELECT version FROM items WHERE id = $1",
      [t.id],
    )
  ).rows[0].version;
  const gone = await call(
    member.token,
    "DELETE",
    `/items/${t.id}?version=${version}`,
  );
  assert.ok(gone.status < 300, gone.raw.body);
  assert.equal(
    await removals(),
    removedBefore,
    "no session_removed row for the deleted task's sessions",
  );
});

// --------------------------------------------------- session reminders ---

test("a reminder when a session starts, once, for people who asked", async () => {
  const me = await person();
  const t = await task(me.token, { title: "Lab report" });
  assert.equal(
    (
      await call(me.token, "PUT", "/planner/prefs", {
        session_reminder_minutes: 7,
      })
    ).status,
    422,
  );
  const s = await session(me.id, t.id, 3, 63);
  await enqueue();
  const notices = async () =>
    (
      await pool.query<{ title: string; channel: string; ref: string }>(
        "SELECT title, channel, ref FROM notifications WHERE user_id = $1 AND kind = 'session'",
        [me.id],
      )
    ).rows;
  assert.equal((await notices()).length, 0, "off unless asked for");

  const set = await call(me.token, "PUT", "/planner/prefs", {
    session_reminder_minutes: 5,
  });
  assert.equal(set.status, 200, set.raw.body);
  assert.equal(
    (await call(me.token, "GET", "/planner/prefs")).body
      .session_reminder_minutes,
    5,
  );
  await enqueue();
  await enqueue();
  const sent = await notices();
  assert.equal(sent.length, 1, JSON.stringify(sent));
  assert.equal(sent[0].title, "Session in 5 min: Lab report");
  assert.ok(sent[0].ref.startsWith(`${s}:`));

  // A started session isn't reminded about.
  const t2 = await task(me.token, { title: "Reading" });
  const s2 = await session(me.id, t2.id, 2, 30);
  await pool.query("UPDATE time_blocks SET started_at = now() WHERE id = $1", [
    s2,
  ]);
  await enqueue();
  assert.equal((await notices()).length, 1);
});

// ------------------------------------------------------ calendar feed ---

test("the calendar feed names a whole-day deadline by its day, never a false time", async () => {
  const me = await person();
  const today = localDateKey(new Date(), "UTC");
  const due = addDays(today, 3);
  const t = await task(me.token, {
    title: "Hand in",
    all_day: true,
    due_at: `${due}T00:00:00.000Z`,
  });
  await session(me.id, t.id, 60, 120);
  const feed = await call(me.token, "POST", "/me/calendar-feed", {
    busy: false,
  });
  assert.equal(feed.status, 200, feed.raw.body);
  await call(me.token, "PUT", "/me/calendar-feed", { include_blocks: true });
  const ics = (
    await call(null, "GET", new URL(feed.body.url).pathname)
  ).raw.body.replace(/\r\n[ \t]/g, "");
  const events = ics.split("BEGIN:VEVENT");
  const item = events.find((e) => e.includes("SUMMARY:Hand in"))!;
  assert.ok(item.includes(`DTSTART;VALUE=DATE:${due.replaceAll("-", "")}`));
  assert.ok(!/DTSTART:\d{8}T/.test(item), "the task itself has no time");
  const s = events.find((e) => e.includes("SUMMARY:Session: Hand in"))!;
  assert.ok(s, "sessions are named as sessions");
  const description = /DESCRIPTION:(.*)/.exec(s)![1];
  assert.match(description, /^Due \w{3} \d{1,2} \w{3}$/, description);
});

// ---------------------------------------------------------- milestones ---

test("milestones: their own dated list, rolling up their tasks' planned finish", async () => {
  const owner = await person("Owner");
  const viewer = await person("Viewer");
  const outsider = await person("Outsider");
  const teamId = await team(owner, [{ id: viewer.id, role: "viewer" }]);
  const p = await project(owner.token, { team_id: teamId });
  const url = `/projects/${p.id}/milestones`;
  const today = localDateKey(new Date(), "UTC");
  const a = await task(owner.token, {
    title: "Survey",
    team_id: teamId,
    project_id: p.id,
    assignee_id: owner.id,
    estimate_minutes: 60,
  });
  const b = await task(owner.token, {
    title: "Report",
    team_id: teamId,
    project_id: p.id,
    assignee_id: owner.id,
    estimate_minutes: 60,
  });

  assert.equal((await call(null, "GET", url)).status, 401);
  assert.equal((await call(outsider.token, "GET", url)).status, 404);
  assert.equal(
    (await call(owner.token, "POST", url, { name: "", due_on: today })).status,
    422,
  );
  assert.equal(
    (
      await call(viewer.token, "POST", url, {
        name: "Draft",
        due_on: addDays(today, 5),
      })
    ).status,
    403,
  );
  const made = await call(owner.token, "POST", url, {
    name: "Draft ready",
    due_on: addDays(today, 5),
    item_ids: [a.id],
  });
  assert.equal(made.status, 201, made.raw.body);
  assert.equal(made.body.task_count, 1);
  assert.equal(made.body.status, "not_planned");
  assert.equal(made.body.needed_minutes, 60);

  // Planned before its day: on track, with its planned finish.
  await session(owner.id, a.id, 60, 120);
  let list = (await call(owner.token, "GET", url)).body;
  assert.equal(list[0].status, "on_track", JSON.stringify(list[0]));
  assert.ok(list[0].planned_finish_at);
  // The viewer sees the milestone, not the owner's sessions.
  const seen = (await call(viewer.token, "GET", url)).body;
  assert.equal(seen[0].task_count, 1);
  assert.equal(seen[0].planned_finish_at, null);

  // A task joins it on its own; another project's task can't.
  const other = await project(owner.token, { team_id: teamId });
  const stray = await task(owner.token, {
    title: "Stray",
    team_id: teamId,
    project_id: other.id,
  });
  assert.equal(
    (
      await call(owner.token, "PUT", `/items/${stray.id}/milestone`, {
        milestone_id: made.body.id,
      })
    ).status,
    422,
  );
  const joined = await call(owner.token, "PUT", `/items/${b.id}/milestone`, {
    milestone_id: made.body.id,
  });
  assert.equal(joined.status, 200, joined.raw.body);
  assert.equal(joined.body.milestone_id, made.body.id);
  list = (await call(owner.token, "GET", url)).body;
  assert.equal(list[0].task_count, 2);
  assert.equal(list[0].status, "not_planned");

  // Leaving the project leaves the milestone; a task's deadline is never written.
  const moving = await call(owner.token, "PUT", `/items/${b.id}/project`, {
    project_id: other.id,
  });
  assert.equal(moving.status, 200, moving.raw.body);
  const moved = (
    await pool.query("SELECT milestone_id, due_at FROM items WHERE id = $1", [
      b.id,
    ])
  ).rows[0];
  assert.equal(moved.milestone_id, null);
  assert.equal(moved.due_at, null);

  // Renamed, marked done, in the History; then removed, its tasks stay.
  const put = await call(owner.token, "PUT", `${url}/${made.body.id}`, {
    done: true,
  });
  assert.equal(put.body.status, "done");
  assert.ok(
    (await history(owner.token, p.id)).some(
      (r) => r.summary === "Milestone done: Draft ready",
    ),
  );
  assert.equal(
    (await call(viewer.token, "DELETE", `${url}/${made.body.id}`)).status,
    403,
  );
  assert.equal(
    (await call(owner.token, "DELETE", `${url}/${made.body.id}`)).status,
    204,
  );
  assert.equal(
    (await pool.query("SELECT milestone_id FROM items WHERE id = $1", [a.id]))
      .rows[0].milestone_id,
    null,
  );
  assert.equal(
    (await call(owner.token, "PUT", `${url}/${made.body.id}`, { name: "x" }))
      .status,
    404,
  );

  // The status rule on its own.
  const now = new Date("2026-10-01T12:00:00Z");
  const base = {
    due_on: "2026-10-05",
    done_at: null,
    task_count: 2,
    done_count: 0,
    needed_minutes: 60,
    planned_finish_at: null,
    unestimated_count: 0,
  };
  assert.equal(milestoneStatus(base, now, "UTC"), "not_planned");
  assert.equal(
    milestoneStatus(
      { ...base, planned_finish_at: "2026-10-06T09:00:00Z" },
      now,
      "UTC",
    ),
    "late",
  );
  assert.equal(
    milestoneStatus({ ...base, due_on: "2026-09-30" }, now, "UTC"),
    "passed",
  );
  assert.equal(
    milestoneStatus({ ...base, task_count: 0 }, now, "UTC"),
    "empty",
  );
});

// ------------------------------------------------------------ mentions ---

test("@mentions tell the people who can open the page, and list it under Mentioned in", async () => {
  const me = await person("Ana");
  const mate = await person("Ben");
  const outsider = await person("Cy");
  const teamId = await team(me, [{ id: mate.id, role: "member" }]);
  const line = `Ask ${mentionMarkdown({ id: mate.id, name: "Ben" })} and ${mentionMarkdown({ id: outsider.id, name: "Cy" })} about it.`;
  assert.equal(mentionedPerson(`/app/person/${mate.id}`), mate.id);
  assert.equal(mentionedPerson("orbyn://person/x"), null);
  assert.deepEqual(mentionQuery("Hi @be", 6), { from: 3, query: "be" });
  assert.equal(mentionQuery("mail@example", 12), null);

  const doc = await call(me.token, "POST", "/docs", {
    title: "Plan for Friday",
    team_id: teamId,
    content: [{ type: "paragraph", text: line, id: "l1" }],
  });
  assert.equal(doc.status, 201, doc.raw.body);
  const notices = async (userId: string) =>
    (
      await pool.query<{ title: string; ref: string }>(
        "SELECT title, ref FROM notifications WHERE user_id = $1 AND kind = 'mention'",
        [userId],
      )
    ).rows;
  const told = await notices(mate.id);
  assert.equal(told.length, 1);
  assert.equal(told[0].title, "Ana mentioned you in Plan for Friday");
  assert.equal(told[0].ref, `doc:${doc.body.id}:l1`);
  // Someone who can't open the page is never recorded or told.
  assert.equal((await notices(outsider.id)).length, 0);
  assert.equal(
    (await call(outsider.token, "GET", "/me/mentions")).body.length,
    0,
  );

  assert.equal((await call(null, "GET", "/me/mentions")).status, 401);
  assert.equal(
    (await call(mate.token, "GET", "/me/mentions?limit=0")).status,
    422,
  );
  const listed = (await call(mate.token, "GET", "/me/mentions")).body;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, "Plan for Friday");
  assert.equal(listed[0].mentioned_by, "Ana");
  assert.match(listed[0].quote, /Ask @Ben and @Cy about it/);

  // Saving again doesn't tell them twice; a new line naming them again doesn't either.
  const current = (await call(me.token, "GET", `/docs/${doc.body.id}`)).body;
  const saved = await call(me.token, "PUT", `/docs/${doc.body.id}`, {
    version: current.version,
    content: [
      ...current.content,
      {
        type: "paragraph",
        text: `Thanks ${mentionMarkdown({ id: mate.id, name: "Ben" })}`,
        id: "l2",
      },
    ],
  });
  assert.equal(saved.status, 200, saved.raw.body);
  assert.equal((await notices(mate.id)).length, 1);

  // Once they leave the team the page, and its title, drop out of the list.
  await pool.query(
    "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, mate.id],
  );
  assert.equal((await call(mate.token, "GET", "/me/mentions")).body.length, 0);
});

// ------------------------------------------------ keep out of assistant ---

test("a project kept out of the assistant: owners and admins decide, and no AI reads it", async () => {
  const owner = await person("Owner");
  const member = await person("Member");
  const teamId = await team(owner, [{ id: member.id, role: "member" }]);
  const p = await project(owner.token, { team_id: teamId });
  const secret = await task(owner.token, {
    title: "Secret merger",
    team_id: teamId,
    project_id: p.id,
  });
  const open = await task(owner.token, {
    title: "Open task",
    team_id: teamId,
  });
  const url = `/projects/${p.id}/assistant`;
  assert.equal((await call(null, "PUT", url, { off: true })).status, 401);
  assert.equal(
    (await call(owner.token, "PUT", url, { off: "yes" })).status,
    422,
  );
  assert.equal(
    (await call(member.token, "PUT", url, { off: true })).status,
    403,
  );
  const off = await call(owner.token, "PUT", url, { off: true });
  assert.equal(off.status, 200, off.raw.body);
  assert.equal(off.body.assistant_off, true);
  const rows = await history(owner.token, p.id);
  assert.ok(rows.some((r) => r.summary === "Kept out of the assistant"));

  // Agents' queries leave it out, and everything in it.
  const params = new visibility.Params();
  const scope = visibility.scopeFor(
    { userId: member.id, teamIds: null, personal: true },
    params,
  );
  const seen = (
    await pool.query<{ id: string }>(
      `SELECT i.id FROM items i WHERE ${visibility.visibleItems("i", scope)}`,
      params.values,
    )
  ).rows.map((r) => r.id);
  assert.ok(seen.includes(open.id));
  assert.ok(!seen.includes(secret.id));
  const projects = (
    await pool.query<{ id: string }>(
      `SELECT p.id FROM projects p WHERE ${visibility.visibleProjects("p", scope)}`,
      params.values,
    )
  ).rows.map((r) => r.id);
  assert.ok(!projects.includes(p.id));

  // The assistant's tools: nothing of it comes back.
  const out = await keptOutFor(pool, member.id);
  assert.ok(out.projects.has(p.id) && out.items.has(secret.id));
  const scrubbed = scrubKeptOut(
    { items: [{ id: secret.id, title: "Secret merger" }, { id: open.id }] },
    out,
  );
  assert.deepEqual(scrubbed, { items: [{ id: open.id }] });
  assert.throws(() => scrubKeptOut({ id: p.id, name: "x" }, out), KeptOutError);
  const ctx = {
    user: { id: member.id, role: "member" as const },
    timezone: "UTC",
    intentText: "what's in my list",
    actions: [],
    clarification: null,
  };
  const found = await runTool(
    {
      id: "1",
      name: "search_items",
      arguments: JSON.stringify({ query: "merger" }),
    },
    ctx,
  );
  assert.ok(!found.content.includes("Secret merger"), found.content);
  const direct = await runTool(
    { id: "2", name: "get_item", arguments: JSON.stringify({ id: secret.id }) },
    ctx,
  );
  assert.ok(!direct.content.includes("Secret merger"), direct.content);

  // A chat can't be scoped to it, and its pages aren't read for Study or page help.
  const chat = await call(member.token, "POST", "/ai/chat/start", {
    message: "Where does it stand?",
    timezone: "UTC",
    scope: { kind: "project", id: p.id },
  });
  assert.ok([422, 503].includes(chat.status), chat.raw.body);
  const page = await call(owner.token, "POST", "/docs", {
    title: "Merger notes",
    team_id: teamId,
    project_id: p.id,
    content: [{ type: "paragraph", text: "Q :: A", id: "x" }],
  });
  const ask = await call(owner.token, "POST", `/docs/${page.body.id}/ask`, {
    question: "What is this?",
  });
  assert.ok([422, 503].includes(ask.status), ask.raw.body);

  // Back in: the switch is the only thing that changes.
  const on = await call(owner.token, "PUT", url, { off: false });
  assert.equal(on.body.assistant_off, false);
  assert.equal((await keptOutFor(pool, member.id)).projects.size, 0);
});

// ------------------------------------------------------- saved chats ---

test("saved project chats are each person's own", async () => {
  const me = await person();
  const mate = await person();
  const teamId = await team(me, [{ id: mate.id, role: "member" }]);
  const p = await project(me.token, { team_id: teamId });
  const id = randomUUID();
  const turns = [
    { role: "user", text: "Where does the project stand?" },
    {
      role: "assistant",
      text: "Two tasks are left [1].",
      sources: [{ number: 1, title: "Draft", kind: "task", id: randomUUID() }],
    },
  ];
  const url = `/ai/chats/${id}`;
  assert.equal(
    (await call(null, "PUT", url, { project_id: p.id, turns })).status,
    401,
  );
  assert.equal(
    (await call(me.token, "PUT", url, { project_id: p.id, turns: [] })).status,
    422,
  );
  const outsider = await person();
  assert.equal(
    (await call(outsider.token, "PUT", url, { project_id: p.id, turns }))
      .status,
    404,
  );
  const saved = await call(me.token, "PUT", url, { project_id: p.id, turns });
  assert.equal(saved.status, 200, saved.raw.body);
  assert.equal(saved.body.title, "Where does the project stand?");
  assert.equal(saved.body.turn_count, 2);
  // Saving again after the next reply updates the same chat.
  const more = await call(me.token, "PUT", url, {
    project_id: p.id,
    turns: [...turns, { role: "user", text: "And next week?" }],
  });
  assert.equal(more.body.turn_count, 3);

  const list = (await call(me.token, "GET", `/ai/projects/${p.id}/chats`)).body;
  assert.equal(list.length, 1);
  const read = await call(me.token, "GET", url);
  assert.equal(read.body.turns.length, 3);
  assert.equal(read.body.turns[1].sources[0].title, "Draft");
  // A teammate sees none of it, and can't take it over.
  assert.equal(
    (await call(mate.token, "GET", `/ai/projects/${p.id}/chats`)).body.length,
    0,
  );
  assert.equal((await call(mate.token, "GET", url)).status, 404);
  assert.equal(
    (await call(mate.token, "PUT", url, { project_id: p.id, turns })).status,
    404,
  );
  assert.equal((await call(mate.token, "DELETE", url)).status, 404);
  // Kept out of the assistant, a project takes no new chats.
  await call(me.token, "PUT", `/projects/${p.id}/assistant`, { off: true });
  assert.equal(
    (
      await call(me.token, "PUT", `/ai/chats/${randomUUID()}`, {
        project_id: p.id,
        turns,
      })
    ).status,
    422,
  );
  assert.equal((await call(me.token, "DELETE", url)).status, 204);
  assert.equal((await call(me.token, "GET", url)).status, 404);
  assert.equal(
    chatTitle([{ role: "user", text: "  hello \n there " }]),
    "hello there",
  );
});

// ------------------------------------------- keys, kinds and rate limits ---

test("a personal API key can't let a kept-out project back in", async () => {
  const owner = await person("Owner");
  const p = await project(owner.token);
  const made = await call(owner.token, "POST", "/me/api-keys", {
    name: "Script",
  });
  assert.equal(made.status, 201, made.raw.body);
  const key = made.body.key as string;
  assert.ok(key.startsWith("ok_"));
  const url = `/projects/${p.id}/assistant`;
  assert.equal(
    (await call(owner.token, "PUT", url, { off: true })).status,
    200,
  );
  const refused = await call(key, "PUT", url, { off: false });
  assert.equal(refused.status, 403, refused.raw.body);
  assert.equal((await keptOutFor(pool, owner.id)).projects.size, 1);
});

test("only tasks join a milestone, and at most 50 per project even in parallel", async () => {
  const owner = await person("Owner");
  const p = await project(owner.token);
  const today = localDateKey(new Date(), "UTC");
  const m = await call(owner.token, "POST", `/projects/${p.id}/milestones`, {
    name: "Beta",
    due_on: today,
  });
  assert.equal(m.status, 201, m.raw.body);
  // An event can't be put in a project through the API; one that got there
  // some other way still can't join a milestone.
  const event = (
    await pool.query<{ id: string }>(
      `INSERT INTO items (user_id, kind, title, due_at, project_id)
       VALUES ($1, 'event', 'Kick-off', now() + interval '1 day', $2) RETURNING id`,
      [owner.id, p.id],
    )
  ).rows[0].id;
  const put = await call(owner.token, "PUT", `/items/${event}/milestone`, {
    milestone_id: m.body.id,
  });
  assert.equal(put.status, 422, put.raw.body);

  const adds = await Promise.all(
    Array.from({ length: 55 }, (_, i) =>
      call(owner.token, "POST", `/projects/${p.id}/milestones`, {
        name: `M${i}`,
        due_on: today,
      }),
    ),
  );
  assert.equal(adds.filter((r) => r.status === 201).length, 49);
  assert.ok(adds.every((r) => r.status === 201 || r.status === 409));
  const count = (
    await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM project_milestones WHERE project_id = $1",
      [p.id],
    )
  ).rows[0].n;
  assert.equal(count, 50);
});

test("the new planning routes answer 429 past the per-minute limit", async () => {
  const me = await person();
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  await settings();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  live.rate_limit_per_minute = 1;
  const routes: [string, string, Json | undefined][] = [
    ["POST", `/blocks/${randomUUID()}/check-in`, { outcome: "done" }],
    ["POST", `/blocks/${randomUUID()}/start`, { from: "reminder" }],
    ["POST", `/projects/${randomUUID()}/milestones`, { name: "M" }],
    ["PUT", `/items/${randomUUID()}/milestone`, { milestone_id: null }],
    ["PUT", `/projects/${randomUUID()}/assistant`, { off: true }],
    ["PUT", `/ai/chats/${randomUUID()}`, { turns: [] }],
    ["GET", "/me/mentions", undefined],
  ];
  try {
    let n = 0;
    for (const [method, url, payload] of routes) {
      const from = `10.93.0.${++n}`;
      const once = () =>
        app.inject({
          method: method as "GET" | "POST" | "PUT",
          url,
          remoteAddress: from,
          headers: { authorization: `Bearer ${me.token}` },
          ...(payload === undefined ? {} : { payload }),
        });
      assert.notEqual((await once()).statusCode, 429, `${method} ${url}`);
      assert.equal((await once()).statusCode, 429, `${method} ${url}`);
    }
  } finally {
    live.rate_limit_per_minute = was;
  }
});
