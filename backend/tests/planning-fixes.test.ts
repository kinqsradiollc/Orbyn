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
  adoptTaskTicks,
  changeProjectDeadline,
  dayTime,
  localDateKey,
  mergeDocs,
  onlyTaskTicksMoved,
  projectDeadlineAt,
  projectDeadlineParts,
  setTodoSource,
  ticksTakenFrom,
  WEBHOOK_EVENTS,
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
  headers: Record<string, string> = {},
) {
  const r = await app.inject({
    method,
    url,
    remoteAddress: from,
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
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

/** Make a linked line's task repeat daily from the day after tomorrow. */
async function makeDaily(token: string, itemId: string) {
  const current = await call(token, "GET", `/items/${itemId}`);
  const repeating = await call(token, "PUT", `/items/${itemId}`, {
    ...baseBody(current.body),
    due_at: local(2, 17),
    rrule: "FREQ=DAILY",
    timezone: TZ,
  });
  assert.equal(repeating.status, 200, repeating.raw.body);
}

/** How many occurrences of a repeating task have been completed. */
const completions = async (itemId: string) =>
  (
    await pool.query(
      `SELECT 1 FROM item_updates
        WHERE item_id = $1 AND body LIKE 'Completed the occurrence%'`,
      [itemId],
    )
  ).rowCount;

/** Forget when the page's history was last kept, so the next save keeps it. */
const newSitting = (docId: string) =>
  pool.query(
    "UPDATE doc_versions SET created_at = now() - interval '1 hour' WHERE doc_id = $1",
    [docId],
  );

test("a ticked repeating line moves its task on once, however the page is saved again", async () => {
  const me = await newUser();
  const { doc, item } = await linkedLine(me.token, "Water the plants");
  await makeDaily(me.token, item.id);
  const nextOne = await session(me.token, item.id, local(3, 8));
  const line = doc.content[0];

  const ticked = await tick(me.token, doc, true);
  assert.equal(ticked.status, 200, ticked.raw.body);
  assert.equal(await completions(item.id), 1);
  // The save answers, and the page is kept, with the task as it now stands:
  // open again, for the next day.
  assert.equal(ticked.body.content[0].done, false);
  const stored = await pool.query("SELECT content FROM docs WHERE id = $1", [
    doc.id,
  ]);
  assert.equal(stored.rows[0].content[0].done, false);

  // An app that still shows the old tick saves an unrelated edit, twice.
  await newSitting(doc.id);
  let version = ticked.body.version;
  for (const text of ["Balcony first", "Balcony first, then the hall"]) {
    const stale = await call(me.token, "PUT", `/docs/${doc.id}`, {
      version,
      content: [
        { ...line, done: true },
        { type: "paragraph", text, id: "b-more" },
      ],
    });
    assert.equal(stale.status, 200, stale.raw.body);
    assert.equal(stale.body.content[0].done, false);
    version = stale.body.version;
  }
  // And one that took the answer's tick saves again.
  await newSitting(doc.id);
  const read = await call(me.token, "GET", `/docs/${doc.id}`);
  const fresh = await call(me.token, "PUT", `/docs/${doc.id}`, {
    version: read.body.version,
    content: [
      ...read.body.content,
      { type: "paragraph", text: "Then the kitchen", id: "b-kitchen" },
    ],
  });
  assert.equal(fresh.status, 200, fresh.raw.body);

  // A proposal taken on the page changes words, never a tick.
  const proposed = await call(me.token, "POST", `/docs/${doc.id}/suggestions`, {
    changes: [
      {
        block_id: "b-more",
        kind: "replace",
        range_start: 0,
        range_end: "Balcony".length,
        text: "Garden",
        quote: "Balcony",
      },
    ],
  });
  assert.equal(proposed.status, 201, proposed.raw.body);
  const taken = await call(
    me.token,
    "POST",
    `/docs/${doc.id}/suggestions/${proposed.body[0].id}`,
    { take: true },
  );
  assert.equal(taken.status, 200, taken.raw.body);
  assert.equal(taken.body.doc.content[0].done, false);
  assert.equal(taken.body.doc.content[1].text, "Garden first, then the hall");

  // Every version the page kept, restored one after another.
  const kept = await call(me.token, "GET", `/docs/${doc.id}/versions`);
  assert.ok(kept.body.length >= 3, "the page kept its sittings");
  for (const v of kept.body) {
    const restored = await call(
      me.token,
      "POST",
      `/docs/${doc.id}/versions/${v.version}/restore`,
    );
    assert.equal(restored.status, 200, restored.raw.body);
    assert.equal(restored.body.content[0].done, false);
  }

  assert.equal(await completions(item.id), 1);
  const after = await call(me.token, "GET", `/items/${item.id}`);
  assert.equal(after.body.status, "todo");
  assert.equal(new Date(after.body.due_at).toISOString(), local(3, 17));
  assert.deepEqual(await sessionsOf(item.id), [nextOne]);

  // Ticking it again is a new tick, and finishes the next occurrence.
  const page = await call(me.token, "GET", `/docs/${doc.id}`);
  assert.equal(page.body.content[0].done, false);
  const second = await tick(me.token, page.body, true);
  assert.equal(second.status, 200, second.raw.body);
  assert.equal(await completions(item.id), 2);
  const later = await call(me.token, "GET", `/items/${item.id}`);
  assert.equal(new Date(later.body.due_at).toISOString(), local(4, 17));
});

test("a line starts again from its task when the task changes elsewhere", async () => {
  const me = await newUser();
  const { doc, item } = await linkedLine(me.token, "Send the invoice");
  const ticked = await tick(me.token, doc, true);
  assert.equal(ticked.status, 200, ticked.raw.body);
  // Reopened in the planner, the line reads unticked, and ticking it there
  // finishes the task again.
  const reopened = await call(me.token, "POST", `/items/${item.id}/updates`, {
    status: "todo",
  });
  assert.equal(reopened.status, 201, reopened.raw.body);
  const page = await call(me.token, "GET", `/docs/${doc.id}`);
  assert.equal(page.body.content[0].done, false);
  const again = await tick(me.token, page.body, true);
  assert.equal(again.status, 200, again.raw.body);
  assert.equal(
    (await call(me.token, "GET", `/items/${item.id}`)).body.status,
    "done",
  );
});

test("a link made before pages kept their ticks goes by the task", async () => {
  const me = await newUser();
  const { doc, item } = await linkedLine(me.token, "Renew the lease");
  await makeDaily(me.token, item.id);
  await pool.query("UPDATE doc_task_links SET done = NULL WHERE doc_id = $1", [
    doc.id,
  ]);
  const ticked = await tick(me.token, doc, true);
  assert.equal(ticked.status, 200, ticked.raw.body);
  assert.equal(await completions(item.id), 1);
  // From then on it remembers, so the same tick sent again does nothing.
  const link = await pool.query(
    "SELECT done FROM doc_task_links WHERE doc_id = $1",
    [doc.id],
  );
  assert.equal(link.rows[0].done, true);
  const stale = await call(me.token, "PUT", `/docs/${doc.id}`, {
    version: ticked.body.version,
    content: [{ ...doc.content[0], done: true }],
  });
  assert.equal(stale.status, 200, stale.raw.body);
  assert.equal(await completions(item.id), 1);
});

test("a real failure while ticking a line fails the save", async () => {
  const me = await newUser();
  const { doc, item } = await linkedLine(me.token, "Back up the laptop");
  // The database refuses to change this one task, as a broken disk might.
  const fn = `refuse_${randomUUID().replace(/-/g, "")}`;
  await pool.query(
    `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS
       $$ BEGIN RAISE EXCEPTION 'storage unavailable'; END $$`,
  );
  await pool.query(
    `CREATE TRIGGER ${fn} BEFORE UPDATE ON items FOR EACH ROW
       WHEN (OLD.id = '${item.id}') EXECUTE FUNCTION ${fn}()`,
  );
  try {
    const saved = await tick(me.token, doc, true);
    assert.equal(saved.status, 500, saved.raw.body);
    assert.doesNotMatch(saved.raw.body, /storage unavailable/);
  } finally {
    await pool.query(`DROP TRIGGER ${fn} ON items`);
    await pool.query(`DROP FUNCTION ${fn}()`);
  }
  // Nothing was half-saved: the page, the task and the link are as before.
  const page = await call(me.token, "GET", `/docs/${doc.id}`);
  assert.equal(page.body.version, doc.version);
  assert.equal(page.body.content[0].done, false);
  assert.equal(
    (await call(me.token, "GET", `/items/${item.id}`)).body.status,
    "todo",
  );
  // Once it's fixed, the same tick goes through.
  const retried = await tick(me.token, doc, true);
  assert.equal(retried.status, 200, retried.raw.body);
  assert.equal(
    (await call(me.token, "GET", `/items/${item.id}`)).body.status,
    "done",
  );
});

test("an editor takes the ticks a save came back with", () => {
  const sent = [
    { type: "todo" as const, text: "Stretch", done: true, id: "a" },
    { type: "todo" as const, text: "Read", done: true, id: "b" },
    { type: "todo" as const, text: "Walk", done: false, id: "c" },
    { type: "paragraph" as const, text: "Notes", id: "d" },
  ];
  const saved = {
    // "a" repeats and moved on; "b" was ticked again here since; "c" isn't
    // a task, so its tick is the page's own.
    content: [
      { ...sent[0], done: false },
      { ...sent[1], done: false },
      { ...sent[2], done: true },
      sent[3],
    ],
    linked_block_ids: ["a", "b"],
  };
  const local = [sent[0], { ...sent[1], done: false }, sent[2], sent[3]];
  const took = adoptTaskTicks(local, sent, saved);
  assert.deepEqual(took.changed, ["a"]);
  assert.equal(took.blocks[0].type === "todo" && took.blocks[0].done, false);
  assert.equal(took.blocks[1], local[1]);
  assert.equal(took.blocks[2], local[2]);
  // Nothing to take: the same array back, so nothing re-renders or re-saves.
  const none = adoptTaskTicks(took.blocks, took.blocks, saved);
  assert.deepEqual(none.changed, []);
  assert.equal(none.blocks, took.blocks);
  assert.equal(
    adoptTaskTicks(local, sent, { content: saved.content }).blocks,
    local,
  );

  assert.equal(setTodoSource("- [x] Stretch", false), "- [ ] Stretch");
  assert.equal(setTodoSource("  * [ ] Read", true), "  * [x] Read");
  assert.equal(setTodoSource("- [ ] Walk", false), "- [ ] Walk");
  assert.equal(setTodoSource("Just words [x]", false), "Just words [x]");
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
  // The page reads, and keeps, the task as it really is, so the refused tick
  // isn't tried again with every save.
  assert.equal(saved.body.content[0].done, false);
  const stored = await pool.query("SELECT content FROM docs WHERE id = $1", [
    doc.id,
  ]);
  assert.equal(stored.rows[0].content[0].done, false);
  // Allowed again, the page's own tick hasn't changed: nothing happens
  // until the line is ticked again.
  await pool.query(
    "UPDATE team_members SET role = 'member' WHERE team_id = $1 AND user_id = $2",
    [teamId, me.id],
  );
  const again = await call(me.token, "PUT", `/docs/${doc.id}`, {
    version: saved.body.version,
    content: [{ ...doc.content[0], done: true }],
  });
  assert.equal(again.status, 200, again.raw.body);
  const still = await call(owner.token, "GET", `/items/${item.id}`);
  assert.equal(still.body.status, "todo");
  const untick = await tick(me.token, again.body, false);
  const retick = await tick(me.token, untick.body, true);
  assert.equal(retick.status, 200, retick.raw.body);
  const done = await call(owner.token, "GET", `/items/${item.id}`);
  assert.equal(done.body.status, "done");
});

// ---- repeating tasks due on a day or over a span ------------------------------

/** A session from `start` to `end`. */
async function sessionUntil(
  token: string,
  itemId: string,
  start: string,
  end: string,
) {
  const r = await call(token, "POST", "/blocks", {
    item_id: itemId,
    start_at: start,
    end_at: end,
  });
  assert.equal(r.status, 201, r.raw.body);
  return r.body.id as string;
}

type Finish = "edit" | "quick tick" | "page tick";

/**
 * A linked line whose task repeats daily with `when` (all-day, or with an
 * end time), finished the given way once `sessions` are placed.
 */
async function finishRepeating(
  how: Finish,
  when: Json,
  sessions: (itemId: string, token: string) => Promise<string[]>,
) {
  const me = await newUser();
  const { doc, item } = await linkedLine(me.token, `Daily check (${how})`);
  const current = await call(me.token, "GET", `/items/${item.id}`);
  const repeating = await call(me.token, "PUT", `/items/${item.id}`, {
    ...baseBody(current.body),
    ...when,
    rrule: "FREQ=DAILY",
    timezone: TZ,
  });
  assert.equal(repeating.status, 200, repeating.raw.body);
  const placed = await sessions(item.id, me.token);

  let finished: Json;
  if (how === "edit") {
    const r = await call(me.token, "PUT", `/items/${item.id}`, {
      ...baseBody(repeating.body),
      ...when,
      rrule: "FREQ=DAILY",
      timezone: TZ,
      status: "done",
    });
    assert.equal(r.status, 200, r.raw.body);
    finished = r.body;
  } else if (how === "quick tick") {
    const r = await call(me.token, "POST", `/items/${item.id}/updates`, {
      status: "done",
    });
    assert.equal(r.status, 201, r.raw.body);
    finished = r.body;
  } else {
    const page = await call(me.token, "GET", `/docs/${doc.id}`);
    const r = await tick(me.token, page.body, true);
    assert.equal(r.status, 200, r.raw.body);
    finished = (await call(me.token, "GET", `/items/${item.id}`)).body;
  }
  // It moved on to the next day rather than closing.
  assert.equal(finished.status, "todo");
  assert.equal(await completions(item.id), 1);
  const shown = await call(me.token, "GET", `/items/${item.id}/sessions`);
  assert.equal(shown.status, 200, shown.raw.body);
  return {
    placed,
    finished,
    left: await sessionsOf(item.id),
    shown: shown.body as Json,
  };
}

const WAYS: Finish[] = ["edit", "quick tick", "page tick"];

test("finishing an all-day repeating task takes that day's sessions, whichever way", async () => {
  for (const how of WAYS) {
    // Due tomorrow, all day: its deadline is the end of tomorrow.
    const { placed, finished, left, shown } = await finishRepeating(
      how,
      { due_at: local(1, 0), end_at: null, all_day: true },
      async (id, token) => [
        // Tomorrow morning and tomorrow afternoon: for tomorrow's occurrence.
        await sessionUntil(token, id, local(1, 10), local(1, 10, 45)),
        await sessionUntil(token, id, local(1, 15), local(1, 16)),
        // Running past midnight: it ends after tomorrow, so it's for the next.
        await sessionUntil(token, id, local(1, 23, 30), local(2, 0, 15)),
        // The day after: for the next occurrence.
        await sessionUntil(token, id, local(2, 10), local(2, 10, 45)),
      ],
    );
    assert.equal(
      new Date(finished.due_at).toISOString(),
      local(2, 0),
      `${how}: moved on a day`,
    );
    assert.deepEqual(left, [placed[2], placed[3]], `${how}: sessions kept`);
    // Nothing is left over for the finished day: every session still there
    // is shown on the task, for the occurrence it's now due.
    assert.equal(shown.sessions.length, 2, how);
    for (const s of shown.sessions)
      assert.equal(new Date(s.due_at).toISOString(), local(2, 0), how);
  }
});

test("finishing a repeating task with an end time takes the sessions up to its end", async () => {
  for (const how of WAYS) {
    // Due tomorrow 9 am to 5 pm: its deadline is 5 pm.
    const { placed, finished, left, shown } = await finishRepeating(
      how,
      { due_at: local(1, 9), end_at: local(1, 17) },
      async (id, token) => [
        // Within the span, and one ending right at 5 pm: for tomorrow.
        await sessionUntil(token, id, local(1, 11), local(1, 11, 45)),
        await sessionUntil(token, id, local(1, 16, 15), local(1, 17)),
        // Running past 5 pm: for the next occurrence.
        await sessionUntil(token, id, local(1, 16, 30), local(1, 17, 15)),
        await sessionUntil(token, id, local(2, 11), local(2, 11, 45)),
      ],
    );
    assert.equal(new Date(finished.due_at).toISOString(), local(2, 9), how);
    assert.equal(new Date(finished.end_at).toISOString(), local(2, 17), how);
    assert.deepEqual(left, [placed[2], placed[3]], `${how}: sessions kept`);
    assert.equal(shown.sessions.length, 2, how);
    for (const s of shown.sessions)
      assert.equal(new Date(s.due_at).toISOString(), local(2, 9), how);
  }
});

// ---- pages hear when their task changes elsewhere ------------------------------

test("a task finished elsewhere moves its pages on, so an old copy can't reopen it", async () => {
  const me = await newUser();
  const { doc, item } = await linkedLine(me.token, "Pay the rent");
  // An old copy of the page, from before the task was finished.
  const stale = doc;

  const done = await call(me.token, "POST", `/items/${item.id}/updates`, {
    status: "done",
  });
  assert.equal(done.status, 201, done.raw.body);
  const page = await call(me.token, "GET", `/docs/${doc.id}`);
  assert.equal(page.body.version, stale.version + 1);
  assert.equal(page.body.content[0].done, true);
  // Moving the version isn't an edit: the page wasn't written on.
  assert.equal(page.body.updated_at, stale.updated_at);

  // The old copy saves a typed line with the old tick: refused as stale, so
  // the editor re-reads and merges instead of reopening the task.
  const typed = await call(me.token, "PUT", `/docs/${doc.id}`, {
    version: stale.version,
    content: [
      ...stale.content,
      { type: "paragraph", text: "Paid by transfer", id: "b-typed" },
    ],
  });
  assert.equal(typed.status, 409, typed.raw.body);
  assert.equal(
    (await call(me.token, "GET", `/items/${item.id}`)).body.status,
    "done",
  );

  // The same the other way: reopened elsewhere, an old ticked copy can't
  // finish it again.
  const reopened = await call(me.token, "POST", `/items/${item.id}/updates`, {
    status: "todo",
  });
  assert.equal(reopened.status, 201, reopened.raw.body);
  const again = await tick(me.token, page.body, true);
  assert.equal(again.status, 409, again.raw.body);
  assert.equal(
    (await call(me.token, "GET", `/items/${item.id}`)).body.status,
    "todo",
  );

  // Read afresh, unticking and ticking there work as usual.
  const fresh = await call(me.token, "GET", `/docs/${doc.id}`);
  assert.equal(fresh.body.content[0].done, false);
  const ticked = await tick(me.token, fresh.body, true);
  assert.equal(ticked.status, 200, ticked.raw.body);
  // The page doing the tick moves on once, by its own save.
  assert.equal(ticked.body.version, fresh.body.version + 1);
  assert.equal(
    (await call(me.token, "GET", `/items/${item.id}`)).body.status,
    "done",
  );
});

test("a tick on one page moves the other pages showing the task, and they hear it", async () => {
  const { streamDocChanges, watcherCount } =
    await import("../src/modules/docs/live.js");
  const me = await newUser();
  const { doc, item } = await linkedLine(me.token, "Book the venue");
  // A second page with a line tied to the same task.
  const other = await call(me.token, "POST", "/docs", {
    title: "Plans",
    content: [{ type: "todo", text: "Book the venue", done: false, id: "v" }],
  });
  assert.equal(other.status, 201, other.raw.body);
  await pool.query(
    "INSERT INTO doc_task_links (doc_id, block_id, item_id, done) VALUES ($1, 'v', $2, false)",
    [other.body.id, item.id],
  );

  const written: string[] = [];
  const reply = {
    getHeaders: () => ({}),
    raw: { writeHead: () => {}, write: (c: string) => written.push(c) },
  } as never;
  const stop = await streamDocChanges(reply, other.body.id, "tab-other");
  try {
    const ticked = await tick(me.token, doc, true);
    assert.equal(ticked.status, 200, ticked.raw.body);
    assert.equal(ticked.body.version, doc.version + 1);

    const moved = await call(me.token, "GET", `/docs/${other.body.id}`);
    assert.equal(moved.body.version, other.body.version + 1);
    assert.equal(moved.body.content[0].done, true);

    const deadline = Date.now() + 5000;
    while (!written.some((c) => c.startsWith("data:")) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 25));
    const events = written
      .filter((c) => c.startsWith("data:"))
      .map((c) => JSON.parse(c.slice(5)) as Json);
    assert.equal(events.length, 1);
    assert.equal(events[0].version, moved.body.version);
  } finally {
    stop();
  }
  assert.equal(watcherCount(other.body.id), 0);

  // Saving the other page as it stands changes no task, so moves no page.
  const quiet = await call(me.token, "GET", `/docs/${other.body.id}`);
  const unchanged = await call(me.token, "PUT", `/docs/${other.body.id}`, {
    version: quiet.body.version,
    content: quiet.body.content,
  });
  assert.equal(unchanged.status, 200, unchanged.raw.body);
  assert.equal(
    (await call(me.token, "GET", `/docs/${doc.id}`)).body.version,
    doc.version + 1,
  );
});

test("a page being saved at that moment isn't waited for, and its old tick doesn't count", async () => {
  const me = await newUser();
  const { doc, item } = await linkedLine(me.token, "Renew the insurance");
  // Another request holds the page, as a save in progress does.
  const holder = await pool.connect();
  let finished: { status: number; raw: { body: string } } | undefined;
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT 1 FROM docs WHERE id = $1 FOR UPDATE", [doc.id]);
    const quick = call(me.token, "POST", `/items/${item.id}/updates`, {
      status: "done",
    });
    finished = await Promise.race([
      quick,
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 5000)),
    ]);
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }
  assert.ok(finished, "the tick didn't wait for the page");
  assert.equal(finished.status, 201, finished.raw.body);
  // The page kept its version (its save gives the next one), and a save
  // made from before the change doesn't reopen the task, even one claiming
  // its ticks are from a later version than it's based on.
  const page = await call(me.token, "GET", `/docs/${doc.id}`);
  assert.equal(page.body.version, doc.version);
  const saved = await call(
    me.token,
    "PUT",
    `/docs/${doc.id}`,
    {
      version: doc.version,
      content: [
        ...doc.content,
        { type: "paragraph", text: "Called them", id: "b" },
      ],
    },
    address(),
    { "x-orbyn-ticks-from": String(doc.version + 5) },
  );
  assert.equal(saved.status, 200, saved.raw.body);
  assert.equal(saved.body.content[0].done, true);
  assert.equal(
    (await call(me.token, "GET", `/items/${item.id}`)).body.status,
    "done",
  );
  // From that save on, the page shows it done, and unticking it reopens it.
  const untick = await call(
    me.token,
    "PUT",
    `/docs/${doc.id}`,
    {
      version: saved.body.version,
      content: saved.body.content.map((b: Json) =>
        b.type === "todo" ? { ...b, done: false } : b,
      ),
    },
    address(),
    { "x-orbyn-ticks-from": String(saved.body.version) },
  );
  assert.equal(untick.status, 200, untick.raw.body);
  assert.equal(
    (await call(me.token, "GET", `/items/${item.id}`)).body.status,
    "todo",
  );
});

test("a save waiting on a task finished elsewhere reads it afresh, so its old tick doesn't reopen it", async () => {
  const { setItemStatus } = await import("../src/modules/items/service.js");
  // Once from an editor that says where its ticks came from, once from an
  // older app that doesn't.
  for (const says of [true, false]) {
    const me = await newUser();
    const { doc, item } = await linkedLine(me.token, "Renew the insurance");
    const typed = [
      ...doc.content,
      { type: "paragraph", text: "Called them", id: "b" },
    ];
    // The task is being finished elsewhere: that request holds it.
    const holder = await pool.connect();
    let saving: ReturnType<typeof call> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM items WHERE id = $1 FOR UPDATE", [
        item.id,
      ]);
      const pid = (
        await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0].pid;
      // Meanwhile a copy of the page open from before types a line, its
      // checklist line unticked as it read it. Its save waits for the task.
      saving = says
        ? saveFrom(me.token, doc.id, doc.version, doc.version, typed)
        : call(me.token, "PUT", `/docs/${doc.id}`, {
            version: doc.version,
            content: typed,
          });
      const deadline = Date.now() + 5000;
      for (;;) {
        const waiting = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE $1 = ANY (pg_blocking_pids(pid))`,
          [pid],
        );
        if (waiting.rows[0].n > 0) break;
        assert.ok(Date.now() < deadline, "the save waits for the task");
        await new Promise((r) => setTimeout(r, 20));
      }
      await setItemStatus(
        holder as never,
        { id: me.id, role: "member" },
        item.id,
        "done",
        100,
      );
      await holder.query("COMMIT");
    } catch (e) {
      await holder.query("ROLLBACK");
      throw e;
    } finally {
      holder.release();
    }
    const saved = await saving!;
    assert.equal(saved.status, 200, saved.raw.body);
    assert.equal(saved.body.content[0].done, true, `header: ${says}`);
    assert.equal(saved.body.content[1].text, "Called them");
    assert.equal(
      (await call(me.token, "GET", `/items/${item.id}`)).body.status,
      "done",
      `header: ${says}`,
    );
    // From that save on the page shows it done, and unticking it there
    // reopens it.
    const untick = await saveFrom(
      me.token,
      doc.id,
      saved.body.version,
      saved.body.version,
      saved.body.content.map((b: Json) =>
        b.type === "todo" ? { ...b, done: false } : b,
      ),
    );
    assert.equal(untick.status, 200, untick.raw.body);
    assert.equal(
      (await call(me.token, "GET", `/items/${item.id}`)).body.status,
      "todo",
    );
  }
});

// ---- where an editor's ticks came from -----------------------------------------

/** A save that says which version its ticks were taken from. */
const saveFrom = (
  token: string,
  docId: string,
  version: number,
  from: number | string,
  content: Json[],
) =>
  call(token, "PUT", `/docs/${docId}`, { version, content }, address(), {
    "x-orbyn-ticks-from": String(from),
  });

test("ticking a repeating line again counts once the page has shown it unticked", async () => {
  const me = await newUser();
  const { doc, item } = await linkedLine(me.token, "Feed the fish");
  await makeDaily(me.token, item.id);
  const line = doc.content[0];
  const ticked = (d: boolean) => [{ ...line, done: d }];

  const first = await saveFrom(
    me.token,
    doc.id,
    doc.version,
    doc.version,
    ticked(true),
  );
  assert.equal(first.status, 200, first.raw.body);
  assert.equal(await completions(item.id), 1);
  assert.equal(first.body.content[0].done, false);

  // A save queued before that answer came back still carries the tick.
  const queued = await saveFrom(
    me.token,
    doc.id,
    first.body.version,
    doc.version,
    [...ticked(true), { type: "paragraph", text: "Flakes", id: "b" }],
  );
  assert.equal(queued.status, 200, queued.raw.body);
  assert.equal(await completions(item.id), 1);

  // The save that would have taken the answer never arrived (the app was
  // closed). Opened afresh, the line reads unticked, and ticking it
  // finishes the next occurrence.
  const page = await call(me.token, "GET", `/docs/${doc.id}`);
  assert.equal(page.body.content[0].done, false);
  const second = await saveFrom(
    me.token,
    doc.id,
    page.body.version,
    page.body.version,
    page.body.content.map((b: Json) =>
      b.type === "todo" ? { ...b, done: true } : b,
    ),
  );
  assert.equal(second.status, 200, second.raw.body);
  assert.equal(await completions(item.id), 2);
  assert.equal(
    new Date(
      (await call(me.token, "GET", `/items/${item.id}`)).body.due_at,
    ).toISOString(),
    local(4, 17),
  );

  // An app that doesn't say where its ticks came from, still showing the
  // tick, goes by what the page last said: nothing more.
  const older = await call(me.token, "PUT", `/docs/${doc.id}`, {
    version: second.body.version,
    content: ticked(true),
  });
  assert.equal(older.status, 200, older.raw.body);
  // Nor does one whose header isn't a version.
  const odd = await saveFrom(
    me.token,
    doc.id,
    older.body.version,
    "soon",
    ticked(true),
  );
  assert.equal(odd.status, 200, odd.raw.body);
  assert.equal(await completions(item.id), 2);
});

test("a refused tick is tried again only when the line is ticked again", async () => {
  const owner = await newUser();
  const me = await newUser();
  const teamId = await newTeam(owner.id, [me.id]);
  const { doc, item } = await linkedLine(me.token, "Order chairs");
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
  const ticked = doc.content.map((b: Json) => ({ ...b, done: true }));
  const refused = await saveFrom(
    me.token,
    doc.id,
    doc.version,
    doc.version,
    ticked,
  );
  assert.equal(refused.status, 200, refused.raw.body);
  assert.equal(refused.body.content[0].done, false);
  await pool.query(
    "UPDATE team_members SET role = 'member' WHERE team_id = $1 AND user_id = $2",
    [teamId, me.id],
  );
  // A save queued before the answer still carries the refused tick: not
  // tried again.
  const queued = await saveFrom(
    me.token,
    doc.id,
    refused.body.version,
    doc.version,
    ticked,
  );
  assert.equal(queued.status, 200, queued.raw.body);
  assert.equal(
    (await call(owner.token, "GET", `/items/${item.id}`)).body.status,
    "todo",
  );
  // Ticked again on the line as it's shown, it's tried again.
  const retried = await saveFrom(
    me.token,
    doc.id,
    queued.body.version,
    queued.body.version,
    ticked,
  );
  assert.equal(retried.status, 200, retried.raw.body);
  assert.equal(
    (await call(owner.token, "GET", `/items/${item.id}`)).body.status,
    "done",
  );
});

/** The page's lines with every checklist line ticked or unticked. */
const allTicked = (content: Json[], done: boolean) =>
  content.map((b) => (b.type === "todo" ? { ...b, done } : b));

test("an unsaved tick merged into a newer copy is still sent as made on the older one", async () => {
  const me = await newUser();

  // A save counted, but its answer never came back (a timeout, a deploy).
  {
    const { doc, item } = await linkedLine(me.token, "Feed the fish");
    await makeDaily(me.token, item.id);
    const page = (await call(me.token, "GET", `/docs/${doc.id}`)).body;
    // What the editor keeps: the version its ticks were taken from.
    let from = page.version as number;
    const mine = allTicked(page.content, true);
    const lost = await saveFrom(me.token, doc.id, page.version, from, mine);
    assert.equal(lost.status, 200, lost.raw.body);
    assert.equal(await completions(item.id), 1);

    // Not knowing, it types a word, and that save is refused as stale.
    const typed = [...mine, { type: "paragraph", text: "Flakes", id: "p" }];
    const stale = await saveFrom(me.token, doc.id, page.version, from, typed);
    assert.equal(stale.status, 409, stale.raw.body);

    // It reads the page and merges: its tick is still on the line, and is
    // still one made on the older copy.
    const theirs = (await call(me.token, "GET", `/docs/${doc.id}`)).body;
    const merged = mergeDocs(page.content, typed, theirs.content).blocks;
    assert.equal(merged[0].type === "todo" && merged[0].done, true);
    from = ticksTakenFrom(from, theirs, merged);
    assert.equal(from, page.version);
    const retried = await saveFrom(
      me.token,
      doc.id,
      theirs.version,
      from,
      merged,
    );
    assert.equal(retried.status, 200, retried.raw.body);
    assert.equal(await completions(item.id), 1);
    assert.equal(retried.body.content[0].done, false);
    assert.equal(retried.body.content[1].text, "Flakes");

    // It takes the answer's tick, and its ticks are now the page's own:
    // ticking the line again finishes the next occurrence.
    const shown = adoptTaskTicks(merged, merged, retried.body).blocks;
    from = ticksTakenFrom(from, retried.body, shown);
    assert.equal(from, retried.body.version);
    const again = await saveFrom(
      me.token,
      doc.id,
      retried.body.version,
      from,
      allTicked(shown as Json[], true),
    );
    assert.equal(again.status, 200, again.raw.body);
    assert.equal(await completions(item.id), 2);
  }

  // Two open copies of the page tick the same line within a save's wait.
  {
    const { doc, item } = await linkedLine(me.token, "Water the plants");
    await makeDaily(me.token, item.id);
    const page = (await call(me.token, "GET", `/docs/${doc.id}`)).body;
    const ticked = allTicked(page.content, true);
    const a = await saveFrom(
      me.token,
      doc.id,
      page.version,
      page.version,
      ticked,
    );
    assert.equal(a.status, 200, a.raw.body);
    assert.equal(await completions(item.id), 1);

    // The other copy hears of it with its own tick unsaved, merges, and
    // saves what it has.
    const theirs = (await call(me.token, "GET", `/docs/${doc.id}`)).body;
    const merged = mergeDocs(page.content, ticked, theirs.content).blocks;
    const from = ticksTakenFrom(page.version, theirs, merged);
    assert.equal(from, page.version);
    const b = await saveFrom(me.token, doc.id, theirs.version, from, merged);
    assert.equal(b.status, 200, b.raw.body);
    assert.equal(await completions(item.id), 1);
    assert.equal(b.body.content[0].done, false);
  }
});

test("an editor's ticks move on to a newer copy only when none are unsaved", () => {
  const line = (id: string, done: boolean) =>
    ({ type: "todo", text: id, done, id }) as const;
  const server = {
    version: 7,
    content: [line("a", false), line("b", true), line("c", false)],
    linked_block_ids: ["a", "b"],
  };
  // The lines tied to tasks show what the copy has: from that copy on.
  assert.equal(ticksTakenFrom(5, server, server.content), 7);
  // A line that isn't a task can say what it likes.
  assert.equal(
    ticksTakenFrom(5, server, [
      line("a", false),
      line("b", true),
      line("c", true),
    ]),
    7,
  );
  // An unsaved tick on a task's line keeps it where the tick was made.
  assert.equal(
    ticksTakenFrom(5, server, [line("a", true), line("b", true)]),
    5,
  );
  assert.equal(ticksTakenFrom(5, server, [line("b", false)]), 5);
  // So does a task's line the copy doesn't have.
  assert.equal(
    ticksTakenFrom(5, { ...server, content: [line("b", true)] }, [
      line("a", false),
    ]),
    5,
  );
  // Without the list, any named checklist line might be a task.
  assert.equal(
    ticksTakenFrom(5, { version: 7, content: server.content }, [
      line("c", true),
    ]),
    5,
  );
  // Never back to an older copy.
  assert.equal(ticksTakenFrom(9, server, server.content), 9);

  // Only a task's tick moved: nobody wrote on the page.
  const before = [
    line("a", false),
    line("c", false),
    { type: "paragraph" as const, text: "Notes", id: "p" },
  ];
  const moved = (content: Json[]) => ({
    content: content as typeof before,
    linked_block_ids: ["a"],
  });
  assert.equal(onlyTaskTicksMoved(before, moved(before)), true);
  assert.equal(
    onlyTaskTicksMoved(before, moved([line("a", true), before[1], before[2]])),
    true,
  );
  // A tick on a line that isn't a task is somebody's edit.
  assert.equal(
    onlyTaskTicksMoved(before, moved([before[0], line("c", true), before[2]])),
    false,
  );
  // So are words, on a task's line or anywhere else, and lines added.
  assert.equal(
    onlyTaskTicksMoved(
      before,
      moved([
        { ...line("a", true), text: "Feed the cat" },
        before[1],
        before[2],
      ]),
    ),
    false,
  );
  assert.equal(
    onlyTaskTicksMoved(
      before,
      moved([line("a", true), before[1], { ...before[2], text: "More notes" }]),
    ),
    false,
  );
  assert.equal(
    onlyTaskTicksMoved(before, moved([...before, before[2]])),
    false,
  );
});

test("an open page hears who moved it on", async () => {
  const { OrbynClient } = await import("@orbyn/api-client");
  const events = [
    { docId: "d", version: 4, by: "task" },
    { docId: "d", version: 5, by: "tab-2" },
    { docId: "d", version: 6 },
  ];
  const stream = (async () =>
    new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
      headers: { "content-type": "text/event-stream" },
    })) as typeof fetch;
  const client = new OrbynClient({
    baseUrl: "http://orbyn.test",
    getToken: () => "t",
    streamFetch: stream,
  });
  const heard: [number, string][] = [];
  const stop = client.watchDoc("d", (version, by) => heard.push([version, by]));
  try {
    const deadline = Date.now() + 2000;
    while (heard.length < 3 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 10));
  } finally {
    stop();
  }
  assert.deepEqual(heard, [
    [4, "task"],
    [5, "tab-2"],
    [6, ""],
  ]);
});

test("the OpenAPI description lists every webhook, sessions included", async () => {
  const r = await call(null, "GET", "/openapi.yaml");
  assert.equal(r.status, 200);
  const { parse } = await import("yaml");
  const spec = parse(r.raw.body);
  assert.deepEqual(
    [...spec.components.schemas.WebhookEvent.enum].sort(),
    [...WEBHOOK_EVENTS].sort(),
  );
  for (const event of WEBHOOK_EVENTS)
    assert.ok(spec.webhooks[event], `documents ${event}`);
  assert.doesNotMatch(r.raw.body, /time blocks?/i);
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
