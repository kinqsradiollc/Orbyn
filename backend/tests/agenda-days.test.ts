import { freshRateLimitSession } from "./rate-limit-session.js";
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
  zonedInstant,
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
const noonOn = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return zonedInstant(year, month, day, 12, 0, TZ);
};

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
  // A page that is only the calendar's has nothing of yours to keep.
  assert.deepEqual(keepAgendaNotes(next, next), next);
  assert.ok(isDateKey("2026-09-24"));
  assert.ok(!isDateKey("2026-02-30") && !isDateKey("yesterday"));
  assert.equal(agendaTitleOn("2026-09-24"), "Thursday 24 September");
});

test("nothing you wrote is lost when the Notes heading is gone", () => {
  const fresh = buildAgenda([], { timeZone: TZ, now: new Date() });
  const top = fresh.slice(0, agendaNotesAt(fresh));
  // A page from before headings had names, with Notes renamed "Journal".
  const renamed: DocBlock[] = [
    { type: "paragraph", text: "Today: 1 event." },
    { type: "heading", level: 2, text: "Schedule" },
    { type: "heading", level: 3, text: "Morning" },
    { type: "bullet", text: "09:00–10:00 · Lecture" },
    { type: "heading", level: 2, text: "Journal" },
    { type: "paragraph", text: "my private thoughts" },
    { type: "heading", level: 2, text: "End of day" },
    { type: "bullet", text: "What went well: lots" },
    { type: "bullet", text: "What to carry into tomorrow: " },
  ];
  const kept = keepAgendaNotes(renamed, fresh);
  assert.deepEqual(kept.slice(0, top.length), top);
  assert.deepEqual(texts(kept.slice(top.length)), [
    "Journal",
    "my private thoughts",
    "End of day",
    "What went well: lots",
    "What to carry into tomorrow: ",
  ]);
  assert.ok(!texts(kept).includes("09:00–10:00 · Lecture"));
  // The renamed heading takes the Notes name, so next time it is found.
  assert.equal(kept[top.length].id, AGENDA_NOTES_ID);
  assert.equal(agendaNotesAt(kept), top.length);

  // A quiet day with no sections of the calendar's: yours starts at the
  // first heading after the opening line.
  const quiet = keepAgendaNotes(
    [
      {
        type: "paragraph",
        text: "Nothing scheduled today. The page is yours.",
      },
      { type: "heading", level: 2, text: "Thoughts" },
      { type: "paragraph", text: "abc" },
    ],
    fresh,
  );
  assert.deepEqual(texts(quiet.slice(top.length)), ["Thoughts", "abc"]);

  // Notes deleted along with every heading below it: the end-of-day
  // heading still marks where yours starts.
  const noNotes = keepAgendaNotes(
    [
      { type: "paragraph", text: "Today: 1 event." },
      { type: "heading", level: 2, text: "Coming up" },
      { type: "bullet", text: "Fri 26 Sept · Exam" },
      { type: "heading", level: 2, text: "End of day" },
      { type: "bullet", text: "What went well: the lab" },
    ],
    fresh,
  );
  // The calendar's line is still on the fresh page, so it isn't kept twice.
  const withExam: DocBlock[] = [
    ...top,
    { type: "heading", level: 2, text: "Coming up" },
    { type: "bullet", text: "Fri 26 Sept · Exam" },
    ...fresh.slice(top.length),
  ];
  const sameExam = keepAgendaNotes(
    [
      { type: "paragraph", text: "Today: 1 event." },
      { type: "heading", level: 2, text: "Coming up" },
      { type: "bullet", text: "Fri 26 Sept · Exam" },
      { type: "heading", level: 2, text: "End of day" },
      { type: "bullet", text: "What went well: the lab" },
    ],
    withExam,
  );
  assert.deepEqual(texts(sameExam.slice(top.length)), [
    "Coming up",
    "Fri 26 Sept · Exam",
    "End of day",
    "What went well: the lab",
  ]);
  assert.equal(sameExam[top.length + 2].id, AGENDA_NOTES_ID);
  // One the fresh page no longer has is still the calendar's, by its shape.
  assert.deepEqual(texts(noNotes.slice(top.length)), [
    "End of day",
    "What went well: the lab",
  ]);

  // Notes deleted with your lines left under the calendar's last section,
  // and End of day below them: the lines are kept, under a fresh Notes
  // heading in front of End of day.
  const stray = keepAgendaNotes(
    [
      { type: "paragraph", text: "Today: 1 event." },
      { type: "heading", level: 2, text: "Coming up" },
      { type: "bullet", text: "Fri 26 Sept · Exam" },
      { type: "paragraph", text: "my private thoughts" },
      { type: "paragraph", text: "" },
      { type: "heading", level: 2, text: "End of day" },
      { type: "bullet", text: "What went well: lots" },
    ],
    withExam,
  );
  assert.deepEqual(texts(stray.slice(top.length)), [
    "Coming up",
    "Fri 26 Sept · Exam",
    "Notes",
    "my private thoughts",
    "End of day",
    "What went well: lots",
  ]);
  assert.equal(stray[top.length + 2].id, AGENDA_NOTES_ID);
  // End of day keeps its own (lack of a) name: Notes has the name now.
  assert.equal(stray[top.length + 4].id, undefined);
  assert.equal(agendaNotesAt(stray), top.length + 2);
  // Written again, the page is found by its Notes heading and stays put.
  assert.deepEqual(keepAgendaNotes(stray, withExam), stray);
  // As the review found it: the exam gone from the calendar since, and your
  // lines right under it — the exam line goes, your words stay.
  const found = keepAgendaNotes(
    [
      { type: "paragraph", text: "Today: 1 event." },
      { type: "heading", level: 2, text: "Coming up" },
      { type: "bullet", text: "Fri 26 Sept · Exam" },
      { type: "paragraph", text: "my private thoughts" },
      { type: "bullet", text: "ask about the lab" },
      { type: "heading", level: 2, text: "End of day" },
      { type: "bullet", text: "What went well: lots" },
    ],
    fresh,
  );
  assert.deepEqual(texts(found.slice(top.length)), [
    "Notes",
    "my private thoughts",
    "ask about the lab",
    "End of day",
    "What went well: lots",
  ]);

  // No heading left to go by at all: every line of yours that the fresh
  // page doesn't have is kept, under a new Notes heading.
  const bare = keepAgendaNotes(
    [
      { type: "paragraph", text: "Today: 1 event." },
      { type: "bullet", text: "09:00–10:00 · Lecture" },
      { type: "paragraph", text: "" },
      { type: "paragraph", text: "my own words" },
    ],
    fresh,
  );
  const tail = bare.slice(top.length);
  assert.equal(tail[0].type, "heading");
  assert.equal(tail[0].id, AGENDA_NOTES_ID);
  assert.ok(texts(tail).includes("my own words"));
  assert.ok(!texts(tail).includes(""));
});

test("the calendar's to-dos and study lines aren't taken for yours", () => {
  const fresh = buildAgenda([], { timeZone: TZ, now: new Date() });
  const top = fresh.slice(0, agendaNotesAt(fresh));
  const tail = (current: DocBlock[]) =>
    texts(keepAgendaNotes(current, fresh).slice(top.length));
  const endOfDay: DocBlock[] = [
    { type: "heading", level: 2, text: "End of day" },
    { type: "bullet", text: "What went well: lots" },
  ];
  // Notes deleted with your words left under Carried over, whose to-do has
  // since been done (the fresh page no longer lists it): the to-do was the
  // calendar's and goes; your words stay, under Notes.
  assert.deepEqual(
    tail([
      { type: "paragraph", text: "Today: 1 carried over." },
      { type: "heading", level: 2, text: "Carried over" },
      { type: "todo", done: false, text: "Write essay" },
      { type: "paragraph", text: "my private thoughts" },
      ...endOfDay,
    ]),
    ["Notes", "my private thoughts", "End of day", "What went well: lots"],
  );
  // The same under Due today and Top priorities, however many to-dos; a
  // to-do of yours after your own words is yours.
  for (const section of ["Due today", "Top priorities"])
    assert.deepEqual(
      tail([
        { type: "paragraph", text: "Today: 2 tasks due." },
        { type: "heading", level: 2, text: section },
        { type: "todo", done: false, text: "Hand in the lab" },
        { type: "todo", done: false, text: "Read chapter 4" },
        { type: "paragraph", text: "remember the form" },
        { type: "todo", done: false, text: "ring the office" },
        ...endOfDay,
      ]),
      [
        "Notes",
        "remember the form",
        "ring the office",
        "End of day",
        "What went well: lots",
      ],
      section,
    );
  // Under Study: the cards to review and the exams coming are the
  // calendar's; the line you added is yours.
  assert.deepEqual(
    tail([
      { type: "paragraph", text: "Today: 1 event." },
      { type: "heading", level: 2, text: "Study" },
      { type: "bullet", text: "3 cards to review · 2 new" },
      { type: "bullet", text: "Physics exam in 4 days · 60% known well" },
      { type: "bullet", text: "Chemistry quiz in 1 day" },
      { type: "bullet", text: "revise chapter 3 tonight" },
      ...endOfDay,
    ]),
    ["Notes", "revise chapter 3 tonight", "End of day", "What went well: lots"],
  );
  assert.deepEqual(
    tail([
      { type: "paragraph", text: "Today: 1 event." },
      { type: "heading", level: 2, text: "Study" },
      { type: "bullet", text: "2 new" },
      ...endOfDay,
    ]),
    ["End of day", "What went well: lots"],
  );
  // A card line under another section isn't taken for the calendar's.
  assert.deepEqual(
    tail([
      { type: "paragraph", text: "Today: 1 event." },
      { type: "heading", level: 2, text: "Coming up" },
      { type: "bullet", text: "3 cards to review" },
      ...endOfDay,
    ]),
    ["Notes", "3 cards to review", "End of day", "What went well: lots"],
  );
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
  const doc = (await call("POST", "/agenda/today")).json();
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

test("calendar-day fixtures preserve the requested Melbourne date across daylight saving", () => {
  const lateEvening = zonedInstant(2026, 10, 1, 23, 30, TZ);
  assert.equal(
    localDateKey(new Date(lateEvening.getTime() + 3 * 86_400_000), TZ),
    "2026-10-05",
  );
  assert.equal(localDateKey(noonOn("2026-10-04"), TZ), "2026-10-04");
});

test("a page written ahead is brought up to date on its day, unless it was changed", async () => {
  const ahead = addDays(today(), 2);
  const doc = (await call("POST", `/agenda/${ahead}`)).json();
  assert.equal(doc.agenda_date, ahead);
  // Its day comes: untouched, it is written again from the calendar.
  const onTheDay = noonOn(ahead);
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
    now: noonOn(later),
  });
  assert.equal(onThatDay.id, kept.id);
  assert.ok(texts(onThatDay.content).includes("Packed my bag"));
});

test("Rewrite from my calendar keeps your notes", async () => {
  const doc = (await call("POST", "/agenda/today")).json();
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
  const rewritten = await rewriteAgenda(userId);
  assert.equal(rewritten.id, doc.id);
  assert.ok(rewritten.version > saved.version);
  const lines = texts(rewritten.content);
  assert.ok(lines.includes("Call the lab about the sample"));
  assert.ok(!lines.includes("Typed above Notes"));
  assert.ok(lines.includes("What went well: "));
});

test("another day's page leaves out what is worked out from today", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `days-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Student",
    },
  });
  const other = r.json().token as string;
  await call("PUT", "/planner/prefs", { timezone: TZ }, other);
  // Something to prioritise, and cards to review.
  await call(
    "POST",
    "/items",
    { kind: "task", title: "Finish the essay", priority: "high" },
    other,
  );
  const cards = await call(
    "POST",
    "/docs",
    {
      title: "Biology",
      content: [
        { type: "paragraph", text: "What carries oxygen :: haemoglobin" },
        {
          type: "paragraph",
          text: "The powerhouse of the cell :: mitochondria",
        },
      ],
    },
    other,
  );
  assert.equal(cards.statusCode, 201, cards.body);
  const headings = (blocks: DocBlock[]) =>
    blocks.flatMap((b) => (b.type === "heading" ? [b.text] : []));
  // Today's page has them...
  const todays = (await call("POST", "/agenda/today", undefined, other)).json();
  assert.ok(headings(todays.content).includes("Top priorities"));
  assert.ok(headings(todays.content).includes("Study"));
  assert.ok(
    todays.content.some(
      (b: DocBlock) => b.type === "todo" && b.text === "Finish the essay",
    ),
  );
  // ...but a page for last week or next week doesn't.
  for (const day of [addDays(today(), -5), addDays(today(), 5)]) {
    const page = (
      await call("POST", `/agenda/${day}`, undefined, other)
    ).json();
    assert.equal(page.agenda_date, day);
    const found = headings(page.content);
    assert.ok(!found.includes("Top priorities"), `${day}: ${found}`);
    assert.ok(!found.includes("Study"), `${day}: ${found}`);
    assert.ok(
      !texts(page.content).some((l) =>
        /cards? to review| in \d+ days?/.test(l),
      ),
    );
  }
});

test("reading an agenda never writes one: today's is written by the POST, and the old GET says it's deprecated", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `agenda-read-${Date.now()}@example.com`,
      password: "a-long-test-password",
      name: "Reader",
    },
  });
  const fresh = r.json().token as string;
  const count = async () =>
    (
      await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM docs WHERE kind = 'agenda' AND user_id = $1",
        [r.json().user.id],
      )
    ).rows[0].n;
  const day = (
    await call("GET", `/agenda/${today()}`, undefined, fresh)
  ).json();
  assert.equal(day.doc, null, "GET /agenda/:date only reads");
  assert.equal(await count(), 0);
  const made = await call("POST", "/agenda/today", { timezone: TZ }, fresh);
  assert.equal(made.statusCode, 201, made.body);
  assert.equal(await count(), 1);
  const again = await call("POST", "/agenda/today", {}, fresh);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().id, made.json().id);
  // Older app builds still get their page, told the GET is deprecated.
  const legacy = await call("GET", "/agenda/today", undefined, fresh);
  assert.equal(legacy.statusCode, 200);
  assert.equal(legacy.json().id, made.json().id);
  assert.match(String(legacy.headers.deprecation), /^@\d+$/);
  assert.equal((await call("POST", "/agenda/today", {}, null)).statusCode, 401);
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
  const limitedToken = await freshRateLimitSession(token);
  live.rate_limit_per_minute = 2;
  const from = (method: "GET" | "POST") =>
    app.inject({
      method,
      url: `/agenda/${addDays(today(), -1)}`,
      headers: { authorization: `Bearer ${limitedToken}` },
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

test("agenda briefing receives the page owner for provider authority", async () => {
  const now = new Date();
  let seenOwner: string | undefined;
  const result = await rewriteAgenda(userId, {
    now,
    brief: async (_day, _now, owner) => {
      seenOwner = owner;
      return "A short fixture summary of your available day.";
    },
  });
  assert.equal(seenOwner, userId);
  assert.equal(result.brief, true);
});
