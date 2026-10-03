import { freshRateLimitSession } from "./rate-limit-session.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Links everywhere, part 1 (D3a): links made with the link picker are kept
 * in pages as orbyn:// links and indexed in object_links on every save, with
 * the fixed connections (a task's line, meeting notes, project notes,
 * dependencies, mentions) beside them. GET /links/here, /links/resolve and
 * /links/pick read the index, and never show what the reader can't open.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { linkMarkdown } = await import("@orbyn/core");

const app = await buildApp();

type Person = { token: string; email: string; id: string };
let me: Person;
let mate: Person;
let viewer: Person;
let stranger: Person;

let address = 0;
const call = (
  who: Person | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    remoteAddress: `10.82.0.${address++ % 250}`,
    headers: who ? { authorization: `Bearer ${who.token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async (name: string): Promise<Person> => {
  const email = `links-${randomUUID()}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "a-long-test-password", name },
  });
  const token = res.json().token;
  const id = (
    await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    })
  ).json().id;
  return { token, email, id };
};

let teamId = "";
let targetId = ""; // my page the others link to
let taskId = "";
let projectId = "";
let secretId = ""; // the stranger's private page

const para = (text: string, id?: string) => ({
  type: "paragraph",
  text,
  ...(id ? { id } : {}),
});

/** Save a page's lines (at its current version). */
const save = async (who: Person, id: string, content: unknown[]) => {
  const doc = (await call(who, "GET", `/docs/${id}`)).json();
  return call(who, "PUT", `/docs/${id}`, { version: doc.version, content });
};

const here = async (who: Person, kind: string, id: string) =>
  call(who, "GET", `/links/here?kind=${kind}&id=${id}`);

before(async () => {
  await migrate();
  me = await register("Linker");
  mate = await register("Mate");
  viewer = await register("Watcher");
  stranger = await register("Stranger");
  const team = (await call(me, "POST", "/teams", { name: "Lab" })).json();
  teamId = team.id;
  await call(me, "POST", `/teams/${teamId}/members`, {
    email: mate.email,
    role: "member",
  });
  await call(me, "POST", `/teams/${teamId}/members`, {
    email: viewer.email,
    role: "viewer",
  });
  targetId = (
    await call(me, "POST", "/docs", { title: "Lab 3 notes", team_id: teamId })
  ).json().id;
  taskId = (
    await call(me, "POST", "/items", {
      title: "Lab 3 report",
      due_at: "2026-10-02T17:00:00.000Z",
      team_id: teamId,
    })
  ).json().id;
  projectId = (
    await call(me, "POST", "/projects", {
      name: "Physics 101",
      team_id: teamId,
    })
  ).json().id;
  secretId = (
    await call(stranger, "POST", "/docs", { title: "Kept to myself" })
  ).json().id;
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
});

test("the link routes need a sign-in (401) and a sensible query (422)", async () => {
  for (const url of [
    `/links/here?kind=doc&id=${targetId}`,
    `/links/resolve?refs=doc:${targetId}`,
    "/links/pick?q=lab",
  ])
    assert.equal((await call(null, "GET", url)).statusCode, 401, url);
  for (const url of [
    "/links/here?kind=doc",
    `/links/here?kind=folder&id=${targetId}`,
    "/links/here?kind=doc&id=nope",
    `/links/here?kind=doc&id=${targetId}&more=1`,
    "/links/resolve?refs=doc:nope",
    "/links/resolve?refs=date:2026-13-45",
    `/links/resolve?refs=folder:${targetId}`,
    `/links/resolve?refs=${Array.from({ length: 61 }, () => `doc:${randomUUID()}`).join(",")}`,
    "/links/pick?limit=0",
    "/links/pick?limit=31",
    `/links/pick?q=${"x".repeat(201)}`,
  ])
    assert.equal((await call(me, "GET", url)).statusCode, 422, url);
});

test("saving a page with a broken body is refused (400) and links nothing", async () => {
  const page = (await call(me, "POST", "/docs", { title: "Broken" })).json();
  const res = await app.inject({
    method: "PUT",
    url: `/docs/${page.id}`,
    remoteAddress: "10.82.1.1",
    headers: {
      authorization: `Bearer ${me.token}`,
      "content-type": "application/json",
    },
    payload: `{"version": 1, "content": [${linkMarkdown({ kind: "doc", id: targetId }, "x")}`,
  });
  assert.equal(res.statusCode, 400);
  const rows = await pool.query(
    "SELECT 1 FROM object_links WHERE source_id = $1 AND link_kind = 'link'",
    [page.id],
  );
  assert.equal(rows.rowCount, 0);
});

test("a viewer can't write links into a team page (403), nor see a private page's (404)", async () => {
  const res = await save(viewer, targetId, [
    para(`See ${linkMarkdown({ kind: "task", id: taskId }, "Lab 3 report")}`),
  ]);
  assert.equal(res.statusCode, 403);
  assert.equal(
    (await here(me, "task", taskId)).json().count,
    0,
    "nothing was linked",
  );
  // Someone else's private page isn't there to ask about.
  assert.equal((await here(me, "doc", secretId)).statusCode, 404);
  // A viewer may read "Linked here" for a team page they can open.
  assert.equal((await here(viewer, "doc", targetId)).statusCode, 200);
});

test("a picker link is indexed on save, shows in Linked here with its line, and follows edits", async () => {
  const page = (
    await call(mate, "POST", "/docs", {
      title: "Lecture 4",
      team_id: teamId,
      content: [
        para("Intro"),
        para(
          `Read ${linkMarkdown({ kind: "doc", id: targetId }, "Lab 3 notes")} before Friday`,
          "b-read",
        ),
        // Code is literal: a link in it is text.
        {
          type: "code",
          lang: "",
          text: linkMarkdown({ kind: "doc", id: targetId }, "code"),
        },
      ],
    })
  ).json();
  const list = (await here(me, "doc", targetId)).json();
  assert.equal(list.count, 1);
  const [entry] = list.items;
  assert.equal(entry.id, page.id);
  assert.equal(entry.kind, "doc");
  assert.equal(entry.title, "Lecture 4");
  assert.equal(entry.source, "link");
  assert.equal(entry.block_id, "b-read");
  assert.deepEqual(entry.context, {
    before: "Read ",
    linked: "Lab 3 notes",
    after: " before Friday",
  });
  // Renaming the target keeps the link: it's by id.
  const target = (await call(me, "GET", `/docs/${targetId}`)).json();
  await call(me, "PUT", `/docs/${targetId}`, {
    version: target.version,
    title: "Lab three notes",
  });
  const [pill] = (
    await call(mate, "GET", `/links/resolve?refs=doc:${targetId}`)
  ).json();
  assert.deepEqual(pill, {
    kind: "doc",
    id: targetId,
    state: "ok",
    title: "Lab three notes",
  });
  assert.equal((await here(me, "doc", targetId)).json().count, 1);
  // Taking the link out of the page takes it out of the index.
  assert.equal((await save(mate, page.id, [para("Intro")])).statusCode, 200);
  assert.equal((await here(me, "doc", targetId)).json().count, 0);
});

test("a private page's link never shows to someone who can't open it", async () => {
  // The stranger links my team page from their own private page.
  await call(stranger, "POST", "/docs", {
    title: "My secret plans",
    content: [
      para(`About ${linkMarkdown({ kind: "doc", id: targetId }, "Lab")}`),
    ],
  });
  const seen = (await here(me, "doc", targetId)).json();
  assert.equal(seen.count, 0, "not listed and not counted");
  assert.ok(!JSON.stringify(seen).includes("secret"));
  // And a pill to a page you can't open says nothing about it.
  const [pill] = (
    await call(me, "GET", `/links/resolve?refs=doc:${secretId}`)
  ).json();
  assert.deepEqual(pill, {
    kind: "doc",
    id: secretId,
    state: "missing",
    title: null,
  });
});

test("a deleted page's pill is muted and restorable; a page in Trash links nothing", async () => {
  const gone = (
    await call(me, "POST", "/docs", {
      title: "Old draft",
      team_id: teamId,
      content: [para(linkMarkdown({ kind: "task", id: taskId }, "report"))],
    })
  ).json().id;
  assert.equal((await here(me, "task", taskId)).json().count, 1);
  await call(me, "DELETE", `/docs/${gone}`);
  const [pill] = (
    await call(me, "GET", `/links/resolve?refs=doc:${gone}`)
  ).json();
  assert.equal(pill.state, "deleted");
  assert.equal(pill.title, "Old draft");
  assert.equal(pill.can_restore, true);
  const [viewerPill] = (
    await call(viewer, "GET", `/links/resolve?refs=doc:${gone}`)
  ).json();
  assert.equal(viewerPill.can_restore, false, "a viewer can't restore");
  assert.equal(
    (await here(me, "task", taskId)).json().count,
    0,
    "a page in Trash is no place a link comes from",
  );
  await call(me, "POST", `/docs/${gone}/restore`);
  assert.equal((await here(me, "task", taskId)).json().count, 1);
  // Deleted for good: the pill can't tell it from never having been yours.
  await call(me, "DELETE", `/docs/${gone}`);
  await call(me, "DELETE", `/docs/${gone}/forever`);
  const [forever] = (
    await call(me, "GET", `/links/resolve?refs=doc:${gone}`)
  ).json();
  assert.equal(forever.state, "missing");
  const left = await pool.query(
    "SELECT 1 FROM object_links WHERE source_id = $1",
    [gone],
  );
  assert.equal(left.rowCount, 0, "its links went with it");
});

test("pills carry a task's tick and deadline, people and dates", async () => {
  const day = "2026-09-26";
  const pills = (
    await call(
      me,
      "GET",
      `/links/resolve?refs=task:${taskId},project:${projectId},person:${mate.id},person:${stranger.id},date:${day}`,
    )
  ).json();
  assert.deepEqual(pills[0], {
    kind: "task",
    id: taskId,
    state: "ok",
    title: "Lab 3 report",
    done: false,
    due_at: "2026-10-02T17:00:00.000Z",
  });
  assert.equal(pills[1].title, "Physics 101");
  assert.equal(pills[2].title, "Mate", "a teammate");
  assert.equal(pills[3].state, "missing", "a stranger isn't named");
  assert.equal(pills[4].title, "Sat 26 Sep 2026");
});

test("fixed connections show too: a task's line, meeting and project notes, dependencies, mentions", async () => {
  const page = (
    await call(me, "POST", "/docs", {
      title: "Week plan",
      team_id: teamId,
      project_id: projectId,
      content: [{ type: "todo", text: "Draft the method", done: false }],
    })
  ).json();
  const made = (await call(me, "POST", `/docs/${page.id}/tasks`, {})).json();
  assert.equal(made.created, 1);
  const lineTask = made.items[0].id;
  const from = (await here(me, "task", lineTask)).json();
  assert.equal(from.count, 1);
  assert.equal(from.items[0].id, page.id);
  assert.equal(from.items[0].source, "task_line");
  assert.equal(from.items[0].context.before, "Draft the method");
  assert.ok(from.items[0].block_id, "opens the page at the line");

  // The page is filed in the project.
  const project = (await here(me, "project", projectId)).json();
  assert.ok(
    project.items.some(
      (e: { id: string; source: string }) =>
        e.id === page.id && e.source === "project",
    ),
  );

  // A task that waits for another.
  const waiting = (
    await call(me, "POST", "/items", {
      title: "Submit",
      team_id: teamId,
      prerequisite_ids: [lineTask],
    })
  ).json();
  const deps = (await here(me, "task", lineTask)).json();
  assert.ok(
    deps.items.some(
      (e: { id: string; source: string }) =>
        e.id === waiting.id && e.source === "dependency",
    ),
  );

  // A meeting note for an event.
  const event = (
    await call(me, "POST", "/items", {
      title: "Lab meeting",
      kind: "event",
      team_id: teamId,
      due_at: "2026-10-01T09:00:00.000Z",
    })
  ).json();
  const note = (await call(me, "POST", `/items/${event.id}/note`, {})).json();
  const meeting = (await here(me, "event", event.id)).json();
  assert.ok(
    meeting.items.some(
      (e: { id: string; source: string }) =>
        e.id === (note.id ?? note.doc?.id) && e.source === "meeting",
    ),
    JSON.stringify(meeting),
  );

  // A person named in a comment.
  const c = await call(me, "POST", `/docs/${page.id}/comments`, {
    body: "Can you check this?",
    mentions: [mate.id],
  });
  assert.equal(c.statusCode, 201);
  const mentioned = (await here(me, "person", mate.id)).json();
  assert.ok(
    mentioned.items.some(
      (e: { id: string; source: string }) =>
        e.id === page.id && e.source === "mention",
    ),
  );
  // A stranger isn't there to ask about.
  assert.equal((await here(me, "person", stranger.id)).statusCode, 404);
});

test("the picker finds pages, tasks with their deadline, projects and people", async () => {
  const hits = (await call(me, "GET", "/links/pick?q=lab")).json();
  const task = hits.find((h: { id: string }) => h.id === taskId);
  assert.equal(task.kind, "task");
  assert.equal(task.done, false);
  assert.equal(task.due_at, "2026-10-02T17:00:00.000Z");
  assert.ok(hits.some((h: { id: string }) => h.id === targetId));
  assert.ok(!hits.some((h: { id: string }) => h.id === secretId));
  const people = (await call(me, "GET", "/links/pick?q=mat")).json();
  assert.ok(
    people.some(
      (h: { kind: string; id: string }) =>
        h.kind === "person" && h.id === mate.id,
    ),
  );
  const none = (await call(me, "GET", "/links/pick?q=strang")).json();
  assert.ok(!none.some((h: { id: string }) => h.id === stranger.id));
  // % is a letter, not a wildcard.
  assert.deepEqual(
    (await call(me, "GET", "/links/pick?q=%25%25%25")).json(),
    [],
  );
});

test("exported pages carry links anyone with access can open", async () => {
  const page = (
    await call(me, "POST", "/docs", {
      title: "Exported",
      content: [
        para(
          `See ${linkMarkdown({ kind: "doc", id: targetId }, "Lab 3 notes")} on ${linkMarkdown({ kind: "date", id: "2026-09-26" }, "26 Sep")}`,
        ),
      ],
    })
  ).json();
  const md = (await call(me, "GET", `/docs/${page.id}/markdown`)).body;
  assert.match(
    md,
    new RegExp(`\\[Lab 3 notes\\]\\(https?://[^)]+/app/doc/${targetId}\\)`),
  );
  assert.ok(!md.includes("orbyn://"));
  assert.ok(md.includes("Sat 26 Sep 2026"));
});

test("the link routes answer 429 past the per-minute limit", async () => {
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  await settings();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  const limitedToken = await freshRateLimitSession(me.token);
  live.rate_limit_per_minute = 2;
  const from = () =>
    app.inject({
      method: "GET",
      url: `/links/here?kind=doc&id=${targetId}`,
      remoteAddress: "10.82.9.9",
      headers: { authorization: `Bearer ${limitedToken}` },
    });
  try {
    assert.equal((await from()).statusCode, 200);
    assert.equal((await from()).statusCode, 200);
    assert.equal((await from()).statusCode, 429);
  } finally {
    live.rate_limit_per_minute = was;
  }
});
