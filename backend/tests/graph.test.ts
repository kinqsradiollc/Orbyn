import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * The fixed graph used for providers flagged `structuredOutput` (Matilda):
 * a stand-in registered as a Matilda provider answers each call in turn, and
 * the plan's actions go through the real proposal tools.
 */
type Request = {
  body: {
    messages: { role: string; content: string }[];
    response_format?: { json_schema?: { name?: string } };
  };
};
let replies: string[] = [];
let requests: Request[] = [];

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });

const provider = createServer(async (req, res) => {
  requests.push({ body: JSON.parse((await read(req)) || "{}") });
  const content = replies.shift() ?? "Done.";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content } }],
    }),
  );
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
const providerUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;

process.env.SMTP_HOST = "";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();

const TZ = "Australia/Melbourne";
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
let caller = 0;
const address = () => `10.6.${Math.floor(++caller / 250)}.${caller % 250}`;

async function newUser() {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: address(),
    payload: {
      email: `graph-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Graph tester",
    },
  });
  assert.equal(r.statusCode, 201);
  return { token: r.json().token as string };
}

async function addItem(token: string, data: Record<string, unknown>) {
  const r = await app.inject({
    method: "POST",
    url: "/items",
    headers: auth(token),
    payload: { kind: "task", ...data },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as { id: string; version: number };
}

async function chat(token: string, message: string) {
  return app.inject({
    method: "POST",
    url: "/ai/chat",
    remoteAddress: address(),
    headers: auth(token),
    payload: { message, timezone: TZ },
  });
}

/** A reply in the plan schema's shape (summary as lines). */
const plan = (summary: string, actions: unknown[]) =>
  JSON.stringify({ summary: [summary], actions });

before(async () => {
  await migrate();
  const standIn = (
    await pool.query(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES ('matilda', 'Graph stand-in', $1) RETURNING id",
      [providerUrl],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1, model='matilda' WHERE id",
    [standIn],
  );
});

after(async () => {
  await app.close();
  await pool.end();
  provider.close();
});

const reset = (...next: string[]) => {
  replies = next;
  requests = [];
};

test("a question gets one plain Markdown answer", async () => {
  const me = await newUser();
  await addItem(me.token, {
    title: "Buy groceries",
    due_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  reset("You have **Buy groceries** tomorrow.");
  const r = await chat(me.token, "What's on this week?");
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().summary, "You have **Buy groceries** tomorrow.");
  assert.deepEqual(r.json().actions, []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.response_format, undefined);
  // The planner data travels with the request, where Matilda reads it.
  const request = requests[0].body.messages.at(-1)!;
  assert.equal(request.role, "user");
  assert.match(request.content, /<orbyn_data>[\s\S]*Buy groceries/);
  assert.match(request.content, /My request: What's on this week\?/);
});

test("a change is one plan, checked item by item and repaired once", async () => {
  const me = await newUser();
  const groceries = await addItem(me.token, {
    title: "Buy groceries",
    notes: "Oat milk",
  });
  const update = {
    operation: "update",
    item_id: groceries.id,
    version: null,
    data: { title: "Buy groceries", notes: "", due_at: "2026-09-17T17:00" },
  };
  reset(
    plan("Proposed.", [
      update,
      { operation: "create", data: { title: "Standup", kind: "event" } },
    ]),
    plan("Proposed both.", [
      update,
      {
        operation: "create",
        data: { title: "Standup", kind: "event", due_at: "2026-09-18T09:30" },
      },
    ]),
  );
  const r = await chat(
    me.token,
    "Move buy groceries to Thursday 5pm and add a standup event",
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].body.response_format?.json_schema?.name,
    "orbyn_reply",
  );
  assert.match(
    requests[1].body.messages.at(-1)!.content,
    /Events require a start time/,
  );
  const reply = r.json();
  assert.equal(reply.summary, "Proposed both.");
  assert.equal(reply.actions.length, 2);
  const [moved, created] = reply.actions;
  assert.equal(moved.item_id, groceries.id);
  assert.equal(moved.version, groceries.version);
  // Empty notes in an update keep the saved notes.
  assert.equal(moved.data.notes, "Oat milk");
  assert.equal(moved.data.due_at, "2026-09-17T17:00:00+10:00");
  assert.equal(created.data.due_at, "2026-09-18T09:30:00+10:00");
});

test("what stays refused after the repair is told to the user", async () => {
  const me = await newUser();
  const other = await newUser();
  const mine = await addItem(me.token, { title: "Water the plants" });
  const theirs = await addItem(other.token, { title: "Their plan" });
  const actions = [
    { operation: "delete", item_id: mine.id },
    {
      operation: "update",
      item_id: theirs.id,
      data: { title: "Their plan", status: "done" },
    },
  ];
  reset(plan("Done.", actions), plan("Done.", actions));
  const r = await chat(me.token, "Push watering the plants to next week");
  assert.equal(r.statusCode, 200, r.body);
  const reply = r.json();
  assert.deepEqual(reply.actions, []);
  assert.match(reply.summary, /_Not proposed:_/);
  assert.match(reply.summary, /didn't ask to delete/);
  assert.match(reply.summary, /No item with that id/);
});

test("the model sees short item ids, mapped back on the server", async () => {
  const me = await newUser();
  const groceries = await addItem(me.token, { title: "Buy groceries" });
  reset(
    plan("Proposed moving **Buy groceries** to Thursday.", [
      {
        operation: "update",
        item_id: "i1",
        data: { title: "Buy groceries", due_at: "2026-09-17T17:00" },
      },
    ]),
  );
  const r = await chat(me.token, "Move buy groceries to Thursday 5pm");
  assert.equal(r.statusCode, 200, r.body);
  const sent = requests[0].body.messages.at(-1)!.content;
  assert.match(sent, /"id":"i1","title":"Buy groceries"/);
  assert.doesNotMatch(sent, new RegExp(groceries.id));
  assert.deepEqual(
    r.json().actions.map((a: { item_id: string }) => a.item_id),
    [groceries.id],
  );
});

test("invalid plans twice are a provider error", async () => {
  const me = await newUser();
  reset("not json", "still not json");
  const r = await chat(me.token, "Add a task to call mum");
  assert.equal(r.statusCode, 502);
  assert.equal(requests.length, 2);
});
