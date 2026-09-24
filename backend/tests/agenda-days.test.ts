import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * The agenda as a diary (DAY-01): stepping to yesterday and tomorrow, a
 * day's page written only when asked, a page written ahead brought up to
 * date on its day, and a Notes section that "Rewrite from my calendar"
 * never touches. No AI provider is involved: rewrites here ask for none.
 */
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { rewriteAgenda, todaysAgenda } =
  await import("../src/modules/docs/agenda.js");
const {
  addDays,
  agendaDay,
  agendaGroups,
  agendaNotesAt,
  agendaTitleOn,
  AGENDA_NOTES_ID,
  buildAgenda,
  isDateKey,
  keepAgendaNotes,
  localDateKey,
} = await import("@orbyn/core");
type DocBlock = import("@orbyn/core").DocBlock;
type DocSummary = import("@orbyn/core").DocSummary;

const app = await buildApp();
type Json = Record<string, any>;
let token = "";
let userId = "";
const TZ = "Australia/Melbourne";

const call = (
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
  as: string | null = token,
) =>
  app.inject({
    method,
    url,
    headers: as ? { authorization: `Bearer ${as}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

before(async () => {
  await migrate();
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `days-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Diarist",
    },
  });
  token = r.json().token;
  userId = r.json().user.id;
  await call("PUT", "/planner/prefs", { timezone: TZ });
});
after(async () => {
  await app.close();
  await pool.end();
});

const texts = (blocks: DocBlock[]) =>
  blocks.map((b) => (b.type === "divider" ? "" : b.text));
const today = () => localDateKey(new Date(), TZ);

test("a rewrite keeps Notes and everything under it, word for word", () => {
  const fresh = buildAgenda([], { timeZone: TZ, now: new Date() });
  const notesAt = agendaNotesAt(fresh);
  assert.ok(notesAt > 0);
  assert.equal(fresh[notesAt].id, AGENDA_NOTES_ID);
  const current: DocBlock[] = [
    { type: "paragraph", text: "An old opening line" },
    { type: "todo", text: "An old priority", done: true },
    ...fresh.slice(notesAt),
  ];
  current.splice(current.length - 2, 0, {
    type: "paragraph",
    text: "My own thoughts",
  });
  const next: DocBlock[] = [
    { type: "paragraph", text: "A new opening line" },
    ...fresh.slice(notesAt),
  ];
  const kept = keepAgendaNotes(current, next);
  assert.equal(texts(kept)[0], "A new opening line");
  assert.ok(!texts(kept).includes("An old priority"));
  assert.ok(texts(kept).includes("My own thoughts"));
  // A page from before Notes had a name is found by its heading's words.
  const old: DocBlock[] = [
    { type: "paragraph", text: "Old" },
    { type: "heading", level: 2, text: "Notes" },
    { type: "paragraph", text: "Kept" },
  ];
  const merged = keepAgendaNotes(old, next);
  assert.deepEqual(texts(merged).slice(-1), ["Kept"]);
  assert.equal(merged[agendaNotesAt(merged)].id, AGENDA_NOTES_ID);
  // With no Notes section left there's nothing to keep.
  assert.deepEqual(
    keepAgendaNotes([{ type: "paragraph", text: "x" }], next),
    next,
  );
  assert.ok(isDateKey("2026-09-24"));
  assert.ok(!isDateKey("2026-02-30") && !isDateKey("yesterday"));
  assert.equal(agendaTitleOn("2026-09-24"), "Thursday 24 September");
});

test("another day's opening line names the day, not today", () => {
  const blocks = buildAgenda([], {
    timeZone: TZ,
    now: new Date(),
    dayName: "Friday",
  });
  assert.equal(
    texts(blocks)[0],
    "Nothing scheduled on Friday. The page is yours.",
  );
});

test("today's agenda knows its day, and stepping to it answers the same page", async () => {
  const doc = (await call("GET", "/agenda/today")).json();
  assert.equal(doc.agenda_date, today());
  const day = await call("GET", `/agenda/${today()}`);
  assert.equal(day.statusCode, 200, day.body);
  assert.equal(day.json().today, today());
  assert.equal(day.json().doc.id, doc.id);
  assert.equal(day.json().title, agendaTitleOn(today()));
});

test("another day's page is there only once someone writes it", async () => {
  const past = addDays(today(), -3);
  const empty = (await call("GET", `/agenda/${past}`)).json();
  assert.equal(empty.doc, null);
  assert.equal(empty.title, agendaTitleOn(past));
  const written = await call("POST", `/agenda/${past}`);
  assert.equal(written.statusCode, 201, written.body);
  const doc = written.json();
  assert.equal(doc.kind, "agenda");
  assert.equal(doc.agenda_date, past);
  assert.equal(doc.title, agendaTitleOn(past));
  // A day gone by has no free time to offer, and isn't called today.
  const lines = texts(doc.content);
  assert.ok(!/^Today/.test(lines[0]), lines[0]);
  assert.ok(!lines.some((l) => /^Free:/.test(l)));
  // Asking again answers the same page.
  const again = await call("POST", `/agenda/${past}`);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().id, doc.id);
  assert.equal((await call("GET", `/agenda/${past}`)).json().doc.id, doc.id);
  // It files under its own day, not the day it was written.
  const list: DocSummary[] = (await call("GET", "/docs?kind=agenda")).json();
  const mine = list.find((d) => d.id === doc.id)!;
  assert.equal(agendaDay(mine).slice(0, 10), past);
  const week = agendaGroups(list).flatMap((y) =>
    y.months.flatMap((m) => m.docs),
  );
  assert.ok(week.some((d) => d.id === doc.id));
});

test("a page written ahead is brought up to date on its day, unless it was changed", async () => {
  const ahead = addDays(today(), 2);
  const doc = (await call("POST", `/agenda/${ahead}`)).json();
  assert.equal(doc.agenda_date, ahead);
  // Its day comes: untouched, it is written again from the calendar.
  const onTheDay = new Date(Date.now() + 2 * 86_400_000);
  const fresh = await todaysAgenda(userId, { now: onTheDay });
  assert.equal(fresh.id, doc.id);
  assert.equal(fresh.version, 2);
  assert.ok(!/^Nothing scheduled on /.test(texts(fresh.content)[0]));

  // One written ahead and then written in is left as it is.
  const later = addDays(today(), 3);
  const kept = (await call("POST", `/agenda/${later}`)).json();
  const edited = await call("PUT", `/docs/${kept.id}`, {
    version: kept.version,
    content: [...kept.content, { type: "paragraph", text: "Packed my bag" }],
  });
  assert.equal(edited.statusCode, 200, edited.body);
  const onThatDay = await todaysAgenda(userId, {
    now: new Date(Date.now() + 3 * 86_400_000),
  });
  assert.equal(onThatDay.id, kept.id);
  assert.ok(texts(onThatDay.content).includes("Packed my bag"));
});

test("Rewrite from my calendar keeps your notes", async () => {
  const doc = (await call("GET", "/agenda/today")).json();
  const at = agendaNotesAt(doc.content);
  const content: DocBlock[] = doc.content.slice();
  content.splice(at + 1, 1, {
    type: "paragraph",
    text: "Call the lab about the sample",
  });
  content.splice(1, 0, { type: "paragraph", text: "Typed above Notes" });
  const saved = (
    await call("PUT", `/docs/${doc.id}`, { version: doc.version, content })
  ).json();
  const rewritten = await rewriteAgenda(userId, { withBrief: false });
  assert.equal(rewritten.id, doc.id);
  assert.ok(rewritten.version > saved.version);
  const lines = texts(rewritten.content);
  assert.ok(lines.includes("Call the lab about the sample"));
  assert.ok(!lines.includes("Typed above Notes"));
  assert.ok(lines.includes("What went well: "));
});

test("the agenda steps only to real days within reach", async () => {
  assert.equal(
    (await call("GET", `/agenda/${today()}`, undefined, null)).statusCode,
    401,
  );
  assert.equal(
    (await call("POST", `/agenda/${today()}`, undefined, null)).statusCode,
    401,
  );
  for (const bad of ["2026-13-01", "tomorrow", "2026-2-3"])
    assert.equal((await call("GET", `/agenda/${bad}`)).statusCode, 422, bad);
  const far = addDays(today(), -800);
  assert.equal((await call("GET", `/agenda/${far}`)).statusCode, 422);
  assert.equal(
    (await call("POST", `/agenda/${addDays(today(), 200)}`)).statusCode,
    422,
  );
  // Nothing was written for them.
  const written = await pool.query(
    "SELECT 1 FROM docs WHERE user_id = $1 AND agenda_date = $2::date",
    [userId, far],
  );
  assert.equal(written.rowCount, 0);
});

test("agenda days answer 429 past the per-minute limit", async () => {
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  await settings();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  live.rate_limit_per_minute = 2;
  const from = (method: "GET" | "POST") =>
    app.inject({
      method,
      url: `/agenda/${addDays(today(), -1)}`,
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: "10.74.0.1",
    });
  try {
    assert.equal((await from("GET")).statusCode, 200);
    assert.equal((await from("GET")).statusCode, 200);
    assert.equal((await from("GET")).statusCode, 429);
    assert.equal((await from("POST")).statusCode, 429);
  } finally {
    live.rate_limit_per_minute = was;
  }
});
