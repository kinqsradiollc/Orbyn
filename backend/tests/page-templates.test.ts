import { test, before, after } from "node:test";
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
const call = (
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
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
  live.rate_limit_per_minute = 2;
  const from = (method: "GET" | "POST", url: string) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${member.token}` },
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
  } finally {
    live.rate_limit_per_minute = was;
  }
});
