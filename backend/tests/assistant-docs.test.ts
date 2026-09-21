import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");
const { runTool } = await import("../src/modules/ai/agent/tools.js");
const { agentPrompt } = await import("../src/modules/ai/agent/prompt.js");

const app = await buildApp();
let userId = "";
let strangerId = "";
let token = "";
let memoId = "";

const register = async (name: string) => {
  const res = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `atools-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name,
      },
    })
  ).json();
  return res as { token: string; user: { id: string } };
};

const ctxFor = (id: string) => ({
  user: { id, role: "member" as const },
  timezone: "UTC",
  intentText: "",
  actions: [],
  clarification: null,
  cited: new Map(),
});

const callTool = (
  name: string,
  args: unknown,
  ctx: ReturnType<typeof ctxFor>,
) => runTool({ id: "t1", name, arguments: JSON.stringify(args) }, ctx);

before(async () => {
  await migrate();
  const me = await register("Reader");
  token = me.token;
  userId = me.user.id;
  strangerId = (await register("Stranger")).user.id;
  memoId = (
    await app.inject({
      method: "POST",
      url: "/docs",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "Design review",
        kind: "meeting",
        content: [
          { type: "heading", level: 2, text: "Decisions", id: "h1" },
          {
            type: "paragraph",
            text: "We ship the connector to every workspace in October.",
            id: "d1",
          },
          {
            type: "paragraph",
            text: "Pricing stays unchanged until the review.",
            id: "d2",
          },
        ],
      },
    })
  ).json().id;
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
});

test("the assistant is told to look in pages before answering", () => {
  const prompt = agentPrompt("UTC", {});
  assert.match(prompt, /search_docs/);
  assert.match(prompt, /do not say/i);
});

test("search_docs finds a page and says which line matched", async () => {
  const ctx = ctxFor(userId);
  const out = await callTool("search_docs", { query: "connector" }, ctx);
  assert.equal(out.isError, false);
  const body = JSON.parse(out.content);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].id, memoId);
  assert.equal(body.items[0].block_id, "d1");
  assert.match(body.note, /Cite a page/);
});

test("what it read is remembered, for citing", async () => {
  const ctx = ctxFor(userId);
  await callTool("search_docs", { query: "connector" }, ctx);
  const cited = [...ctx.cited.values()];
  assert.equal(cited.length, 1);
  assert.equal(cited[0].doc_id, memoId);
  assert.equal(cited[0].title, "Design review");
  assert.equal(cited[0].block_id, "d1");
});

test("a search that finds nothing says so rather than inviting a guess", async () => {
  const ctx = ctxFor(userId);
  const out = await callTool("search_docs", { query: "zeppelins" }, ctx);
  const body = JSON.parse(out.content);
  assert.deepEqual(body.items, []);
  assert.match(body.note, /rather than answering from memory/);
});

test("get_doc reads one page with the names to cite lines by", async () => {
  const ctx = ctxFor(userId);
  const out = await callTool("get_doc", { doc_id: memoId }, ctx);
  const body = JSON.parse(out.content);
  assert.equal(body.title, "Design review");
  assert.deepEqual(
    body.lines.map((l: { block_id: string }) => l.block_id),
    ["h1", "d1", "d2"],
  );
  assert.equal(ctx.cited.size, 1, "reading a page counts as citing it");
});

test("a page that is not yours is not readable, and not searchable", async () => {
  const ctx = ctxFor(strangerId);
  const read = await callTool("get_doc", { doc_id: memoId }, ctx);
  assert.equal(read.isError, true);
  assert.match(read.content, /not yours to read/);
  const found = await callTool("search_docs", { query: "connector" }, ctx);
  assert.deepEqual(JSON.parse(found.content).items, []);
  assert.equal(ctx.cited.size, 0);
});

test("the kind filter narrows the search", async () => {
  const ctx = ctxFor(userId);
  const notes = JSON.parse(
    (await callTool("search_docs", { query: "connector", kind: "note" }, ctx))
      .content,
  );
  assert.deepEqual(notes.items, [], "the memo is a meeting, not a note");
  const meetings = JSON.parse(
    (
      await callTool(
        "search_docs",
        { query: "connector", kind: "meeting" },
        ctx,
      )
    ).content,
  );
  assert.equal(meetings.items.length, 1);
});
