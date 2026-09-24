import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Sharing into Orbyn (CAP-01): a link or some text from another app's share
 * sheet, sent to an Inbox task "Read: <title>", today's agenda, a page, a
 * new page in a folder, or a project; and the link's title, looked up on
 * the server through netguard (the network is stood in for here).
 */
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { outbound } = await import("../src/lib/netguard.js");
const {
  AGENDA_NOTES_ID,
  addToAgendaNotes,
  captureBlocks,
  capturePageTitle,
  captureTask,
  choiceLabel,
  readChoices,
  readLinkPreview,
  readShared,
  readingTitle,
  rememberChoice,
  siteOf,
} = await import("@orbyn/core");
type DocBlock = import("@orbyn/core").DocBlock;
type ShareChoice = import("@orbyn/core").ShareChoice;

const app = await buildApp();
type Json = Record<string, any>;
let caller = 0;
const address = () => `10.74.${Math.floor(++caller / 250)}.${caller % 250}`;
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

async function newUser(name: string) {
  const r = await call(null, "POST", "/auth/register", {
    email: `share-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name,
  });
  const token = r.json().token as string;
  await call(token, "PUT", "/planner/prefs", { timezone: "Europe/London" });
  return { token, id: r.json().user.id as string };
}

let owner: { token: string; id: string };
let member: { token: string; id: string };
let viewer: { token: string; id: string };
let stranger: { token: string; id: string };
let team = "";

/** What the stand-in web answers, by address. */
const pages = new Map<
  string,
  { status?: number; type?: string; body?: string; location?: string }
>();
const asked: string[] = [];
const realRequest = outbound.request;

before(async () => {
  await migrate();
  owner = await newUser("Owner");
  member = await newUser("Member");
  viewer = await newUser("Viewer");
  stranger = await newUser("Stranger");
  team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Share crew', $1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO team_members (team_id, user_id, role)
     VALUES ($1,$2,'owner'),($1,$3,'member'),($1,$4,'viewer')`,
    [team, owner.id, member.id, viewer.id],
  );
  // Nothing leaves the machine: the checked address is answered from above.
  outbound.request = (async (checked) => {
    const href = checked.url.toString();
    asked.push(href);
    const page = pages.get(href);
    if (!page) throw new Error("offline");
    return new Response(page.body ?? "", {
      status: page.status ?? 200,
      headers: {
        "content-type": page.type ?? "text/html; charset=utf-8",
        ...(page.location ? { location: page.location } : {}),
      },
    });
  }) as typeof outbound.request;
});
after(async () => {
  outbound.request = realRequest;
  await app.close();
  await pool.end();
});

const ARTICLE = "https://93.184.216.34/articles/tides";
pages.set(ARTICLE, {
  body: `<!doctype html><html><head>
    <meta property="og:site_name" content="The Sea &amp; Sky">
    <meta property="og:title" content="How tides   work &#8212; a guide">
    <title>Ignored</title></head><body>…</body></html>`,
});

// ------------------------------------------------------------ the words ---

test("what another app shares is read into a link and its words", () => {
  assert.deepEqual(readShared([{ url: " https://example.com/a " }]), {
    url: "https://example.com/a",
    text: "",
  });
  // A post shares text with the link inside it; the link isn't kept twice.
  assert.deepEqual(
    readShared([
      { text: "Worth a read: https://example.com/post?id=4. Thoughts?" },
    ]),
    { url: "https://example.com/post?id=4", text: "Worth a read: . Thoughts?" },
  );
  // A browser can share the page's title as text beside the link.
  assert.deepEqual(
    readShared([
      { text: "Tides explained" },
      { url: "https://example.com/tides" },
    ]),
    { url: "https://example.com/tides", text: "Tides explained" },
  );
  assert.deepEqual(readShared([{ text: "Just words\nand more" }]), {
    url: null,
    text: "Just words\nand more",
  });
  // Something that isn't a web address is words, not a link.
  assert.equal(readShared([{ url: "ftp://example.com/x" }]).url, null);
  assert.equal(siteOf("https://www.bbc.co.uk/news/1"), "bbc.co.uk");
  assert.equal(siteOf("not a link"), "");
});

test("a page's title and site are read from its HTML", () => {
  assert.deepEqual(readLinkPreview(pages.get(ARTICLE)!.body!, ARTICLE), {
    title: "How tides work — a guide",
    site: "The Sea & Sky",
  });
  assert.deepEqual(
    readLinkPreview(
      "<html><head><title>\n  Plain &lt;title&gt;\n</title></head>",
      "https://www.example.com/x",
    ),
    { title: "Plain <title>", site: "example.com" },
  );
  assert.deepEqual(
    readLinkPreview(
      `<meta content='Twitter words' name='twitter:title'>`,
      "https://example.com",
    ),
    { title: "Twitter words", site: "example.com" },
  );
  assert.deepEqual(readLinkPreview("<p>no head</p>", "https://a.io/b"), {
    title: null,
    site: "a.io",
  });
});

test("a share becomes a task, lines on a page, or a new page", () => {
  const link = {
    url: "https://example.com/tides",
    title: "Tides [part 1]",
    text: "For Friday",
  };
  assert.deepEqual(captureTask(link), {
    title: "Read: Tides [part 1]",
    notes: "For Friday",
    links: [{ url: "https://example.com/tides", title: "Tides [part 1]" }],
  });
  // No title: the site stands in.
  assert.equal(
    readingTitle(null, "https://www.example.com/x"),
    "Read: example.com",
  );
  assert.equal(readingTitle("  A\n title ", "https://x.io"), "Read: A title");
  assert.equal(readingTitle("x".repeat(300), "https://x.io").length, 200);
  // Text alone: its first line is the title and the rest are notes.
  assert.deepEqual(
    captureTask({
      url: null,
      title: null,
      text: "\nCall the dentist\nBefore 5",
    }),
    { title: "Call the dentist", notes: "Before 5", links: [] },
  );
  const long = "word ".repeat(80).trim();
  const fromLong = captureTask({ url: null, title: null, text: long });
  assert.equal(fromLong.title.length, 200);
  assert.equal(fromLong.notes, long, "a clipped title keeps its words");
  // On a page the link is written as a link, its brackets taken out.
  assert.deepEqual(captureBlocks(link), [
    {
      type: "paragraph",
      text: "[Tides part 1](https://example.com/tides)",
    },
    { type: "paragraph", text: "For Friday" },
  ]);
  assert.deepEqual(
    captureBlocks(
      { url: "https://example.com/a(b)", title: null, text: "" },
      true,
    ),
    [{ type: "bullet", text: "[example.com](https://example.com/a%28b%29)" }],
  );
  assert.equal(capturePageTitle(link), "Tides [part 1]");
  assert.equal(
    capturePageTitle({ url: null, title: null, text: "\n Idea: tidy\nmore" }),
    "Idea: tidy",
  );
});

test("an agenda takes shared lines at the end of its Notes", () => {
  const notes: DocBlock = {
    type: "heading",
    level: 2,
    text: "Notes",
    id: AGENDA_NOTES_ID,
  };
  const page: DocBlock[] = [
    { type: "heading", level: 2, text: "Schedule" },
    { type: "bullet", text: "09:00 · Lecture" },
    notes,
    { type: "bullet", text: "Mine" },
    { type: "paragraph", text: "" },
    { type: "heading", level: 2, text: "End of day" },
    { type: "bullet", text: "What went well: " },
  ];
  const added: DocBlock[] = [{ type: "bullet", text: "Shared" }];
  assert.deepEqual(addToAgendaNotes(page, added), [
    ...page.slice(0, 4),
    ...added,
    ...page.slice(4),
  ]);
  // Notes at the very end.
  assert.deepEqual(addToAgendaNotes([notes], added), [notes, ...added]);
  // A page that lost its Notes gets them back, with the lines under them.
  assert.deepEqual(addToAgendaNotes(page.slice(0, 2), added), [
    ...page.slice(0, 2),
    notes,
    ...added,
  ]);
});

test("the last three destinations are remembered, newest first", () => {
  const page = (id: string, label: string): ShareChoice => ({
    kind: "page",
    id,
    label,
  });
  const a = randomUUID();
  const b = randomUUID();
  let kept: ShareChoice[] = [];
  kept = rememberChoice(kept, { kind: "inbox" });
  kept = rememberChoice(kept, page(a, "Reading list"));
  kept = rememberChoice(kept, { kind: "agenda" });
  kept = rememberChoice(kept, page(a, "Reading list"));
  assert.deepEqual(kept, [
    page(a, "Reading list"),
    { kind: "agenda" },
    { kind: "inbox" },
  ]);
  kept = rememberChoice(kept, { kind: "project", id: b, label: "Physics 101" });
  assert.equal(kept.length, 3);
  assert.deepEqual(readChoices(JSON.stringify(kept)), kept);
  // Whatever can't be read is left out, not trusted.
  assert.deepEqual(
    readChoices(
      JSON.stringify([
        { kind: "page", id: "nope", label: "x" },
        { kind: "new_page", id: null, label: "Unfiled" },
        { kind: "drop tables" },
        "inbox",
      ]),
    ),
    [{ kind: "new_page", id: null, label: "Unfiled" }],
  );
  assert.deepEqual(readChoices("{broken"), []);
  assert.deepEqual(readChoices(null), []);
  assert.equal(
    choiceLabel({ kind: "new_page", id: null, label: "Reading" }),
    "New page in Reading",
  );
  assert.equal(choiceLabel({ kind: "agenda" }), "Today’s agenda");
});

// ---------------------------------------------------------- the preview ---

test("a link's title is looked up through netguard", async () => {
  const r = await call(owner.token, "POST", "/capture/preview", {
    url: ARTICLE,
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), {
    url: ARTICLE,
    title: "How tides work — a guide",
    site: "The Sea & Sky",
  });
  // Redirects are followed, each hop checked again.
  const moved = "https://93.184.216.34/short/1";
  pages.set(moved, { status: 301, location: "/articles/tides" });
  assert.equal(
    (await call(owner.token, "POST", "/capture/preview", { url: moved })).json()
      .title,
    "How tides work — a guide",
  );
  // An http link is looked up at its https address.
  asked.length = 0;
  const plain = await call(owner.token, "POST", "/capture/preview", {
    url: "http://93.184.216.34/articles/tides",
  });
  assert.equal(plain.json().title, "How tides work — a guide");
  assert.equal(plain.json().url, "http://93.184.216.34/articles/tides");
  assert.deepEqual(asked, [ARTICLE]);
});

test("a link that can't be looked up just has no title", async () => {
  // A private address is never called.
  asked.length = 0;
  const inside = await call(owner.token, "POST", "/capture/preview", {
    url: "https://10.0.0.5/admin",
  });
  assert.equal(inside.statusCode, 200);
  assert.deepEqual(inside.json(), {
    url: "https://10.0.0.5/admin",
    title: null,
    site: "10.0.0.5",
  });
  assert.deepEqual(asked, []);
  // Not a web page, an error, a loop of redirects, or no answer at all.
  const pdf = "https://93.184.216.34/paper.pdf";
  pages.set(pdf, { type: "application/pdf", body: "%PDF" });
  const gone = "https://93.184.216.34/gone";
  pages.set(gone, { status: 404, body: "<title>Not found</title>" });
  const loop = "https://93.184.216.34/loop";
  pages.set(loop, { status: 302, location: loop });
  for (const url of [pdf, gone, loop, "https://93.184.216.34/silent"]) {
    const r = await call(owner.token, "POST", "/capture/preview", { url });
    assert.equal(r.statusCode, 200, url);
    assert.equal(r.json().title, null, url);
    assert.equal(r.json().site, "93.184.216.34", url);
  }
});

/** A body that isn't JSON at all: 400, before anything reads it. */
const broken = (url: string) =>
  app.inject({
    method: "POST",
    url,
    payload: "{",
    remoteAddress: address(),
    headers: {
      authorization: `Bearer ${owner.token}`,
      "content-type": "application/json",
    },
  });

test("the preview asks for a signed-in person and a web link", async () => {
  assert.equal(
    (await call(null, "POST", "/capture/preview", { url: ARTICLE })).statusCode,
    401,
  );
  for (const body of [
    {},
    { url: "javascript:alert(1)" },
    { url: "file:///etc/passwd" },
    { url: ARTICLE, extra: true },
    { url: `https://example.com/${"x".repeat(2000)}` },
  ])
    assert.equal(
      (await call(owner.token, "POST", "/capture/preview", body)).statusCode,
      422,
      JSON.stringify(body).slice(0, 60),
    );
  assert.equal((await broken("/capture/preview")).statusCode, 400);
});

// ------------------------------------------------------------- capture ---

test("a shared link becomes an Inbox task 'Read: <title>' with the link", async () => {
  const r = await call(owner.token, "POST", "/capture", {
    url: ARTICLE,
    text: "For the seminar",
    to: { kind: "inbox" },
  });
  assert.equal(r.statusCode, 201, r.body);
  const out = r.json();
  assert.equal(out.to, "inbox");
  assert.equal(out.item.title, "Read: How tides work — a guide");
  assert.equal(
    out.note,
    "Added “Read: How tides work — a guide” to your tasks.",
  );
  const item = (await call(owner.token, "GET", `/items/${out.item.id}`)).json();
  assert.equal(item.notes, "For the seminar");
  assert.equal(item.team_id, null);
  assert.equal(item.project_id ?? null, null);
  assert.deepEqual(
    item.links.map((l: Json) => ({ url: l.url, title: l.title })),
    [{ url: ARTICLE, title: "How tides work — a guide" }],
  );
  // The title the app already has is used as it is.
  const given = await call(owner.token, "POST", "/capture", {
    url: "https://93.184.216.34/unknown",
    title: "From the app",
    to: { kind: "inbox" },
  });
  assert.equal(given.json().item.title, "Read: From the app");
  // Text alone is a task named by its first line.
  const text = await call(owner.token, "POST", "/capture", {
    text: "Buy chalk\nThe coloured kind",
    to: { kind: "inbox" },
  });
  assert.equal(text.statusCode, 201);
  assert.equal(text.json().item.title, "Buy chalk");
  assert.equal(text.json().item.notes, "The coloured kind");
});

test("a share goes into a project as a task in its first stage", async () => {
  const project = (
    await call(member.token, "POST", "/projects", {
      name: "Oceanography",
      team_id: team,
      stages: ["Reading", "Writing"],
    })
  ).json();
  const r = await call(member.token, "POST", "/capture", {
    url: ARTICLE,
    to: { kind: "project", project_id: project.id },
  });
  assert.equal(r.statusCode, 201, r.body);
  const item = (
    await call(member.token, "GET", `/items/${r.json().item.id}`)
  ).json();
  assert.equal(item.project_id, project.id);
  assert.equal(item.stage_id, project.stages[0].id);
  assert.equal(item.team_id, team, "a team project's task is the team's");
  assert.equal(r.json().note, `Added “${item.title}” to Oceanography.`);
  // A viewer can't add to it; someone outside the team can't find it.
  assert.equal(
    (
      await call(viewer.token, "POST", "/capture", {
        text: "x",
        to: { kind: "project", project_id: project.id },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(stranger.token, "POST", "/capture", {
        text: "x",
        to: { kind: "project", project_id: project.id },
      })
    ).statusCode,
    404,
  );
  // Someone else's personal project is not found either.
  const mine = (
    await call(owner.token, "POST", "/projects", { name: "Private" })
  ).json();
  assert.equal(
    (
      await call(member.token, "POST", "/capture", {
        text: "x",
        to: { kind: "project", project_id: mine.id },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(owner.token, "POST", "/capture", {
        text: "x",
        to: { kind: "project", project_id: randomUUID() },
      })
    ).statusCode,
    404,
  );
});

test("a share is added to the end of today's agenda's Notes", async () => {
  const today = (await call(owner.token, "GET", "/agenda/today")).json();
  const r = await call(owner.token, "POST", "/capture", {
    url: ARTICLE,
    text: "Before the lab",
    to: { kind: "agenda" },
    timezone: "Europe/London",
  });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().doc.id, today.id);
  assert.equal(r.json().note, "Added to today’s agenda.");
  const after = (await call(owner.token, "GET", `/docs/${today.id}`)).json();
  assert.equal(after.version, today.version + 1);
  const content = after.content as DocBlock[];
  const at = content.findIndex((b) => b.id === AGENDA_NOTES_ID);
  assert.deepEqual(content.slice(at + 1, at + 3), [
    {
      type: "bullet",
      text: `[How tides work — a guide](${ARTICLE})`,
    },
    { type: "bullet", text: "Before the lab" },
  ]);
  // Still under Notes, ahead of the end-of-day questions.
  const endOfDay = content.findIndex(
    (b) => b.type === "heading" && b.text === "End of day",
  );
  assert.ok(endOfDay > at + 2);
  // Kept for history as any save is.
  const versions = (
    await call(owner.token, "GET", `/docs/${today.id}/versions`)
  ).json();
  assert.ok(versions.some((v: Json) => v.version === today.version));
});

test("a share is added to the end of a page", async () => {
  const page = (
    await call(member.token, "POST", "/docs", {
      title: "Reading list",
      team_id: team,
      content: [{ type: "paragraph", text: "Start" }],
    })
  ).json();
  const r = await call(member.token, "POST", "/capture", {
    url: ARTICLE,
    title: "Tides",
    to: { kind: "page", doc_id: page.id },
  });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().note, "Added to “Reading list”.");
  const after = (await call(member.token, "GET", `/docs/${page.id}`)).json();
  assert.deepEqual(after.content, [
    { type: "paragraph", text: "Start" },
    { type: "paragraph", text: `[Tides](${ARTICLE})` },
  ]);
  assert.equal(after.version, page.version + 1);
  // An empty page takes the share in place of its one blank line.
  const blank = (
    await call(owner.token, "POST", "/docs", {
      title: "",
      content: [{ type: "paragraph", text: "" }],
    })
  ).json();
  await call(owner.token, "POST", "/capture", {
    text: "Only this",
    to: { kind: "page", doc_id: blank.id },
  });
  assert.deepEqual(
    (await call(owner.token, "GET", `/docs/${blank.id}`)).json().content,
    [{ type: "paragraph", text: "Only this" }],
  );
  // Read-only and unseen pages refuse, and a page in Trash is gone.
  const to = { kind: "page", doc_id: page.id };
  assert.equal(
    (await call(viewer.token, "POST", "/capture", { text: "x", to }))
      .statusCode,
    403,
  );
  assert.equal(
    (await call(stranger.token, "POST", "/capture", { text: "x", to }))
      .statusCode,
    404,
  );
  await call(member.token, "DELETE", `/docs/${page.id}`);
  assert.equal(
    (await call(member.token, "POST", "/capture", { text: "x", to }))
      .statusCode,
    404,
  );
});

test("a share can start a new page in a folder", async () => {
  const folder = (
    await call(owner.token, "POST", "/folders", { name: "Reading" })
  ).json();
  const r = await call(owner.token, "POST", "/capture", {
    url: ARTICLE,
    text: "Chapter two",
    to: { kind: "new_page", folder_id: folder.id },
  });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().note, "Saved “How tides work — a guide” in Reading.");
  const doc = (
    await call(owner.token, "GET", `/docs/${r.json().doc.id}`)
  ).json();
  assert.equal(doc.folder_id, folder.id);
  assert.equal(doc.team_id, null);
  assert.equal(doc.kind, "doc");
  assert.deepEqual(doc.content, [
    { type: "paragraph", text: `[How tides work — a guide](${ARTICLE})` },
    { type: "paragraph", text: "Chapter two" },
  ]);
  // Unfiled.
  const loose = await call(owner.token, "POST", "/capture", {
    text: "A thought",
    to: { kind: "new_page", folder_id: null },
  });
  assert.equal(loose.statusCode, 201);
  assert.equal(loose.json().note, "Saved “A thought” as a new page.");
  // A team folder makes a team page; a viewer can't, a stranger can't see it.
  const shelf = (
    await call(owner.token, "POST", "/folders", {
      name: "Shelf",
      team_id: team,
    })
  ).json();
  const teamPage = await call(member.token, "POST", "/capture", {
    text: "For everyone",
    to: { kind: "new_page", folder_id: shelf.id },
  });
  assert.equal(teamPage.statusCode, 201, teamPage.body);
  assert.equal(
    (await call(member.token, "GET", `/docs/${teamPage.json().doc.id}`)).json()
      .team_id,
    team,
  );
  assert.equal(
    (
      await call(viewer.token, "POST", "/capture", {
        text: "x",
        to: { kind: "new_page", folder_id: shelf.id },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(stranger.token, "POST", "/capture", {
        text: "x",
        to: { kind: "new_page", folder_id: folder.id },
      })
    ).statusCode,
    404,
  );
});

test("a share asks for a signed-in person, something shared, and a destination", async () => {
  assert.equal(
    (await call(null, "POST", "/capture", { text: "x", to: { kind: "inbox" } }))
      .statusCode,
    401,
  );
  for (const body of [
    {},
    { to: { kind: "inbox" } },
    { text: "   ", to: { kind: "inbox" } },
    { text: "x" },
    { text: "x", to: { kind: "elsewhere" } },
    { text: "x", to: { kind: "page" } },
    { text: "x", to: { kind: "page", doc_id: "nope" } },
    { url: "javascript:alert(1)", to: { kind: "inbox" } },
    { text: "x".repeat(10001), to: { kind: "inbox" } },
    { text: "x", to: { kind: "inbox" }, timezone: "Mars/Olympus" },
    { text: "x", to: { kind: "inbox" }, extra: 1 },
  ])
    assert.equal(
      (await call(owner.token, "POST", "/capture", body)).statusCode,
      422,
      JSON.stringify(body).slice(0, 80),
    );
  assert.equal((await broken("/capture")).statusCode, 400);
});

test("sharing answers 429 past the per-minute limit", async () => {
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  await settings();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  live.rate_limit_per_minute = 2;
  const from = (url: string, payload: unknown) =>
    app.inject({
      method: "POST",
      url,
      headers: { authorization: `Bearer ${member.token}` },
      remoteAddress: "10.75.0.1",
      payload: payload as object,
    });
  try {
    const share = { text: "limited", to: { kind: "inbox" } };
    assert.equal((await from("/capture", share)).statusCode, 201);
    assert.equal((await from("/capture", share)).statusCode, 201);
    assert.equal((await from("/capture", share)).statusCode, 429);
  } finally {
    live.rate_limit_per_minute = was;
  }
  // The preview has its own limit, as it reaches out to the web.
  let last = 0;
  for (let n = 0; n < 31; n++)
    last = (
      await app.inject({
        method: "POST",
        url: "/capture/preview",
        headers: { authorization: `Bearer ${member.token}` },
        remoteAddress: "10.75.0.2",
        payload: { url: ARTICLE },
      })
    ).statusCode;
  assert.equal(last, 429);
});
