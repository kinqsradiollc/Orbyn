import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * The assistant's agent loop end to end: a stand-in provider scripts the
 * model's tool calls, and the real tools run against the test database.
 */
type Call = { name: string; arguments: unknown };
type Reply = { content?: string; tool_calls?: Call[] };
type Request = {
  url: string;
  body: {
    messages: { role: string; content: string | null; tool_call_id?: string }[];
    tool_choice?: unknown;
    tools?: unknown[];
  };
};
let script: (Reply | ((requests: Request[]) => Reply))[] = [];
let requests: Request[] = [];

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });

const provider = createServer(async (req, res) => {
  const body = JSON.parse((await read(req)) || "{}");
  requests.push({ url: req.url ?? "", body });
  const next = script.shift() ?? { content: "Done." };
  const reply = typeof next === "function" ? next(requests) : next;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: reply.tool_calls ? "tool_calls" : "stop",
          message: {
            content: reply.content ?? null,
            ...(reply.tool_calls
              ? {
                  tool_calls: reply.tool_calls.map((c, i) => ({
                    id: `call_${requests.length}_${i}`,
                    type: "function",
                    function: {
                      name: c.name,
                      arguments: JSON.stringify(c.arguments),
                    },
                  })),
                }
              : {}),
          },
        },
      ],
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

async function newUser() {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: `10.8.${Math.floor(++caller / 250)}.${caller % 250}`,
    payload: {
      email: `agent-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Agent tester",
    },
  });
  assert.equal(r.statusCode, 201);
  return { token: r.json().token as string, id: r.json().user.id as string };
}

async function newTeam(ownerId: string, name: string) {
  const id = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams(name, created_by) VALUES ($1, $2) RETURNING id",
      [name, ownerId],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members(team_id, user_id, role) VALUES ($1, $2, 'owner')",
    [id, ownerId],
  );
  return { id };
}

async function addItem(token: string, data: Record<string, unknown>) {
  const r = await app.inject({
    method: "POST",
    url: "/items",
    headers: auth(token),
    payload: { kind: "task", ...data },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as { id: string; version: number; title: string };
}

let caller = 0;
async function chat(token: string, message: string, history: unknown[] = []) {
  const r = await app.inject({
    method: "POST",
    url: "/ai/chat",
    // Each call from its own address, so the chat rate limit never trips.
    remoteAddress: `10.9.${Math.floor(++caller / 250)}.${caller % 250}`,
    headers: auth(token),
    payload: { message, timezone: TZ, history },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json() as {
    id: string;
    summary: string;
    actions: {
      operation: string;
      item_id?: string;
      version?: number;
      data?: Record<string, unknown>;
    }[];
    follow_ups: string[];
  };
}

/** The tool results the model was sent in one request, parsed. */
const toolResults = (request: Request) =>
  request.body.messages
    .filter((m) => m.role === "tool")
    .map((m) => JSON.parse(m.content ?? "{}"));

/** The id of the first item in the latest search_items result. */
const firstFound = (all: Request[]) =>
  toolResults(all.at(-1)!).at(-1).items[0].id as string;

before(async () => {
  await migrate();
  const standIn = (
    await pool.query(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES ('openai-compatible', 'Agent stand-in', $1) RETURNING id",
      [providerUrl],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1, model='agent-test' WHERE id",
    [standIn],
  );
});

after(async () => {
  await app.close();
  await pool.end();
  provider.close();
});

const reset = (...steps: typeof script) => {
  script = steps;
  requests = [];
};

test("several items in one request become one proposal, each checked", async () => {
  const me = await newUser();
  reset(
    {
      tool_calls: [
        {
          name: "propose_create",
          arguments: {
            items: [
              { title: "Buy milk" },
              { title: "Gym", kind: "event", due_at: "2026-09-18T07:00" },
              { title: "Standup", kind: "event" },
              // Proposed again in the same reply: a correction.
              { title: "Buy milk", priority: "high" },
            ],
          },
        },
      ],
    },
    { content: "I've proposed **Buy milk** and **Gym** for your approval." },
  );
  const reply = await chat(
    me.token,
    "Add buy milk, gym Friday 7am and a standup event",
  );
  assert.equal(requests.length, 2);
  const [result] = toolResults(requests[1]);
  assert.deepEqual(
    result.results.map((r: { ok: boolean }) => r.ok),
    [true, true, false, true],
  );
  assert.match(result.results[2].error, /Events require a start time/);
  assert.equal(result.results[3].replaced_earlier_draft, true);
  // The correction replaces the first draft rather than adding a copy.
  assert.equal(reply.actions.length, 2);
  assert.equal(reply.actions[0].data!.priority, "high");
  // A bare local time gets the user's offset for that date.
  assert.equal(reply.actions[1].data!.due_at, "2026-09-18T07:00:00+10:00");
  assert.match(reply.summary, /Buy milk/);
  assert.deepEqual(reply.follow_ups, []);
});

test("updates find the item first and change only the fields sent", async () => {
  const me = await newUser();
  const item = await addItem(me.token, {
    title: "Dentist appointment",
    notes: "Bring the forms",
    priority: "high",
  });
  reset(
    { tool_calls: [{ name: "search_items", arguments: { query: "dentist" } }] },
    (all) => ({
      tool_calls: [
        {
          name: "propose_update",
          arguments: {
            changes: [
              { id: firstFound(all), fields: { status: "in_progress" } },
            ],
          },
        },
      ],
    }),
    (all) => ({
      // A second call for the same item merges with the first.
      tool_calls: [
        {
          name: "propose_update",
          arguments: {
            changes: [
              {
                id: toolResults(all.at(-1)!).at(-1).results[0].id,
                fields: { due_at: "2026-09-21" },
              },
            ],
          },
        },
      ],
    }),
    { content: "Proposed: the dentist appointment moves to Monday." },
  );
  const reply = await chat(me.token, "Move my dentist appointment to Monday");
  assert.equal(reply.actions.length, 1);
  const [action] = reply.actions;
  assert.equal(action.operation, "update");
  assert.equal(action.item_id, item.id);
  assert.equal(action.version, item.version);
  assert.equal(action.data!.title, "Dentist appointment");
  assert.equal(action.data!.notes, "Bring the forms");
  assert.equal(action.data!.priority, "high");
  assert.equal(action.data!.status, "in_progress");
  assert.equal(action.data!.due_at, "2026-09-21T00:00:00+10:00");

  // Applying the proposal saves exactly that.
  const applied = await app.inject({
    method: "POST",
    url: `/ai/proposals/${reply.id}/apply`,
    headers: auth(me.token),
  });
  assert.equal(applied.statusCode, 200);
  const saved = (
    await pool.query("SELECT status, notes FROM items WHERE id=$1", [item.id])
  ).rows[0];
  assert.deepEqual(saved, { status: "in_progress", notes: "Bring the forms" });
});

test("the assistant only sees the user's own and team items", async () => {
  const me = await newUser();
  const other = await newUser();
  const secret = await addItem(other.token, { title: "Surprise party plans" });
  const team = await newTeam(other.id, "Other's team");
  const teamItem = await addItem(other.token, {
    title: "Surprise team offsite",
    team_id: team.id,
  });
  reset(
    {
      tool_calls: [
        { name: "search_items", arguments: { query: "surprise" } },
        { name: "get_item", arguments: { id: secret.id } },
        { name: "get_item", arguments: { id: teamItem.id } },
        { name: "search_items", arguments: { team_id: team.id } },
        {
          name: "propose_update",
          arguments: {
            changes: [{ id: secret.id, fields: { title: "Hijacked" } }],
          },
        },
        { name: "propose_delete", arguments: { ids: [teamItem.id] } },
        {
          name: "propose_create",
          arguments: { items: [{ title: "Sneak in", team_id: team.id }] },
        },
      ],
    },
    { content: "I couldn't find that." },
  );
  const reply = await chat(
    me.token,
    "Rename the surprise party plans and delete the offsite",
  );
  const [search, getSecret, getTeam, teamSearch, update, del, create] =
    toolResults(requests[1]);
  assert.equal(search.total, 0);
  assert.deepEqual(search.items, []);
  assert.match(getSecret.error, /No item with that id/);
  assert.match(getTeam.error, /No item with that id/);
  assert.equal(teamSearch.total, 0);
  assert.equal(update.results[0].ok, false);
  assert.equal(del.results[0].ok, false);
  assert.equal(create.results[0].ok, false);
  assert.deepEqual(reply.actions, []);
  const everything = JSON.stringify(requests.map((r) => r.body.messages));
  assert.doesNotMatch(everything, /Surprise party plans|Surprise team offsite/);
});

test("team members see team items, and viewers can't change them", async () => {
  const owner = await newUser();
  const viewer = await newUser();
  const team = await newTeam(owner.id, "Launch crew");
  await pool.query(
    "INSERT INTO team_members(team_id, user_id, role) VALUES ($1, $2, 'viewer')",
    [team.id, viewer.id],
  );
  const shared = await addItem(owner.token, {
    title: "Launch checklist",
    team_id: team.id,
  });
  reset(
    { tool_calls: [{ name: "search_items", arguments: { query: "launch" } }] },
    {
      tool_calls: [
        {
          name: "propose_update",
          arguments: {
            changes: [{ id: shared.id, fields: { status: "done" } }],
          },
        },
        { name: "list_teams", arguments: {} },
      ],
    },
    { content: "You can only view that item." },
  );
  const reply = await chat(viewer.token, "Mark the launch checklist done");
  const [found] = toolResults(requests[1]);
  assert.equal(found.items[0].id, shared.id);
  assert.equal(found.items[0].team, "Launch crew");
  const [update, teams] = toolResults(requests[2]).slice(-2);
  assert.match(update.results[0].error, /only view/);
  assert.deepEqual(
    teams.teams.map((t: { name: string; can_add_items: boolean }) => [
      t.name,
      t.can_add_items,
    ]),
    [["Launch crew", false]],
  );
  assert.deepEqual(reply.actions, []);
});

test("questions never produce changes, and only delete requests delete", async () => {
  const me = await newUser();
  const item = await addItem(me.token, { title: "Water the plants" });
  reset(
    {
      tool_calls: [
        { name: "propose_create", arguments: { items: [{ title: "Extra" }] } },
      ],
    },
    { content: "Nothing is due Friday." },
  );
  let reply = await chat(me.token, "What's due on Friday?");
  assert.match(toolResults(requests[1])[0].error, /asked a question/);
  assert.deepEqual(reply.actions, []);

  reset(
    { tool_calls: [{ name: "propose_delete", arguments: { ids: [item.id] } }] },
    { content: "Okay." },
  );
  reply = await chat(me.token, "Push watering the plants to next week");
  assert.match(toolResults(requests[1])[0].error, /didn't ask to delete/);
  assert.deepEqual(reply.actions, []);

  reset(
    { tool_calls: [{ name: "propose_delete", arguments: { ids: [item.id] } }] },
    { content: "Proposed deleting **Water the plants**." },
  );
  reply = await chat(me.token, "Delete water the plants");
  assert.deepEqual(
    reply.actions.map((a) => [a.operation, a.item_id]),
    [["delete", item.id]],
  );
});

test("one named item with several matches needs a question, not every match", async () => {
  const me = await newUser();
  const first = await addItem(me.token, {
    title: "Gym session",
    kind: "event",
    due_at: "2026-09-16T07:00:00+10:00",
  });
  const second = await addItem(me.token, {
    title: "Gym session",
    kind: "event",
    due_at: "2026-09-18T07:00:00+10:00",
  });
  const both = { ids: [first.id, second.id] };
  reset(
    { tool_calls: [{ name: "propose_delete", arguments: both }] },
    { content: "Which one?" },
  );
  let reply = await chat(me.token, "Cancel the gym session");
  const [result] = toolResults(requests[1]);
  assert.deepEqual(
    result.results.map((r: { ok: boolean }) => r.ok),
    [false, false],
  );
  assert.match(result.results[0].error, /ask_clarification/);
  assert.deepEqual(reply.actions, []);

  // One id per call is caught too.
  reset(
    {
      tool_calls: [
        { name: "propose_delete", arguments: { ids: [first.id] } },
        { name: "propose_delete", arguments: { ids: [second.id] } },
      ],
    },
    { content: "Which one?" },
  );
  reply = await chat(me.token, "Cancel the gym session");
  assert.equal(reply.actions.length, 1);

  for (const message of [
    "Cancel both gym sessions",
    "Cancel the gym sessions",
  ]) {
    reset(
      { tool_calls: [{ name: "propose_delete", arguments: both }] },
      { content: "Proposed cancelling both." },
    );
    reply = await chat(me.token, message);
    assert.equal(reply.actions.length, 2, message);
  }
});

test("items named in the request reach the model before its first step", async () => {
  const me = await newUser();
  const other = await newUser();
  const groceries = await addItem(me.token, { title: "Buy groceries" });
  await addItem(me.token, { title: "Water the plants" });
  await addItem(other.token, { title: "Buy groceries for the office" });
  reset({ content: "" }, { content: "Proposed." });
  await chat(me.token, "Move buy groceries to Thursday");
  const system = requests[0].body.messages[0].content!;
  const data = JSON.parse(
    system.split("<orbyn_data>")[1].split("</orbyn_data>")[0],
  );
  // Only this user's matching item, with the id needed to change it.
  assert.deepEqual(
    data.matching_request.map((i: { id: string }) => i.id),
    [groceries.id],
  );
  // An empty first reply gets a nudge even before any tool ran.
  assert.equal(requests.length, 2);
  assert.match(requests[1].body.messages.at(-1)!.content!, /gave no answer/);
});

test("a clarifying question ends the turn and offers choices", async () => {
  const me = await newUser();
  reset(
    {
      tool_calls: [
        {
          name: "ask_clarification",
          arguments: {
            question: "Which meeting do you mean?",
            options: ["Design review", "1:1 with Sam"],
          },
        },
      ],
    },
    { content: "never requested" },
  );
  const reply = await chat(me.token, "Move the meeting to 3pm");
  assert.equal(requests.length, 1);
  assert.equal(reply.summary, "Which meeting do you mean?");
  assert.deepEqual(reply.follow_ups, ["Design review", "1:1 with Sam"]);
  assert.deepEqual(reply.actions, []);

  // Answering the question keeps the original request's intent to change.
  const item = await addItem(me.token, { title: "Design review" });
  reset(
    {
      tool_calls: [
        {
          name: "propose_update",
          arguments: {
            changes: [{ id: item.id, fields: { due_at: "2026-09-16T15:00" } }],
          },
        },
      ],
    },
    { content: "Proposed moving **Design review** to 3pm." },
  );
  const answer = await chat(me.token, "Design review", [
    { role: "user", content: "Move the meeting to 3pm" },
    { role: "assistant", content: "Which meeting do you mean?" },
  ]);
  assert.equal(answer.actions.length, 1);
});

test("the loop stops at its step limit, the last step without tools", async () => {
  const me = await newUser();
  const searching = (all: Request[]): Reply => ({
    tool_calls: [
      { name: "search_items", arguments: { query: `word${all.length}` } },
    ],
  });
  reset(...Array.from({ length: 12 }, () => searching));
  const reply = await chat(me.token, "Find everything about my trip");
  assert.equal(requests.length, 8);
  assert.equal(requests[0].body.tool_choice, "auto");
  assert.equal(requests[7].body.tool_choice, "none");
  assert.match(reply.summary, /ran out of steps/);
});

test("repeated calls, empty answers and announcements are caught", async () => {
  const me = await newUser();
  const overview = { name: "get_overview", arguments: {} };
  reset(
    { tool_calls: [overview] },
    { tool_calls: [overview] },
    { tool_calls: [overview] },
    { content: "" },
    { content: "Let me check your planner for that." },
    { content: "Your week is clear." },
  );
  const reply = await chat(me.token, "How does my week look?");
  const third = toolResults(requests[3]).at(-1);
  assert.match(third.error, /already ran this exact call/);
  assert.match(requests[4].body.messages.at(-1)!.content!, /gave no answer/);
  assert.match(requests[5].body.messages.at(-1)!.content!, /Don't announce/);
  assert.equal(reply.summary, "Your week is clear.");
});

test("bad tool calls come back as errors the model can fix", async () => {
  const me = await newUser();
  reset(
    {
      tool_calls: [
        { name: "drop_tables", arguments: {} },
        { name: "search_items", arguments: { owner: "everyone" } },
        { name: "get_item", arguments: { id: "not-an-id" } },
      ],
    },
    { content: "Sorry, I couldn't find that." },
  );
  await chat(me.token, "Show my tasks");
  const [unknown, invalid, missing] = toolResults(requests[1]);
  assert.match(unknown.error, /Unknown tool/);
  assert.match(invalid.error, /Invalid arguments for search_items/);
  assert.match(missing.error, /No item with that id/);
});

test("an old-style JSON reply still works and is vetted", async () => {
  const me = await newUser();
  const other = await newUser();
  const theirs = await addItem(other.token, { title: "Not yours" });
  reset({
    content: JSON.stringify({
      summary: "Here is the plan.",
      actions: [
        { operation: "create", data: { title: "Call mum" } },
        {
          operation: "delete",
          item_id: theirs.id,
          version: theirs.version,
        },
      ],
    }),
  });
  const reply = await chat(me.token, "Add call mum and delete not yours");
  assert.equal(reply.summary, "Here is the plan.");
  assert.deepEqual(
    reply.actions.map((a) => a.operation),
    ["create"],
  );
});

test("only requests for changes may propose them", async () => {
  const { mayChange } = await import("../src/modules/ai/guards.js");
  for (const message of [
    "Add milk",
    "Can you move my dentist to Friday?",
    "Dinner with Sam Thursday 7pm",
    "Find the dentist appointment and move it to Friday",
    "Push watering the plants to next week",
    // Telling the assistant what happened asks for the item to be updated.
    "Oral defence has been completed",
    "The oral defence is done",
    "I finished the report",
    "I've paid the electricity bill",
    "We attended the dentist appointment",
    "The team meeting got cancelled",
    "Dentist didn't happen",
    "That's sorted now",
    "Mark the gym as done",
    "Cancelled the dentist",
  ])
    assert.equal(mayChange(message), true, message);
  for (const message of [
    "What's the secret launch plan about?",
    "What's due on Friday?",
    "Is the gym on Friday?",
    "Summarize my week",
    "Show me what's due next week",
    "Is the oral defence done?",
    "What did I finish this week?",
    "Did the meeting get cancelled?",
  ])
    assert.equal(mayChange(message), false, message);
});

test("telling the assistant something happened lets it mark the item done", async () => {
  const me = await newUser();
  const item = await addItem(me.token, {
    title: "Oral Defence",
    kind: "event",
    due_at: "2026-09-17T14:00:00+10:00",
  });
  reset(
    {
      tool_calls: [
        {
          name: "propose_update",
          arguments: { changes: [{ id: item.id, fields: { status: "done" } }] },
        },
      ],
    },
    { content: "Proposed marking **Oral Defence** as done." },
  );
  const reply = await chat(me.token, "Oral defence has been completed");
  assert.equal(reply.actions.length, 1);
  assert.equal(reply.actions[0].operation, "update");
  assert.equal(reply.actions[0].item_id, item.id);
  assert.equal(reply.actions[0].data.status, "done");
});

test("a question proposes nothing, and asking drops earlier proposals", async () => {
  const me = await newUser();
  reset(
    {
      tool_calls: [
        {
          name: "propose_create",
          arguments: { items: [{ title: "Secret launch plan" }] },
        },
      ],
    },
    { content: "I couldn't find it." },
  );
  let reply = await chat(me.token, "What's the secret launch plan about?");
  assert.match(toolResults(requests[1])[0].error, /asked a question/);
  assert.deepEqual(reply.actions, []);

  reset({
    tool_calls: [
      {
        name: "propose_create",
        arguments: {
          items: [
            { title: "Team lunch", kind: "event", due_at: "2026-09-18T12:00" },
          ],
        },
      },
      {
        name: "ask_clarification",
        arguments: { question: "Which team?", options: ["Design", "Sales"] },
      },
    ],
  });
  reply = await chat(me.token, "Can you add a team lunch on Friday at noon?");
  assert.equal(reply.summary, "Which team?");
  assert.deepEqual(reply.follow_ups, ["Design", "Sales"]);
  assert.deepEqual(reply.actions, []);
});

test("clarifying questions about tools or known dates are refused", async () => {
  const me = await newUser();
  reset(
    {
      tool_calls: [
        {
          name: "ask_clarification",
          arguments: {
            question: "What would you like to do?",
            options: ["Get overview", "Search items"],
          },
        },
      ],
    },
    {
      tool_calls: [
        {
          name: "ask_clarification",
          arguments: { question: "Which date is tomorrow for you?" },
        },
      ],
    },
    { content: "Proposed **Buy milk** for tomorrow." },
  );
  const reply = await chat(me.token, "Add buy milk tomorrow");
  assert.equal(requests.length, 3);
  assert.match(toolResults(requests[1])[0].error, /never about tools/);
  assert.match(toolResults(requests[2]).at(-1).error, /Don't ask for dates/);
  assert.equal(reply.summary, "Proposed **Buy milk** for tomorrow.");
  assert.deepEqual(reply.follow_ups, []);
});
