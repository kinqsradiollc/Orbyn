import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * D5 on the server:
 * - stars on tasks, views and headings, and the Starred group (NAV-07);
 * - choices that follow the account: Arrange, shortcuts, view choices
 *   (NAV-08, NAV-09, SHR-08);
 * - archiving pages and folders, and several pages at once (SRCH-03, ORG-03);
 * - the Connections map (CNV-02);
 * - a team's switches for publishing, the assistant and booking (OTH-04);
 * - a recording's summary through a stand-in provider only (CAP-10);
 * - the Orbyn Clipper's keys and clips (CAP-02, CAP-03, CAP-04).
 */

let replies: string[] = [];
const asked: string[] = [];
const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
const provider = createServer(async (req, res) => {
  asked.push(await read(req));
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

const app = await buildApp();

type Person = { token: string; email: string; id: string; name: string };
let address = 0;
const next = () =>
  `10.95.${Math.floor(address / 250) % 250}.${address++ % 250}`;
const call = (
  who: Person | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    remoteAddress: next(),
    headers: who ? { authorization: `Bearer ${who.token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
/** The same address every time, to reach a route's limit. */
const hammer = async (
  who: Person,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload: unknown,
  times: number,
  at: string,
) => {
  let last = 0;
  for (let n = 0; n < times; n++)
    last = (
      await app.inject({
        method,
        url,
        remoteAddress: at,
        headers: { authorization: `Bearer ${who.token}` },
        ...(payload === undefined ? {} : { payload: payload as object }),
      })
    ).statusCode;
  return last;
};

const register = async (name: string): Promise<Person> => {
  const email = `d5-${randomUUID()}@example.com`;
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

const p = (text: string, id?: string) => ({
  type: "paragraph",
  text,
  ...(id ? { id } : {}),
});
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
const task = async (who: Person, title: string, extra = {}) => {
  const res = await call(who, "POST", "/items", {
    kind: "task",
    title,
    ...extra,
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { id: string };
};
const apiKey = async (who: Person): Promise<Person> => {
  const made = await call(who, "POST", "/me/api-keys", { name: "Script" });
  assert.equal(made.statusCode, 201, made.body);
  return { ...who, token: made.json().key };
};

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
  const standIn = (
    await pool.query<{ id: string }>(
      "INSERT INTO ai_providers(kind, name, base_url) VALUES ('openai-compatible', 'D5 stand-in', $1) RETURNING id",
      [providerUrl],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id = $1, model = 'd5-test' WHERE id",
    [standIn],
  );
});

after(async () => {
  await pool.query("UPDATE ai_settings SET provider_id = NULL WHERE id");
  await app.close();
  await pool.end();
  provider.close();
});

// ------------------------------------------------------------- NAV-07

test("stars reach tasks, views and headings, and the Starred group names them live", async () => {
  const who = await register("Sam Stars");
  const doc = await page(who, "Physics notes", [
    { type: "heading", level: 2, text: "Waves", id: "h-waves" },
    p("Frequency and length."),
  ]);
  const t = await task(who, "Lab report");
  const view = await call(who, "POST", "/views", {
    name: "Due soon",
    definition: { source: "tasks", filters: { due_within_days: 7 } },
  });
  assert.equal(view.statusCode, 201, view.body);
  for (const body of [
    { kind: "doc", target_id: doc.id, starred: true },
    { kind: "task", target_id: t.id, starred: true },
    { kind: "view", target_id: view.json().id, starred: true },
    { kind: "heading", target_id: doc.id, block_id: "h-waves", starred: true },
  ]) {
    const res = await call(who, "PUT", "/favourites", body);
    assert.equal(res.statusCode, 204, `${body.kind}: ${res.body}`);
  }
  // Starring twice is harmless.
  assert.equal(
    (
      await call(who, "PUT", "/favourites", {
        kind: "task",
        target_id: t.id,
        starred: true,
      })
    ).statusCode,
    204,
  );
  const starred = (await call(who, "GET", "/starred")).json() as {
    kind: string;
    title: string;
    hint: string | null;
    block_id: string;
  }[];
  assert.equal(starred.length, 4);
  const heading = starred.find((s) => s.kind === "heading")!;
  assert.equal(heading.title, "Waves");
  assert.equal(heading.hint, "Physics notes");
  assert.equal(heading.block_id, "h-waves");
  assert.ok(starred.some((s) => s.kind === "task" && s.title === "Lab report"));
  assert.ok(starred.some((s) => s.kind === "view" && s.title === "Due soon"));
  // A heading that's gone drops out of the group.
  await call(who, "PUT", `/docs/${doc.id}`, {
    content: [p("Frequency and length.")],
    version: doc.version,
  });
  assert.ok(
    !((await call(who, "GET", "/starred")).json() as { kind: string }[]).some(
      (s) => s.kind === "heading",
    ),
  );
  // Unstarring takes it off.
  await call(who, "PUT", "/favourites", {
    kind: "task",
    target_id: t.id,
    starred: false,
  });
  assert.ok(
    !((await call(who, "GET", "/starred")).json() as { kind: string }[]).some(
      (s) => s.kind === "task",
    ),
  );
});

test("stars: 401 signed out, 422 a heading without its line, 404 someone else's or a missing line", async () => {
  const who = await register("Una Stars");
  const doc = await page(who, "Mine", [p("x", "b1")]);
  const theirs = await page(owner, "Owner only", [p("secret", "s1")]);
  const theirTask = await task(owner, "Owner's task");
  assert.equal((await call(null, "GET", "/starred")).statusCode, 401);
  assert.equal(
    (
      await call(null, "PUT", "/favourites", {
        kind: "doc",
        target_id: doc.id,
        starred: true,
      })
    ).statusCode,
    401,
  );
  for (const bad of [
    { kind: "heading", target_id: doc.id, starred: true },
    { kind: "doc", target_id: doc.id, block_id: "b1", starred: true },
    { kind: "heading", target_id: doc.id, block_id: "bad id!", starred: true },
    { kind: "folder", target_id: doc.id, starred: true },
  ])
    assert.equal(
      (await call(who, "PUT", "/favourites", bad)).statusCode,
      422,
      JSON.stringify(bad),
    );
  for (const body of [
    { kind: "doc", target_id: theirs.id, starred: true },
    { kind: "heading", target_id: theirs.id, block_id: "s1", starred: true },
    { kind: "task", target_id: theirTask.id, starred: true },
    { kind: "heading", target_id: doc.id, block_id: "nope", starred: true },
  ])
    assert.equal(
      (await call(who, "PUT", "/favourites", body)).statusCode,
      404,
      JSON.stringify(body),
    );
});

test("a team page's star stops showing once you leave the team", async () => {
  const who = await register("Leo Leaves");
  const team = (
    await call(owner, "POST", "/teams", { name: "Short stay" })
  ).json().id as string;
  await call(owner, "POST", `/teams/${team}/members`, {
    email: who.email,
    role: "member",
  });
  const doc = await page(owner, "Team plan", [p("x")], { team_id: team });
  assert.equal(
    (
      await call(who, "PUT", "/favourites", {
        kind: "doc",
        target_id: doc.id,
        starred: true,
      })
    ).statusCode,
    204,
  );
  assert.equal((await call(who, "GET", "/starred")).json().length, 1);
  await call(owner, "DELETE", `/teams/${team}/members/${who.id}`);
  assert.deepEqual((await call(who, "GET", "/starred")).json(), []);
});

// --------------------------------------------- NAV-08, NAV-09, SHR-08

test("Arrange, shortcuts and view choices follow the account", async () => {
  const who = await register("Pat Prefs");
  const empty = (await call(who, "GET", "/me/prefs")).json();
  assert.deepEqual(empty.sidebar, { order: [], hidden: [] });
  assert.deepEqual(empty.shortcuts, {});
  assert.deepEqual(empty.views, {});
  const saved = await call(who, "PUT", "/me/prefs", {
    sidebar: { order: ["Docs", "Projects"], hidden: ["Booking", "Study"] },
    shortcuts: { "page.present": ["mod", "shift", "P"], "new.task": [] },
    views: { tasks: { layout: "board", group: "project", sort: "due" } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  // View choices merge by place; null clears one.
  await call(who, "PUT", "/me/prefs", {
    views: { calendar: { set: "all" } },
  });
  let now = (await call(who, "GET", "/me/prefs")).json();
  assert.deepEqual(now.sidebar.hidden, ["Booking", "Study"]);
  assert.deepEqual(now.shortcuts["page.present"], ["mod", "shift", "P"]);
  assert.deepEqual(now.shortcuts["new.task"], []);
  assert.equal(now.views.tasks.layout, "board");
  assert.equal(now.views.calendar.set, "all");
  await call(who, "PUT", "/me/prefs", { views: { tasks: null } });
  now = (await call(who, "GET", "/me/prefs")).json();
  assert.equal(now.views.tasks, undefined);
  assert.equal(now.views.calendar.set, "all");
  // Another person's choices are theirs.
  assert.deepEqual((await call(stranger, "GET", "/me/prefs")).json().views, {});
  // Back as it came.
  assert.equal((await call(who, "DELETE", "/me/prefs")).statusCode, 204);
  assert.deepEqual((await call(who, "GET", "/me/prefs")).json().shortcuts, {});
});

test("prefs: 401, 400 unknown command or a key twice, 422 bad shapes, 403 for API keys, 429", async () => {
  const who = await register("Quin Prefs");
  assert.equal((await call(null, "GET", "/me/prefs")).statusCode, 401);
  assert.equal(
    (await call(null, "PUT", "/me/prefs", { views: {} })).statusCode,
    401,
  );
  assert.equal(
    (
      await call(who, "PUT", "/me/prefs", {
        shortcuts: { "no.such": ["mod", "J"] },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(who, "PUT", "/me/prefs", {
        shortcuts: {
          "page.present": ["mod", "J"],
          "page.window": ["mod", "J"],
        },
      })
    ).statusCode,
    400,
  );
  for (const bad of [
    {},
    { shortcuts: { "page.present": ["mod", "shift", "alt", "ctrl", "J"] } },
    { shortcuts: { "page.present": ["<script>"] } },
    { views: { Tasks: { layout: "board" } } },
    { views: { tasks: { colour: "red" } } },
    { sidebar: { order: "Docs" } },
  ])
    assert.equal(
      (await call(who, "PUT", "/me/prefs", bad)).statusCode,
      422,
      JSON.stringify(bad),
    );
  const key = await apiKey(who);
  assert.equal(
    (await call(key, "PUT", "/me/prefs", { views: {} })).statusCode,
    403,
  );
  assert.equal((await call(key, "GET", "/me/prefs")).statusCode, 200);
  assert.equal(
    await hammer(
      who,
      "PUT",
      "/me/prefs",
      { views: { tasks: { layout: "list" } } },
      32,
      "10.95.251.1",
    ),
    429,
  );
});

// ------------------------------------------------- SRCH-03, ORG-03

test("an archived page leaves the library, the switcher, search and the picker, and comes back when asked", async () => {
  const who = await register("Arch Ive");
  const doc = await page(who, "Quantum term notes", [p("Entanglement notes")]);
  const other = await page(who, "Quantum reading list", [p("books")]);
  const archived = await call(who, "PUT", `/docs/${doc.id}/archive`, {
    archived: true,
  });
  assert.equal(archived.statusCode, 200, archived.body);
  assert.equal(archived.json().archived, true);
  assert.ok(archived.json().archived_at);
  // The version is unchanged: nobody's open copy is interrupted.
  assert.equal(archived.json().version, doc.version);
  const ids = (res: { json: () => unknown }) =>
    (res.json() as { id: string }[]).map((d) => d.id);
  assert.ok(!ids(await call(who, "GET", "/docs")).includes(doc.id));
  assert.ok(ids(await call(who, "GET", "/docs")).includes(other.id));
  assert.deepEqual(ids(await call(who, "GET", "/docs?archived=only")), [
    doc.id,
  ]);
  assert.ok(
    ids(await call(who, "GET", "/docs?archived=include")).includes(doc.id),
  );
  assert.ok(!ids(await call(who, "GET", "/find?q=Quantum")).includes(doc.id));
  assert.ok(
    ids(
      await call(who, "GET", "/find?q=Quantum&include_archived=true"),
    ).includes(doc.id),
  );
  assert.ok(
    !ids(await call(who, "GET", "/search?q=entanglement")).includes(doc.id),
  );
  assert.ok(
    ids(
      await call(who, "GET", "/search?q=entanglement&include_archived=1"),
    ).includes(doc.id),
  );
  assert.ok(
    !ids(await call(who, "GET", "/links/pick?q=Quantum%20term")).includes(
      doc.id,
    ),
  );
  // It still opens, whole.
  assert.equal((await call(who, "GET", `/docs/${doc.id}`)).statusCode, 200);
  // And comes back.
  const back = await call(who, "PUT", `/docs/${doc.id}/archive`, {
    archived: false,
  });
  assert.equal(back.json().archived, false);
  assert.ok(ids(await call(who, "GET", "/docs")).includes(doc.id));
});

test("an archived folder takes its pages out of lists; several pages move, archive or take a tag at once", async () => {
  const who = await register("Fol Der");
  const folder = (
    await call(who, "POST", "/folders", { name: "Last term" })
  ).json().id as string;
  const a = await page(who, "Old lecture A", [p("a")], { folder_id: folder });
  const b = await page(who, "Loose page B", [p("b")]);
  const c = await page(who, "Loose page C", [p("c")]);
  const theirs = await page(owner, "Not yours", [p("x")]);
  const res = await call(who, "PUT", `/folders/${folder}/archive`, {
    archived: true,
  });
  assert.equal(res.statusCode, 200, res.body);
  const listed = (await call(who, "GET", "/docs")).json() as { id: string }[];
  assert.ok(!listed.some((d) => d.id === a.id));
  const folders = (await call(who, "GET", "/folders")).json() as {
    id: string;
    archived_at: string | null;
  }[];
  assert.ok(folders.find((f) => f.id === folder)?.archived_at);
  await call(who, "PUT", `/folders/${folder}/archive`, { archived: false });

  const tag = (await call(who, "POST", "/tags", { name: "revise" })).json()
    .id as string;
  const bulk = await call(who, "POST", "/docs/bulk", {
    ids: [b.id, c.id, theirs.id],
    folder_id: folder,
    tag_id: tag,
  });
  assert.equal(bulk.statusCode, 200, bulk.body);
  assert.deepEqual(bulk.json().done.sort(), [b.id, c.id].sort());
  assert.deepEqual(
    bulk.json().skipped.map((s: { id: string }) => s.id),
    [theirs.id],
  );
  const moved = (await call(who, "GET", `/docs/${b.id}`)).json();
  assert.equal(moved.folder_id, folder);
  assert.ok(moved.tags.some((t: { id: string }) => t.id === tag));
  assert.ok(moved.version > b.version);
  // Out of the folder, and archived, together.
  const out = await call(who, "POST", "/docs/bulk", {
    ids: [b.id, c.id],
    folder_id: null,
    archived: true,
  });
  assert.equal(out.json().done.length, 2);
  const after = (await call(who, "GET", `/docs/${c.id}`)).json();
  assert.equal(after.folder_id, null);
  assert.equal(after.archived, true);
  // The owner's page is untouched.
  const still = (await call(owner, "GET", `/docs/${theirs.id}`)).json();
  assert.equal(still.folder_id, null);
});

test("archive and bulk: 401, 422, 404 not yours, 403 a viewer, 429", async () => {
  const who = await register("Arc Guard");
  const doc = await page(who, "Mine", [p("x")]);
  const team = await page(owner, "Team page", [p("t")], { team_id: teamId });
  assert.equal(
    (await call(null, "PUT", `/docs/${doc.id}/archive`, { archived: true }))
      .statusCode,
    401,
  );
  assert.equal(
    (await call(null, "POST", "/docs/bulk", { ids: [doc.id], archived: true }))
      .statusCode,
    401,
  );
  assert.equal(
    (await call(who, "PUT", `/docs/${doc.id}/archive`, { archived: "yes" }))
      .statusCode,
    422,
  );
  assert.equal(
    (await call(who, "POST", "/docs/bulk", { ids: [doc.id] })).statusCode,
    422,
  );
  assert.equal(
    (await call(who, "POST", "/docs/bulk", { ids: [], archived: true }))
      .statusCode,
    422,
  );
  assert.equal(
    (await call(stranger, "PUT", `/docs/${doc.id}/archive`, { archived: true }))
      .statusCode,
    404,
  );
  assert.equal(
    (await call(viewer, "PUT", `/docs/${team.id}/archive`, { archived: true }))
      .statusCode,
    403,
  );
  const folder = (await call(who, "POST", "/folders", { name: "F" })).json()
    .id as string;
  assert.equal(
    (
      await call(stranger, "PUT", `/folders/${folder}/archive`, {
        archived: true,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    await hammer(
      who,
      "PUT",
      `/docs/${doc.id}/archive`,
      { archived: true },
      32,
      "10.95.251.2",
    ),
    429,
  );
});

// ------------------------------------------------------------- CNV-02

test("the Connections map shows what's linked, one or two steps out, and nothing the reader can't open", async () => {
  const who = await register("Map Maker");
  const t = await task(who, "Order lenses");
  const far = await page(who, "Optics supplier", [p("Call Monday")]);
  const middle = await page(who, "Lab setup", [
    p(`Supplier: [Optics supplier](orbyn://doc/${far.id})`),
  ]);
  const secret = await page(owner, "Owner's secret plan", [p("x")]);
  const centre = await page(who, "Experiment 4", [
    p(`Needs [Order lenses](orbyn://task/${t.id})`),
    p(`See [Lab setup](orbyn://doc/${middle.id})`),
    p(`And [Hidden](orbyn://doc/${secret.id})`),
  ]);
  const one = await call(
    who,
    "GET",
    `/links/map?kind=doc&id=${centre.id}&depth=1`,
  );
  assert.equal(one.statusCode, 200, one.body);
  const map1 = one.json() as {
    nodes: { key: string; title: string; depth: number; kind: string }[];
    edges: { from: string; to: string; label: string }[];
    truncated: boolean;
  };
  const titles = map1.nodes.map((n) => n.title).sort();
  assert.deepEqual(titles, ["Experiment 4", "Lab setup", "Order lenses"]);
  assert.ok(!JSON.stringify(map1).includes("secret"));
  assert.ok(!JSON.stringify(map1).includes(secret.id));
  assert.equal(map1.nodes.find((n) => n.depth === 0)?.title, "Experiment 4");
  assert.ok(map1.edges.every((e) => e.label === "Links to"));
  const two = (
    await call(who, "GET", `/links/map?kind=doc&id=${centre.id}&depth=2`)
  ).json() as typeof map1;
  const supplier = two.nodes.find((n) => n.title === "Optics supplier");
  assert.equal(supplier?.depth, 2);
  assert.ok(
    two.edges.some(
      (e) =>
        (e.from === `doc:${middle.id}` && e.to === supplier?.key) ||
        (e.to === `doc:${middle.id}` && e.from === supplier?.key),
    ),
  );
  // A project's map has its pages and tasks.
  const project = (
    await call(who, "POST", "/projects", { name: "Telescope" })
  ).json() as { id: string };
  await page(who, "Telescope brief", [p("brief")], { project_id: project.id });
  const pt = await call(who, "POST", "/items", {
    kind: "task",
    title: "Grind mirror",
  });
  await pool.query("UPDATE items SET project_id = $2 WHERE id = $1", [
    pt.json().id,
    project.id,
  ]);
  const pm = (
    await call(who, "GET", `/links/map?kind=project&id=${project.id}`)
  ).json() as typeof map1;
  assert.deepEqual(pm.nodes.map((n) => n.title).sort(), [
    "Grind mirror",
    "Telescope",
    "Telescope brief",
  ]);
});

test("the map: 401 signed out, 422 bad depth or kind, 404 a page you can't open", async () => {
  const who = await register("Map Guard");
  const doc = await page(who, "Mine", [p("x")]);
  const theirs = await page(owner, "Theirs", [p("x")]);
  assert.equal(
    (await call(null, "GET", `/links/map?kind=doc&id=${doc.id}`)).statusCode,
    401,
  );
  assert.equal(
    (await call(who, "GET", `/links/map?kind=doc&id=${doc.id}&depth=3`))
      .statusCode,
    422,
  );
  assert.equal(
    (await call(who, "GET", `/links/map?kind=task&id=${doc.id}`)).statusCode,
    422,
  );
  assert.equal(
    (await call(who, "GET", `/links/map?kind=doc&id=${theirs.id}`)).statusCode,
    404,
  );
  assert.equal(
    await hammer(
      who,
      "GET",
      `/links/map?kind=doc&id=${doc.id}`,
      undefined,
      62,
      "10.95.251.3",
    ),
    429,
  );
});

// ------------------------------------------------------------- OTH-04

test("a team's switches: members read them, owners change them, and each one takes effect", async () => {
  const team = (
    await call(owner, "POST", "/teams", { name: "Switches" })
  ).json().id as string;
  await call(owner, "POST", `/teams/${team}/members`, {
    email: mate.email,
    role: "member",
  });
  const got = (await call(mate, "GET", `/teams/${team}/policies`)).json();
  assert.deepEqual(got, {
    publishing: true,
    assistant: true,
    booking: true,
    can_change: false,
  });
  assert.equal(
    (await call(mate, "PUT", `/teams/${team}/policies`, { assistant: false }))
      .statusCode,
    403,
  );
  // The assistant: team pages are kept out of it; personal pages aren't.
  const teamPage = await page(mate, "Team notes", [p("Budget talk", "b1")], {
    team_id: team,
  });
  const own = await page(mate, "My notes", [p("Mine", "m1")]);
  const off = await call(owner, "PUT", `/teams/${team}/policies`, {
    assistant: false,
  });
  assert.equal(off.statusCode, 200, off.body);
  assert.equal(off.json().assistant, false);
  const ask = await call(mate, "POST", `/docs/${teamPage.id}/ask`, {
    question: "What is this?",
  });
  assert.equal(ask.statusCode, 403, ask.body);
  assert.match(ask.json().message, /keeps its pages out of the assistant/);
  const chip = await call(mate, "POST", "/ai/assist", {
    action: "summarise",
    doc_id: teamPage.id,
  });
  assert.equal(chip.statusCode, 403);
  replies = ['{"summary": "- Mine"}'];
  const mine = await call(mate, "POST", "/ai/assist", {
    action: "summarise",
    doc_id: own.id,
  });
  assert.equal(mine.statusCode, 200, mine.body);
  // Publishing is the same switch as the publishing panel's.
  await call(owner, "PUT", `/teams/${team}/policies`, { publishing: false });
  assert.equal(
    (await call(owner, "GET", `/teams/${team}/publishing`)).json().allowed,
    false,
  );
  // Booking: the team's pages stop taking bookings from outside.
  const slug = `d5-${randomUUID().slice(0, 8)}`;
  const bp = await call(owner, "POST", "/booking-pages", {
    slug,
    title: "Office hours",
    durations: [30],
    team_id: team,
  });
  assert.equal(bp.statusCode, 201, bp.body);
  assert.equal((await call(null, "GET", `/book/${slug}`)).statusCode, 200);
  await call(owner, "PUT", `/teams/${team}/policies`, { booking: false });
  assert.equal((await call(null, "GET", `/book/${slug}`)).statusCode, 404);
  await call(owner, "PUT", `/teams/${team}/policies`, { booking: true });
  assert.equal((await call(null, "GET", `/book/${slug}`)).statusCode, 200);
  const audited = (
    await pool.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE target_id = $1 ORDER BY created_at",
      [team],
    )
  ).rows.map((r) => r.action);
  assert.ok(audited.includes("team.assistant_off"));
  assert.ok(audited.includes("team.booking_on"));
});

test("team switches: 401, 422, 404 not a member, 403 for an API key", async () => {
  assert.equal(
    (await call(null, "GET", `/teams/${teamId}/policies`)).statusCode,
    401,
  );
  assert.equal(
    (await call(owner, "PUT", `/teams/${teamId}/policies`, {})).statusCode,
    422,
  );
  assert.equal(
    (
      await call(owner, "PUT", `/teams/${teamId}/policies`, {
        assistant: "no",
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (await call(stranger, "GET", `/teams/${teamId}/policies`)).statusCode,
    404,
  );
  const key = await apiKey(owner);
  assert.equal(
    (await call(key, "PUT", `/teams/${teamId}/policies`, { booking: true }))
      .statusCode,
    403,
  );
});

// ------------------------------------------------------------- CAP-10

test("a recording's summary and action items come from the assistant only when asked", async () => {
  const who = await register("Rec Order");
  const doc = await page(who, "Lecture 5", [p("Recorded below.")]);
  const fileId = (
    await pool.query<{ id: string }>(
      `INSERT INTO page_files (user_id, doc_id, name, mime, kind, bytes, status)
         VALUES ($1, $2, 'Lecture.webm', 'audio/webm', 'file', 2048, 'ready')
       RETURNING id`,
      [who.id, doc.id],
    )
  ).rows[0].id;
  asked.length = 0;
  replies = [
    JSON.stringify({
      summary: "Waves carry energy.\n\nThe lab is next week.",
      actions: [
        { title: "Hand in lab report", due: "2026-10-03" },
        { title: "Read chapter 4", due: "sometime" },
      ],
    }),
  ];
  const res = await call(who, "POST", `/ai/recordings/${fileId}/summary`, {
    transcript:
      "Today: waves carry energy. Hand in the lab report on 3 October.",
  });
  assert.equal(res.statusCode, 200, res.body);
  const s = res.json();
  assert.match(s.summary, /Waves carry energy/);
  assert.deepEqual(s.actions, [
    { title: "Hand in lab report", due: "2026-10-03" },
    { title: "Read chapter 4", due: null },
  ]);
  // Only the words were sent, as data.
  assert.equal(asked.length, 1);
  assert.match(asked[0], /<transcript>/);
  // Nothing was written to the page.
  const after = (await call(who, "GET", `/docs/${doc.id}`)).json();
  assert.equal(after.version, doc.version);
});

test("recording summary: 401, 404 not yours, 400 not a recording, 403 team off, 422, 429", async () => {
  const who = await register("Rec Guard");
  const doc = await page(who, "Notes", [p("x")]);
  const insert = async (mime: string, docId = doc.id, user = who.id) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO page_files (user_id, doc_id, name, mime, kind, bytes, status)
           VALUES ($1, $2, 'f', $3, 'file', 10, 'ready') RETURNING id`,
        [user, docId, mime],
      )
    ).rows[0].id;
  const audio = await insert("audio/mp4");
  const pdf = await insert("application/pdf");
  assert.equal(
    (await call(null, "POST", `/ai/recordings/${audio}/summary`, {}))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await call(stranger, "POST", `/ai/recordings/${audio}/summary`, {
        transcript: "x",
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(who, "POST", `/ai/recordings/${pdf}/summary`, {
        transcript: "x",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(who, "POST", `/ai/recordings/${audio}/summary`, {
        transcript: 5,
      })
    ).statusCode,
    422,
  );
  const team = (await call(owner, "POST", "/teams", { name: "Quiet" })).json()
    .id as string;
  const teamDoc = await page(owner, "Team lecture", [p("x")], {
    team_id: team,
  });
  const teamAudio = await insert("audio/webm", teamDoc.id, owner.id);
  await call(owner, "PUT", `/teams/${team}/policies`, { assistant: false });
  assert.equal(
    (
      await call(owner, "POST", `/ai/recordings/${teamAudio}/summary`, {
        transcript: "x",
      })
    ).statusCode,
    403,
  );
  const key = await apiKey(who);
  assert.equal(
    (
      await call(key, "POST", `/ai/recordings/${audio}/summary`, {
        transcript: "x",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    await hammer(
      who,
      "POST",
      `/ai/recordings/${pdf}/summary`,
      { transcript: "x" },
      12,
      "10.95.251.4",
    ),
    429,
  );
});

// ------------------------------------------------ CAP-02, 03, 04

const ARTICLE = `<!doctype html><html><head>
<title>Why the sky is blue | Science Daily</title>
<meta property="og:title" content="Why the sky is blue">
</head><body>
<nav><a href="/">Home</a> <a href="/news">News</a></nav>
<header>Science Daily</header>
<article>
<h1>Why the sky is blue</h1>
<p>Sunlight is scattered by the <strong>molecules</strong> in the air, and
blue light is scattered more than red. This is <a href="/rayleigh">Rayleigh
scattering</a>, named after Lord Rayleigh who described it in 1871.</p>
<p>Links to <a href="javascript:alert(1)">nowhere</a> stay words. A sneaky
[link](orbyn://doc/00000000-0000-0000-0000-000000000000) stays harmless.</p>
<ul><li>Short wavelengths scatter most</li><li>Sunsets look red</li></ul>
<script>steal()</script>
</article>
<footer>Copyright</footer>
<div class="cookie-banner">Accept cookies</div>
</body></html>`;

test("the Clipper saves an article as a clean page with where it came from", async () => {
  const who = await register("Cli Pper");
  const made = await call(who, "POST", "/me/clip-keys", { name: "Laptop" });
  assert.equal(made.statusCode, 201, made.body);
  const key: Person = { ...who, token: made.json().key };
  assert.match(key.token, /^ocl_/);
  assert.equal(made.json().clip_key.hint, key.token.slice(-4));
  const folder = (
    await call(who, "POST", "/folders", { name: "Reading" })
  ).json().id as string;
  const dests = (await call(key, "GET", "/clips/destinations")).json();
  assert.ok(dests.folders.some((f: { id: string }) => f.id === folder));
  // A dry run says what would be saved and saves nothing.
  const dry = await call(key, "POST", "/clips", {
    type: "article",
    url: "https://science.example.com/sky",
    html: ARTICLE,
    folder_id: folder,
    dry_run: true,
  });
  assert.equal(dry.statusCode, 200, dry.body);
  assert.equal(dry.json().made, null);
  assert.equal(dry.json().title, "Why the sky is blue");
  const res = await call(key, "POST", "/clips", {
    type: "article",
    url: "https://science.example.com/sky",
    html: ARTICLE,
    folder_id: folder,
    time_zone: "Europe/London",
  });
  assert.equal(res.statusCode, 201, res.body);
  const docId = res.json().made.id;
  const doc = (await call(who, "GET", `/docs/${docId}`)).json();
  assert.equal(doc.folder_id, folder);
  assert.equal(doc.title, "Why the sky is blue");
  const text = JSON.stringify(doc.content);
  assert.match(doc.content[0].text, /^Clipped from \[science\.example\.com\]/);
  assert.match(text, /\*\*molecules\*\*/);
  assert.match(
    text,
    /\[Rayleigh scattering\]\(https:\/\/science\.example\.com\/rayleigh\)/,
  );
  assert.match(text, /Sunsets look red/);
  for (const gone of [
    "steal",
    "Accept cookies",
    "Copyright",
    "javascript:",
    "orbyn://doc",
  ])
    assert.ok(!text.includes(gone), gone);
  // The link-looking words made no link.
  const links = (
    await pool.query(
      "SELECT 1 FROM object_links WHERE source_id = $1 AND link_kind = 'link'",
      [docId],
    )
  ).rowCount;
  assert.equal(links, 0);
});

test("papers, assignments, read later and highlights take their own shapes", async () => {
  const who = await register("Stu Dent");
  const key: Person = {
    ...who,
    token: (await call(who, "POST", "/me/clip-keys", {})).json().key,
  };
  const paper = await call(key, "POST", "/clips", {
    type: "paper",
    url: "https://arxiv.org/abs/2401.00001",
    html: `<html><head><meta name="citation_title" content="Deep waves">
      <meta name="citation_author" content="Ada Lovelace">
      <meta name="citation_author" content="Alan Turing">
      <meta name="citation_publication_date" content="2024/01/02">
      <meta name="citation_doi" content="10.1234/waves.5"></head>
      <body><main><p>${"Waves are deep. ".repeat(30)}</p></main></body></html>`,
  });
  assert.equal(paper.statusCode, 201, paper.body);
  const pdoc = (await call(who, "GET", `/docs/${paper.json().made.id}`)).json();
  assert.equal(pdoc.title, "Deep waves");
  const ptext = JSON.stringify(pdoc.content);
  assert.match(ptext, /Ada Lovelace, Alan Turing/);
  assert.match(ptext, /\*\*Year:\*\* 2024/);
  assert.match(ptext, /doi\.org\/10\.1234\/waves\.5/);

  const assignment = await call(key, "POST", "/clips", {
    type: "assignment",
    url: "https://school.instructure.com/courses/1/assignments/2",
    title: "Lab report 2",
    html: "<main><h2>Lab report 2</h2><p>Due: October 3, 2026 5pm. Submit online.</p></main>",
    time_zone: "Europe/London",
  });
  assert.equal(assignment.statusCode, 201, assignment.body);
  assert.equal(assignment.json().made.kind, "task");
  assert.equal(assignment.json().due_at, "2026-10-03T16:00:00.000Z");
  const item = (
    await call(who, "GET", `/items/${assignment.json().made.id}`)
  ).json();
  assert.equal(item.title, "Lab report 2");
  assert.equal(item.due_at, "2026-10-03T16:00:00.000Z");
  assert.match(item.notes, /instructure\.com/);
  // A date that can't be trusted is left for the person, and said why.
  const vague = await call(key, "POST", "/clips", {
    type: "assignment",
    url: "https://school.instructure.com/courses/1/assignments/3",
    title: "Essay",
    html: "<main><p>Due Friday. Around 2000 words.</p></main>",
    dry_run: true,
  });
  assert.equal(vague.json().due_at, null);
  assert.match(vague.json().due_note, /isn't a full date/);

  const later = await call(key, "POST", "/clips", {
    type: "read_later",
    url: "https://blog.example.com/long-read",
    title: "A long read",
    html: `<article><p>${"word ".repeat(1200)}</p></article>`,
  });
  assert.equal(later.statusCode, 201, later.body);
  const laterItem = (
    await call(who, "GET", `/items/${later.json().made.id}`)
  ).json();
  assert.equal(laterItem.title, "Read: A long read");
  assert.equal(laterItem.estimate_minutes, 5);

  // Highlights as quotes on a new page, then as cards on a page of cards.
  const quotes = await call(key, "POST", "/clips", {
    type: "highlights",
    url: "https://science.example.com/sky",
    title: "Why the sky is blue",
    highlights: [{ text: "Blue light is scattered more than red." }],
  });
  assert.equal(quotes.statusCode, 201, quotes.body);
  const qdoc = (
    await call(who, "GET", `/docs/${quotes.json().made.id}`)
  ).json();
  assert.equal(qdoc.title, "Highlights: Why the sky is blue");
  assert.equal(qdoc.content[1].type, "quote");
  assert.match(qdoc.content[1].text, /\(\[source\]\(https:\/\/science/);
  const deck = await page(who, "Physics cards", [
    { type: "heading", level: 2, text: "Cards" },
    { type: "bullet", text: "Speed of light :: 3e8 m/s" },
  ]);
  const cards = await call(key, "POST", "/clips", {
    type: "highlights",
    highlights_as: "cards",
    url: "https://science.example.com/sky",
    doc_id: deck.id,
    highlights: [
      { text: "Rayleigh described it in 1871.", hide: "1871" },
      { text: "Blue light is scattered more than red." },
    ],
  });
  assert.equal(cards.statusCode, 201, cards.body);
  assert.equal(cards.json().cards, 2);
  const after = (await call(who, "GET", `/docs/${deck.id}`)).json();
  const lines = after.content.map((b: { text?: string }) => b.text ?? "");
  assert.ok(lines.includes("Rayleigh described it in {{1871}}."));
  assert.ok(lines.some((l: string) => /\{\{scattered\}\}/.test(l)));
  assert.equal(after.version, deck.version + 1);
  // The cards are study cards now.
  const destinations = (await call(key, "GET", "/clips/destinations")).json();
  assert.ok(
    destinations.card_pages.some((c: { id: string }) => c.id === deck.id),
  );
});

test("a Clipper key clips and does nothing else; keys are made and removed signed in", async () => {
  const who = await register("Key Keeper");
  const made = (
    await call(who, "POST", "/me/clip-keys", { name: "Work" })
  ).json();
  const key: Person = { ...who, token: made.key };
  for (const [method, url] of [
    ["GET", "/docs"],
    ["GET", "/me"],
    ["GET", "/items"],
    ["GET", "/me/clip-keys"],
    ["POST", "/me/clip-keys"],
    ["GET", "/me/prefs"],
  ] as const) {
    const res = await call(
      key,
      method,
      url,
      method === "POST" ? {} : undefined,
    );
    assert.equal(res.statusCode, 401, `${method} ${url}: ${res.body}`);
    assert.match(res.json().message, /Clipper key only saves clips/);
  }
  // A personal API key can't mint Clipper keys.
  const api = await apiKey(who);
  assert.equal((await call(api, "POST", "/me/clip-keys", {})).statusCode, 403);
  const listed = (await call(who, "GET", "/me/clip-keys")).json();
  assert.equal(listed.length, 1);
  assert.ok(!JSON.stringify(listed).includes(key.token));
  // Another person can't remove it; its owner can, and then it stops working.
  assert.equal(
    (await call(stranger, "DELETE", `/me/clip-keys/${made.clip_key.id}`))
      .statusCode,
    404,
  );
  assert.equal(
    (await call(who, "DELETE", `/me/clip-keys/${made.clip_key.id}`)).statusCode,
    204,
  );
  assert.equal((await call(key, "GET", "/clips/destinations")).statusCode, 401);
});

test("clips: 401, 422 bad input, 404 somewhere you can't put it, 403 a viewer's team, 429", async () => {
  const who = await register("Clip Guard");
  const key: Person = {
    ...who,
    token: (await call(who, "POST", "/me/clip-keys", {})).json().key,
  };
  assert.equal((await call(null, "POST", "/clips", {})).statusCode, 401);
  assert.equal(
    (await call(null, "GET", "/clips/destinations")).statusCode,
    401,
  );
  assert.equal(
    (await call({ ...who, token: "ocl_made_up" }, "GET", "/clips/destinations"))
      .statusCode,
    401,
  );
  for (const bad of [
    { type: "article", url: "javascript:alert(1)", html: "<p>x</p>" },
    { type: "article", url: "file:///etc/passwd", html: "<p>x</p>" },
    { type: "podcast", url: "https://x.example" },
    { type: "highlights", url: "https://x.example", highlights: [] },
  ])
    assert.equal(
      (await call(key, "POST", "/clips", bad)).statusCode,
      422,
      JSON.stringify(bad),
    );
  // Nothing readable.
  assert.equal(
    (
      await call(key, "POST", "/clips", {
        type: "article",
        url: "https://x.example",
        html: "<script>x()</script>",
      })
    ).statusCode,
    422,
  );
  const theirFolder = (
    await call(owner, "POST", "/folders", { name: "Owner's" })
  ).json().id as string;
  assert.equal(
    (
      await call(key, "POST", "/clips", {
        type: "article",
        url: "https://x.example",
        html: "<p>Something worth reading here.</p>",
        folder_id: theirFolder,
      })
    ).statusCode,
    404,
  );
  const viewerKey: Person = {
    ...viewer,
    token: (await call(viewer, "POST", "/me/clip-keys", {})).json().key,
  };
  assert.equal(
    (
      await call(viewerKey, "POST", "/clips", {
        type: "article",
        url: "https://x.example",
        html: "<p>Something worth reading here.</p>",
        team_id: teamId,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    await hammer(
      key,
      "POST",
      "/clips",
      {
        type: "article",
        url: "https://x.example",
        html: "<p>x</p>",
        dry_run: true,
      },
      62,
      "10.95.251.5",
    ),
    429,
  );
});
