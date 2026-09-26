import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Views quick wins and the Info panel (D3b):
 * - GET /docs/:id/info, one request for a page's Info panel (NAV-04): what
 *   it belongs to, its tags, its versions, how many places link to it
 *   (never counting what the reader can't open) and whether they may
 *   confirm it.
 * - POST /blocks with a `day` (ORG-06): a task dropped on a calendar day
 *   gets a session at the first free working time that day. Its deadline is
 *   never touched, and a session after it is kept (flagged late).
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { linkMarkdown, addDays, localDateKey } = await import("@orbyn/core");

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
    remoteAddress: `10.83.0.${address++ % 250}`,
    headers: who ? { authorization: `Bearer ${who.token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async (name: string): Promise<Person> => {
  const email = `views-${randomUUID()}@example.com`;
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
let pageId = ""; // a team page in a project, a folder of mine, with tags
let projectId = "";
let folderId = ""; // the team's folder
let privateId = ""; // the stranger's page that links to mine

const save = async (who: Person, id: string, content: unknown[]) => {
  const doc = (await call(who, "GET", `/docs/${id}`)).json();
  return call(who, "PUT", `/docs/${id}`, { version: doc.version, content });
};

before(async () => {
  await migrate();
  me = await register("Info Owner");
  mate = await register("Info Mate");
  viewer = await register("Info Viewer");
  stranger = await register("Info Stranger");
  teamId = (await call(me, "POST", "/teams", { name: "Physics" })).json().id;
  await call(me, "POST", `/teams/${teamId}/members`, {
    email: mate.email,
    role: "member",
  });
  await call(me, "POST", `/teams/${teamId}/members`, {
    email: viewer.email,
    role: "viewer",
  });
  projectId = (
    await call(me, "POST", "/projects", {
      name: "Physics 101",
      team_id: teamId,
    })
  ).json().id;
  folderId = (
    await call(me, "POST", "/folders", { name: "Labs", team_id: teamId })
  ).json().id;
  pageId = (
    await call(me, "POST", "/docs", {
      title: "Lab 3 notes",
      team_id: teamId,
      project_id: projectId,
    })
  ).json().id;
  // Saves by two people keep versions (one per person's sitting).
  await save(me, pageId, [{ type: "paragraph", text: "First go" }]);
  await save(mate, pageId, [
    { type: "heading", level: 1, text: "Method" },
    { type: "paragraph", text: "Second go" },
  ]);
  assert.equal(
    (await call(me, "POST", `/docs/${pageId}/tags`, { names: ["lab"] }))
      .statusCode,
    200,
  );
  // A teammate's page links here; so does a page only the stranger can open.
  const mates = (
    await call(mate, "POST", "/docs", { title: "Plan", team_id: teamId })
  ).json().id;
  await save(mate, mates, [
    {
      type: "paragraph",
      text: `See ${linkMarkdown({ kind: "doc", id: pageId }, "Lab 3 notes")}`,
    },
  ]);
  privateId = (
    await call(stranger, "POST", "/docs", { title: "Kept to myself" })
  ).json().id;
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
});

test("the Info panel needs a sign-in (401) and a page id (422)", async () => {
  assert.equal(
    (await call(null, "GET", `/docs/${pageId}/info`)).statusCode,
    401,
  );
  assert.equal((await call(me, "GET", "/docs/nope/info")).statusCode, 422);
});

test("a page you can't open has no Info (404), in Trash or not yours", async () => {
  assert.equal(
    (await call(me, "GET", `/docs/${privateId}/info`)).statusCode,
    404,
  );
  assert.equal(
    (await call(stranger, "GET", `/docs/${pageId}/info`)).statusCode,
    404,
  );
  const gone = (await call(me, "POST", "/docs", { title: "Bin me" })).json();
  await call(me, "DELETE", `/docs/${gone.id}`);
  assert.equal(
    (await call(me, "GET", `/docs/${gone.id}/info`)).statusCode,
    404,
  );
});

test("Info says what a page belongs to, its tags, versions and links", async () => {
  // Filed in the team's folder.
  const doc = (await call(me, "GET", `/docs/${pageId}`)).json();
  const filed = await call(me, "PUT", `/docs/${pageId}`, {
    version: doc.version,
    folder_id: folderId,
  });
  assert.equal(filed.statusCode, 200, filed.body);
  const res = await call(me, "GET", `/docs/${pageId}/info`);
  assert.equal(res.statusCode, 200);
  const info = res.json();
  assert.equal(info.id, pageId);
  assert.equal(info.kind, "doc");
  assert.deepEqual(info.team, { id: teamId, name: "Physics" });
  assert.deepEqual(info.project, { id: projectId, name: "Physics 101" });
  assert.equal(info.event, null);
  assert.deepEqual(info.folder, { id: folderId, name: "Labs" });
  assert.deepEqual(
    info.tags.map((t: { name: string }) => t.name),
    ["lab"],
  );
  assert.equal(info.linked_here, 1);
  assert.ok(info.versions.count >= 2, "two people's saves keep versions");
  assert.ok(info.versions.recent.length >= 2);
  assert.ok(info.versions.recent.length <= 3);
  assert.ok(
    info.versions.recent[0].version > info.versions.recent[1].version,
    "newest first",
  );
  assert.ok(
    ["Info Owner", "Info Mate"].includes(info.versions.recent[0].author),
  );
  assert.ok(!("content" in info.versions.recent[0]));
  assert.equal(typeof info.updated_at, "string");
  assert.equal(info.reviewed_at, null);
  assert.equal(info.can_write, true);
});

test("a private page that links here is never counted", async () => {
  await save(stranger, privateId, [
    {
      type: "paragraph",
      text: `Secretly about ${linkMarkdown({ kind: "doc", id: pageId }, "x")}`,
    },
  ]);
  const info = (await call(me, "GET", `/docs/${pageId}/info`)).json();
  assert.equal(info.linked_here, 1);
});

test("a viewer reads Info but may not confirm or change the page (403)", async () => {
  const res = await call(viewer, "GET", `/docs/${pageId}/info`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().can_write, false);
  assert.equal(
    (await call(mate, "GET", `/docs/${pageId}/info`)).json().can_write,
    true,
  );
  // "Confirmed still true" is a write: the viewer is refused.
  const review = await call(viewer, "POST", `/docs/${pageId}/review`, {
    verdict: "still_true",
  });
  assert.equal(review.statusCode, 403);
  // Confirmed by someone who can: Info shows when.
  assert.equal(
    (
      await call(me, "POST", `/docs/${pageId}/review`, {
        verdict: "still_true",
      })
    ).statusCode,
    200,
  );
  const info = (await call(me, "GET", `/docs/${pageId}/info`)).json();
  assert.equal(typeof info.reviewed_at, "string");
});

test("a meeting note's Info names its event", async () => {
  const event = (
    await call(me, "POST", "/items", {
      title: "Lab meeting",
      kind: "event",
      due_at: "2026-11-02T10:00:00.000Z",
      end_at: "2026-11-02T11:00:00.000Z",
    })
  ).json();
  const note = (
    await call(me, "POST", "/docs", {
      title: "Lab meeting notes",
      kind: "meeting",
      item_id: event.id,
    })
  ).json();
  const info = (await call(me, "GET", `/docs/${note.id}/info`)).json();
  assert.equal(info.event?.id, event.id);
  assert.equal(info.event?.title, "Lab meeting");
});

// ---------------------------------------------------- a task on a day ---

/** Monday to Sunday, 9 to 5, in UTC, so the tests read plainly. */
const workAllWeek = (who: Person) =>
  call(who, "PUT", "/planner/prefs", {
    timezone: "UTC",
    work_days: [0, 1, 2, 3, 4, 5, 6],
    work_start: "09:00",
    work_end: "17:00",
  });

test("a session on a day needs a sign-in (401) and a real day (422, 400)", async () => {
  const task = (
    await call(me, "POST", "/items", { title: "Read chapter 4" })
  ).json();
  assert.equal(
    (
      await call(null, "POST", "/blocks", {
        item_id: task.id,
        day: "2030-01-07",
      })
    ).statusCode,
    401,
  );
  for (const payload of [
    { item_id: task.id, day: "7 Jan" },
    { item_id: task.id, day: "2030-13-45" },
    { item_id: task.id, day: "2030-01-07", minutes: 2 },
    { item_id: task.id, day: "2030-01-07", start_at: "x" },
    { item_id: "nope", day: "2030-01-07" },
  ])
    assert.equal(
      (await call(me, "POST", "/blocks", payload)).statusCode,
      422,
      JSON.stringify(payload),
    );
  const broken = await app.inject({
    method: "POST",
    url: "/blocks",
    remoteAddress: "10.83.9.1",
    headers: {
      authorization: `Bearer ${me.token}`,
      "content-type": "application/json",
    },
    payload: "{not json",
  });
  assert.equal(broken.statusCode, 400);
});

test("a session on a day: someone else's task is not found, an event can't", async () => {
  const theirs = (
    await call(stranger, "POST", "/items", { title: "Theirs" })
  ).json();
  assert.equal(
    (
      await call(me, "POST", "/blocks", {
        item_id: theirs.id,
        day: "2030-01-07",
      })
    ).statusCode,
    404,
  );
  const event = (
    await call(me, "POST", "/items", {
      title: "Seminar",
      kind: "event",
      due_at: "2030-01-07T10:00:00.000Z",
      end_at: "2030-01-07T11:00:00.000Z",
    })
  ).json();
  assert.equal(
    (
      await call(me, "POST", "/blocks", {
        item_id: event.id,
        day: "2030-01-08",
      })
    ).statusCode,
    422,
  );
});

test("a task dropped on a day goes in that day's first free working time", async () => {
  assert.equal((await workAllWeek(me)).statusCode, 200);
  const day = addDays(localDateKey(new Date(), "UTC"), 3);
  const task = (
    await call(me, "POST", "/items", {
      title: "Write lab report",
      estimate_minutes: 90,
      // Due the day before: the session is still made, and flagged late.
      due_at: `${addDays(day, -1)}T12:00:00.000Z`,
    })
  ).json();
  const first = await call(me, "POST", "/blocks", {
    item_id: task.id,
    day,
  });
  assert.equal(first.statusCode, 201, first.body);
  const a = first.json();
  assert.equal(a.start_at, `${day}T09:00:00.000Z`);
  assert.equal(a.end_at, `${day}T10:30:00.000Z`, "the estimate's length");
  // The deadline is never written.
  const after = (await call(me, "GET", `/items/${task.id}`)).json();
  assert.equal(after.due_at, `${addDays(day, -1)}T12:00:00.000Z`);
  // A second one on the same day goes after the first.
  const second = await call(me, "POST", "/blocks", {
    item_id: task.id,
    day,
    minutes: 30,
  });
  assert.equal(second.statusCode, 201);
  assert.ok(
    Date.parse(second.json().start_at) >= Date.parse(a.end_at),
    "no clash with the first",
  );
  assert.equal(
    Date.parse(second.json().end_at) - Date.parse(second.json().start_at),
    30 * 60_000,
  );
});

test("a day with no free time, or one that's over, says so (409)", async () => {
  await workAllWeek(me);
  const day = addDays(localDateKey(new Date(), "UTC"), 5);
  const task = (await call(me, "POST", "/items", { title: "Long one" })).json();
  // The whole working day is taken.
  const full = await call(me, "POST", "/blocks", {
    item_id: task.id,
    start_at: `${day}T09:00:00.000Z`,
    end_at: `${day}T17:00:00.000Z`,
  });
  assert.equal(full.statusCode, 201);
  const none = await call(me, "POST", "/blocks", { item_id: task.id, day });
  assert.equal(none.statusCode, 409);
  assert.match(none.json().error ?? none.body, /no free working time/i);
  const past = await call(me, "POST", "/blocks", {
    item_id: task.id,
    day: addDays(localDateKey(new Date(), "UTC"), -2),
  });
  assert.equal(past.statusCode, 409);
  assert.match(past.body, /day is over/i);
});

test("Info and sessions on a day answer 429 past the per-minute limit", async () => {
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  await settings();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  live.rate_limit_per_minute = 2;
  const from = () =>
    app.inject({
      method: "GET",
      url: `/docs/${pageId}/info`,
      remoteAddress: "10.83.9.9",
      headers: { authorization: `Bearer ${me.token}` },
    });
  try {
    assert.equal((await from()).statusCode, 200);
    assert.equal((await from()).statusCode, 200);
    assert.equal((await from()).statusCode, 429);
    const block = await app.inject({
      method: "POST",
      url: "/blocks",
      remoteAddress: "10.83.9.9",
      headers: { authorization: `Bearer ${me.token}` },
      payload: { item_id: randomUUID(), day: "2030-01-07" },
    });
    assert.equal(block.statusCode, 429);
  } finally {
    live.rate_limit_per_minute = was;
  }
});
