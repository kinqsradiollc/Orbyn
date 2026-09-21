import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");
const { runTool } = await import("../src/modules/ai/agent/tools.js");

const app = await buildApp();
let token = "";
let userId = "";
let strangerId = "";
let docId = "";
let projectId = "";

const register = async () => {
  const body = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `writes-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name: "Writer",
      },
    })
  ).json();
  return body as { token: string; user: { id: string } };
};

const ctxFor = (id: string) => ({
  user: { id, role: "member" as const },
  timezone: "UTC",
  intentText: "",
  actions: [],
  clarification: null,
  cited: new Map(),
  notes: [] as unknown[],
});

const call = (name: string, args: unknown, ctx: ReturnType<typeof ctxFor>) =>
  runTool({ id: "t", name, arguments: JSON.stringify(args) }, ctx);

before(async () => {
  await migrate();
  const me = await register();
  token = me.token;
  userId = me.user.id;
  strangerId = (await register()).user.id;
  projectId = (
    await app.inject({
      method: "POST",
      url: "/projects",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Q4 launch" },
    })
  ).json().id;
  docId = (
    await app.inject({
      method: "POST",
      url: "/docs",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "Pricing memo",
        content: [
          {
            type: "paragraph",
            text: "We raise prices by ten per cent in October.",
            id: "p1",
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

test("a drafted note is not written anywhere", async () => {
  const ctx = ctxFor(userId);
  const out = await call(
    "propose_note",
    {
      title: "Launch decisions",
      body: "## Decisions\n\n- Ship in October\n- [ ] Tell the team",
      project_id: projectId,
      why: "The meeting settled three things",
    },
    ctx,
  );
  assert.equal(out.isError, false);
  assert.match(out.content, /never say it is saved/);

  const draft = ctx.notes[0] as {
    title: string;
    content: { type: string }[];
    project_id: string;
    project_name: string;
  };
  assert.equal(draft.title, "Launch decisions");
  assert.equal(draft.project_id, projectId);
  assert.equal(draft.project_name, "Q4 launch");
  assert.deepEqual(
    draft.content.map((b) => b.type),
    ["heading", "bullet", "todo"],
    "the Markdown became real blocks",
  );

  // Nothing reached the database.
  const pages = (
    await app.inject({
      method: "GET",
      url: "/docs?kind=note",
      headers: { authorization: `Bearer ${token}` },
    })
  ).json();
  assert.deepEqual(pages, [], "no page was created");
});

test("a project or task the person cannot see is not attached", async () => {
  const ctx = ctxFor(strangerId);
  await call(
    "propose_note",
    { title: "Sneaky", body: "text", project_id: projectId },
    ctx,
  );
  const draft = ctx.notes[0] as { project_id: string | null };
  assert.equal(draft.project_id, null, "someone else's project is dropped");
});

test("only so many notes in one turn", async () => {
  const ctx = ctxFor(userId);
  for (let n = 0; n < 3; n++)
    await call("propose_note", { title: `N${n}`, body: "x" }, ctx);
  const tooMany = await call("propose_note", { title: "N4", body: "x" }, ctx);
  assert.equal(tooMany.isError, true);
  assert.match(tooMany.content, /enough notes/);
});

test("a proposed edit waits beside the page rather than changing it", async () => {
  const ctx = ctxFor(userId);
  const out = await call(
    "propose_doc_edit",
    {
      doc_id: docId,
      changes: [{ find: "ten per cent", replace: "8%" }],
      why: "Board settled on eight",
    },
    ctx,
  );
  assert.equal(out.isError, false);
  const body = JSON.parse(out.content);
  assert.equal(body.proposed, 1);
  assert.equal(body.on, "Pricing memo");
  assert.match(body.note, /never say the page is changed/);

  const page = (
    await app.inject({
      method: "GET",
      url: `/docs/${docId}`,
      headers: { authorization: `Bearer ${token}` },
    })
  ).json();
  assert.equal(
    page.content[0].text,
    "We raise prices by ten per cent in October.",
    "the page is untouched",
  );

  const open = (
    await app.inject({
      method: "GET",
      url: `/docs/${docId}/suggestions`,
      headers: { authorization: `Bearer ${token}` },
    })
  ).json();
  assert.equal(open.length, 1);
  assert.equal(open[0].quote, "ten per cent");
  assert.equal(open[0].text, "8%");
  assert.equal(open[0].status, "open");
  assert.match(open[0].note, /Assistant · Board settled on eight/);

  // And it goes through the ordinary Take, landing where it should.
  const taken = await app.inject({
    method: "POST",
    url: `/docs/${docId}/suggestions/${open[0].id}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { take: true },
  });
  assert.equal(taken.statusCode, 200);
  assert.equal(
    taken.json().doc.content[0].text,
    "We raise prices by 8% in October.",
  );
});

test("words that are not on the page are reported, not invented", async () => {
  const ctx = ctxFor(userId);
  const out = await call(
    "propose_doc_edit",
    { doc_id: docId, changes: [{ find: "not on this page", replace: "x" }] },
    ctx,
  );
  const body = JSON.parse(out.content);
  assert.equal(body.proposed, 0);
  assert.deepEqual(body.not_found, ["not on this page"]);
  assert.match(body.note, /Quote the words exactly/);
});

test("someone else's page cannot be proposed on", async () => {
  const out = await call(
    "propose_doc_edit",
    { doc_id: docId, changes: [{ find: "October", replace: "November" }] },
    ctxFor(strangerId),
  );
  assert.equal(out.isError, true);
  assert.match(out.content, /not yours to read/);
});

test("the assistant is told a draft is not a saved page", async () => {
  const { agentPrompt } = await import("../src/modules/ai/agent/prompt.js");
  const prompt = agentPrompt("UTC", {});
  assert.match(prompt, /propose_note/);
  assert.match(prompt, /never say it is saved/);
  assert.match(prompt, /propose_doc_edit/);
});
