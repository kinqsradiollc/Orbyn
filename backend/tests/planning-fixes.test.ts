import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * The fixes Phase 1 builds on: a finished repeating task keeps its next
 * occurrence's sessions, a task moved to another space leaves its project,
 * a ticked checklist line finishes its task the usual way, project counts
 * leave out what isn't work, only lines tied to a task say so, session
 * changes reach other devices, and a project deadline means one moment.
 */
process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  addDays,
  changeProjectDeadline,
  dayTime,
  localDateKey,
  projectDeadlineAt,
  projectDeadlineParts,
} = await import("@orbyn/core");
const app = await buildApp();

const TZ = "Australia/Melbourne";
let caller = 0;
const address = () => `10.61.${Math.floor(++caller / 250)}.${caller % 250}`;

type Json = Record<string, any>;
async function call(
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
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
  let body: any = null;
  try {
    body = r.body ? JSON.parse(r.body) : null;
  } catch {
    body = r.body;
  }
  return { status: r.statusCode, body, raw: r };
}

/** A request whose body isn't JSON at all. */
const malformed = (token: string, method: "POST" | "PUT", url: string) =>
  app
    .inject({
      method,
      url,
      remoteAddress: address(),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: "{",
    })
    .then((r) => ({ status: r.statusCode }));

async function newUser() {
  const r = await call(null, "POST", "/auth/register", {
    email: `fix-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name: "Fixer",
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

async function newTeam(ownerId: string, members: string[] = []) {
  const id = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Fix crew', $1) RETURNING id",
      [ownerId],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')",
    [id, ownerId],
  );
  for (const m of members)
    await pool.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'member')",
      [id, m],
    );
  return id;
}

/** A webhook for `userId` that listens to `events`, straight into the table. */
async function hook(userId: string, events: string[]) {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO webhooks (user_id, url, events, secret_encrypted)
       VALUES ($1, 'https://hooks.example.com/orbyn', $2, 'test') RETURNING id`,
      [userId, events],
    )
  ).rows[0].id;
}

/** The events queued for a webhook, oldest first. */
async function delivered(webhookId: string) {
  return (
    await pool.query<{ event: string; payload: Json }>(
      `SELECT event, payload FROM webhook_deliveries WHERE webhook_id = $1
        ORDER BY created_at, event`,
      [webhookId],
    )
  ).rows;
}

/** A Melbourne wall-clock time on the day `offset` days from today. */
const local = (offset: number, hour: number, minute = 0) =>
  dayTime(
    addDays(localDateKey(new Date(), TZ), offset),
    hour * 60 + minute,
    TZ,
  ).toISOString();

const task = (data: Json) => ({ kind: "task", ...data });
const baseBody = (i: Json) => ({
  title: i.title,
  notes: i.notes,
  kind: i.kind,
  status: i.status,
  priority: i.priority,
  due_at: i.due_at,
  end_at: i.end_at,
  team_id: i.team_id,
  version: i.version,
});

async function session(token: string, itemId: string, start: string) {
  const r = await call(token, "POST", "/blocks", {
    item_id: itemId,
    start_at: start,
    end_at: new Date(Date.parse(start) + 45 * 60_000).toISOString(),
  });
  assert.equal(r.status, 201, r.raw.body);
  return r.body.id as string;
}

const sessionsOf = async (itemId: string) =>
  (
    await pool.query<{ id: string }>(
      "SELECT id FROM time_blocks WHERE item_id = $1 ORDER BY start_at",
      [itemId],
    )
  ).rows.map((r) => r.id);

before(async () => {
  await migrate();
});

after(async () => {
  await app.close();
  await pool.end();
});

// ---- repeating tasks --------------------------------------------------------

test("finishing a repeating task keeps the sessions for its next occurrence", async () => {
  const me = await newUser();
  // Due at 5 pm in two days, then every day after.
  const made = await call(
    me.token,
    "POST",
    "/items",
    task({
      title: "Practise scales",
      due_at: local(2, 17),
      rrule: "FREQ=DAILY",
      timezone: TZ,
    }),
  );
  assert.equal(made.status, 201, made.raw.body);
  const before = await session(me.token, made.body.id, local(1, 10));
  const nextOne = await session(me.token, made.body.id, local(3, 10));

  const done = await call(me.token, "PUT", `/items/${made.body.id}`, {
    ...baseBody(made.body),
    rrule: "FREQ=DAILY",
    timezone: TZ,
    status: "done",
  });
  assert.equal(done.status, 200, done.raw.body);
  // It moved on to the next day rather than closing.
  assert.equal(done.body.status, "todo");
  assert.equal(new Date(done.body.due_at).toISOString(), local(3, 17));
  // Only the finished occurrence's session went.
  assert.deepEqual(await sessionsOf(made.body.id), [nextOne]);
  assert.ok(!(await sessionsOf(made.body.id)).includes(before));
});

test("the quick tick moves a repeating task on and keeps its next sessions", async () => {
  const me = await newUser();
  const made = await call(
    me.token,
    "POST",
    "/items",
    task({
      title: "Water the plants",
      due_at: local(2, 17),
      rrule: "FREQ=DAILY",
      timezone: TZ,
    }),
  );
  await session(me.token, made.body.id, local(1, 11));
  const nextOne = await session(me.token, made.body.id, local(3, 11));

  const ticked = await call(
    me.token,
    "POST",
    `/items/${made.body.id}/updates`,
    { status: "done" },
  );
  assert.equal(ticked.status, 201, ticked.raw.body);
  assert.equal(ticked.body.status, "todo");
  assert.equal(new Date(ticked.body.due_at).toISOString(), local(3, 17));
  assert.deepEqual(await sessionsOf(made.body.id), [nextOne]);
  // One timeline entry says so, not an empty one beside it.
  const entries = ticked.body.updates.filter(
    (u: Json) => u.body === "" && u.status === "done",
  );
  assert.equal(entries.length, 0);
  assert.match(ticked.body.updates[0].body, /Completed the occurrence due/);
});

test("the quick tick finishes a task the usual way: sessions go, webhooks hear", async () => {
  const me = await newUser();
  const webhook = await hook(me.id, ["item.completed", "item.updated"]);
  const made = await call(
    me.token,
    "POST",
    "/items",
    task({ title: "Send the invoice", due_at: local(3, 17) }),
  );
  await session(me.token, made.body.id, local(1, 9));
  const ticked = await call(
    me.token,
    "POST",
    `/items/${made.body.id}/updates`,
    { status: "done", body: "Sent" },
  );
  assert.equal(ticked.status, 201, ticked.raw.body);
  assert.equal(ticked.body.status, "done");
  assert.equal(ticked.body.progress, 100);
  assert.deepEqual(await sessionsOf(made.body.id), []);
  const events = (await delivered(webhook)).map((d) => d.event);
  assert.ok(events.includes("item.completed"));
  assert.ok(events.includes("item.updated"));
  // The note is kept, with the status it set.
  assert.equal(ticked.body.updates[0].body, "Sent");
  assert.equal(ticked.body.updates[0].status, "done");

  // Reopening works the same way, and the same status twice is no change.
  const reopened = await call(
    me.token,
    "POST",
    `/items/${made.body.id}/updates`,
    { status: "todo" },
  );
  assert.equal(reopened.status, 201);
  assert.equal(reopened.body.status, "todo");
  const again = await call(me.token, "POST", `/items/${made.body.id}/updates`, {
    status: "todo",
  });
  assert.equal(again.status, 201);
  assert.equal(again.body.version, reopened.body.version);
});

test("a task whose assignee left the team can still be ticked off", async () => {
  const owner = await newUser();
  const member = await newUser();
  const teamId = await newTeam(owner.id, [member.id]);
  const made = await call(
    owner.token,
    "POST",
    "/items",
    task({
      title: "Book the venue",
      team_id: teamId,
      assignee_id: member.id,
    }),
  );
  assert.equal(made.status, 201, made.raw.body);
  await pool.query(
    "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, member.id],
  );
  const ticked = await call(
    owner.token,
    "POST",
    `/items/${made.body.id}/updates`,
    { status: "done" },
  );
  assert.equal(ticked.status, 201, ticked.raw.body);
  assert.equal(ticked.body.status, "done");
  // Choosing someone who isn't in the team is still refused.
  const detail = await call(owner.token, "GET", `/items/${made.body.id}`);
  const wrong = await call(owner.token, "PUT", `/items/${made.body.id}`, {
    ...baseBody(detail.body),
    assignee_id: randomUUID(),
  });
  assert.equal(wrong.status, 422);
});

test("a task waiting on one you can no longer see can still be ticked off", async () => {
  const owner = await newUser();
  const me = await newUser();
  const teamId = await newTeam(owner.id, [me.id]);
  const theirs = await call(
    owner.token,
    "POST",
    "/items",
    task({ title: "Approve the budget", team_id: teamId }),
  );
  const mine = await call(
    me.token,
    "POST",
    "/items",
    task({ title: "Order the stand", prerequisite_ids: [theirs.body.id] }),
  );
  assert.equal(mine.status, 201, mine.raw.body);
  await pool.query(
    "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, me.id],
  );
  const ticked = await call(
    me.token,
    "POST",
    `/items/${mine.body.id}/updates`,
    {
      status: "done",
    },
  );
  assert.equal(ticked.status, 201, ticked.raw.body);
  assert.equal(ticked.body.status, "done");
  // What it waited on is kept as it was.
  assert.deepEqual(ticked.body.prerequisite_ids, [theirs.body.id]);
});

test("the quick tick keeps its guards", async () => {
  const me = await newUser();
  const stranger = await newUser();
  const made = await call(
    me.token,
    "POST",
    "/items",
    task({ title: "Mine alone" }),
  );
  const url = `/items/${made.body.id}/updates`;
  assert.equal((await call(null, "POST", url, { status: "done" })).status, 401);
  assert.equal(
    (await call(stranger.token, "POST", url, { status: "done" })).status,
    404,
  );
  // Not a status: refused, and a body that isn't JSON is a bad request.
  assert.equal(
    (await call(me.token, "POST", url, { status: "finished" })).status,
    422,
  );
  assert.equal((await malformed(me.token, "POST", url)).status, 400);
  // A team viewer can read the task but not tick it.
  const owner = await newUser();
  const viewer = await newUser();
  const teamId = await newTeam(owner.id);
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'viewer')",
    [teamId, viewer.id],
  );
  const shared = await call(
    owner.token,
    "POST",
    "/items",
    task({ title: "Shared", team_id: teamId }),
  );
  assert.equal(
    (
      await call(viewer.token, "POST", `/items/${shared.body.id}/updates`, {
        status: "done",
      })
    ).status,
    403,
  );
});

// ---- moving between spaces --------------------------------------------------

test("a task moved to another space leaves its project and stage", async () => {
  const me = await newUser();
  const teamId = await newTeam(me.id);
  const project = await call(me.token, "POST", "/projects", {
    name: "Garden",
  });
  assert.equal(project.status, 201, project.raw.body);
  const made = await call(
    me.token,
    "POST",
    "/items",
    task({ title: "Plant the roses" }),
  );
  const filed = await call(me.token, "PUT", `/items/${made.body.id}/project`, {
    project_id: project.body.id,
    stage_id: project.body.stages[0].id,
  });
  assert.equal(filed.status, 200, filed.raw.body);

  // An ordinary edit keeps it in the project.
  const current = await call(me.token, "GET", `/items/${made.body.id}`);
  const renamed = await call(me.token, "PUT", `/items/${made.body.id}`, {
    ...baseBody(current.body),
    title: "Plant the red roses",
  });
  assert.equal(renamed.status, 200, renamed.raw.body);
  let row = (
    await pool.query("SELECT project_id, stage_id FROM items WHERE id = $1", [
      made.body.id,
    ])
  ).rows[0];
  assert.equal(row.project_id, project.body.id);
  assert.equal(row.stage_id, project.body.stages[0].id);

  // Moved into the team, it leaves the personal project.
  const moved = await call(me.token, "PUT", `/items/${made.body.id}`, {
    ...baseBody(renamed.body),
    team_id: teamId,
  });
  assert.equal(moved.status, 200, moved.raw.body);
  row = (
    await pool.query("SELECT project_id, stage_id FROM items WHERE id = $1", [
      made.body.id,
    ])
  ).rows[0];
  assert.equal(row.project_id, null);
  assert.equal(row.stage_id, null);
  const counts = await call(me.token, "GET", `/projects/${project.body.id}`);
  assert.equal(counts.body.task_count, 0);
});

// ---- checklist ticks --------------------------------------------------------

/** A page with one checklist line, made into a task. */
async function linkedLine(token: string, text: string) {
  const doc = await call(token, "POST", "/docs", {
    title: "Notes",
    content: [{ type: "todo", text, done: false }],
  });
  assert.equal(doc.status, 201, doc.raw.body);
  const made = await call(token, "POST", `/docs/${doc.body.id}/tasks`);
  assert.equal(made.status, 200, made.raw.body);
  assert.equal(made.body.created, 1);
  return { doc: made.body.doc as Json, item: made.body.items[0] as Json };
}

const tick = (token: string, doc: Json, done: boolean) =>
  call(token, "PUT", `/docs/${doc.id}`, {
    version: doc.version,
    content: doc.content.map((b: Json) =>
      b.type === "todo" ? { ...b, done } : b,
    ),
  });

test("ticking a linked line finishes its task the usual way", async () => {
  const me = await newUser();
  const webhook = await hook(me.id, ["item.completed"]);
  const { doc, item } = await linkedLine(me.token, "Call the plumber");
  assert.deepEqual(doc.linked_block_ids, [doc.content[0].id]);
  await session(me.token, item.id, local(1, 14));

  const saved = await tick(me.token, doc, true);
  assert.equal(saved.status, 200, saved.raw.body);
  const after = await call(me.token, "GET", `/items/${item.id}`);
  assert.equal(after.body.status, "done");
  assert.equal(after.body.progress, 100);
  assert.deepEqual(await sessionsOf(item.id), []);
  assert.ok(
    (await delivered(webhook)).some((d) => d.event === "item.completed"),
  );

  // Unticking reopens it.
  const reopened = await tick(me.token, saved.body, false);
  assert.equal(reopened.status, 200, reopened.raw.body);
  const back = await call(me.token, "GET", `/items/${item.id}`);
  assert.equal(back.body.status, "todo");
  assert.equal(back.body.progress, 0);
});

test("ticking a line tied to a repeating task moves the task on", async () => {
  const me = await newUser();
  const { doc, item } = await linkedLine(me.token, "Stretch");
  const current = await call(me.token, "GET", `/items/${item.id}`);
  const repeating = await call(me.token, "PUT", `/items/${item.id}`, {
    ...baseBody(current.body),
    due_at: local(2, 17),
    rrule: "FREQ=DAILY",
    timezone: TZ,
  });
  assert.equal(repeating.status, 200, repeating.raw.body);
  const nextOne = await session(me.token, item.id, local(3, 8));
  await session(me.token, item.id, local(1, 8));

  const saved = await tick(me.token, doc, true);
  assert.equal(saved.status, 200, saved.raw.body);
  const after = await call(me.token, "GET", `/items/${item.id}`);
  assert.equal(after.body.status, "todo");
  assert.equal(new Date(after.body.due_at).toISOString(), local(3, 17));
  assert.deepEqual(await sessionsOf(item.id), [nextOne]);
  // The page reads the task as it stands: open again, for the next day.
  const page = await call(me.token, "GET", `/docs/${doc.id}`);
  assert.equal(page.body.content[0].done, false);
});

test("a line whose task can't be changed here doesn't stop the save", async () => {
  const owner = await newUser();
  const me = await newUser();
  const teamId = await newTeam(owner.id, [me.id]);
  const { doc, item } = await linkedLine(me.token, "Order paint");
  // The task went to the team, where I'm now only a viewer.
  const current = await call(me.token, "GET", `/items/${item.id}`);
  const moved = await call(me.token, "PUT", `/items/${item.id}`, {
    ...baseBody(current.body),
    team_id: teamId,
  });
  assert.equal(moved.status, 200, moved.raw.body);
  await pool.query(
    "UPDATE team_members SET role = 'viewer' WHERE team_id = $1 AND user_id = $2",
    [teamId, me.id],
  );
  const saved = await tick(me.token, doc, true);
  assert.equal(saved.status, 200, saved.raw.body);
  const after = await call(owner.token, "GET", `/items/${item.id}`);
  assert.equal(after.body.status, "todo");
});

// ---- which lines are tasks --------------------------------------------------

test("a page says which of its lines are tasks", async () => {
  const me = await newUser();
  const stranger = await newUser();
  const { doc } = await linkedLine(me.token, "Book flights");
  // Lines get ids when they're remarked on; that doesn't make them tasks.
  const next = [
    ...doc.content,
    { type: "todo", text: "Pack", done: false, id: "b-remarked" },
    { type: "paragraph", text: "Just words", id: "b-words" },
  ];
  const saved = await call(me.token, "PUT", `/docs/${doc.id}`, {
    version: doc.version,
    content: next,
  });
  assert.equal(saved.status, 200, saved.raw.body);
  assert.deepEqual(saved.body.linked_block_ids, [doc.content[0].id]);
  const read = await call(me.token, "GET", `/docs/${doc.id}`);
  assert.deepEqual(read.body.linked_block_ids, [doc.content[0].id]);
  // The list stays light: no per-page ids there.
  const list = await call(me.token, "GET", "/docs");
  assert.equal(
    list.body.find((d: Json) => d.id === doc.id).linked_block_ids,
    undefined,
  );
  // "Add to my tasks" still finds the remarked-on line.
  const more = await call(me.token, "POST", `/docs/${doc.id}/tasks`);
  assert.equal(more.body.created, 1);
  assert.deepEqual(
    more.body.doc.linked_block_ids.sort(),
    [doc.content[0].id, "b-remarked"].sort(),
  );

  assert.equal((await call(null, "GET", `/docs/${doc.id}`)).status, 401);
  assert.equal(
    (await call(stranger.token, "GET", `/docs/${doc.id}`)).status,
    404,
  );
  assert.equal((await call(me.token, "GET", "/docs/not-an-id")).status, 422);
  assert.equal(
    (await malformed(me.token, "PUT", `/docs/${doc.id}`)).status,
    400,
  );
});

test("an agenda's lines aren't made into tasks again", async () => {
  const me = await newUser();
  const agenda = await call(me.token, "POST", "/docs", {
    title: "Agenda",
    kind: "agenda",
    content: [{ type: "todo", text: "Pay supplier", done: false }],
  });
  assert.equal(agenda.status, 201, agenda.raw.body);
  const made = await call(me.token, "POST", `/docs/${agenda.body.id}/tasks`);
  assert.equal(made.status, 422);
  assert.match(made.body.message ?? made.body.error ?? "", /agenda/i);
  const items = await pool.query(
    "SELECT 1 FROM items WHERE user_id = $1 AND title = 'Pay supplier'",
    [me.id],
  );
  assert.equal(items.rowCount, 0);
  assert.equal(
    (await call(null, "POST", `/docs/${agenda.body.id}/tasks`)).status,
    401,
  );
});

// ---- project counts ---------------------------------------------------------

test("project counts leave out cancelled tasks and events", async () => {
  const me = await newUser();
  const project = await call(me.token, "POST", "/projects", {
    name: "Move house",
  });
  const add = async (data: Json) => {
    const made = await call(me.token, "POST", "/items", data);
    assert.equal(made.status, 201, made.raw.body);
    await pool.query("UPDATE items SET project_id = $2 WHERE id = $1", [
      made.body.id,
      project.body.id,
    ]);
    return made.body;
  };
  await add(task({ title: "Pack books", status: "done" }));
  await add(task({ title: "Hire a van" }));
  await add(task({ title: "Paint the hall", status: "cancelled" }));
  await add({
    kind: "event",
    title: "Handover",
    due_at: local(5, 10),
    end_at: local(5, 11),
  });
  const read = await call(me.token, "GET", `/projects/${project.body.id}`);
  assert.equal(read.body.task_count, 2);
  assert.equal(read.body.done_count, 1);
  const list = await call(me.token, "GET", "/projects");
  const mine = list.body.find((p: Json) => p.id === project.body.id);
  assert.equal(mine.task_count, 2);
  assert.equal(mine.done_count, 1);
});

// ---- session change signals -------------------------------------------------

test("moving, rescheduling or removing a session tells other devices", async () => {
  const me = await newUser();
  const other = await newUser();
  const webhook = await hook(me.id, [
    "block.scheduled",
    "block.updated",
    "block.deleted",
  ]);
  const made = await call(
    me.token,
    "POST",
    "/items",
    task({ title: "Write the report", estimate_minutes: 60 }),
  );
  const id = await session(me.token, made.body.id, local(1, 9));

  const start = local(1, 13);
  const moved = await call(me.token, "PUT", `/blocks/${id}`, {
    start_at: start,
    end_at: local(1, 14),
  });
  assert.equal(moved.status, 200, moved.raw.body);
  const rescheduled = await call(me.token, "POST", `/blocks/${id}/reschedule`);
  assert.equal(rescheduled.status, 200, rescheduled.raw.body);
  const removed = await call(me.token, "DELETE", `/blocks/${id}`);
  assert.equal(removed.status, 204);

  const events = await delivered(webhook);
  assert.deepEqual(
    events.map((e) => e.event),
    ["block.scheduled", "block.updated", "block.updated", "block.deleted"],
  );
  assert.equal(events[1].payload.data.start_at, start);
  assert.equal(events[3].payload.data.id, id);
  assert.equal(events[3].payload.data.item_id, made.body.id);

  // Guards: signed in, your own session, a sensible time.
  const again = await session(me.token, made.body.id, local(2, 9));
  assert.equal((await call(null, "DELETE", `/blocks/${again}`)).status, 401);
  assert.equal(
    (
      await call(null, "PUT", `/blocks/${again}`, {
        start_at: start,
        end_at: local(1, 14),
      })
    ).status,
    401,
  );
  const theirs = await call(other.token, "DELETE", `/blocks/${again}`);
  assert.equal(theirs.status, 404);
  assert.match(theirs.body.message ?? theirs.body.error ?? "", /Session/);
  assert.equal(
    (await call(other.token, "POST", `/blocks/${again}/reschedule`)).status,
    404,
  );
  assert.equal(
    (
      await call(me.token, "PUT", `/blocks/${again}`, {
        start_at: local(1, 14),
        end_at: local(1, 13),
      })
    ).status,
    422,
  );
  assert.equal(
    (await call(me.token, "DELETE", "/blocks/not-an-id")).status,
    422,
  );
  assert.equal(
    (await malformed(me.token, "PUT", `/blocks/${again}`)).status,
    400,
  );
  // Nothing was sent for the refused changes.
  assert.equal((await delivered(webhook)).length, 5);
});

test("session changes are rate limited like everything else", async () => {
  const me = await newUser();
  const from = "10.62.0.1";
  const first = await call(
    me.token,
    "DELETE",
    `/blocks/${randomUUID()}`,
    undefined,
    from,
  );
  assert.equal(first.status, 404);
  const limit = Number(first.raw.headers["ratelimit-limit"]);
  assert.ok(limit > 0);
  let last = first;
  for (let i = 0; i < limit && last.status !== 429; i++)
    last = await call(
      me.token,
      "DELETE",
      `/blocks/${randomUUID()}`,
      undefined,
      from,
    );
  assert.equal(last.status, 429);
});

// ---- project deadline -------------------------------------------------------

test("a project deadline is 5 pm where you are unless you pick a time", () => {
  const la = "America/Los_Angeles";
  // Friday 16 October at 5 pm in Los Angeles is Saturday in UTC.
  const at = projectDeadlineAt("2026-10-16", null, la);
  assert.equal(at, "2026-10-17T00:00:00.000Z");
  // It still reads as Friday, 5 pm, there…
  assert.deepEqual(projectDeadlineParts(at, la), {
    day: "2026-10-16",
    clock: "17:00",
  });
  // …and as the same moment in Melbourne.
  assert.deepEqual(projectDeadlineParts(at, TZ), {
    day: "2026-10-17",
    clock: "11:00",
  });
  // A picked time is kept.
  assert.equal(
    projectDeadlineAt("2026-10-16", "09:30", la),
    "2026-10-16T16:30:00.000Z",
  );
  // Changing the day keeps the time; changing the time keeps the day.
  const moved = changeProjectDeadline(at, { day: "2026-10-20" }, la)!;
  assert.deepEqual(projectDeadlineParts(moved, la), {
    day: "2026-10-20",
    clock: "17:00",
  });
  const earlier = changeProjectDeadline(moved, { clock: "08:15" }, la)!;
  assert.deepEqual(projectDeadlineParts(earlier, la), {
    day: "2026-10-20",
    clock: "08:15",
  });
  // A first deadline starts at 5 pm; no day means no deadline.
  assert.equal(changeProjectDeadline(null, { day: "2026-10-16" }, la), at);
  assert.equal(changeProjectDeadline(at, { day: null }, la), null);
  assert.equal(changeProjectDeadline(null, { clock: "09:00" }, la), null);
});
