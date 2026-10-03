import { freshRateLimitSession } from "./rate-limit-session.js";
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Page templates (DAY-02): the six starters, blanks that fill themselves in
 * without touching study syntax, saving a page as a template with its
 * folder and tags, to-do lines that become tasks in a chosen project, an
 * event's note made from a template, and who may make, change and use them.
 */
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  PAGE_TEMPLATE_STARTERS,
  blankDate,
  eventNoteFor,
  seriesNoteFor,
  blanksIn,
  fillBlanks,
  fillTemplate,
  fillTitle,
  templateFromPage,
  templateTodos,
} = await import("@orbyn/core");
type DocBlock = import("@orbyn/core").DocBlock;

const app = await buildApp();
type Json = Record<string, any>;
// Each call comes from its own address, so the file's many calls stay
// under the per-minute limit (which the 429 test checks on its own).
let caller = 0;
const address = () => `10.73.${Math.floor(++caller / 250)}.${caller % 250}`;
const call = (
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const TZ = "Europe/London";

async function newUser(name: string) {
  const r = await call(null, "POST", "/auth/register", {
    email: `ptpl-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name,
  });
  const token = r.json().token as string;
  await call(token, "PUT", "/planner/prefs", { timezone: TZ });
  return { token, id: r.json().user.id as string };
}

let owner: { token: string; id: string };
let member: { token: string; id: string };
let viewer: { token: string; id: string };
let stranger: { token: string; id: string };
let team = "";

before(async () => {
  await migrate();
  owner = await newUser("Owner");
  member = await newUser("Member");
  viewer = await newUser("Viewer");
  stranger = await newUser("Stranger");
  team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Page crew', $1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO team_members (team_id, user_id, role)
     VALUES ($1,$2,'owner'),($1,$3,'member'),($1,$4,'viewer')`,
    [team, owner.id, member.id, viewer.id],
  );
});
// Each case is an independent device workflow; changing IP must not reset a window.
beforeEach(async () => {
  for (const person of [owner, member, viewer, stranger])
    person.token = await freshRateLimitSession(person.token);
});
after(async () => {
  await app.close();
  await pool.end();
});

const texts = (blocks: DocBlock[]) =>
  blocks.map((b) => (b.type === "divider" ? "" : b.text));

test("blanks fill in single braces and never touch study syntax", () => {
  const values = { date: "24 September 2026", project: "Physics 101" };
  assert.equal(
    fillBlanks("Notes for {project} on {date}", values),
    "Notes for Physics 101 on 24 September 2026",
  );
  // {{ }} is a cloze card and "::" a flashcard: both stay exactly as typed.
  assert.equal(
    fillBlanks("{{date}} :: {date}", values),
    "{{date}} :: 24 September 2026",
  );
  assert.equal(fillBlanks("{Date} {unknown}", values), "{Date} {unknown}");
  // A blank with nothing to fill it goes quietly.
  assert.equal(fillBlanks("With {event}", values), "With ");
  // Titles tidy the separators an empty blank leaves behind.
  assert.equal(fillTitle("{event} · {date}", values), "24 September 2026");
  // The template's name stands in for an event not chosen.
  assert.equal(
    fillTitle("{event} · {date}", values, "Meeting"),
    "Meeting · 24 September 2026",
  );
  assert.equal(
    fillTitle("{event} · {date}", { ...values, event: "Design sync" }),
    "Design sync · 24 September 2026",
  );
  assert.deepEqual(
    blanksIn({
      title: "{event} · {date}",
      content: [{ type: "paragraph", text: "Course: {project} {{title}}" }],
    }),
    ["date", "project", "event"],
  );
  // {title} on the page is the page's own final title.
  const filled = fillTemplate(
    {
      title: "Plan · {date}",
      content: [
        { type: "paragraph", text: "{title}" },
        { type: "code", text: "{date}", lang: "" },
        { type: "math", text: "\\{x\\}", check: false },
      ],
    },
    values,
  );
  assert.equal(filled.title, "Plan · 24 September 2026");
  assert.deepEqual(texts(filled.content), [
    "Plan · 24 September 2026",
    "{date}",
    "\\{x\\}",
  ]);
  assert.equal(
    fillTemplate({ title: "x", content: [] }, values, "  My own name ").title,
    "My own name",
  );
  assert.equal(
    blankDate(new Date("2026-09-24T23:30:00Z"), "Europe/London"),
    "25 September 2026",
  );
});

test("a line that only labels blanks left empty is left off the page", () => {
  const today = { date: "24 September 2026" };
  for (const id of ["starter:lecture", "starter:lab", "starter:essay"]) {
    const starter = PAGE_TEMPLATE_STARTERS.find((s) => s.id === id)!;
    const lines = texts(fillTemplate(starter, today).content);
    assert.ok(
      !lines.some((l) => /^(Course|Class):\s*$/.test(l)),
      `${starter.name}: ${lines.slice(0, 3).join(" | ")}`,
    );
    // Only those lines: every heading and to-do is still there.
    assert.equal(
      lines.length,
      starter.content.length - (id === "starter:lecture" ? 2 : 1),
    );
  }
  const lecture = PAGE_TEMPLATE_STARTERS.find(
    (s) => s.id === "starter:lecture",
  )!;
  // Filled, the labels stay.
  assert.deepEqual(
    texts(
      fillTemplate(lecture, {
        ...today,
        project: "Physics 101",
        event: "Optics",
      }).content,
    ).slice(0, 2),
    ["Course: Physics 101", "Class: Optics"],
  );
  // A line with words of its own around an empty blank is kept, and so is
  // one that was never a label.
  const kept = fillTemplate(
    {
      title: "x",
      content: [
        { type: "paragraph", text: "Course: {project} (second year)" },
        { type: "paragraph", text: "{project}" },
        { type: "paragraph", text: "When: {date}" },
        { type: "bullet", text: "Ask: " },
      ],
    },
    today,
  );
  assert.deepEqual(texts(kept.content), [
    "Course:  (second year)",
    "",
    "When: 24 September 2026",
    "Ask: ",
  ]);
});

test("the six starters are there, and none of them makes study cards", () => {
  assert.deepEqual(
    PAGE_TEMPLATE_STARTERS.map((s) => s.name),
    [
      "Lecture notes",
      "Lab report",
      "Essay plan",
      "Meeting",
      "Weekly review",
      "One-to-one",
    ],
  );
  for (const s of PAGE_TEMPLATE_STARTERS) {
    const all = [s.title, ...texts(s.content)].join("\n");
    assert.ok(!all.includes("::"), `${s.name} has no flashcard lines`);
    assert.ok(!/\{\{|\}\}/.test(all), `${s.name} has no cloze`);
  }
  // A template starts fresh: boxes unticked, lines named for nothing.
  const clean = templateFromPage([
    { type: "todo", text: "Done", done: true, id: "b1" },
    { type: "paragraph", text: "Words", id: "b2" },
  ]);
  assert.deepEqual(clean, [
    { type: "todo", text: "Done", done: false },
    { type: "paragraph", text: "Words" },
  ]);
  assert.equal(templateTodos(clean), 1);
});

test("everyone sees the starters; a signed-out caller sees nothing", async () => {
  assert.equal((await call(null, "GET", "/page-templates")).statusCode, 401);
  const all: Json[] = (
    await call(member.token, "GET", "/page-templates")
  ).json();
  const starters = all.filter((t) => t.source === "starter");
  assert.equal(starters.length, 6);
  assert.ok(starters.every((t) => !t.can_edit && t.team_id === null));
  assert.ok(starters.some((t) => t.id === "starter:lecture"));
});

test("a starter makes a page with its blanks filled, in the chosen project", async () => {
  const project = (
    await call(owner.token, "POST", "/projects", { name: "Physics 101" })
  ).json();
  const made = await call(
    owner.token,
    "POST",
    "/page-templates/starter:lecture/use",
    {
      project_id: project.id,
    },
  );
  assert.equal(made.statusCode, 201, made.body);
  const { doc, tasks_created } = made.json();
  const today = blankDate(new Date(), TZ);
  assert.equal(doc.title, `Lecture notes · ${today}`);
  assert.equal(doc.kind, "doc");
  assert.equal(doc.project_id, project.id);
  assert.equal(tasks_created, 0);
  const lines = texts(doc.content);
  assert.equal(lines[0], "Course: Physics 101");
  // No event was chosen, so "Class:" isn't left dangling on the page.
  assert.equal(lines[1], "Key ideas");
  assert.ok(!lines.includes("Class: "));
  // Nothing became a task without being asked.
  const links = await pool.query(
    "SELECT 1 FROM doc_task_links WHERE doc_id = $1",
    [doc.id],
  );
  assert.equal(links.rowCount, 0);
});

test("its to-do lines become real tasks in the project, tied to their lines", async () => {
  const project = (
    await call(owner.token, "POST", "/projects", { name: "Chemistry lab" })
  ).json();
  const made = await call(
    owner.token,
    "POST",
    "/page-templates/starter:lab/use",
    {
      project_id: project.id,
      make_tasks: true,
      title: "Titration",
    },
  );
  assert.equal(made.statusCode, 201, made.body);
  const { doc, tasks_created } = made.json();
  assert.equal(doc.title, "Titration");
  assert.equal(tasks_created, 3);
  const tasks = (
    await pool.query<{
      title: string;
      project_id: string;
      stage_id: string | null;
    }>(
      `SELECT i.title, i.project_id, i.stage_id FROM doc_task_links l
         JOIN items i ON i.id = l.item_id WHERE l.doc_id = $1 ORDER BY i.title`,
      [doc.id],
    )
  ).rows;
  assert.deepEqual(
    tasks.map((t) => t.title),
    [
      "Check the report against the marking guide",
      "Hand in the report",
      "Write up the results",
    ],
  );
  assert.ok(tasks.every((t) => t.project_id === project.id));
  // Into the project's first stage, as a project template's tasks go.
  const first = (
    await pool.query<{ id: string }>(
      "SELECT id FROM project_stages WHERE project_id = $1 ORDER BY position LIMIT 1",
      [project.id],
    )
  ).rows[0]?.id;
  assert.ok(tasks.every((t) => t.stage_id === (first ?? null)));
  // The lines know their tasks, so ticking one ticks the other.
  const todos = (doc.content as DocBlock[]).filter((b) => b.type === "todo");
  assert.ok(todos.every((b) => !!b.id));
  // Asked again, nothing is made twice.
  const again = await call(owner.token, "POST", `/docs/${doc.id}/tasks`);
  assert.equal(again.json().created, 0);
});

test("with an event, the page is the event's note and {event} is its title", async () => {
  const event = (
    await call(owner.token, "POST", "/items", {
      title: "Design sync",
      kind: "event",
      due_at: "2026-10-02T09:00:00.000Z",
      end_at: "2026-10-02T10:00:00.000Z",
    })
  ).json();
  const made = await call(
    owner.token,
    "POST",
    "/page-templates/starter:meeting/use",
    {
      event_id: event.id,
    },
  );
  assert.equal(made.statusCode, 201, made.body);
  const { doc } = made.json();
  assert.equal(doc.title, "Design sync · 2 October 2026");
  assert.equal(doc.kind, "meeting");
  assert.equal(doc.item_id, event.id);
  assert.equal(texts(doc.content)[0], "When: 2 October 2026");
  // Opening the event's note finds this page rather than writing another.
  const note = await call(owner.token, "POST", `/items/${event.id}/note`);
  assert.equal(note.json().id, doc.id);
  // Someone else's event is not found.
  const theirs = await call(
    stranger.token,
    "POST",
    "/page-templates/starter:meeting/use",
    {
      event_id: event.id,
    },
  );
  assert.equal(theirs.statusCode, 404);
});

test("an event that already has a note keeps that one note", async () => {
  const event = (
    await call(owner.token, "POST", "/items", {
      title: "Budget review",
      kind: "event",
      due_at: "2026-10-05T09:00:00.000Z",
      end_at: "2026-10-05T10:00:00.000Z",
    })
  ).json();
  // The event's note is opened and written in first.
  const note = (
    await call(owner.token, "POST", `/items/${event.id}/note`)
  ).json();
  const written = await call(owner.token, "PUT", `/docs/${note.id}`, {
    version: note.version,
    content: [...note.content, { type: "paragraph", text: "Cut travel" }],
  });
  assert.equal(written.statusCode, 200, written.body);
  // Choosing the same event for the Meeting starter answers that note.
  const used = await call(
    owner.token,
    "POST",
    "/page-templates/starter:meeting/use",
    { event_id: event.id, make_tasks: true },
  );
  assert.equal(used.statusCode, 200, used.body);
  assert.equal(used.json().existing, true);
  assert.equal(used.json().doc.id, note.id);
  assert.equal(used.json().tasks_created, 0);
  assert.ok(texts(used.json().doc.content).includes("Cut travel"));
  const notes = await pool.query(
    "SELECT 1 FROM docs WHERE item_id = $1 AND kind = 'meeting'",
    [event.id],
  );
  assert.equal(notes.rowCount, 1);
  // And the event still opens the note with the writing in it.
  const again = (
    await call(owner.token, "POST", `/items/${event.id}/note`)
  ).json();
  assert.equal(again.id, note.id);

  // Two at once still make only one.
  const fresh = (
    await call(owner.token, "POST", "/items", {
      title: "Retro",
      kind: "event",
      due_at: "2026-10-06T09:00:00.000Z",
      end_at: "2026-10-06T10:00:00.000Z",
    })
  ).json();
  const both = await Promise.all([
    call(owner.token, "POST", "/page-templates/starter:meeting/use", {
      event_id: fresh.id,
    }),
    call(owner.token, "POST", `/items/${fresh.id}/note`),
  ]);
  assert.deepEqual(both.map((r) => r.statusCode).sort(), [200, 201]);
  const made = await pool.query(
    "SELECT 1 FROM docs WHERE item_id = $1 AND kind = 'meeting'",
    [fresh.id],
  );
  assert.equal(made.rowCount, 1);
});

test("an event on the calendar is marked with the note it opens", () => {
  const note = (
    doc_id: string,
    item_id: string,
    occurrence: string | null,
    team_id: string | null = null,
  ) => ({ doc_id, title: doc_id, item_id, occurrence, team_id });
  // Latest edited first, as the server lists them.
  const notes = [
    note("standup-thu", "standup", "2026-09-24T09:00:00.000Z"),
    note("standup-series", "standup", null),
    note("review", "review", null),
    note("team-sync", "sync", null, "team-1"),
  ];
  const rrule = "FREQ=DAILY";
  // One time of a repeating event: its own note, whatever the offset says.
  assert.equal(
    eventNoteFor(notes, {
      item_id: "standup",
      rrule,
      occurrence: "2026-09-24T19:00:00+10:00",
    })?.doc_id,
    "standup-thu",
  );
  // Another time of it has none yet: not the series' note, not Thursday's.
  assert.equal(
    eventNoteFor(notes, {
      item_id: "standup",
      rrule,
      occurrence: "2026-09-25T09:00:00.000Z",
    }),
    undefined,
  );
  // The series with no time given opens the series' own.
  assert.equal(
    eventNoteFor(notes, { item_id: "standup", rrule })?.doc_id,
    "standup-series",
  );
  // An event that doesn't repeat: its note, the latest edited.
  assert.equal(
    eventNoteFor(notes, { item_id: "review", occurrence: null })?.doc_id,
    "review",
  );
  // A note is only an event's in the event's own space.
  assert.equal(
    eventNoteFor(notes, { item_id: "sync", team_id: "team-1" })?.doc_id,
    "team-sync",
  );
  assert.equal(eventNoteFor(notes, { item_id: "sync" }), undefined);
  assert.equal(
    eventNoteFor(notes, { item_id: "review", team_id: "team-1" }),
    undefined,
  );
  assert.equal(eventNoteFor([], { item_id: "review" }), undefined);

  // One class open: the series' own note is pointed to beside it, whether
  // or not the class has one of its own; never for a whole event.
  for (const occurrence of [
    "2026-09-24T09:00:00.000Z",
    "2026-09-25T09:00:00.000Z",
  ])
    assert.equal(
      seriesNoteFor(notes, { item_id: "standup", occurrence })?.doc_id,
      "standup-series",
    );
  assert.equal(seriesNoteFor(notes, { item_id: "standup" }), undefined);
  assert.equal(
    seriesNoteFor(notes, { item_id: "review", occurrence: null }),
    undefined,
  );
  assert.equal(
    seriesNoteFor(notes, {
      item_id: "sync",
      occurrence: "2026-09-24T09:00:00.000Z",
    }),
    undefined,
  );
  assert.equal(
    seriesNoteFor(notes, {
      item_id: "sync",
      team_id: "team-1",
      occurrence: "2026-09-24T09:00:00.000Z",
    })?.doc_id,
    "team-sync",
  );
});

test("each class of a repeating event keeps its own note", async () => {
  // A daily lecture, five classes, at 10:00 in London.
  const series = (
    await call(owner.token, "POST", "/items", {
      title: "Physics lecture",
      kind: "event",
      due_at: "2026-09-24T09:00:00.000Z",
      end_at: "2026-09-24T10:00:00.000Z",
      rrule: "FREQ=DAILY;COUNT=5",
      location: "Room 1",
    })
  ).json();
  const at = (day: number) =>
    new Date(Date.UTC(2026, 8, 24 + day, 9)).toISOString();
  // The calendar names each class by the time the apps send back.
  const view = (
    await call(
      owner.token,
      "GET",
      `/calendar?from=${at(-1)}&to=${encodeURIComponent(at(6))}`,
    )
  ).json();
  const classes = view.entries.filter((e: Json) => e.item_id === series.id);
  assert.deepEqual(
    classes.map((e: Json) => e.occurrence),
    [0, 1, 2, 3, 4].map(at),
  );

  const lecture = (occurrence: string) =>
    call(owner.token, "POST", "/page-templates/starter:lecture/use", {
      event_id: series.id,
      event_at: occurrence,
      occurrence,
    });
  const first = await lecture(at(0));
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json().doc.title, "Lecture notes · 24 September 2026");
  assert.equal(first.json().doc.occurrence, at(0));
  // Two days later is another class, so another page.
  const third = await lecture(at(2));
  assert.equal(third.statusCode, 201, third.body);
  assert.notEqual(third.json().doc.id, first.json().doc.id);
  assert.equal(third.json().doc.title, "Lecture notes · 26 September 2026");
  assert.equal(third.json().existing, false);
  // The first class again: its own page, not a new one.
  const again = await lecture(at(0));
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().existing, true);
  assert.equal(again.json().doc.id, first.json().doc.id);
  // An app that sends only the class's time finds its page too.
  const byTime = await call(
    owner.token,
    "POST",
    "/page-templates/starter:lecture/use",
    { event_id: series.id, event_at: at(2) },
  );
  assert.equal(byTime.statusCode, 200, byTime.body);
  assert.equal(byTime.json().doc.id, third.json().doc.id);

  // Opening a class from the calendar opens that class's note.
  const open = (occurrence?: string) =>
    call(
      owner.token,
      "POST",
      `/items/${series.id}/note`,
      occurrence ? { occurrence } : undefined,
    );
  assert.equal((await open(at(0))).json().id, first.json().doc.id);
  assert.equal((await open(at(2))).json().id, third.json().doc.id);
  // A class with no note yet gets its own, named for its day.
  const second = await open(at(1));
  assert.equal(second.statusCode, 201, second.body);
  assert.equal(second.json().title, "Physics lecture · 25 September 2026");
  assert.equal(texts(second.json().content)[0], "2026-09-25 at 10:00 · Room 1");
  assert.equal(second.json().occurrence, at(1));
  const secondAgain = await open(at(1));
  assert.equal(secondAgain.statusCode, 200);
  assert.equal(secondAgain.json().id, second.json().id);
  // The whole series, with no class named, keeps a note of its own.
  const whole = await open();
  assert.equal(whole.statusCode, 201, whole.body);
  assert.equal(whole.json().title, "Physics lecture");
  assert.equal(whole.json().occurrence, null);
  assert.ok(
    ![first, third].some((r) => r.json().doc.id === whole.json().id) &&
      whole.json().id !== second.json().id,
  );
  assert.equal((await open()).json().id, whole.json().id);
  // A time the event doesn't have is refused, as is anything else.
  assert.equal((await open("2026-09-24T09:30:00.000Z")).statusCode, 422);
  assert.equal((await open(at(7))).statusCode, 422);
  assert.equal((await lecture("2026-09-24T09:30:00.000Z")).statusCode, 422);
  assert.equal(
    (
      await call(owner.token, "POST", `/items/${series.id}/note`, {
        occurrence: "tomorrow",
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(owner.token, "POST", `/items/${series.id}/note`, {
        class: at(0),
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (await call(null, "POST", `/items/${series.id}/note`)).statusCode,
    401,
  );
  assert.equal(
    (
      await call(stranger.token, "POST", `/items/${series.id}/note`, {
        occurrence: at(0),
      })
    ).statusCode,
    404,
  );

  // A class moved on its own keeps its note, found by its first time or
  // its new one, and a page made for it carries its own title, day and
  // room.
  const moved = await call(
    owner.token,
    "PUT",
    `/items/${series.id}?scope=this&occurrence=${encodeURIComponent(at(3))}`,
    {
      title: "Physics lecture (Room 9)",
      notes: series.notes,
      kind: "event",
      status: series.status,
      priority: series.priority,
      due_at: "2026-09-27T13:00:00.000Z",
      end_at: "2026-09-27T14:00:00.000Z",
      location: "Room 9",
      team_id: null,
      version: series.version,
    },
  );
  assert.equal(moved.statusCode, 200, moved.body);
  const fourth = await open("2026-09-27T13:00:00.000Z");
  assert.equal(fourth.statusCode, 201, fourth.body);
  assert.equal(fourth.json().occurrence, at(3));
  assert.equal(
    fourth.json().title,
    "Physics lecture (Room 9) · 27 September 2026",
  );
  assert.equal(texts(fourth.json().content)[0], "2026-09-27 at 14:00 · Room 9");
  assert.equal((await open(at(3))).json().id, fourth.json().id);
  const fourthPage = await call(
    owner.token,
    "POST",
    "/page-templates/starter:lecture/use",
    { event_id: series.id, occurrence: at(3) },
  );
  assert.equal(fourthPage.statusCode, 200, fourthPage.body);
  assert.equal(fourthPage.json().doc.id, fourth.json().id);

  // The notes these events have, to mark them: each class's, and the
  // series' own, and nobody else's.
  const refs = await call(
    owner.token,
    "GET",
    `/docs/event-notes?items=${series.id}`,
  );
  assert.equal(refs.statusCode, 200, refs.body);
  const byOccurrence = new Map(
    refs.json().map((r: Json) => [r.occurrence, r.doc_id]),
  );
  assert.equal(byOccurrence.get(at(0)), first.json().doc.id);
  assert.equal(byOccurrence.get(at(1)), second.json().id);
  assert.equal(byOccurrence.get(at(2)), third.json().doc.id);
  assert.equal(byOccurrence.get(at(3)), fourth.json().id);
  assert.equal(byOccurrence.get(null), whole.json().id);
  assert.equal(refs.json().length, 5);
  const one = refs.json().find((r: Json) => r.doc_id === first.json().doc.id);
  assert.equal(one.title, "Lecture notes · 24 September 2026");
  assert.equal(one.item_id, series.id);
  assert.equal(one.team_id, null);
  // The apps' rule agrees: each class opens its own, the series its own.
  for (const e of classes)
    assert.equal(
      eventNoteFor(refs.json(), e)?.doc_id,
      byOccurrence.get(e.occurrence),
    );
  assert.equal(
    eventNoteFor(refs.json(), { item_id: series.id, occurrence: at(4) }),
    undefined,
  );
  // The series with no time given: the series' own note, as the server has.
  assert.equal(
    eventNoteFor(refs.json(), { item_id: series.id, rrule: series.rrule })
      ?.doc_id,
    whole.json().id,
  );
  // A window keeps a repeating event's classes to the times shown.
  const window = await call(
    owner.token,
    "GET",
    `/docs/event-notes?items=${series.id}&from=${encodeURIComponent(at(1))}&to=${encodeURIComponent(at(3))}`,
  );
  assert.deepEqual(
    window
      .json()
      .map((r: Json) => r.occurrence)
      .sort(),
    [at(1), at(2), null].sort(),
  );
  // A note in Trash no longer marks its class.
  await call(owner.token, "DELETE", `/docs/${second.json().id}`);
  assert.ok(
    !(await call(owner.token, "GET", `/docs/event-notes?items=${series.id}`))
      .json()
      .some((r: Json) => r.doc_id === second.json().id),
  );
  // Opened meanwhile, that class gets a fresh note; bringing the old one
  // back lets the untouched copy go — that class's only, not the other
  // classes' pages nobody has written in yet.
  const copy = await open(at(1));
  assert.equal(copy.statusCode, 201, copy.body);
  assert.notEqual(copy.json().id, second.json().id);
  const restored = await call(
    owner.token,
    "POST",
    `/docs/${second.json().id}/restore`,
  );
  assert.equal(restored.statusCode, 200, restored.body);
  const left = (
    await pool.query<{ id: string }>(
      `SELECT id FROM docs WHERE item_id = $1 AND kind = 'meeting'
          AND deleted_at IS NULL`,
      [series.id],
    )
  ).rows.map((r) => r.id);
  assert.deepEqual(
    left.sort(),
    [
      first.json().doc.id,
      second.json().id,
      third.json().doc.id,
      fourth.json().id,
      whole.json().id,
    ].sort(),
  );
  assert.equal((await open(at(1))).json().id, second.json().id);
  assert.deepEqual(
    (
      await call(stranger.token, "GET", `/docs/event-notes?items=${series.id}`)
    ).json(),
    [],
  );
  assert.equal(
    (await call(null, "GET", `/docs/event-notes?items=${series.id}`))
      .statusCode,
    401,
  );
  for (const bad of ["", "?items=", "?items=nope", `?items=${series.id}&x=1`])
    assert.equal(
      (await call(owner.token, "GET", `/docs/event-notes${bad}`)).statusCode,
      422,
      bad,
    );
  const many = Array.from({ length: 201 }, () => randomUUID()).join(",");
  assert.equal(
    (await call(owner.token, "GET", `/docs/event-notes?items=${many}`))
      .statusCode,
    422,
  );
});

test("a class's note stays with its class when the series changes", async () => {
  const hour = 3_600_000;
  const plus = (iso: string, ms: number) =>
    new Date(Date.parse(iso) + ms).toISOString();
  const openNote = (id: string, occurrence?: string) =>
    call(
      owner.token,
      "POST",
      `/items/${id}/note`,
      occurrence ? { occurrence } : undefined,
    );
  const noteId = async (id: string, occurrence?: string) => {
    const r = await openNote(id, occurrence);
    assert.ok([200, 201].includes(r.statusCode), r.body);
    return r.json().id as string;
  };
  const getItem = async (id: string) =>
    (await call(owner.token, "GET", `/items/${id}`)).json();
  const body = (item: Json, patch: Json = {}) => ({
    title: item.title,
    notes: item.notes ?? "",
    kind: item.kind,
    status: item.status,
    priority: item.priority,
    due_at: item.due_at,
    end_at: item.end_at,
    team_id: null,
    version: item.version,
    ...patch,
  });
  const put = (
    id: string,
    data: Json,
    scope?: { scope: "this" | "following"; occurrence: string },
  ) =>
    call(
      owner.token,
      "PUT",
      `/items/${id}${
        scope
          ? `?scope=${scope.scope}&occurrence=${encodeURIComponent(scope.occurrence)}`
          : ""
      }`,
      data,
    );
  const lecture = async (title: string, start: string, rrule: string) =>
    (
      await call(owner.token, "POST", "/items", {
        title,
        kind: "event",
        due_at: start,
        end_at: plus(start, hour),
        rrule,
        timezone: TZ,
        location: "Room 1",
      })
    ).json() as Json;
  /**
   * What the calendar marks each class of these events with, by the notes
   * the server lists for them: class start → note id.
   */
  const marks = async (ids: string[], from: string, to: string) => {
    const view = (
      await call(
        owner.token,
        "GET",
        `/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
    ).json();
    const refs = (
      await call(owner.token, "GET", `/docs/event-notes?items=${ids.join(",")}`)
    ).json();
    const out: Record<string, string> = {};
    for (const e of view.entries.filter((x: Json) => ids.includes(x.item_id))) {
      const found = eventNoteFor(refs, e);
      if (found) out[e.occurrence] = found.doc_id;
    }
    return out;
  };

  // A daily lecture, eight classes from 5 October at 10:00 in London, with
  // notes made ahead for some of them and one for the whole series.
  const day = (n: number, h = 9) =>
    new Date(Date.UTC(2026, 9, 5 + n, h)).toISOString();
  const chem = await lecture("Chemistry lecture", day(0), "FREQ=DAILY;COUNT=8");
  const n0 = await noteId(chem.id, day(0));
  const n2 = await noteId(chem.id, day(2));
  const n4 = await noteId(chem.id, day(4));
  const n6 = await noteId(chem.id, day(6));
  const whole = await noteId(chem.id);

  // "This and following" from the third class, to another room at the same
  // time: the notes from there on go with their classes to the new series.
  const split = await put(
    chem.id,
    body(await getItem(chem.id), {
      due_at: day(2),
      end_at: day(2, 10),
      location: "Room 9",
    }),
    { scope: "following", occurrence: day(2) },
  );
  assert.equal(split.statusCode, 200, split.body);
  const next = split.json();
  assert.notEqual(next.id, chem.id);
  const prepped = await openNote(next.id, day(4));
  assert.equal(prepped.statusCode, 200, prepped.body);
  assert.equal(prepped.json().id, n4);
  assert.equal(await noteId(next.id, day(2)), n2);
  assert.equal(await noteId(next.id, day(6)), n6);
  // What stays with the old series stays: its first class, and its own note.
  assert.equal(await noteId(chem.id, day(0)), n0);
  assert.equal(await noteId(chem.id), whole);
  assert.equal((await openNote(chem.id, day(4))).statusCode, 422);
  assert.deepEqual(await marks([chem.id, next.id], day(-1), day(9)), {
    [day(0)]: n0,
    [day(2)]: n2,
    [day(4)]: n4,
    [day(6)]: n6,
  });

  // Again from the seventh class, an hour later this time: each note moves
  // to its class's new time.
  const n7 = await noteId(next.id, day(7));
  const later = await put(
    next.id,
    body(await getItem(next.id), { due_at: day(6, 10), end_at: day(6, 11) }),
    { scope: "following", occurrence: day(6) },
  );
  assert.equal(later.statusCode, 200, later.body);
  const third = later.json();
  assert.equal(await noteId(third.id, day(6, 10)), n6);
  assert.equal(await noteId(third.id, day(7, 10)), n7);
  assert.equal(await noteId(next.id, day(4)), n4);
  assert.deepEqual(await marks([chem.id, next.id, third.id], day(-1), day(9)), {
    [day(0)]: n0,
    [day(2)]: n2,
    [day(4)]: n4,
    [day(6, 10)]: n6,
    [day(7, 10)]: n7,
  });

  // The whole series moved an hour later: every class, past ones too, still
  // opens its own note at its new time, and the old times are gone.
  const sept = (n: number) =>
    new Date(Date.UTC(2026, 8, 1 + n, 9)).toISOString();
  const bio = await lecture("Biology lecture", sept(0), "FREQ=DAILY;COUNT=6");
  const bioNotes = new Map<number, string>();
  for (const n of [0, 1, 3, 5]) bioNotes.set(n, await noteId(bio.id, sept(n)));
  const bioWhole = await noteId(bio.id);
  const bioItem = await getItem(bio.id);
  const moved = await put(
    bio.id,
    body(bioItem, {
      due_at: plus(bioItem.due_at, hour),
      end_at: plus(bioItem.end_at, hour),
    }),
  );
  assert.equal(moved.statusCode, 200, moved.body);
  for (const [n, id] of bioNotes) {
    const r = await openNote(bio.id, plus(sept(n), hour));
    assert.equal(r.statusCode, 200, `class ${n}: ${r.body}`);
    assert.equal(r.json().id, id, `class ${n}`);
    assert.equal((await openNote(bio.id, sept(n))).statusCode, 422);
  }
  assert.equal(await noteId(bio.id), bioWhole);
  assert.deepEqual(
    await marks([bio.id], sept(-1), sept(7)),
    Object.fromEntries(
      [...bioNotes].map(([n, id]) => [plus(sept(n), hour), id]),
    ),
  );

  // Once the series has moved on to a later class (as it does when a class
  // has passed), "this and following" from its first class moves all of
  // it: each note still follows its own class.
  const lab = await lecture("Physics lab", sept(10), "FREQ=DAILY;COUNT=4");
  const labNotes: string[] = [];
  for (const n of [10, 11, 12, 13])
    labNotes.push(await noteId(lab.id, sept(n)));
  await pool.query("UPDATE items SET due_at = $2, end_at = $3 WHERE id = $1", [
    lab.id,
    sept(12),
    plus(sept(12), hour),
  ]);
  const fromFirst = await put(
    lab.id,
    body(await getItem(lab.id), {
      due_at: plus(sept(10), hour),
      end_at: plus(sept(10), 2 * hour),
    }),
    { scope: "following", occurrence: sept(10) },
  );
  assert.equal(fromFirst.statusCode, 200, fromFirst.body);
  assert.equal(fromFirst.json().id, lab.id);
  for (const [i, n] of [10, 11, 12, 13].entries())
    assert.equal(
      await noteId(lab.id, plus(sept(n), hour)),
      labNotes[i],
      `${n}`,
    );

  // Moved a day later across the clocks going back (25 October): a weekly
  // Saturday class becomes a Sunday one at the same 10:00, and each note
  // follows its class, not a fixed 24 hours.
  const sat = await lecture(
    "Seminar",
    "2026-10-17T09:00:00.000Z",
    "FREQ=WEEKLY;COUNT=3",
  );
  const was = [
    "2026-10-17T09:00:00.000Z",
    "2026-10-24T09:00:00.000Z",
    "2026-10-31T10:00:00.000Z",
  ];
  const now = [
    "2026-10-18T09:00:00.000Z",
    "2026-10-25T10:00:00.000Z",
    "2026-11-01T10:00:00.000Z",
  ];
  const satNotes = [];
  for (const t of was) satNotes.push(await noteId(sat.id, t));
  const satItem = await getItem(sat.id);
  const sunday = await put(
    sat.id,
    body(satItem, {
      due_at: plus(satItem.due_at, 24 * hour),
      end_at: plus(satItem.end_at, 24 * hour),
    }),
  );
  assert.equal(sunday.statusCode, 200, sunday.body);
  for (const [i, t] of now.entries())
    assert.equal(await noteId(sat.id, t), satNotes[i], t);
  assert.deepEqual(
    await marks(
      [sat.id],
      "2026-10-16T00:00:00.000Z",
      "2026-11-03T00:00:00.000Z",
    ),
    Object.fromEntries(now.map((t, i) => [t, satNotes[i]])),
  );

  // A new pattern keeps the notes of the classes it still has; a class it
  // doesn't have any more leaves its note to the whole event, not to a
  // time nothing opens.
  const nov = (n: number) =>
    new Date(Date.UTC(2026, 10, 2 + n, 10)).toISOString();
  const prac = await lecture("Practical", nov(0), "FREQ=DAILY;COUNT=5");
  const prac0 = await noteId(prac.id, nov(0));
  const prac2 = await noteId(prac.id, nov(2));
  const weekly = await put(
    prac.id,
    body(await getItem(prac.id), { rrule: "FREQ=WEEKLY;COUNT=5" }),
  );
  assert.equal(weekly.statusCode, 200, weekly.body);
  assert.equal(await noteId(prac.id, nov(0)), prac0);
  assert.equal((await openNote(prac.id, nov(2))).statusCode, 422);
  const kept = await openNote(prac.id);
  assert.equal(kept.statusCode, 200, kept.body);
  assert.equal(kept.json().id, prac2);
  assert.equal(kept.json().occurrence, null);

  // Classes deleted (from one on, or one alone) leave their notes to the
  // whole event too.
  const prac14 = await noteId(prac.id, nov(14));
  const prac28 = await noteId(prac.id, nov(28));
  const prac7 = await noteId(prac.id, nov(7));
  const cut = await call(
    owner.token,
    "DELETE",
    `/items/${prac.id}?version=${(await getItem(prac.id)).version}&scope=following&occurrence=${encodeURIComponent(nov(14))}`,
  );
  assert.ok([200, 204].includes(cut.statusCode), cut.body);
  const skip = await call(
    owner.token,
    "DELETE",
    `/items/${prac.id}?version=${(await getItem(prac.id)).version}&scope=this&occurrence=${encodeURIComponent(nov(7))}`,
  );
  assert.ok([200, 204].includes(skip.statusCode), skip.body);
  const left = new Map(
    (
      await pool.query<{
        id: string;
        occurrence: Date | null;
        class_was: Date | null;
      }>(
        `SELECT id, occurrence, class_was FROM docs
          WHERE item_id = $1 AND kind = 'meeting'`,
        [prac.id],
      )
    ).rows.map((r) => [
      r.id,
      [r.occurrence?.toISOString() ?? null, r.class_was?.toISOString() ?? null],
    ]),
  );
  // Each remembers the class it was for.
  assert.deepEqual(Object.fromEntries(left), {
    [prac0]: [nov(0), null],
    [prac2]: [null, nov(2)],
    [prac7]: [null, nov(7)],
    [prac14]: [null, nov(14)],
    [prac28]: [null, nov(28)],
  });

  // A repeat taken off: the one event keeps every note, none of them tied
  // to a time.
  const single = await put(
    bio.id,
    body(await getItem(bio.id), { rrule: null }),
  );
  assert.equal(single.statusCode, 200, single.body);
  assert.equal(
    (
      await pool.query(
        `SELECT 1 FROM docs WHERE item_id = $1 AND kind = 'meeting'
            AND occurrence IS NOT NULL`,
        [bio.id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM docs WHERE item_id = $1 AND kind = 'meeting'",
        [bio.id],
      )
    ).rowCount,
    5,
  );
});

/** Opening, writing and listing event notes as the owner, for the tests below. */
const hour = 3_600_000;
const openNote = (id: string, occurrence?: string) =>
  call(
    owner.token,
    "POST",
    `/items/${id}/note`,
    occurrence ? { occurrence } : undefined,
  );
const noteId = async (id: string, occurrence?: string) => {
  const r = await openNote(id, occurrence);
  assert.ok([200, 201].includes(r.statusCode), r.body);
  return r.json().id as string;
};
const write = async (docId: string, line: string) => {
  const doc = (await call(owner.token, "GET", `/docs/${docId}`)).json();
  const r = await call(owner.token, "PUT", `/docs/${docId}`, {
    version: doc.version,
    content: [...doc.content, { type: "paragraph", text: line }],
  });
  assert.equal(r.statusCode, 200, r.body);
};
const getItem = async (id: string) =>
  (await call(owner.token, "GET", `/items/${id}`)).json();
const refsOf = async (ids: string[]) =>
  (
    await call(owner.token, "GET", `/docs/event-notes?items=${ids.join(",")}`)
  ).json() as Json[];
const event = async (title: string, start: string, rrule: string) =>
  (
    await call(owner.token, "POST", "/items", {
      title,
      kind: "event",
      due_at: start,
      end_at: new Date(Date.parse(start) + hour).toISOString(),
      rrule,
      timezone: TZ,
    })
  ).json() as Json;
const body = (item: Json, patch: Json = {}) => ({
  title: item.title,
  notes: item.notes ?? "",
  kind: item.kind,
  status: item.status,
  priority: item.priority,
  due_at: item.due_at,
  end_at: item.end_at,
  team_id: null,
  version: item.version,
  ...patch,
});

test("the series' own note stays first when a class's note loses its class", async () => {
  // A weekly one-to-one on Mondays at 10:00 in London, with a running note
  // for the whole series, written in.
  const monday = (n: number) =>
    new Date(Date.UTC(2026, 8, 28 + 7 * n, n >= 4 ? 10 : 9)).toISOString();
  const oneToOne = await event("One-to-one", monday(0), "FREQ=WEEKLY;COUNT=6");
  const running = await noteId(oneToOne.id);
  await write(running, "Agreed: weekly goals");
  // A later class's note prepped (the latest edited now), then that class
  // skipped.
  const prepped = await openNote(oneToOne.id, monday(3));
  assert.equal(prepped.statusCode, 201, prepped.body);
  assert.equal(prepped.json().title, "One-to-one · 19 October 2026");
  const skipped = await call(
    owner.token,
    "DELETE",
    `/items/${oneToOne.id}?version=${(await getItem(oneToOne.id)).version}&scope=this&occurrence=${encodeURIComponent(monday(3))}`,
  );
  assert.ok([200, 204].includes(skipped.statusCode), skipped.body);
  // Opening the event with no class (Overview, ⌘K, notices) still opens
  // the running note, and every class points to it.
  assert.equal(await noteId(oneToOne.id), running);
  let refs = await refsOf([oneToOne.id]);
  const former = refs.find((r) => r.doc_id === prepped.json().id);
  assert.ok(former, "the skipped class's note is still the event's");
  assert.equal(former.occurrence, null);
  assert.equal(former.class_was, monday(3));
  assert.equal(
    refs.find((r) => r.doc_id === running)?.class_was,
    null,
    "the running note was never a class's",
  );
  assert.equal(refs[0].doc_id, running, "the event's own note comes first");
  for (const n of [0, 1, 2, 4])
    assert.equal(
      seriesNoteFor(refs, { item_id: oneToOne.id, occurrence: monday(n) })
        ?.doc_id,
      running,
      `class ${n}`,
    );
  assert.equal(
    eventNoteFor(refs, { item_id: oneToOne.id, rrule: oneToOne.rrule })?.doc_id,
    running,
  );
  // The skipped class's note is still there to open, in the library too.
  const kept = await call(owner.token, "GET", `/docs/${prepped.json().id}`);
  assert.equal(kept.statusCode, 200, kept.body);
  assert.ok(
    (await call(owner.token, "GET", "/docs?kind=meeting"))
      .json()
      .some((d: Json) => d.id === prepped.json().id),
  );
  // Written in after, it still doesn't take the running note's place.
  await write(prepped.json().id, "Moved to next week");
  assert.equal(await noteId(oneToOne.id), running);
  refs = await refsOf([oneToOne.id]);
  assert.equal(
    seriesNoteFor(refs, { item_id: oneToOne.id, occurrence: monday(1) })
      ?.doc_id,
    running,
  );

  // With the running note in Trash, a former class's note stands in (no
  // fresh copy is made); bringing the running note back takes its place
  // again, and doesn't let a former class's note nobody wrote in go.
  const untouched = await noteId(oneToOne.id, monday(4));
  const cut = await call(
    owner.token,
    "DELETE",
    `/items/${oneToOne.id}?version=${(await getItem(oneToOne.id)).version}&scope=following&occurrence=${encodeURIComponent(monday(4))}`,
  );
  assert.ok([200, 204].includes(cut.statusCode), cut.body);
  assert.equal(await noteId(oneToOne.id), running);
  await call(owner.token, "DELETE", `/docs/${running}`);
  const standIn = await openNote(oneToOne.id);
  assert.equal(standIn.statusCode, 200, standIn.body);
  assert.ok([prepped.json().id, untouched].includes(standIn.json().id));
  const back = await call(owner.token, "POST", `/docs/${running}/restore`);
  assert.equal(back.statusCode, 200, back.body);
  assert.equal(await noteId(oneToOne.id), running);
  assert.deepEqual(
    (
      await pool.query<{ id: string }>(
        `SELECT id FROM docs WHERE item_id = $1 AND kind = 'meeting'
            AND deleted_at IS NULL ORDER BY id`,
        [oneToOne.id],
      )
    ).rows.map((r) => r.id),
    [running, prepped.json().id, untouched].sort(),
  );

  // A new pattern for the whole series: the class it drops leaves its note
  // behind the series' own.
  const nov = (n: number) =>
    new Date(Date.UTC(2026, 10, 2 + n, 10)).toISOString();
  const tutorial = await event("Tutorial", nov(0), "FREQ=DAILY;COUNT=10");
  const tutorialNote = await noteId(tutorial.id);
  await write(tutorialNote, "Reading list");
  const sixth = await noteId(tutorial.id, nov(4));
  await write(sixth, "Bring the lab book");
  const weekly = await call(
    owner.token,
    "PUT",
    `/items/${tutorial.id}`,
    body(await getItem(tutorial.id), { rrule: "FREQ=WEEKLY;COUNT=5" }),
  );
  assert.equal(weekly.statusCode, 200, weekly.body);
  assert.equal(await noteId(tutorial.id), tutorialNote);
  refs = await refsOf([tutorial.id]);
  assert.equal(
    seriesNoteFor(refs, { item_id: tutorial.id, occurrence: nov(7) })?.doc_id,
    tutorialNote,
  );
  assert.equal(refs.find((r) => r.doc_id === sixth)?.class_was, nov(4));

  // "This and following" to a new pattern: a class neither series has any
  // more leaves its note with the series it was made on, behind that
  // series' own; the new series starts with a note of its own.
  const seminar = await event("Seminar", nov(0), "FREQ=DAILY;COUNT=10");
  const seminarNote = await noteId(seminar.id);
  await write(seminarNote, "Term plan");
  const lost = await noteId(seminar.id, nov(4));
  await write(lost, "Questions for the 6th");
  const split = await call(
    owner.token,
    "PUT",
    `/items/${seminar.id}?scope=following&occurrence=${encodeURIComponent(nov(3))}`,
    body(await getItem(seminar.id), {
      due_at: nov(3),
      end_at: new Date(Date.parse(nov(3)) + hour).toISOString(),
      rrule: "FREQ=WEEKLY;COUNT=3",
    }),
  );
  assert.equal(split.statusCode, 200, split.body);
  const next = split.json();
  assert.notEqual(next.id, seminar.id);
  assert.equal(await noteId(seminar.id), seminarNote);
  const fresh = await openNote(next.id);
  assert.equal(fresh.statusCode, 201, fresh.body);
  assert.ok(![seminarNote, lost].includes(fresh.json().id));
  refs = await refsOf([seminar.id, next.id]);
  const lostRef = refs.find((r) => r.doc_id === lost);
  assert.equal(lostRef?.item_id, seminar.id);
  assert.equal(lostRef?.class_was, nov(4));
  assert.equal(
    seriesNoteFor(refs, { item_id: next.id, occurrence: nov(10) })?.doc_id,
    fresh.json().id,
  );

  // With no note of its own, a series opens the former class's note rather
  // than a fresh page, whichever order the notes come in.
  const ref = (doc_id: string, class_was: string | null = null) => ({
    doc_id,
    title: doc_id,
    item_id: "weekly",
    occurrence: null,
    team_id: null,
    class_was,
  });
  const entry = { item_id: "weekly", occurrence: monday(0) };
  assert.equal(
    seriesNoteFor([ref("former", monday(3)), ref("own")], entry)?.doc_id,
    "own",
  );
  assert.equal(
    eventNoteFor([ref("former", monday(3)), ref("own")], {
      item_id: "weekly",
      rrule: "FREQ=WEEKLY",
    })?.doc_id,
    "own",
  );
  assert.equal(
    seriesNoteFor([ref("former", monday(3))], entry)?.doc_id,
    "former",
  );
});

test("a class split off into an event of its own takes its note along", async () => {
  // A weekly seminar on Mondays at 10:00 in London from 5 October, with no
  // note for the whole series; the 26 October class's note and a later
  // class's are written in.
  const monday = (n: number) =>
    new Date(Date.UTC(2026, 9, 5 + 7 * n, n >= 3 ? 10 : 9)).toISOString();
  const seminar = await event("Seminar", monday(0), "FREQ=WEEKLY;COUNT=6");
  const classNote = await noteId(seminar.id, monday(3));
  await write(classNote, "Questions for the 26th");
  const laterNote = await noteId(seminar.id, monday(4));
  await write(laterNote, "Bring the slides");

  // "This and following" from 26 October, the repeat taken off: that class
  // is now an event on its own.
  const split = await call(
    owner.token,
    "PUT",
    `/items/${seminar.id}?scope=following&occurrence=${encodeURIComponent(monday(3))}`,
    body(await getItem(seminar.id), {
      due_at: monday(3),
      end_at: new Date(Date.parse(monday(3)) + hour).toISOString(),
      rrule: null,
    }),
  );
  assert.equal(split.statusCode, 200, split.body);
  const oneOff = split.json();
  assert.notEqual(oneOff.id, seminar.id);
  assert.equal(oneOff.rrule, null);
  assert.equal(oneOff.due_at, monday(3));

  // Opening it opens the note written for that class, as the event's own.
  const opened = await openNote(oneOff.id);
  assert.equal(opened.statusCode, 200, opened.body);
  assert.equal(opened.json().id, classNote);
  assert.equal(opened.json().occurrence, null);
  let refs = await refsOf([seminar.id, oneOff.id]);
  const own = refs.find((r) => r.doc_id === classNote);
  assert.equal(own?.item_id, oneOff.id);
  assert.equal(own?.class_was, null);
  assert.equal(
    eventNoteFor(refs, { item_id: oneOff.id, rrule: null })?.doc_id,
    classNote,
  );

  // The series it came from (5 to 19 October) doesn't open it; the later
  // class's note stays there, remembering its class, and stands in for the
  // series' note, which it has none of.
  const later = refs.find((r) => r.doc_id === laterNote);
  assert.equal(later?.item_id, seminar.id);
  assert.equal(later?.occurrence, null);
  assert.equal(later?.class_was, monday(4));
  const series = await openNote(seminar.id);
  assert.equal(series.statusCode, 200, series.body);
  assert.equal(series.json().id, laterNote);
  assert.equal(
    seriesNoteFor(refs, { item_id: seminar.id, occurrence: monday(1) })?.doc_id,
    laterNote,
  );

  // Moved to another time in the same edit, the class still takes its note,
  // even one in Trash (bringing it back finds the event).
  const lab = await event("Lab", monday(0), "FREQ=WEEKLY;COUNT=6");
  const labNote = await noteId(lab.id, monday(2));
  await write(labNote, "Safety briefing");
  await call(owner.token, "DELETE", `/docs/${labNote}`);
  const moved = await call(
    owner.token,
    "PUT",
    `/items/${lab.id}?scope=following&occurrence=${encodeURIComponent(monday(2))}`,
    body(await getItem(lab.id), {
      due_at: new Date(Date.parse(monday(2)) + 2 * hour).toISOString(),
      end_at: new Date(Date.parse(monday(2)) + 3 * hour).toISOString(),
      rrule: null,
    }),
  );
  assert.equal(moved.statusCode, 200, moved.body);
  const labOnce = moved.json();
  assert.notEqual(labOnce.id, lab.id);
  const back = await call(owner.token, "POST", `/docs/${labNote}/restore`);
  assert.equal(back.statusCode, 200, back.body);
  refs = await refsOf([lab.id, labOnce.id]);
  assert.equal(refs.find((r) => r.doc_id === labNote)?.item_id, labOnce.id);
  assert.equal(await noteId(labOnce.id), labNote);
  const labSeries = await openNote(lab.id);
  assert.equal(labSeries.statusCode, 201, labSeries.body);
  assert.notEqual(labSeries.json().id, labNote);
});

test("a starter makes a team's page from its events, projects and folders", async () => {
  const event = (
    await call(member.token, "POST", "/items", {
      title: "Team planning",
      kind: "event",
      team_id: team,
      due_at: "2026-10-07T09:00:00.000Z",
      end_at: "2026-10-07T10:00:00.000Z",
    })
  ).json();
  assert.equal(event.team_id, team);
  const project = (
    await call(member.token, "POST", "/projects", {
      name: "Launch",
      team_id: team,
    })
  ).json();
  assert.equal(project.team_id, team);
  const folder = (
    await call(member.token, "POST", "/folders", {
      name: "Meetings",
      team_id: team,
    })
  ).json();
  assert.equal(folder.team_id, team);
  const made = await call(
    member.token,
    "POST",
    "/page-templates/starter:meeting/use",
    {
      team_id: team,
      event_id: event.id,
      project_id: project.id,
      folder_id: folder.id,
      make_tasks: false,
    },
  );
  assert.equal(made.statusCode, 201, made.body);
  const { doc } = made.json();
  assert.equal(doc.team_id, team);
  assert.equal(doc.kind, "meeting");
  assert.equal(doc.item_id, event.id);
  assert.equal(doc.project_id, project.id);
  assert.equal(doc.folder_id, folder.id);
  assert.equal(doc.title, "Team planning · 7 October 2026");
  // The team's event opens this same note.
  const note = await call(owner.token, "POST", `/items/${event.id}/note`);
  assert.equal(note.json().id, doc.id);
  // Everyone on the team can read it; a viewer can't write one.
  assert.equal(
    (await call(viewer.token, "GET", `/docs/${doc.id}`)).statusCode,
    200,
  );
  assert.equal(
    (
      await call(viewer.token, "POST", "/page-templates/starter:lecture/use", {
        team_id: team,
      })
    ).statusCode,
    403,
  );
  // A team's event can't be a personal page's, nor a personal project a
  // team page's.
  assert.equal(
    (
      await call(member.token, "POST", "/page-templates/starter:meeting/use", {
        team_id: null,
        event_id: event.id,
      })
    ).statusCode,
    404,
  );
  const mine = (
    await call(member.token, "POST", "/projects", { name: "Mine only" })
  ).json();
  assert.equal(
    (
      await call(member.token, "POST", "/page-templates/starter:lecture/use", {
        team_id: team,
        project_id: mine.id,
      })
    ).statusCode,
    404,
  );
  // Someone outside the team can't even find it.
  assert.equal(
    (
      await call(
        stranger.token,
        "POST",
        "/page-templates/starter:lecture/use",
        {
          team_id: team,
        },
      )
    ).statusCode,
    404,
  );
});

test("with no event chosen, a meeting page is named for the template", async () => {
  const made = await call(
    owner.token,
    "POST",
    "/page-templates/starter:meeting/use",
    {},
  );
  assert.equal(made.statusCode, 201, made.body);
  assert.equal(made.json().doc.title, `Meeting · ${blankDate(new Date(), TZ)}`);
  assert.equal(made.json().doc.kind, "doc");
});

test("a page saved as a template keeps its folder and tags, and starts fresh", async () => {
  const folder = (
    await call(owner.token, "POST", "/folders", { name: "Lectures" })
  ).json();
  const tag = (
    await call(owner.token, "POST", "/tags", { name: "cs101" })
  ).json();
  const page = (
    await call(owner.token, "POST", "/docs", {
      title: "Week {date}",
      folder_id: folder.id,
      tags: [tag.id],
      content: [
        { type: "paragraph", text: "Topic for {project}", id: "b1" },
        { type: "todo", text: "Read chapter 2", done: true, id: "b2" },
      ],
    })
  ).json();
  const saved = await call(
    owner.token,
    "POST",
    `/page-templates/from-doc/${page.id}`,
    {
      name: "Weekly lecture",
    },
  );
  assert.equal(saved.statusCode, 201, saved.body);
  const t = saved.json();
  assert.equal(t.name, "Weekly lecture");
  assert.equal(t.source, "personal");
  assert.equal(t.can_edit, true);
  assert.equal(t.title, "Week {date}");
  assert.equal(t.folder_id, folder.id);
  assert.equal(t.folder_name, "Lectures");
  assert.deepEqual(
    t.tags.map((g: Json) => g.name),
    ["cs101"],
  );
  assert.deepEqual(t.content, [
    { type: "paragraph", text: "Topic for {project}" },
    { type: "todo", text: "Read chapter 2", done: false },
  ]);

  const used = (
    await call(owner.token, "POST", `/page-templates/${t.id}/use`, {})
  ).json();
  assert.equal(used.doc.title, `Week ${blankDate(new Date(), TZ)}`);
  assert.equal(used.doc.folder_id, folder.id);
  assert.deepEqual(
    used.doc.tags.map((g: Json) => g.name),
    ["cs101"],
  );
  assert.equal(texts(used.doc.content)[0], "Topic for ");
  // A different folder can be chosen instead, or none.
  const unfiled = (
    await call(owner.token, "POST", `/page-templates/${t.id}/use`, {
      folder_id: null,
    })
  ).json();
  assert.equal(unfiled.doc.folder_id, null);

  // Only its maker sees and changes it.
  assert.equal(
    (await call(stranger.token, "POST", `/page-templates/${t.id}/use`, {}))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(stranger.token, "PUT", `/page-templates/${t.id}`, {
        name: "Mine",
      })
    ).statusCode,
    404,
  );
  const renamed = await call(owner.token, "PUT", `/page-templates/${t.id}`, {
    name: "Lecture week",
    tags: [],
    content: [{ type: "todo", text: "Bring {event}", done: true, id: "x" }],
  });
  assert.equal(renamed.statusCode, 200, renamed.body);
  assert.equal(renamed.json().name, "Lecture week");
  assert.deepEqual(renamed.json().tags, []);
  assert.deepEqual(renamed.json().content, [
    { type: "todo", text: "Bring {event}", done: false },
  ]);
  assert.equal(
    (await call(owner.token, "DELETE", `/page-templates/${t.id}`)).statusCode,
    204,
  );
  assert.equal(
    (await call(owner.token, "POST", `/page-templates/${t.id}/use`, {}))
      .statusCode,
    404,
  );
});

test("templates and their pages stay in their own space", async () => {
  const theirFolder = (
    await call(stranger.token, "POST", "/folders", { name: "Theirs" })
  ).json();
  const theirTag = (
    await call(stranger.token, "POST", "/tags", { name: "secret" })
  ).json();
  const theirProject = (
    await call(stranger.token, "POST", "/projects", { name: "Theirs" })
  ).json();
  const base = { name: "Mine", content: [] };
  assert.equal(
    (
      await call(owner.token, "POST", "/page-templates", {
        ...base,
        folder_id: theirFolder.id,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(owner.token, "POST", "/page-templates", {
        ...base,
        tags: [theirTag.id],
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(owner.token, "POST", "/page-templates/starter:essay/use", {
        project_id: theirProject.id,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(owner.token, "POST", "/page-templates/starter:essay/use", {
        folder_id: theirFolder.id,
      })
    ).statusCode,
    404,
  );
  // Bad input is refused, with nothing written; so is an id that isn't one.
  for (const body of [
    { name: "" },
    { name: "x", surprise: true },
    { name: "x", content: [{ type: "nonsense" }] },
  ])
    assert.equal(
      (await call(owner.token, "POST", "/page-templates", body)).statusCode,
      422,
    );
  assert.equal(
    (
      await call(owner.token, "POST", "/page-templates/starter:essay/use", {
        make_tasks: "yes",
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (await call(owner.token, "POST", "/page-templates/not-a-template/use", {}))
      .statusCode,
    422,
  );
  assert.equal(
    (await call(null, "POST", "/page-templates/starter:essay/use", {}))
      .statusCode,
    401,
  );
});

test("a team's templates: members make them, viewers use their own copy", async () => {
  const teamPage = (
    await call(member.token, "POST", "/docs", {
      title: "Stand-up",
      team_id: team,
      content: [{ type: "todo", text: "Say what's blocked", done: false }],
    })
  ).json();
  // A member saves the team's page as the team's template.
  const saved = await call(
    member.token,
    "POST",
    `/page-templates/from-doc/${teamPage.id}`,
    {},
  );
  assert.equal(saved.statusCode, 201, saved.body);
  const t = saved.json();
  assert.equal(t.source, "team");
  assert.equal(t.team_id, team);
  assert.equal(t.team_name, "Page crew");
  // A viewer can't make the team's templates, but may keep a copy of their own.
  assert.equal(
    (
      await call(
        viewer.token,
        "POST",
        `/page-templates/from-doc/${teamPage.id}`,
        {},
      )
    ).statusCode,
    403,
  );
  const copy = await call(
    viewer.token,
    "POST",
    `/page-templates/from-doc/${teamPage.id}`,
    {
      personal: true,
    },
  );
  assert.equal(copy.statusCode, 201, copy.body);
  assert.equal(copy.json().team_id, null);
  // Someone outside the team can't see the page at all.
  assert.equal(
    (
      await call(
        stranger.token,
        "POST",
        `/page-templates/from-doc/${teamPage.id}`,
        {},
      )
    ).statusCode,
    404,
  );

  // Everyone on the team sees it; its maker and the owner may change it.
  const seen = (
    await call(viewer.token, "GET", "/page-templates")
  ).json() as Json[];
  const mine = seen.find((x) => x.id === t.id);
  assert.ok(mine);
  assert.equal(mine.can_edit, false);
  assert.equal(
    (await call(viewer.token, "PUT", `/page-templates/${t.id}`, { name: "No" }))
      .statusCode,
    403,
  );
  assert.equal(
    (await call(viewer.token, "DELETE", `/page-templates/${t.id}`)).statusCode,
    403,
  );
  const byOwner = (
    await call(owner.token, "GET", "/page-templates")
  ).json() as Json[];
  assert.equal(byOwner.find((x) => x.id === t.id)?.can_edit, true);

  // Using it makes a team page; a viewer can't write one.
  const used = await call(
    member.token,
    "POST",
    `/page-templates/${t.id}/use`,
    {},
  );
  assert.equal(used.statusCode, 201, used.body);
  assert.equal(used.json().doc.team_id, team);
  assert.equal(
    (await call(viewer.token, "POST", `/page-templates/${t.id}/use`, {}))
      .statusCode,
    403,
  );
  // ...but can make their own page from it.
  const own = await call(viewer.token, "POST", `/page-templates/${t.id}/use`, {
    team_id: null,
  });
  assert.equal(own.statusCode, 201, own.body);
  assert.equal(own.json().doc.team_id, null);
  assert.equal(
    (await call(owner.token, "DELETE", `/page-templates/${t.id}`)).statusCode,
    204,
  );
});

test("page templates answer 429 past the per-minute limit", async () => {
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  await settings();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  const limitedToken = await freshRateLimitSession(member.token);
  live.rate_limit_per_minute = 2;
  const from = (method: "GET" | "POST", url: string) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${limitedToken}` },
      remoteAddress: "10.72.0.1",
      ...(method === "POST" ? { payload: {} } : {}),
    });
  try {
    assert.equal((await from("GET", "/page-templates")).statusCode, 200);
    assert.equal((await from("GET", "/page-templates")).statusCode, 200);
    const limited = await from("GET", "/page-templates");
    assert.equal(limited.statusCode, 429);
    assert.equal(
      (await from("POST", "/page-templates/starter:meeting/use")).statusCode,
      429,
    );
    assert.equal(
      (await from("GET", `/docs/event-notes?items=${randomUUID()}`)).statusCode,
      429,
    );
  } finally {
    live.rate_limit_per_minute = was;
  }
});
