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

test("project search includes its tasks and pages but excludes other projects", async () => {
  const project = await post("/projects", { name: "Vendor launch" });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().id as string;
  const elsewhere = await post("/projects", { name: "Other work" });
  assert.equal(elsewhere.statusCode, 201, elsewhere.body);
  const doc = await post("/docs", {
    title: "Vendor brief",
    project_id: projectId,
    content: [
      {
        type: "paragraph",
        text: "Review the vendor terms.",
        id: "vendor-line",
      },
    ],
  });
  assert.equal(doc.statusCode, 201, doc.body);
  const task = await post("/items", {
    title: "Review vendor contract",
    kind: "task",
    project_id: projectId,
  });
  assert.equal(task.statusCode, 201, task.body);
  const otherTask = await post("/items", {
    title: "Review vendor invoice",
    kind: "task",
    project_id: elsewhere.json().id,
  });
  assert.equal(otherTask.statusCode, 201, otherTask.body);

  const hits = (await call(`/search?q=vendor&project=${projectId}`)).json();
  assert.deepEqual(
    new Set(hits.map((hit: { id: string }) => hit.id)),
    new Set([doc.json().id, task.json().id]),
  );
  assert.equal(
    hits.find((hit: { id: string }) => hit.id === doc.json().id).block_id,
    "vendor-line",
  );
  const outsider = (
    await call(`/search?q=vendor&project=${projectId}`, () => strangerToken)
  ).json();
  assert.deepEqual(outsider, []);
});

test("a project's search finds its decisions, and pages by its new name", async () => {
  const project = await post("/projects", { name: "Harbour move" });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().id as string;
  const decision = await post("/work-records", {
    kind: "decision",
    title: "Pick the removalist",
    details: "Compare three removalist quotes before Friday.",
    project_id: projectId,
  });
  assert.equal(decision.statusCode, 201, decision.body);
  const page = await post("/docs", {
    title: "Packing list",
    project_id: projectId,
    content: [{ type: "paragraph", text: "Boxes and tape.", id: "p1" }],
  });
  assert.equal(page.statusCode, 201, page.body);

  const hits = (await call(`/search?q=removalist&project=${projectId}`)).json();
  const record = hits.find(
    (hit: { id: string }) => hit.id === decision.json().id,
  );
  assert.ok(record, JSON.stringify(hits));
  assert.equal(record.type, "record");
  assert.equal(record.kind, "decision");
  assert.match(record.snippet, /\[\[removalist\]\]/i);
  // Records only come with one project's search (or when asked for).
  assert.ok(
    !(await call("/search?q=removalist"))
      .json()
      .some((hit: { type: string }) => hit.type === "record"),
  );
  assert.equal(
    (await call("/search?q=removalist&type=record")).json()[0].id,
    decision.json().id,
  );
  assert.deepEqual(
    (
      await call(
        `/search?q=removalist&project=${projectId}`,
        () => strangerToken,
      )
    ).json(),
    [],
  );

  // Pages are found by their project's name; renaming it reindexes them.
  const renamed = await app.inject({
    method: "PUT",
    url: `/projects/${projectId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name: "Quayside relocation" },
  });
  assert.equal(renamed.statusCode, 200, renamed.body);
  const byName = (await call("/search?q=quayside&type=doc")).json();
  assert.ok(
    byName.some((hit: { id: string }) => hit.id === page.json().id),
    JSON.stringify(byName),
  );
  assert.equal((await call("/search?q=x&type=bogus")).statusCode, 422);
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
