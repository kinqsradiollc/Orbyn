import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * D4c on the server:
 * - GET /changes: recent changes per team, with your own hidden (SHR-02);
 * - /me/first-run: the guided first run and its starter project (DSN-02);
 * - publishing a page or folder to /p/<slug>, the team switch, passwords,
 *   descriptions and noindex (SHR-05, SHR-06);
 * - /imports/pages and the Todoist and TickTick presets (DATA-08);
 * - /ai/assist: Summarise and Pull out deadlines, through a stand-in
 *   provider only (AI-01).
 */

let replies: string[] = [];
const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
const provider = createServer(async (req, res) => {
  await read(req);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { content: replies.shift() ?? "{}" },
        },
      ],
    }),
  );
});
await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
const providerUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { zip } = await import("../src/modules/docs/zip.js");
const { SWEEP_RULES } = await import("../src/lib/sweep.js");

const app = await buildApp();

type Person = { token: string; email: string; id: string; name: string };
let address = 0;
const next = () =>
  `10.93.${Math.floor(address / 250) % 250}.${address++ % 250}`;
const call = (
  who: Person | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url,
    remoteAddress: next(),
    headers: {
      ...(who ? { authorization: `Bearer ${who.token}` } : {}),
      ...headers,
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async (name: string): Promise<Person> => {
  const email = `d4c-${randomUUID()}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: next(),
    payload: { email, password: "a-long-test-password", name },
  });
  const token = res.json().token;
  const id = (
    await app.inject({
      method: "GET",
      url: "/me",
      remoteAddress: next(),
      headers: { authorization: `Bearer ${token}` },
    })
  ).json().id;
  return { token, email, id, name };
};

const page = async (
  who: Person,
  title: string,
  content: unknown[],
  extra: Record<string, unknown> = {},
) => {
  const res = await call(who, "POST", "/docs", { title, content, ...extra });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { id: string; version: number };
};

const p = (text: string) => ({ type: "paragraph", text });

let owner: Person;
let mate: Person;
let viewer: Person;
let stranger: Person;
let teamId = "";

before(async () => {
  await migrate();
  owner = await register("Ada Owner");
  mate = await register("Ben Mate");
  viewer = await register("Cy Viewer");
  stranger = await register("Dee Stranger");
  teamId = (await call(owner, "POST", "/teams", { name: "Physics" })).json().id;
  for (const [who, role] of [
    [mate, "member"],
    [viewer, "viewer"],
  ] as const)
    await call(owner, "POST", `/teams/${teamId}/members`, {
      email: who.email,
      role,
    });
});

after(async () => {
  await pool.query("UPDATE ai_settings SET provider_id = NULL WHERE id");
  await app.close();
  await pool.end();
  provider.close();
});

// ------------------------------------------------------------- SHR-02

test("recent changes list who changed which team page or task, with mine hidden", async () => {
  const doc = await page(mate, "Lab plan", [p("Draft")], { team_id: teamId });
  // Two edits in a row are one entry that counts them.
  let version = doc.version;
  for (const text of ["Draft two", "Draft three"]) {
    const res = await call(mate, "PUT", `/docs/${doc.id}`, {
      title: "Lab plan",
      content: [p(text)],
      version,
    });
    assert.equal(res.statusCode, 200, res.body);
    version = res.json().version;
  }
  const task = await call(mate, "POST", "/items", {
    kind: "task",
    title: "Order parts",
    team_id: teamId,
  });
  assert.equal(task.statusCode, 201, task.body);
  const done = await call(mate, "PUT", `/items/${task.json().id}`, {
    kind: "task",
    title: "Order parts",
    team_id: teamId,
    status: "done",
    version: 1,
  });
  assert.equal(done.statusCode, 200, done.body);
  // Something of mine, and something personal of theirs.
  await page(owner, "My team page", [p("x")], { team_id: teamId });
  await page(mate, "Mate's own notes", [p("private")]);

  const res = await call(owner, "GET", `/changes?team_id=${teamId}`);
  assert.equal(res.statusCode, 200, res.body);
  const changes = res.json().changes as {
    title: string;
    action: string;
    edits: number;
    user_name: string;
    kind: string;
    open: boolean;
  }[];
  const titles = changes.map((c) => `${c.kind}:${c.title}:${c.action}`);
  assert.ok(titles.includes("page:Lab plan:created"), titles.join(", "));
  const lab = changes.find((c) => c.title === "Lab plan")!;
  assert.equal(lab.edits, 3, "made and edited twice within minutes: one entry");
  assert.equal(lab.user_name, "Ben Mate");
  assert.ok(titles.includes("task:Order parts:done"));
  assert.ok(!titles.some((t) => t.includes("My team page")), "mine are hidden");
  assert.ok(
    !titles.some((t) => t.includes("Mate's own")),
    "personal pages aren't news",
  );

  const all = await call(
    owner,
    "GET",
    `/changes?team_id=${teamId}&hide_mine=false`,
  );
  assert.ok(
    (all.json().changes as { title: string }[]).some(
      (c) => c.title === "My team page",
    ),
  );
  // Deleting a page lists it, and it can't be opened any more.
  const gone = await call(mate, "DELETE", `/docs/${doc.id}`);
  assert.ok(gone.statusCode < 300, gone.body);
  const after = (await call(owner, "GET", "/changes")).json().changes as {
    title: string;
    action: string;
    open: boolean;
  }[];
  const deleted = after.find(
    (c) => c.title === "Lab plan" && c.action === "deleted",
  );
  assert.ok(deleted);
  assert.equal(deleted!.open, false);
  // Paging: one at a time, then the rest.
  const first = (await call(owner, "GET", "/changes?limit=1")).json();
  assert.equal(first.changes.length, 1);
  assert.ok(first.next);
  const second = (
    await call(
      owner,
      "GET",
      `/changes?limit=1&before=${encodeURIComponent(first.next)}`,
    )
  ).json();
  assert.notEqual(second.changes[0]?.id, first.changes[0].id);
});

test("recent changes: signed out 401, someone else's team 404, bad input 422", async () => {
  assert.equal((await call(null, "GET", "/changes")).statusCode, 401);
  assert.equal(
    (await call(stranger, "GET", `/changes?team_id=${teamId}`)).statusCode,
    404,
  );
  assert.deepEqual(
    (await call(stranger, "GET", "/changes")).json().changes,
    [],
  );
  assert.equal(
    (await call(owner, "GET", "/changes?team_id=nope")).statusCode,
    422,
  );
  assert.equal(
    (await call(owner, "GET", "/changes?before=yesterday")).statusCode,
    422,
  );
  assert.equal(
    (await call(owner, "GET", "/changes?limit=500")).statusCode,
    422,
  );
  assert.ok(
    SWEEP_RULES.some((r) => r.table === "team_changes" && r.days === 90),
  );
});

// ------------------------------------------------------------- DSN-02

test("a new account starts with the first run; a starter makes a project and a linked brief", async () => {
  const fresh = await register("Eve Student");
  const me = (await call(fresh, "GET", "/me")).json();
  assert.equal(me.first_run_done, false);
  const res = await call(fresh, "POST", "/me/first-run", {
    purpose: "study",
    starter: "term",
  });
  assert.equal(res.statusCode, 200, res.body);
  const out = res.json();
  assert.equal(out.user.first_run_done, true);
  assert.equal(out.user.purpose, "study");
  assert.ok(out.project_id && out.brief_id);
  const project = (
    await call(fresh, "GET", `/projects/${out.project_id}`)
  ).json();
  assert.equal(project.name, "This term");
  assert.deepEqual(
    project.stages.map((s: { name: string }) => s.name),
    ["Lectures", "Assignments", "Exams"],
  );
  const brief = (await call(fresh, "GET", `/docs/${out.brief_id}`)).json();
  assert.equal(brief.title, "Term brief");
  const text = JSON.stringify(brief.content);
  assert.match(text, /orbyn:\/\/doc\//);
  // The brief's links show on the pages as "Linked here".
  const docs = (await call(fresh, "GET", "/docs")).json() as {
    id: string;
    title: string;
  }[];
  const lecture = (
    Array.isArray(docs) ? docs : (docs as { docs: typeof docs }).docs
  ).find((d) => d.title === "Lecture notes")!;
  const here = await call(
    fresh,
    "GET",
    `/links/here?kind=doc&id=${lecture.id}`,
  );
  assert.equal(here.statusCode, 200, here.body);
  assert.match(here.body, /Term brief/);
  // Once: asking again makes nothing more.
  const again = await call(fresh, "POST", "/me/first-run", {
    purpose: "personal",
    starter: "weekly",
  });
  assert.equal(again.json().project_id, null);
  const projects = await pool.query(
    "SELECT 1 FROM projects WHERE user_id = $1",
    [fresh.id],
  );
  assert.equal(projects.rowCount, 1);
});

test("a team sprint starter makes a team; skipping shows it no more", async () => {
  const lead = await register("Finn Lead");
  const res = await call(lead, "POST", "/me/first-run", {
    purpose: "team",
    starter: "sprint",
    team_name: "Robotics",
  });
  assert.equal(res.statusCode, 200, res.body);
  const teams = (await call(lead, "GET", "/teams")).json() as {
    name: string;
  }[];
  assert.ok(teams.some((t) => t.name === "Robotics"));
  const skipper = await register("Gus Skip");
  const skipped = await call(skipper, "POST", "/me/first-run/skip");
  assert.equal(skipped.json().first_run_done, true);
  // Someone else's team can't be named.
  const sneaky = await register("Hal Sneak");
  const no = await call(sneaky, "POST", "/me/first-run", {
    purpose: "team",
    starter: "sprint",
    team_id: teamId,
  });
  assert.equal(no.statusCode, 404);
});

test("first run: 401 signed out, 400 unreadable, 422 bad input, 429 when hammered", async () => {
  assert.equal(
    (await call(null, "POST", "/me/first-run", { purpose: "study" }))
      .statusCode,
    401,
  );
  assert.equal(
    (await call(null, "POST", "/me/first-run/skip")).statusCode,
    401,
  );
  const who = await register("Ivy Input");
  const garbled = await app.inject({
    method: "POST",
    url: "/me/first-run",
    remoteAddress: next(),
    headers: {
      authorization: `Bearer ${who.token}`,
      "content-type": "application/json",
    },
    payload: "{not json",
  });
  assert.equal(garbled.statusCode, 400);
  assert.equal(
    (await call(who, "POST", "/me/first-run", { purpose: "work" })).statusCode,
    422,
  );
  assert.equal(
    (
      await call(who, "POST", "/me/first-run", {
        purpose: "study",
        starter: "x",
      })
    ).statusCode,
    422,
  );
  let last = 0;
  for (let n = 0; n < 12; n++)
    last = (
      await app.inject({
        method: "POST",
        url: "/me/first-run",
        remoteAddress: "10.93.250.1",
        headers: { authorization: `Bearer ${who.token}` },
        payload: { purpose: "personal" },
      })
    ).statusCode;
  assert.equal(last, 429);
});

// ------------------------------------------------------------- SHR-05

test("a page published to the web reads at /p/<slug>, hidden from search, and Unpublish ends it", async () => {
  const other = await page(owner, "Other page", [p("Not on the web")]);
  const doc = await page(owner, "Physics notes", [
    { type: "heading", level: 1, text: "Forces" },
    p(
      `Newton's laws, $F = ma$. See [the other page](orbyn://doc/${other.id}).`,
    ),
    { type: "heading", level: 1, text: "Energy" },
    { type: "heading", level: 1, text: "Momentum" },
  ]);
  const before = (await call(owner, "GET", `/docs/${doc.id}/publish`)).json();
  assert.equal(before.published, null, "off by default");
  assert.equal(before.can_publish, true);
  const res = await call(owner, "PUT", `/docs/${doc.id}/publish`, {
    description: "Notes for the class",
  });
  assert.equal(res.statusCode, 200, res.body);
  const info = res.json().published;
  assert.match(info.slug, /^physics-notes-[0-9a-f]{6}$/);
  assert.equal(info.noindex, true);
  const read = await call(null, "GET", info.path);
  assert.equal(read.statusCode, 200);
  assert.match(read.headers["content-type"] as string, /text\/html/);
  assert.equal(read.headers["x-robots-tag"], "noindex, nofollow");
  assert.match(
    read.headers["content-security-policy"] as string,
    /default-src 'none'/,
  );
  assert.match(read.body, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(read.body, /og:description" content="Notes for the class"/);
  assert.match(read.body, /Contents/);
  // Maths is written as MathML, which browsers draw with nothing to load.
  assert.match(read.body, /<math/);
  assert.match(read.body, /href="#h-0"/);
  // A link to a page that isn't published keeps its words, not its address.
  assert.match(read.body, /the other page/);
  assert.ok(!read.body.includes(`orbyn://doc/${other.id}`));
  // Published too: now the link works.
  const otherInfo = (
    await call(owner, "PUT", `/docs/${other.id}/publish`, {})
  ).json().published;
  const again = await call(null, "GET", info.path);
  assert.match(again.body, new RegExp(`href="${otherInfo.path}"`));
  // …and the other page lists it as linking there.
  const back = await call(null, "GET", otherInfo.path);
  assert.match(back.body, /Linked here/);
  // Search engines may be let in.
  await call(owner, "PUT", `/docs/${doc.id}/publish`, { noindex: false });
  const open = await call(null, "GET", info.path);
  assert.equal(open.headers["x-robots-tag"], undefined);
  assert.match(open.body, /content="index, follow"/);
  // Views are counted.
  const counted = (await call(owner, "GET", `/docs/${doc.id}/publish`)).json();
  assert.ok(counted.published.views >= 3);
  // Unpublish: the address stops working at once.
  const off = await call(owner, "DELETE", `/docs/${doc.id}/publish`);
  assert.equal(off.json().published, null);
  assert.equal((await call(null, "GET", info.path)).statusCode, 404);
  // A page in Trash is off the web too.
  await call(owner, "DELETE", `/docs/${other.id}`);
  assert.equal((await call(null, "GET", otherInfo.path)).statusCode, 404);
});

test("a password keeps a published page shut until it is typed", async () => {
  const doc = await page(owner, "Answers", [p("42")]);
  const info = (
    await call(owner, "PUT", `/docs/${doc.id}/publish`, {
      password: "open sesame",
    })
  ).json().published;
  assert.equal(info.has_password, true);
  const shut = await call(null, "GET", info.path);
  assert.equal(shut.statusCode, 401);
  assert.match(shut.body, /needs a password/);
  assert.ok(!shut.body.includes("42"));
  const wrong = await app.inject({
    method: "POST",
    url: `${info.path}/unlock`,
    remoteAddress: next(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "password=nope",
  });
  assert.equal(wrong.statusCode, 401);
  assert.match(wrong.body, /isn't right/);
  const right = await app.inject({
    method: "POST",
    url: `${info.path}/unlock`,
    remoteAddress: next(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "password=open+sesame",
  });
  assert.equal(right.statusCode, 303);
  const cookie = String(right.headers["set-cookie"]).split(";")[0];
  assert.match(String(right.headers["set-cookie"]), /HttpOnly/);
  const opened = await call(null, "GET", info.path, undefined, { cookie });
  assert.equal(opened.statusCode, 200);
  assert.match(opened.body, /42/);
  // A new password shuts it again for everyone.
  await call(owner, "PUT", `/docs/${doc.id}/publish`, {
    password: "another one",
  });
  assert.equal(
    (await call(null, "GET", info.path, undefined, { cookie })).statusCode,
    401,
  );
  // Taken away: open to anyone with the address.
  await call(owner, "PUT", `/docs/${doc.id}/publish`, { password: null });
  assert.equal((await call(null, "GET", info.path)).statusCode, 200);
});

test("a published folder lists its pages, and each page reads inside it", async () => {
  const folder = (
    await call(owner, "POST", "/folders", { name: "Handbook" })
  ).json();
  assert.ok(folder.id, JSON.stringify(folder));
  const a = await page(owner, "Welcome", [p("Hello")], {
    folder_id: folder.id,
  });
  const b = await page(
    owner,
    "Tools",
    [p(`Back to [welcome](orbyn://doc/${a.id})`)],
    {
      folder_id: folder.id,
    },
  );
  await call(owner, "PUT", `/docs/${a.id}/web-description`, {
    description: "Start here",
  });
  const slug = `handbook-${randomUUID().slice(0, 8)}`;
  const info = (
    await call(owner, "PUT", `/folders/${folder.id}/publish`, { slug })
  ).json().published;
  assert.equal(info.path, `/p/${slug}`);
  const index = await call(null, "GET", `/p/${slug}`);
  assert.equal(index.statusCode, 200);
  assert.match(index.body, /Welcome/);
  assert.match(index.body, /Start here/);
  const tools = await call(null, "GET", `/p/${slug}/${b.id}`);
  assert.equal(tools.statusCode, 200);
  assert.match(tools.body, new RegExp(`href="/p/${slug}/${a.id}"`));
  assert.match(tools.body, /In Handbook/);
  // A page's own state says it is on the web through its folder.
  const state = (await call(owner, "GET", `/docs/${a.id}/publish`)).json();
  assert.equal(state.via_folder.path, `/p/${slug}/${a.id}`);
  assert.equal(state.web_description, "Start here");
  // A page from elsewhere isn't read through the folder's address.
  const outside = await page(owner, "Diary", [p("secret")]);
  assert.equal(
    (await call(null, "GET", `/p/${slug}/${outside.id}`)).statusCode,
    404,
  );
  // The address is taken now.
  const clash = await page(owner, "Another", [p("x")]);
  const taken = await call(owner, "PUT", `/docs/${clash.id}/publish`, { slug });
  assert.equal(taken.statusCode, 200);
  assert.equal(taken.json().published.slug, `${slug}-2`);
});

test("team pages: members publish, viewers can't, and the team switch takes them all off", async () => {
  const doc = await page(mate, "Team brief", [p("For the client")], {
    team_id: teamId,
  });
  const asViewer = await call(viewer, "PUT", `/docs/${doc.id}/publish`, {});
  assert.equal(asViewer.statusCode, 403);
  const viewerState = (
    await call(viewer, "GET", `/docs/${doc.id}/publish`)
  ).json();
  assert.equal(viewerState.can_publish, false);
  assert.equal(
    (await call(stranger, "PUT", `/docs/${doc.id}/publish`, {})).statusCode,
    404,
  );
  const info = (await call(mate, "PUT", `/docs/${doc.id}/publish`, {})).json()
    .published;
  assert.equal((await call(null, "GET", info.path)).statusCode, 200);
  // Only owners and admins switch it off.
  assert.equal(
    (await call(mate, "PUT", `/teams/${teamId}/publishing`, { allowed: false }))
      .statusCode,
    403,
  );
  const switched = await call(owner, "PUT", `/teams/${teamId}/publishing`, {
    allowed: false,
  });
  assert.equal(switched.statusCode, 200, switched.body);
  assert.equal(switched.json().published, 1);
  assert.equal(
    (await call(null, "GET", info.path)).statusCode,
    404,
    "off at once",
  );
  const refused = await call(mate, "PUT", `/docs/${doc.id}/publish`, {});
  assert.equal(refused.statusCode, 403);
  assert.match(refused.json().message, /switched off/);
  // Back on: the page comes back as it was.
  await call(owner, "PUT", `/teams/${teamId}/publishing`, { allowed: true });
  assert.equal((await call(null, "GET", info.path)).statusCode, 200);
  const setting = (
    await call(mate, "GET", `/teams/${teamId}/publishing`)
  ).json();
  assert.deepEqual(setting, { allowed: true, published: 1, can_change: false });
});

test("publishing: 401 signed out, 422 bad input, 404 unknown, 429 when hammered", async () => {
  const doc = await page(owner, "Limits", [p("x")]);
  assert.equal(
    (await call(null, "PUT", `/docs/${doc.id}/publish`, {})).statusCode,
    401,
  );
  assert.equal(
    (await call(null, "GET", `/docs/${doc.id}/publish`)).statusCode,
    401,
  );
  assert.equal(
    (
      await call(owner, "PUT", `/docs/${doc.id}/publish`, {
        slug: "No Spaces!",
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (await call(owner, "PUT", `/docs/${doc.id}/publish`, { password: "abc" }))
      .statusCode,
    422,
  );
  assert.equal(
    (
      await call(owner, "PUT", `/docs/${doc.id}/web-description`, {
        description: "x".repeat(301),
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (await call(owner, "GET", `/docs/${randomUUID()}/publish`)).statusCode,
    404,
  );
  assert.equal((await call(null, "GET", "/p/no-such-page")).statusCode, 404);
  assert.equal((await call(null, "GET", "/p/NOT..valid")).statusCode, 404);
  let last = 0;
  for (let n = 0; n < 12; n++)
    last = (
      await app.inject({
        method: "PUT",
        url: `/docs/${doc.id}/publish`,
        remoteAddress: "10.93.250.2",
        headers: { authorization: `Bearer ${owner.token}` },
        payload: {},
      })
    ).statusCode;
  assert.equal(last, 429);
});

// ------------------------------------------------------------- DATA-08

const b64 = (entries: { name: string; body: string }[]) =>
  zip(entries).toString("base64");

test("a Markdown zip: a dry run first, then pages in folders with working links", async () => {
  const who = await register("Jo Importer");
  const data = b64([
    { name: "notes/Physics/Lab 1.md", body: "# Lab 1\n\nUses [[Formulas]]." },
    { name: "notes/Physics/Formulas.md", body: "F = ma" },
    { name: "notes/Todo.md", body: "- [ ] Revise" },
    { name: "notes/pic.png", body: "PNG" },
  ]);
  const dry = await call(who, "POST", "/imports/pages", {
    format: "markdown",
    file_name: "notes.zip",
    data,
  });
  assert.equal(dry.statusCode, 200, dry.body);
  const summary = dry.json();
  assert.equal(summary.pages, 3);
  assert.equal(summary.folders, 2);
  assert.equal(summary.links, 1);
  assert.ok(summary.left_out.some((l: string) => /other file/.test(l)));
  assert.equal(
    (await pool.query("SELECT 1 FROM docs WHERE user_id = $1", [who.id]))
      .rowCount,
    0,
    "a dry run writes nothing",
  );
  const real = await call(who, "POST", "/imports/pages", {
    format: "markdown",
    file_name: "notes.zip",
    data,
    dry_run: false,
  });
  assert.equal(real.statusCode, 200, real.body);
  assert.ok(real.json().folder_id);
  const rows = (
    await pool.query<{ title: string; folder: string; content: unknown }>(
      `SELECT d.title, f.name AS folder, d.content FROM docs d
         JOIN folders f ON f.id = d.folder_id WHERE d.user_id = $1 ORDER BY d.title`,
      [who.id],
    )
  ).rows;
  assert.deepEqual(
    rows.map((r) => [r.title, r.folder]),
    [
      ["Formulas", "Physics"],
      ["Lab 1", "Physics"],
      ["Todo", "notes"],
    ],
  );
  assert.match(JSON.stringify(rows[1].content), /orbyn:\/\/doc\//);
  // One Markdown file on its own works too.
  const single = await call(who, "POST", "/imports/pages", {
    format: "markdown",
    file_name: "one.md",
    data: Buffer.from("# One\n\nText").toString("base64"),
  });
  assert.equal(single.json().pages, 1);
});

test("a Notion zip: its databases become projects with tasks", async () => {
  const who = await register("Kit Notion");
  const id = "0123456789abcdef0123456789abcdef";
  const data = b64([
    { name: `Course ${id}.md`, body: "# Course\n\nAbout it." },
    {
      name: `Course ${id}/Deadlines ${id}.csv`,
      body: "Name,Status,Due\nEssay,Done,2026-10-01\nExam,,2026-11-20",
    },
  ]);
  const real = await call(who, "POST", "/imports/pages", {
    format: "notion",
    file_name: "Export.zip",
    data,
    dry_run: false,
  });
  assert.equal(real.statusCode, 200, real.body);
  assert.equal(real.json().projects, 1);
  assert.equal(real.json().tasks, 2);
  const tasks = (
    await pool.query<{ title: string; status: string; project: string }>(
      `SELECT i.title, i.status, p.name AS project FROM items i
         JOIN projects p ON p.id = i.project_id WHERE i.user_id = $1 ORDER BY i.title`,
      [who.id],
    )
  ).rows;
  assert.deepEqual(
    tasks.map((t) => [t.title, t.status, t.project]),
    [
      ["Essay", "done", "Deadlines"],
      ["Exam", "todo", "Deadlines"],
    ],
  );
});

test("page imports: 401 signed out, 422 bad input or unreadable file, 404 someone else's team", async () => {
  const who = await register("Lu Limits");
  assert.equal(
    (
      await call(null, "POST", "/imports/pages", {
        format: "markdown",
        file_name: "a.md",
        data: "eA==",
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await call(who, "POST", "/imports/pages", {
        format: "evernote",
        file_name: "a.md",
        data: "eA==",
      })
    ).statusCode,
    422,
  );
  const notZip = await call(who, "POST", "/imports/pages", {
    format: "markdown",
    file_name: "a.zip",
    data: Buffer.from("not a zip").toString("base64"),
  });
  assert.equal(notZip.statusCode, 422);
  assert.match(notZip.json().message, /zip/);
  assert.equal(
    (
      await call(who, "POST", "/imports/pages", {
        format: "markdown",
        file_name: "a.pdf",
        data: "eA==",
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(who, "POST", "/imports/pages", {
        format: "markdown",
        file_name: "a.md",
        data: "eA==",
        team_id: teamId,
      })
    ).statusCode,
    404,
  );
});

test("Todoist and TickTick CSVs come in as tasks, after a dry run", async () => {
  const who = await register("Mo Tasks");
  const todoist = [
    "TYPE,CONTENT,DESCRIPTION,PRIORITY,DATE",
    "section,Uni,,,",
    "task,Essay plan,,1,2026-10-02",
  ].join("\n");
  const dry = await call(who, "POST", "/me/import", {
    format: "todoist",
    data: todoist,
  });
  assert.equal(dry.statusCode, 200, dry.body);
  assert.equal(dry.json().created, 1);
  assert.equal(dry.json().lists_added, 1);
  const real = await call(who, "POST", "/me/import", {
    format: "todoist",
    data: todoist,
    dry_run: false,
  });
  assert.equal(real.json().created, 1);
  const row = (
    await pool.query<{ priority: string; list: string }>(
      `SELECT i.priority, l.name AS list FROM items i JOIN lists l ON l.id = i.list_id
        WHERE i.user_id = $1`,
      [who.id],
    )
  ).rows[0];
  assert.deepEqual(row, { priority: "high", list: "Uni" });
  const tick = await call(who, "POST", "/me/import", {
    format: "ticktick",
    data: '"Date: x"\n"Title","List Name","Priority","Status"\n"Walk","Home","0","0"',
  });
  assert.equal(tick.json().created, 1);
  const empty = await call(who, "POST", "/me/import", {
    format: "ticktick",
    data: "nothing",
  });
  assert.equal(empty.json().created, 0);
  assert.equal(empty.json().errors.length, 1);
});

// ------------------------------------------------------------- AI-01

test("Summarise and Pull out deadlines come back as suggestions, from the hosted assistant only", async () => {
  const who = await register("Nia Assist");
  const doc = await page(who, "Syllabus", [
    p("Essay due 3 October."),
    p("Exam on 20 November."),
  ]);
  // No assistant set up: a plain 503, and nothing else happens.
  await pool.query("UPDATE ai_settings SET provider_id = NULL WHERE id");
  const none = await call(who, "POST", "/ai/assist", {
    action: "summarise",
    doc_id: doc.id,
  });
  assert.equal(none.statusCode, 503);
  const standIn = (
    await pool.query<{ id: string }>(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES ('openai-compatible', 'D4c stand-in', $1) RETURNING id",
      [providerUrl],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id = $1, model = 'stand-in' WHERE id",
    [standIn],
  );
  replies = [JSON.stringify({ summary: "- An essay\n- An exam" })];
  const summary = await call(who, "POST", "/ai/assist", {
    action: "summarise",
    doc_id: doc.id,
  });
  assert.equal(summary.statusCode, 200, summary.body);
  assert.equal(summary.json().summary, "- An essay\n- An exam");
  // The page itself is unchanged: taking it is the person's own edit.
  const still = (await call(who, "GET", `/docs/${doc.id}`)).json();
  assert.equal(still.content.length, 2);
  replies = [
    JSON.stringify({
      tasks: [
        { title: "Essay", due: "2026-10-03", source: "Essay due 3 October." },
        { title: "Exam", due: null, source: "Exam on 20 November." },
      ],
    }),
  ];
  const deadlines = await call(who, "POST", "/ai/assist", {
    action: "deadlines",
    text: "Essay due 3 October. Exam on 20 November.",
  });
  assert.equal(deadlines.statusCode, 200, deadlines.body);
  assert.deepEqual(deadlines.json().tasks, [
    {
      title: "Essay",
      due_at: "2026-10-03T17:00:00.000Z",
      source: "Essay due 3 October.",
    },
    { title: "Exam", due_at: null, source: "Exam on 20 November." },
  ]);
  const before = (
    await pool.query("SELECT 1 FROM items WHERE user_id = $1", [who.id])
  ).rowCount;
  assert.equal(before, 0, "no task is made until it is taken");
  // "Make 10 flashcards" asks Study for ten.
  replies = [
    JSON.stringify({
      cards: Array.from({ length: 14 }, (_, n) => ({
        question: `Q${n}?`,
        answer: `A${n}`,
        source: "",
      })),
    }),
  ];
  const cards = await call(who, "POST", `/ai/study/pages/${doc.id}/cards`, {
    max: 10,
  });
  assert.equal(cards.statusCode, 200, cards.body);
  assert.equal(cards.json().cards.length, 10);
  // An unreadable answer is a 502, not a crash.
  replies = ["not json"];
  assert.equal(
    (
      await call(who, "POST", "/ai/assist", {
        action: "summarise",
        doc_id: doc.id,
      })
    ).statusCode,
    502,
  );
});

test("assistant chips: 401 signed out, 422 nothing to work from, 404 someone else's page, 429", async () => {
  const who = await register("Oz Chips");
  const mine = await page(owner, "Owner only", [p("secret")]);
  assert.equal(
    (await call(null, "POST", "/ai/assist", { action: "summarise", text: "x" }))
      .statusCode,
    401,
  );
  assert.equal(
    (await call(who, "POST", "/ai/assist", { action: "summarise" })).statusCode,
    422,
  );
  assert.equal(
    (await call(who, "POST", "/ai/assist", { action: "translate", text: "x" }))
      .statusCode,
    422,
  );
  assert.equal(
    (
      await call(who, "POST", "/ai/assist", {
        action: "summarise",
        doc_id: mine.id,
      })
    ).statusCode,
    404,
  );
  let last = 0;
  for (let n = 0; n < 12; n++)
    last = (
      await app.inject({
        method: "POST",
        url: "/ai/assist",
        remoteAddress: "10.93.250.3",
        headers: { authorization: `Bearer ${who.token}` },
        payload: { action: "summarise" },
      })
    ).statusCode;
  assert.equal(last, 429);
});
