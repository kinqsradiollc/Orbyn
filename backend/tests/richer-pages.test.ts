import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Richer links and pages (D4b), end to end through the API:
 *
 * - links to one line of a page (LNK-04), a line named so a link can point
 *   at it, and a section of a page to embed (LNK-08);
 * - hover cards on links (LNK-07);
 * - "Mentioned without a link" with its one-click Link, and "Related"
 *   (LNK-06); other names for pages and projects (LNK-03);
 * - "Move to new page" and "Merge into…" (ORG-05);
 * - folded headings (EDT-14);
 * - pictures and files in pages, through the file store (EDT-01);
 * - Word, web page and PDF exports of the new kinds of line.
 *
 * Every route refuses without a sign-in (401), a bad body or query
 * (400/422), someone who may only read where a change is asked (403), and
 * answers 429 past the limit.
 */

const dir = await mkdtemp(join(tmpdir(), "orbyn-page-files-test-"));
process.env.FILES_SECRET ??= "test-files-secret-0123456789abcdef";
process.env.FILES_DIR = dir;
process.env.PAGE_FILES_DIR = join(dir, "kept");
process.env.FILES_MIN_FREE_MB = "0";

const { startTestPdfService } = await import("./helpers/pdf-service.js");
const pdfService = await startTestPdfService();
const { readPdf } = await import("../src/modules/imports/pdf.js");
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { sweepPageFiles } =
  await import("../src/modules/page-files/store-routes.js");
const { runSweep } = await import("../src/lib/sweep.js");
const { linkMarkdown } = await import("@orbyn/core");

const app = await buildApp();

type Person = { token: string; email: string; id: string };
let me: Person;
let mate: Person;
let viewer: Person;
let stranger: Person;
let teamId = "";

let address = 0;
const call = (
  who: Person | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    remoteAddress: `10.83.${Math.floor(address / 250) % 250}.${address++ % 250}`,
    headers: who ? { authorization: `Bearer ${who.token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async (name: string): Promise<Person> => {
  const email = `d4b-${randomUUID()}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "a-long-test-password", name },
  });
  const token = res.json().token;
  const id = (
    await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    })
  ).json().id;
  return { token, email, id };
};

const para = (text: string, id?: string) => ({
  type: "paragraph",
  text,
  ...(id ? { id } : {}),
});
const heading = (text: string, id: string, level = 2) => ({
  type: "heading",
  level,
  text,
  id,
});

const page = async (
  who: Person,
  title: string,
  content: unknown[] = [],
  extra = {},
) => (await call(who, "POST", "/docs", { title, content, ...extra })).json();

const read = async (who: Person, id: string) =>
  (await call(who, "GET", `/docs/${id}`)).json();

before(async () => {
  await migrate();
  me = await register("Writer");
  mate = await register("Mate");
  viewer = await register("Watcher");
  stranger = await register("Stranger");
  teamId = (await call(me, "POST", "/teams", { name: "Physics" })).json().id;
  await call(me, "POST", `/teams/${teamId}/members`, {
    email: mate.email,
    role: "member",
  });
  await call(me, "POST", `/teams/${teamId}/members`, {
    email: viewer.email,
    role: "viewer",
  });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pdfService.close();
  await pool.end();
});

test("the new routes need a sign-in (401)", async () => {
  const id = randomUUID();
  for (const [method, url] of [
    ["GET", `/links/card?kind=doc&id=${id}`],
    ["GET", `/links/mentions?kind=doc&id=${id}`],
    ["POST", "/links/mentions/link"],
    ["GET", `/links/related?kind=doc&id=${id}`],
    ["GET", `/links/headings?doc=${id}`],
    ["GET", `/docs/${id}/section`],
    ["POST", `/docs/${id}/anchor`],
    ["POST", `/docs/${id}/extract`],
    ["POST", `/docs/${id}/merge`],
    ["GET", `/docs/${id}/folds`],
    ["PUT", `/docs/${id}/folds`],
    ["PUT", `/docs/${id}/aliases`],
    ["POST", `/docs/${id}/files`],
    ["GET", `/docs/${id}/files`],
    ["GET", `/docs/files/${id}`],
    ["DELETE", `/docs/files/${id}`],
    ["GET", "/files/usage"],
  ] as const)
    assert.equal(
      (await call(null, method, url, method === "GET" ? undefined : {}))
        .statusCode,
      401,
      `${method} ${url}`,
    );
});

test("bad queries and bodies are refused (422), and broken JSON (400)", async () => {
  const doc = await page(me, "Bad input");
  for (const url of [
    "/links/card?kind=folder&id=" + doc.id,
    "/links/card?kind=doc&id=nope",
    `/links/card?kind=doc&id=${doc.id}&block=has space`,
    "/links/mentions?kind=task&id=" + doc.id,
    "/links/headings?doc=nope",
    `/docs/${doc.id}/section?block=${"x".repeat(65)}`,
  ])
    assert.equal((await call(me, "GET", url)).statusCode, 422, url);
  for (const [url, body] of [
    [`/docs/${doc.id}/anchor`, { index: -1, text: "" }],
    [`/docs/${doc.id}/extract`, { block_ids: [], version: 1 }],
    [`/docs/${doc.id}/merge`, { into: "nope", version: 1 }],
    [`/docs/${doc.id}/files`, { name: "", bytes: 10 }],
    ["/links/mentions/link", { doc_id: doc.id }],
  ] as const)
    assert.equal((await call(me, "POST", url, body)).statusCode, 422, url);
  assert.equal(
    (
      await call(me, "PUT", `/docs/${doc.id}/folds`, {
        block_ids: Array.from({ length: 201 }, (_, i) => `b${i}`),
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(me, "PUT", `/docs/${doc.id}/aliases`, {
        aliases: Array.from({ length: 9 }, (_, i) => `name ${i}`),
      })
    ).statusCode,
    422,
  );
  const broken = await app.inject({
    method: "POST",
    url: `/docs/${doc.id}/extract`,
    remoteAddress: "10.83.250.1",
    headers: {
      authorization: `Bearer ${me.token}`,
      "content-type": "application/json",
    },
    payload: '{"block_ids": [',
  });
  assert.equal(broken.statusCode, 400);
});

test("a link to one line is indexed on its page, resolves with the line's words, and names lines", async () => {
  const target = await page(me, "Lecture 6", [
    para("Intro"),
    heading("Raft elections", "b-raft"),
    para("Leaders send heartbeats.", "b-beat"),
    heading("Safety", "b-safe"),
    para("No id here"),
  ]);
  const source = await page(me, "Revision", [
    para(
      `See ${linkMarkdown({ kind: "doc", id: target.id, block: "b-raft" }, "Lecture 6")}`,
      "b-see",
    ),
  ]);
  const here = (
    await call(me, "GET", `/links/here?kind=doc&id=${target.id}`)
  ).json();
  assert.equal(here.count, 1);
  assert.equal(here.items[0].id, source.id);
  const [pill, gone] = (
    await call(
      me,
      "GET",
      `/links/resolve?refs=doc:${target.id}%23b-raft,doc:${target.id}%23b-nope`,
    )
  ).json();
  assert.equal(pill.block, "b-raft");
  assert.equal(pill.block_title, "Raft elections");
  assert.equal(pill.title, "Lecture 6");
  assert.equal(gone.block_title, null);
  // A block ref on anything but a page is not a link.
  assert.equal(
    (await call(me, "GET", `/links/resolve?refs=task:${target.id}%23b1`))
      .statusCode,
    422,
  );

  // [[Lecture 6# offers its headings; with words, lines that say them too.
  const heads = (
    await call(me, "GET", `/links/headings?doc=${target.id}`)
  ).json();
  assert.deepEqual(
    heads.map((h: { text: string }) => h.text),
    ["Raft elections", "Safety"],
  );
  const lines = (
    await call(me, "GET", `/links/headings?doc=${target.id}&q=id%20here`)
  ).json();
  assert.equal(lines[0].text, "No id here");
  assert.equal(lines[0].block_id, null);
  assert.equal(
    (await call(stranger, "GET", `/links/headings?doc=${target.id}`))
      .statusCode,
    404,
  );

  // Naming that line so a link can point at it; a page that moved on says so.
  const named = await call(me, "POST", `/docs/${target.id}/anchor`, {
    index: lines[0].index,
    text: "No id here",
  });
  assert.equal(named.statusCode, 200);
  const after = await read(me, target.id);
  assert.equal(after.content[4].id, named.json().block_id);
  assert.equal(
    (
      await call(me, "POST", `/docs/${target.id}/anchor`, {
        index: 4,
        text: "Something else",
      })
    ).statusCode,
    409,
  );
  // A line that already has a name keeps it.
  assert.equal(
    (
      await call(me, "POST", `/docs/${target.id}/anchor`, {
        index: 1,
        text: "Raft elections",
      })
    ).json().block_id,
    "b-raft",
  );
  assert.equal(
    (
      await call(stranger, "POST", `/docs/${target.id}/anchor`, {
        index: 1,
        text: "Raft elections",
      })
    ).statusCode,
    404,
  );
  // Naming a line isn't a change to its words: a team viewer may, so
  // "Copy link to this line" works for them.
  const shared = await page(me, "Shared lecture", [para("Unnamed")], {
    team_id: teamId,
  });
  const byViewer = await call(viewer, "POST", `/docs/${shared.id}/anchor`, {
    index: 0,
    text: "Unnamed",
  });
  assert.equal(byViewer.statusCode, 200, byViewer.body);
  assert.equal(
    (await read(me, shared.id)).content[0].id,
    byViewer.json().block_id,
  );
});

test("a section embeds live and read-only: a heading's lines, or the page's first lines", async () => {
  const src = await page(
    me,
    "Meeting brief",
    [
      heading("Agenda", "b-agenda"),
      para("Budget"),
      { type: "todo", text: "Book the room", done: false, id: "b-room" },
      heading("Notes", "b-notes"),
      para("Later"),
    ],
    { team_id: teamId },
  );
  const section = (
    await call(viewer, "GET", `/docs/${src.id}/section?block=b-agenda`)
  ).json();
  assert.equal(section.title, "Meeting brief");
  assert.equal(section.blocks.length, 3);
  assert.equal(section.missing, false);
  const whole = (await call(viewer, "GET", `/docs/${src.id}/section`)).json();
  assert.equal(whole.blocks.length, 5);
  const missing = (
    await call(me, "GET", `/docs/${src.id}/section?block=b-gone`)
  ).json();
  assert.equal(missing.missing, true);
  assert.equal(
    (await call(stranger, "GET", `/docs/${src.id}/section`)).statusCode,
    404,
  );
});

test("hover cards: a page, a task with its session, an event with its note, a project", async () => {
  const project = (
    await call(me, "POST", "/projects", {
      name: "Physics 101",
      team_id: teamId,
    })
  ).json();
  const task = (
    await call(me, "POST", "/items", {
      title: "Lab report",
      due_at: "2026-10-02T17:00:00.000Z",
      estimate_minutes: 120,
      team_id: teamId,
    })
  ).json();
  await call(me, "PUT", `/items/${task.id}/project`, {
    project_id: project.id,
  });
  const start = new Date(Date.now() + 86_400_000);
  const blocked = await call(me, "POST", "/blocks", {
    item_id: task.id,
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + 3_600_000).toISOString(),
  });
  assert.equal(blocked.statusCode, 201, blocked.body);
  const card = (
    await call(me, "GET", `/links/card?kind=task&id=${task.id}`)
  ).json();
  assert.equal(card.state, "ok");
  assert.equal(card.title, "Lab report");
  assert.equal(card.done, false);
  assert.equal(card.estimate_minutes, 120);
  assert.equal(card.project.name, "Physics 101");
  assert.equal(card.planned.start_at, start.toISOString());
  assert.equal(card.can_write, true);
  // A teammate sees the task, but not someone else's sessions.
  const theirs = (
    await call(mate, "GET", `/links/card?kind=task&id=${task.id}`)
  ).json();
  assert.equal(theirs.planned, null);
  const viewing = (
    await call(viewer, "GET", `/links/card?kind=task&id=${task.id}`)
  ).json();
  assert.equal(viewing.can_write, false);
  // Someone who can't open it gets nothing about it.
  const hidden = (
    await call(stranger, "GET", `/links/card?kind=task&id=${task.id}`)
  ).json();
  assert.deepEqual(hidden, {
    kind: "task",
    id: task.id,
    state: "missing",
    title: null,
    can_write: false,
  });

  const event = (
    await call(me, "POST", "/items", {
      title: "Lab meeting",
      kind: "event",
      due_at: "2026-10-03T09:00:00.000Z",
      end_at: "2026-10-03T10:00:00.000Z",
      team_id: teamId,
    })
  ).json();
  const noted = await call(me, "POST", `/items/${event.id}/note`, {});
  const eventCard = (
    await call(me, "GET", `/links/card?kind=event&id=${event.id}`)
  ).json();
  assert.equal(eventCard.kind, "event");
  assert.equal(eventCard.start_at, "2026-10-03T09:00:00.000Z");
  assert.equal(eventCard.note_id, noted.json().id);

  const projectCard = (
    await call(me, "GET", `/links/card?kind=project&id=${project.id}`)
  ).json();
  assert.deepEqual(projectCard.progress, { done: 0, total: 1 });
  assert.equal(projectCard.next.title, "Lab report");

  const doc = await page(me, "Card page", [
    heading("Part one", "b-one"),
    para("First words."),
    heading("Part two", "b-two"),
  ]);
  const docCard = (
    await call(me, "GET", `/links/card?kind=doc&id=${doc.id}&block=b-one`)
  ).json();
  assert.equal(docCard.kind_label, "Page");
  assert.equal(docCard.section, "Part one");
  assert.equal(docCard.preview, "Part one First words.");
  await call(me, "DELETE", `/docs/${doc.id}`);
  assert.equal(
    (await call(me, "GET", `/links/card?kind=doc&id=${doc.id}`)).json().state,
    "deleted",
  );
});

test("other names find pages and projects in the switcher and the picker", async () => {
  const doc = await page(me, "Intro to Programming");
  assert.equal(
    (
      await call(viewer, "PUT", `/docs/${doc.id}/aliases`, {
        aliases: ["CS101"],
      })
    ).statusCode,
    404,
  );
  const set = await call(me, "PUT", `/docs/${doc.id}/aliases`, {
    aliases: ["CS101", "cs101", " Programming 1 "],
  });
  assert.deepEqual(set.json().aliases, ["CS101", "Programming 1"]);
  assert.deepEqual((await read(me, doc.id)).aliases, [
    "CS101",
    "Programming 1",
  ]);
  const found = (await call(me, "GET", "/find?q=CS101")).json();
  assert.equal(found[0].id, doc.id);
  assert.equal(found[0].hint, "Also called CS101");
  const picked = (await call(me, "GET", "/links/pick?q=cs10")).json();
  assert.ok(picked.some((o: { id: string }) => o.id === doc.id));
  const searched = (await call(me, "GET", "/search?q=CS101")).json();
  assert.ok(searched.some((h: { id: string }) => h.id === doc.id));

  const project = (
    await call(me, "POST", "/projects", { name: "Operating Systems" })
  ).json();
  const updated = (
    await call(me, "PUT", `/projects/${project.id}`, { aliases: ["COMP3300"] })
  ).json();
  assert.deepEqual(updated.aliases, ["COMP3300"]);
  const hits = (await call(me, "GET", "/find?q=comp3300&type=project")).json();
  assert.equal(hits[0].id, project.id);
  // Not someone else's to find.
  assert.equal(
    (await call(stranger, "GET", "/find?q=COMP3300")).json().length,
    0,
  );
});

test("Mentioned without a link, and its Link button; Related by tags and shared links", async () => {
  const target = await page(me, "Exam 2 plan", [], { team_id: teamId });
  await call(me, "PUT", `/docs/${target.id}/aliases`, { aliases: ["Midterm"] });
  const mentions = await page(
    mate,
    "Week 5",
    [
      para("Code: `Exam 2 plan` is literal", "b-code"),
      para("Remember the midterm on Friday.", "b-mid"),
    ],
    { team_id: teamId },
  );
  await page(mate, "Other", [para("Nothing to see")], { team_id: teamId });
  // A word inside a longer word isn't a mention.
  await page(mate, "Partial", [para("midterms are hard")], { team_id: teamId });
  // A page that links already isn't listed.
  await page(
    mate,
    "Linked",
    [
      para(
        `See ${linkMarkdown({ kind: "doc", id: target.id }, "Exam 2 plan")}`,
      ),
    ],
    { team_id: teamId },
  );
  const secret = await page(stranger, "Mine", [para("Exam 2 plan here")]);
  const list = (
    await call(me, "GET", `/links/mentions?kind=doc&id=${target.id}`)
  ).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].doc_id, mentions.id);
  assert.equal(list[0].block_id, "b-mid");
  assert.equal(list[0].matched, "midterm");
  assert.equal(list[0].context.linked, "midterm");
  assert.equal(list[0].can_link, true);
  assert.ok(!list.some((m: { doc_id: string }) => m.doc_id === secret.id));
  // A viewer sees it but can't make the link.
  const theirs = (
    await call(viewer, "GET", `/links/mentions?kind=doc&id=${target.id}`)
  ).json();
  assert.equal(theirs[0].can_link, false);
  const refused = await call(viewer, "POST", "/links/mentions/link", {
    doc_id: mentions.id,
    block_id: "b-mid",
    matched: "midterm",
    target: { kind: "doc", id: target.id },
  });
  assert.equal(refused.statusCode, 403);
  const linked = await call(me, "POST", "/links/mentions/link", {
    doc_id: mentions.id,
    block_id: "b-mid",
    matched: "midterm",
    target: { kind: "doc", id: target.id },
  });
  assert.equal(linked.statusCode, 200);
  const now = await read(me, mentions.id);
  assert.equal(
    now.content[1].text,
    `Remember the [midterm](orbyn://doc/${target.id}) on Friday.`,
  );
  assert.equal(
    (await call(me, "GET", `/links/mentions?kind=doc&id=${target.id}`)).json()
      .length,
    0,
  );
  // Linking again: the words aren't there as a mention any more.
  assert.equal(
    (
      await call(me, "POST", "/links/mentions/link", {
        doc_id: mentions.id,
        block_id: "b-mid",
        matched: "midterm",
        target: { kind: "doc", id: target.id },
      })
    ).statusCode,
    409,
  );
  // Not a page anyone can link a mention to something they can't open.
  assert.equal(
    (
      await call(me, "POST", "/links/mentions/link", {
        doc_id: mentions.id,
        block_id: "b-code",
        matched: "Exam 2 plan",
        target: { kind: "doc", id: secret.id },
      })
    ).statusCode,
    404,
  );

  // Related: the same tags, and links to the same things.
  const tagged = await page(me, "Tagged A");
  const other = await page(me, "Tagged B");
  await call(me, "POST", `/docs/${tagged.id}/tags`, { names: ["physics"] });
  await call(me, "POST", `/docs/${other.id}/tags`, { names: ["physics"] });
  const related = (
    await call(me, "GET", `/links/related?kind=doc&id=${tagged.id}`)
  ).json();
  assert.ok(
    related.some(
      (r: { doc_id: string; reason: string }) =>
        r.doc_id === other.id && r.reason === "Same tags",
    ),
    JSON.stringify(related),
  );
  assert.equal(
    (await call(stranger, "GET", `/links/related?kind=doc&id=${tagged.id}`))
      .statusCode,
    404,
  );
});

test("Move to new page takes the lines, their comments and task lines, and leaves a link", async () => {
  const doc = await page(me, "Long notes", [
    para("Keep me", "b-keep"),
    heading("Chapter 2", "b-ch2"),
    { type: "todo", text: "Revise chapter 2", done: false, id: "b-todo" },
    para("More of chapter 2", "b-more"),
  ]);
  await call(me, "POST", `/docs/${doc.id}/tasks`, { block_ids: ["b-todo"] });
  const comment = await call(me, "POST", `/docs/${doc.id}/comments`, {
    body: "Good point",
    block_id: "b-more",
    quote: "More of chapter 2",
  });
  assert.equal(comment.statusCode, 201);
  await call(me, "POST", `/docs/${doc.id}/comments`, {
    body: "Agreed",
    parent_id: comment.json().id,
  });
  const current = await read(me, doc.id);
  // Stale version: refused.
  assert.equal(
    (
      await call(me, "POST", `/docs/${doc.id}/extract`, {
        block_ids: ["b-ch2"],
        version: current.version - 1,
      })
    ).statusCode,
    409,
  );
  const moved = await call(me, "POST", `/docs/${doc.id}/extract`, {
    block_ids: ["b-ch2", "b-todo", "b-more"],
    version: current.version,
  });
  assert.equal(moved.statusCode, 201);
  const { doc: made, source } = moved.json();
  assert.equal(made.title, "Chapter 2");
  assert.deepEqual(
    made.content.map((b: { id: string }) => b.id),
    ["b-ch2", "b-todo", "b-more"],
  );
  assert.deepEqual(made.linked_block_ids, ["b-todo"]);
  assert.equal(source.content.length, 2);
  assert.equal(
    source.content[1].text,
    linkMarkdown({ kind: "doc", id: made.id }, "Chapter 2"),
  );
  const comments = (await call(me, "GET", `/docs/${made.id}/comments`)).json();
  assert.equal(comments.length, 2);
  assert.equal(
    (await call(me, "GET", `/docs/${doc.id}/comments`)).json().length,
    0,
  );
  // "Linked here" on the new page shows where it came from.
  assert.equal(
    (await call(me, "GET", `/links/here?kind=doc&id=${made.id}`)).json().count,
    1,
  );
  // A viewer can't move a team page's lines.
  const team = await page(me, "Team page", [para("x", "b-x")], {
    team_id: teamId,
  });
  assert.equal(
    (
      await call(viewer, "POST", `/docs/${team.id}/extract`, {
        block_ids: ["b-x"],
        version: team.version,
      })
    ).statusCode,
    403,
  );
  // Lines that aren't there: nothing to move.
  assert.equal(
    (
      await call(me, "POST", `/docs/${team.id}/extract`, {
        block_ids: ["b-nope"],
        version: team.version,
      })
    ).statusCode,
    409,
  );
});

test("Merge into… moves the lines, relinks pages, goes to Trash, and old links open the other", async () => {
  const into = await page(me, "Course notes", [para("Week 1", "b-w1")]);
  const from = await page(me, "Week 2", [
    para("Week 2 words", "b-w1"),
    { type: "todo", text: "Do the reading", done: false, id: "b-read" },
  ]);
  await call(me, "POST", `/docs/${from.id}/tasks`, { block_ids: ["b-read"] });
  const pointer = await page(me, "Index", [
    para(
      `Go to ${linkMarkdown({ kind: "doc", id: from.id, block: "b-read" }, "Week 2")}`,
    ),
  ]);
  const renamedLink = await page(me, "Pointer to a renamed line", [
    para(
      `See ${linkMarkdown({ kind: "doc", id: from.id, block: "b-w1" }, "Week 2 words")}`,
    ),
  ]);
  const personal = await page(me, "Elsewhere");
  const team = await page(me, "Team notes", [], { team_id: teamId });
  assert.equal(
    (
      await call(me, "POST", `/docs/${personal.id}/merge`, {
        into: team.id,
        version: personal.version,
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(me, "POST", `/docs/${from.id}/merge`, {
        into: from.id,
        version: from.version,
      })
    ).statusCode,
    400,
  );
  const fresh = await read(me, from.id);
  const merged = await call(me, "POST", `/docs/${from.id}/merge`, {
    into: into.id,
    version: fresh.version,
  });
  assert.equal(merged.statusCode, 200, merged.body);
  assert.equal(merged.json().relinked, 2);
  const doc = merged.json().doc;
  assert.deepEqual(
    doc.content.map((b: { text: string }) => b.text),
    ["Week 1", "Week 2", "Week 2 words", "Do the reading"],
  );
  // The line whose name the page already used got a new one; the task
  // line kept its name and its task.
  assert.notEqual(doc.content[2].id, "b-w1");
  assert.deepEqual(doc.linked_block_ids, ["b-read"]);
  assert.equal((await call(me, "GET", `/docs/${from.id}`)).statusCode, 404);
  const relinked = await read(me, pointer.id);
  assert.ok(relinked.content[0].text.includes(`orbyn://doc/${into.id}#b-read`));
  // A link to a line that had to be renamed follows the new name, not the
  // other page's own line of the old name; the page keeps its history.
  const toRenamed = await read(me, renamedLink.id);
  assert.ok(
    toRenamed.content[0].text.includes(
      `orbyn://doc/${into.id}#${doc.content[2].id})`,
    ),
    toRenamed.content[0].text,
  );
  assert.equal(
    (
      await pool.query("SELECT 1 FROM doc_versions WHERE doc_id = $1", [
        renamedLink.id,
      ])
    ).rowCount,
    1,
  );
  // A hover card on an old link shows the page it went into.
  const card = (
    await call(me, "GET", `/links/card?kind=doc&id=${from.id}`)
  ).json();
  assert.equal(card.state, "ok");
  assert.equal(card.id, into.id);
  assert.equal(card.moved_from, from.id);
  assert.equal(card.title, "Course notes");
  const [pill] = (
    await call(me, "GET", `/links/resolve?refs=doc:${from.id}`)
  ).json();
  assert.equal(pill.moved_to, into.id);
  assert.equal(pill.title, "Course notes");
  // Brought back from Trash, it's its own page again.
  await call(me, "POST", `/docs/${from.id}/restore`);
  const [back] = (
    await call(me, "GET", `/links/resolve?refs=doc:${from.id}`)
  ).json();
  assert.equal(back.moved_to, undefined);
  assert.equal(back.title, "Week 2");
});

test("folded headings are each person's own, on every device", async () => {
  const doc = await page(
    me,
    "Folding",
    [heading("A", "b-a"), para("under a")],
    { team_id: teamId },
  );
  assert.deepEqual(
    (await call(me, "GET", `/docs/${doc.id}/folds`)).json().block_ids,
    [],
  );
  const set = await call(me, "PUT", `/docs/${doc.id}/folds`, {
    block_ids: ["b-a", "b-a"],
  });
  assert.deepEqual(set.json().block_ids, ["b-a"]);
  assert.deepEqual(
    (await call(me, "GET", `/docs/${doc.id}/folds`)).json().block_ids,
    ["b-a"],
  );
  // A viewer may fold for themselves; it isn't anyone else's.
  assert.equal(
    (await call(viewer, "PUT", `/docs/${doc.id}/folds`, { block_ids: [] }))
      .statusCode,
    200,
  );
  assert.deepEqual(
    (await call(mate, "GET", `/docs/${doc.id}/folds`)).json().block_ids,
    [],
  );
  assert.equal(
    (await call(stranger, "GET", `/docs/${doc.id}/folds`)).statusCode,
    404,
  );
  await call(me, "PUT", `/docs/${doc.id}/folds`, { block_ids: [] });
  assert.deepEqual(
    (await call(me, "GET", `/docs/${doc.id}/folds`)).json().block_ids,
    [],
  );
});

/** The smallest PNG there is: one transparent pixel. */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

const upload = (path: string, body: Buffer, type = "image/png") =>
  app.inject({
    method: "PUT",
    url: path,
    remoteAddress: `10.83.251.${address++ % 250}`,
    headers: { "content-type": type, "content-length": String(body.length) },
    payload: body,
  });

test("pictures in pages: an upload link used once, a short-lived link to show it, a quota", async () => {
  const doc = await page(me, "With a picture", [], { team_id: teamId });
  // A viewer can't add to a team page; a stranger can't find it.
  assert.equal(
    (
      await call(viewer, "POST", `/docs/${doc.id}/files`, {
        name: "x.png",
        bytes: PNG.length,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(stranger, "POST", `/docs/${doc.id}/files`, {
        name: "x.png",
        bytes: PNG.length,
      })
    ).statusCode,
    404,
  );
  // Only pictures and a few kinds of file.
  assert.equal(
    (
      await call(me, "POST", `/docs/${doc.id}/files`, {
        name: "script.exe",
        bytes: 10,
      })
    ).statusCode,
    415,
  );
  const made = await call(me, "POST", `/docs/${doc.id}/files`, {
    name: "diagram.png",
    bytes: PNG.length,
    width: 1,
    height: 1,
  });
  assert.equal(made.statusCode, 201);
  const { file, upload_path } = made.json();
  assert.equal(file.kind, "image");
  assert.equal(file.status, "waiting");
  // Not ready yet.
  assert.equal(
    (await call(me, "GET", `/docs/files/${file.id}`)).statusCode,
    409,
  );
  // A forged link is refused.
  assert.equal(
    (await upload(upload_path.replace(/.$/, "x"), PNG)).statusCode,
    403,
  );
  const sent = await upload(upload_path, PNG);
  assert.equal(sent.statusCode, 201, sent.body);
  // The link works once.
  assert.equal((await upload(upload_path, PNG)).statusCode, 409);
  // A teammate who can read the page can show it.
  const link = await call(viewer, "GET", `/docs/files/${file.id}`);
  assert.equal(link.statusCode, 200);
  assert.equal(link.json().file.status, "ready");
  const shown = await app.inject({
    method: "GET",
    url: link.json().url_path,
    remoteAddress: "10.83.252.1",
  });
  assert.equal(shown.statusCode, 200);
  assert.equal(shown.headers["content-type"], "image/png");
  assert.match(String(shown.headers["content-disposition"]), /^inline;/);
  assert.deepEqual(shown.rawPayload, PNG);
  // A read link is not an upload link, and a bad one says it expired.
  assert.equal(
    (await upload(link.json().url_path.replace("/files/r/", "/files/p/"), PNG))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/files/r/not.a-link",
        remoteAddress: "10.83.252.2",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call(stranger, "GET", `/docs/files/${file.id}`)).statusCode,
    404,
  );
  assert.equal(
    (await call(me, "GET", `/docs/${doc.id}/files`)).json().length,
    1,
  );

  // A file that isn't what its name says is refused.
  const liar = (
    await call(me, "POST", `/docs/${doc.id}/files`, {
      name: "notes.pdf",
      bytes: PNG.length,
    })
  ).json();
  assert.equal(
    (await upload(liar.upload_path, PNG, "application/pdf")).statusCode,
    415,
  );

  // Only what was kept counts against the space: not the refused file.
  const usage = (await call(me, "GET", "/files/usage")).json();
  assert.equal(usage.used_bytes, PNG.length);
  assert.ok(usage.quota_bytes > 0);
  // One file over the size limit, or over the space left: refused before
  // anything is sent.
  assert.equal(
    (
      await call(me, "POST", `/docs/${doc.id}/files`, {
        name: "big.png",
        bytes: 100 * 1024 * 1024,
      })
    ).statusCode,
    413,
  );
  const filler = (
    await pool.query<{ id: string }>(
      `INSERT INTO page_files (user_id, doc_id, name, mime, kind, bytes, status)
       VALUES ($1, $2, 'filler.pdf', 'application/pdf', 'file', $3, 'ready')
       RETURNING id`,
      [me.id, doc.id, usage.quota_bytes - PNG.length],
    )
  ).rows[0].id;
  const full = await call(me, "POST", `/docs/${doc.id}/files`, {
    name: "one-more.png",
    bytes: PNG.length + 1,
  });
  assert.equal(full.statusCode, 413);
  assert.match(full.json().message, /space for pictures and files is full/);
  await pool.query("DELETE FROM page_files WHERE id = $1", [filler]);
  // A viewer can't delete it; the writer can.
  assert.equal(
    (await call(viewer, "DELETE", `/docs/files/${file.id}`)).statusCode,
    403,
  );
  assert.equal(
    (await call(me, "DELETE", `/docs/files/${file.id}`)).statusCode,
    204,
  );
  assert.equal(
    (await call(me, "GET", `/docs/files/${file.id}`)).statusCode,
    404,
  );
  // The file store lets its bytes go once the row has gone (after a grace).
  const kept = join(dir, "kept");
  const orphan = randomUUID();
  await writeFile(join(kept, `${orphan}.bin`), "x");
  await writeFile(join(kept, `${orphan}.key`), "{}");
  const { utimes } = await import("node:fs/promises");
  const old = new Date(Date.now() - 3_600_000);
  for (const name of [
    `${orphan}.bin`,
    `${orphan}.key`,
    `${file.id}.bin`,
    `${file.id}.key`,
  ])
    await utimes(join(kept, name), old, old).catch(() => {});
  assert.ok((await sweepPageFiles()) >= 1);
  const left = await readdir(kept);
  assert.ok(!left.some((n) => n.startsWith(orphan)));
  assert.ok(!left.some((n) => n.startsWith(file.id)));
});

test("a page deleted for good lets its files go at the next sweep", async () => {
  const doc = await page(me, "Short-lived");
  const made = (
    await call(me, "POST", `/docs/${doc.id}/files`, {
      name: "a.png",
      bytes: PNG.length,
    })
  ).json();
  await upload(made.upload_path, PNG);
  await call(me, "DELETE", `/docs/${doc.id}`);
  await call(me, "DELETE", `/docs/${doc.id}/forever`);
  const row = await pool.query("SELECT doc_id FROM page_files WHERE id = $1", [
    made.file.id,
  ]);
  assert.equal(row.rows[0].doc_id, null);
  await runSweep();
  assert.equal(
    (await pool.query("SELECT 1 FROM page_files WHERE id = $1", [made.file.id]))
      .rowCount,
    0,
  );
});

/** A picture uploaded to a page, ready to show. */
const picture = async (who: Person, docId: string, name = "p.png") => {
  const made = (
    await call(who, "POST", `/docs/${docId}/files`, {
      name,
      bytes: PNG.length,
    })
  ).json();
  assert.equal((await upload(made.upload_path, PNG)).statusCode, 201);
  return made.file.id as string;
};
const image = (file: string, id: string) => ({
  type: "image",
  file,
  text: "",
  id,
});
const save = async (who: Person, id: string, content: unknown[]) => {
  const now = await read(who, id);
  const res = await call(who, "PUT", `/docs/${id}`, {
    content,
    version: now.version,
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
};
const owner = async (file: string) =>
  (
    await pool.query<{ doc_id: string | null }>(
      "SELECT doc_id FROM page_files WHERE id = $1",
      [file],
    )
  ).rows[0]?.doc_id;
const listed = async (who: Person, docId: string) =>
  (await call(who, "GET", `/docs/${docId}/files`))
    .json()
    .map((f: { id: string }) => f.id);

test("pictures go with their lines when moved or merged, and still show where pasted", async () => {
  const src = await page(me, "Photos");
  const one = await picture(me, src.id, "one.png");
  const two = await picture(me, src.id, "two.png");
  await save(me, src.id, [
    para("Intro", "b-intro"),
    image(one, "b-one"),
    image(two, "b-two"),
  ]);

  // Move to new page: the picture belongs to the new page, so trashing
  // the old one doesn't break it.
  const fresh = await read(me, src.id);
  const moved = (
    await call(me, "POST", `/docs/${src.id}/extract`, {
      block_ids: ["b-one"],
      version: fresh.version,
    })
  ).json().doc;
  assert.equal(await owner(one), moved.id);
  assert.equal(await owner(two), src.id);
  assert.deepEqual(await listed(me, moved.id), [one]);
  assert.equal((await call(me, "DELETE", `/docs/${src.id}`)).statusCode, 204);
  assert.equal((await call(me, "GET", `/docs/files/${one}`)).statusCode, 200);
  // A picture pasted into another page shows there, though the page it
  // was added to is in Trash; someone who can't read either still can't.
  const pasted = await page(me, "Pasted into", [image(two, "b-copy")]);
  assert.equal((await call(me, "GET", `/docs/files/${two}`)).statusCode, 200);
  assert.deepEqual(await listed(me, pasted.id), [two]);
  assert.equal(
    (await call(stranger, "GET", `/docs/files/${two}`)).statusCode,
    404,
  );
  // Deleted for good, the page it was added to lets go; the paste keeps it.
  await call(me, "DELETE", `/docs/${src.id}/forever`);
  await runSweep();
  assert.equal((await call(me, "GET", `/docs/files/${two}`)).statusCode, 200);

  // Merge into…: the merged page's pictures belong to the page it went
  // into, and show there although the merged page is in Trash.
  const week = await page(me, "Week 3");
  const three = await picture(me, week.id, "three.png");
  const merged = await save(me, week.id, [image(three, "b-three")]);
  const into = await page(me, "Term notes", [para("Week 1", "b-t1")]);
  const res = await call(me, "POST", `/docs/${week.id}/merge`, {
    into: into.id,
    version: merged.version,
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(await owner(three), into.id);
  assert.equal((await call(me, "GET", `/docs/files/${three}`)).statusCode, 200);
  assert.deepEqual(await listed(me, into.id), [three]);
});

test("a picture no page shows any more frees its space 30 days later", async () => {
  const doc = await page(me, "Tidy");
  const file = await picture(me, doc.id);
  await save(me, doc.id, [image(file, "b-pic")]);
  const unused = async () =>
    (
      await pool.query<{ unused_since: Date | null }>(
        "SELECT unused_since FROM page_files WHERE id = $1",
        [file],
      )
    ).rows[0]?.unused_since;
  assert.equal(await unused(), null);
  // Its line removed: marked, but kept for undo and history.
  await save(me, doc.id, [para("No picture now")]);
  assert.ok(await unused());
  await runSweep();
  assert.equal(await owner(file), doc.id);
  // Put back (undo): in use again.
  await save(me, doc.id, [image(file, "b-pic")]);
  assert.equal(await unused(), null);
  await save(me, doc.id, [para("Gone again")]);
  const before = (await call(me, "GET", "/files/usage")).json().used_bytes;
  await pool.query(
    "UPDATE page_files SET unused_since = now() - interval '31 days' WHERE id = $1",
    [file],
  );
  await runSweep();
  assert.equal(await owner(file), undefined);
  assert.equal(
    (await call(me, "GET", "/files/usage")).json().used_bytes,
    before - PNG.length,
  );
  // Removed at once from the page's Files, by whoever can change a page
  // showing it; a viewer can't.
  const team = await page(me, "Team pictures", [], { team_id: teamId });
  const shared = await picture(me, team.id);
  await save(me, team.id, [image(shared, "b-s")]);
  assert.equal(
    (await call(viewer, "DELETE", `/docs/files/${shared}`)).statusCode,
    403,
  );
  assert.equal(
    (await call(mate, "DELETE", `/docs/files/${shared}`)).statusCode,
    204,
  );
});

test("a file's id alone gives nothing: a paste links only what you can read, and only its page deletes it", async () => {
  const team = await page(me, "Team album", [], { team_id: teamId });
  const shared = await picture(me, team.id, "album.png");
  await save(me, team.id, [image(shared, "b-album")]);

  // Someone outside the team who got hold of the id pastes it into their
  // own page: the page saves, but the file isn't theirs to see or delete.
  const stolen = await page(stranger, "Mine now", [image(shared, "b-x")]);
  await save(stranger, stolen.id, [image(shared, "b-x"), para("again")]);
  assert.deepEqual(await listed(stranger, stolen.id), []);
  assert.equal(
    (await call(stranger, "GET", `/docs/files/${shared}`)).statusCode,
    404,
  );
  assert.equal(
    (await call(stranger, "DELETE", `/docs/files/${shared}`)).statusCode,
    404,
  );

  // A team viewer may read it, so a paste into their own page shows it
  // there, but deleting it is still only for the team page's writers or
  // its uploader; removing the line is theirs.
  const mine = await page(viewer, "Viewer's copy", [image(shared, "b-v")]);
  assert.deepEqual(await listed(viewer, mine.id), [shared]);
  assert.equal(
    (await call(viewer, "DELETE", `/docs/files/${shared}`)).statusCode,
    403,
  );
  assert.equal(
    (await call(me, "GET", `/docs/files/${shared}`)).statusCode,
    200,
  );
  assert.deepEqual(await listed(me, team.id), [shared]);

  // Someone who leaves the team loses it, pasted copy or not, and can't
  // get it back by pasting the id again.
  const leaver = await register("Leaver");
  await call(me, "POST", `/teams/${teamId}/members`, {
    email: leaver.email,
    role: "member",
  });
  assert.equal(
    (await call(leaver, "GET", `/docs/files/${shared}`)).statusCode,
    200,
  );
  const kept = await page(leaver, "Kept a copy", [image(shared, "b-k")]);
  assert.deepEqual(await listed(leaver, kept.id), [shared]);
  assert.equal(
    (await call(me, "DELETE", `/teams/${teamId}/members/${leaver.id}`))
      .statusCode,
    204,
  );
  assert.equal(
    (await call(leaver, "GET", `/docs/files/${shared}`)).statusCode,
    404,
  );
  await save(leaver, kept.id, [image(shared, "b-k"), para("still here?")]);
  assert.deepEqual(await listed(leaver, kept.id), []);
  assert.equal(
    (await call(leaver, "GET", `/docs/files/${shared}`)).statusCode,
    404,
  );
  assert.equal(
    (await call(leaver, "DELETE", `/docs/files/${shared}`)).statusCode,
    404,
  );
  // The team page still shows it; its writers and uploader may delete it.
  assert.equal(
    (await call(mate, "GET", `/docs/files/${shared}`)).statusCode,
    200,
  );
  assert.equal(
    (await call(mate, "DELETE", `/docs/files/${shared}`)).statusCode,
    204,
  );
});

test("uploads at the same time can't together go over the space", async () => {
  const doc = await page(me, "Racing");
  const quota = (await call(me, "GET", "/files/usage")).json();
  // Room for exactly one more picture.
  const filler = (
    await pool.query<{ id: string }>(
      `INSERT INTO page_files (user_id, doc_id, name, mime, kind, bytes, status)
       VALUES ($1, $2, 'filler.pdf', 'application/pdf', 'file', $3, 'ready')
       RETURNING id`,
      [me.id, doc.id, quota.quota_bytes - quota.used_bytes - PNG.length],
    )
  ).rows[0].id;
  try {
    const codes = (
      await Promise.all(
        Array.from({ length: 4 }, (_, n) =>
          call(me, "POST", `/docs/${doc.id}/files`, {
            name: `race-${n}.png`,
            bytes: PNG.length,
          }),
        ),
      )
    ).map((r) => r.statusCode);
    assert.equal(codes.filter((c) => c === 201).length, 1, String(codes));
    assert.equal(codes.filter((c) => c === 413).length, 3);
  } finally {
    await pool.query("DELETE FROM page_files WHERE doc_id = $1 OR id = $2", [
      doc.id,
      filler,
    ]);
  }
});

test("exports carry tables, callouts, footnotes and pictures' captions", async () => {
  const doc = await page(me, "Export me", [
    para("A claim[^1] and ~~an old one~~ and =={green}a key idea=="),
    {
      type: "table",
      text: "| Term | Meaning |\n| --- | --- |\n| CAP | Consistency |",
    },
    { type: "callout", kind: "tip", text: "Start early" },
    { type: "image", file: randomUUID(), text: "The diagram" },
    { type: "footnote", label: "1", text: "Source: the lecture." },
  ]);
  const html = await call(me, "GET", `/docs/${doc.id}/export?format=html`);
  assert.match(html.body, /<table>.*<th>Term<\/th>/s);
  assert.match(html.body, /<blockquote class="c tip"><strong>Tip<\/strong>/);
  assert.match(html.body, /<s>an old one<\/s>/);
  assert.match(html.body, /<mark class="green">a key idea<\/mark>/);
  assert.match(html.body, /<sup><a href="#fn-1">1<\/a><\/sup>/);
  assert.match(
    html.body,
    /<li id="fn-1" value="1">Source: the lecture\.<\/li>/,
  );
  assert.match(html.body, /Picture: The diagram/);
  const docx = await call(me, "GET", `/docs/${doc.id}/export?format=docx`);
  assert.equal(docx.statusCode, 200);
  // Word's own footnotes: a part of their own, referenced from the text.
  const raw = docx.rawPayload.toString("latin1");
  assert.ok(raw.includes("word/footnotes.xml"));
  const md = await call(me, "GET", `/docs/${doc.id}/export?format=md`);
  assert.match(md.body, /\| Term \| Meaning \|/);
  assert.match(md.body, /> \[!tip\] Start early/);
  assert.match(md.body, /\[\^1\]: Source: the lecture\./);
  const pdf = await call(me, "GET", `/docs/${doc.id}/export?format=pdf`);
  assert.equal(pdf.statusCode, 200);
  const pages = await readPdf(pdf.rawPayload, 20);
  const text = pages
    .flatMap((page) => page.text.spans.map((span) => span.text))
    .join(" ");
  assert.match(text, /Tip\s+Start early/);
  assert.match(text, /Consistency/);
  assert.match(text, /Source: the lecture/);
  assert.match(text, /Picture: The diagram/);
});

test("the new routes answer 429 past the per-minute limit", async () => {
  const doc = await page(me, "Limited");
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  await settings();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  live.rate_limit_per_minute = 2;
  const from = () =>
    app.inject({
      method: "GET",
      url: `/links/card?kind=doc&id=${doc.id}`,
      remoteAddress: "10.83.253.9",
      headers: { authorization: `Bearer ${me.token}` },
    });
  try {
    assert.equal((await from()).statusCode, 200);
    assert.equal((await from()).statusCode, 200);
    assert.equal((await from()).statusCode, 429);
  } finally {
    live.rate_limit_per_minute = was;
  }
});
