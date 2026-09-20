import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
import type { Item } from "@orbyn/core";
const { buildAgenda, agendaTitle, meetingNoteTemplate } =
  await import("@orbyn/core");

const app = await buildApp();
let token = "";

const call = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const TZ = "Australia/Melbourne";
/** 2026-09-20 10:00 in Melbourne. */
const NOW = new Date("2026-09-20T00:00:00.000Z");

const item = (over: Partial<Item>): Item =>
  ({
    id: randomUUID(),
    title: "x",
    kind: "task",
    status: "todo",
    due_at: null,
    location: "",
    ...over,
  }) as Item;

before(async () => {
  await migrate();
  token = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `agenda-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name: "Planner",
      },
    })
  ).json().token;
  await call("PUT", "/planner/prefs", { timezone: TZ });
});
after(async () => {
  await app.close();
  await pool.end();
});

test("the agenda splits today, what slipped and what's coming", () => {
  const blocks = buildAgenda(
    [
      // Today, in Melbourne terms.
      item({
        kind: "event",
        title: "Design sync",
        due_at: "2026-09-20T01:00:00.000Z",
        location: "Zoom",
      }),
      item({ title: "Write the brief", due_at: "2026-09-20T03:00:00.000Z" }),
      // Slipped.
      item({ title: "Chase the invoice", due_at: "2026-09-17T03:00:00.000Z" }),
      // Coming up inside the week.
      item({ title: "Book the venue", due_at: "2026-09-24T03:00:00.000Z" }),
      // Too far out, and already finished — neither shows.
      item({ title: "Next month", due_at: "2026-11-01T03:00:00.000Z" }),
      item({
        title: "Already done",
        status: "done",
        due_at: "2026-09-20T03:00:00.000Z",
      }),
    ],
    { now: NOW, timeZone: TZ },
  );
  const text = blocks.map((b) => (b.type === "divider" ? "" : b.text));
  const headings = blocks
    .filter((b) => b.type === "heading")
    .map((b) => (b.type === "heading" ? b.text : ""));

  assert.deepEqual(headings, [
    "Your day",
    "To do today",
    "Slipped",
    "Coming up",
    "Notes",
  ]);
  assert.match(text[0], /2 things on today, and 1 that slipped/);
  assert.ok(
    text.some((t) => /Design sync/.test(t) && /Zoom/.test(t)),
    "the event carries its time and place",
  );
  assert.ok(text.includes("Write the brief"));
  assert.ok(text.includes("Chase the invoice"));
  assert.ok(text.some((t) => /2026-09-24 — Book the venue/.test(t)));
  assert.ok(!text.some((t) => /Next month|Already done/.test(t)));
});

test("an empty day says so instead of showing empty headings", () => {
  const blocks = buildAgenda([], { now: NOW, timeZone: TZ });
  const headings = blocks.filter((b) => b.type === "heading");
  assert.equal(headings.length, 1, "only Notes");
  assert.match(
    blocks[0].type === "paragraph" ? blocks[0].text : "",
    /Nothing scheduled today/,
  );
});

test("the agenda is written once a day and then kept", async () => {
  const first = await call("GET", "/agenda/today");
  assert.equal(first.statusCode, 200, first.body);
  const doc = first.json();
  assert.equal(doc.kind, "agenda");
  assert.equal(doc.title, agendaTitle(new Date(), TZ));

  // Edit it, then ask again: the edit survives.
  await call("PUT", `/docs/${doc.id}`, {
    content: [{ type: "paragraph", text: "My own words" }],
    version: doc.version,
  });
  const again = await call("GET", "/agenda/today");
  assert.equal(again.json().id, doc.id, "same document");
  assert.equal(again.json().content[0].text, "My own words");
});

test("a meeting note is created once per event, from a template", async () => {
  const event = (
    await call("POST", "/items", {
      title: "Quarterly review",
      kind: "event",
      due_at: "2026-09-21T01:00:00.000Z",
      end_at: "2026-09-21T02:00:00.000Z",
      location: "Room 4",
    })
  ).json();

  const made = await call("POST", `/items/${event.id}/note`);
  assert.equal(made.statusCode, 201, made.body);
  const note = made.json();
  assert.equal(note.kind, "meeting");
  assert.equal(note.item_id, event.id);
  assert.equal(note.title, "Quarterly review");
  const headings = note.content
    .filter((b: { type: string }) => b.type === "heading")
    .map((b: { text: string }) => b.text);
  assert.deepEqual(headings, ["Agenda", "Notes", "Decisions", "Action items"]);
  assert.match(note.content[0].text, /Room 4/);

  // Asking again returns the same note rather than a second one.
  const second = await call("POST", `/items/${event.id}/note`);
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().id, note.id);
});

test("the template shows when and where, or says it isn't scheduled", () => {
  const scheduled = meetingNoteTemplate({
    title: "Standup",
    due_at: "2026-09-21T01:00:00.000Z",
    location: "Zoom",
    timeZone: TZ,
  });
  assert.match(
    scheduled[0].type === "paragraph" ? scheduled[0].text : "",
    /2026-09-21 at 11:00 · Zoom/,
  );
  const loose = meetingNoteTemplate({ title: "Someday", timeZone: TZ });
  assert.match(
    loose[0].type === "paragraph" ? loose[0].text : "",
    /Not scheduled/,
  );
});

test("unticked checklist lines become tasks, blanks and ticks are skipped", async () => {
  const doc = (
    await call("POST", "/docs", {
      title: "Action items",
      content: [
        { type: "todo", done: false, text: "Send the recap" },
        { type: "todo", done: true, text: "Already handled" },
        { type: "todo", done: false, text: "   " },
        { type: "todo", done: false, text: "Book the room" },
        { type: "paragraph", text: "Not a task" },
      ],
    })
  ).json();

  const made = await call("POST", `/docs/${doc.id}/tasks`);
  assert.equal(made.statusCode, 200, made.body);
  assert.equal(made.json().created, 2);
  assert.deepEqual(
    made.json().items.map((i: { title: string }) => i.title),
    ["Send the recap", "Book the room"],
  );
  assert.ok(
    made.json().items.every((i: { kind: string }) => i.kind === "task"),
  );

  // A document with nothing to do makes nothing.
  const empty = (
    await call("POST", "/docs", {
      title: "Nothing",
      content: [{ type: "paragraph", text: "Just prose" }],
    })
  ).json();
  const none = await call("POST", `/docs/${empty.id}/tasks`);
  assert.equal(none.json().created, 0);
});
