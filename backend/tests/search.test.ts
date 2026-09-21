import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { snippetRuns } = await import("@orbyn/core");

const app = await buildApp();
let token = "";
let strangerToken = "";

const call = (url: string, as = () => token) =>
  app.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${as()}` },
  });

const post = (url: string, payload: unknown, as = () => token) =>
  app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${as()}` },
    payload: payload as object,
  });

const register = async () =>
  (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `search-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name: "Searcher",
      },
    })
  ).json().token as string;

let noteId = "";
let briefId = "";
let tagId = "";

before(async () => {
  await migrate();
  token = await register();
  strangerToken = await register();
  tagId = (await post("/tags", { name: "pricing" })).json().id;
  briefId = (
    await post("/docs", {
      title: "Design review",
      content: [
        { type: "heading", level: 1, text: "Design review", id: "h1" },
        {
          type: "paragraph",
          text: "The connector rollout needs a decision on quotas.",
          id: "p1",
        },
      ],
    })
  ).json().id;
  noteId = (
    await post("/docs", {
      title: "Launch risks",
      kind: "note",
      tags: [tagId],
      content: [
        {
          type: "paragraph",
          text: "Legal review may run long and delay the launch.",
          id: "n1",
        },
      ],
    })
  ).json().id;
  await post("/items", {
    title: "Draft the quotas memo",
    notes: "Follow the connector rollout decision",
  });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
});

test("a word from a page's body finds it, at the line that says it", async () => {
  const hits = (await call("/search?q=quotas&type=doc")).json();
  assert.ok(hits.length >= 1);
  const hit = hits.find((h: { id: string }) => h.id === briefId);
  assert.ok(hit, "the page that says it comes back");
  assert.equal(hit.block_id, "p1", "and says which line said it");
  assert.match(hit.snippet, /\[\[quotas\]\]/, "with the word marked");
  assert.deepEqual(
    snippetRuns(hit.snippet)
      .filter((r) => r.hit)
      .map((r) => r.text),
    ["quotas"],
  );
});

test("a misspelt title still finds the page", async () => {
  const hits = (await call("/search?q=Desgin%20reveiw&type=doc")).json();
  assert.equal(
    hits[0]?.id,
    briefId,
    "letters of the title match where the words do not",
  );
});

test("a title match outranks a passing mention in a body", async () => {
  const hits = (await call("/search?q=launch&type=doc")).json();
  assert.equal(hits[0].id, noteId, "the page called Launch risks comes first");
});

test("filters narrow the same search", async () => {
  const all = (await call("/search?q=review")).json();
  assert.ok(all.length >= 2, "both pages mention review");
  const notesOnly = (await call("/search?q=review&kind=note")).json();
  assert.deepEqual(
    notesOnly.map((h: { id: string }) => h.id),
    [noteId],
  );
  const tagged = (await call(`/search?q=review&tag=${tagId}`)).json();
  assert.deepEqual(
    tagged.map((h: { id: string }) => h.id),
    [noteId],
  );
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const none = (
    await call(`/search?q=review&updated_after=${encodeURIComponent(future)}`)
  ).json();
  assert.deepEqual(none, [], "nothing was edited tomorrow");
});

test("tasks and pages come back together, ranked on one scale", async () => {
  const hits = (await call("/search?q=quotas")).json();
  const types = new Set(hits.map((h: { type: string }) => h.type));
  assert.ok(types.has("doc") && types.has("task"), "both kinds are found");
  const ranks = hits.map((h: { rank: number }) => Number(h.rank));
  assert.deepEqual(
    ranks,
    [...ranks].sort((a, b) => b - a),
    "best first, whatever kind it is",
  );
  const tasksOnly = (await call("/search?q=quotas&type=task")).json();
  assert.ok(tasksOnly.every((h: { type: string }) => h.type === "task"));
});

test("a search only finds what the searcher may see", async () => {
  const mine = (await call("/search?q=quotas")).json();
  assert.ok(mine.length > 0);
  const theirs = (await call("/search?q=quotas", () => strangerToken)).json();
  assert.deepEqual(theirs, [], "someone else's pages are not searchable");
});

test("a page found by tag is found again once the tag is taken off", async () => {
  const doc = (await call(`/docs/${noteId}`)).json();
  await app.inject({
    method: "PUT",
    url: `/docs/${noteId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { version: doc.version, tags: [] },
  });
  const byTag = (await call(`/search?q=review&tag=${tagId}`)).json();
  assert.deepEqual(byTag, [], "the tag filter no longer matches it");
  const byWord = (await call("/search?q=legal&type=doc")).json();
  assert.equal(byWord[0].id, noteId, "but its words are still indexed");
});
