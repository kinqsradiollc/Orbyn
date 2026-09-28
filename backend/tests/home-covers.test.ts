import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { DEFAULT_HOME, type DocBlock } from "@orbyn/core";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";

/**
 * W1 Home and W6 covers and icons, on the server:
 * - Home's layout (hubs, panel order, hidden panels, the quote) follows the
 *   account in /me/prefs, with the defaults until something is chosen;
 * - GET /me/home answers goals, routines, today's brief and reflection;
 * - "How did today go?" adds a line under Reflection on today's agenda;
 * - a project's and a page's cover and icon: set, cleared, only by someone
 *   who may change it, only with a picture they can see, and undoable when
 *   an agent set them (update_project, organize "look").
 * No AI provider is ever reached.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

let ana: Person;
let bo: Person;
let agentKey = "";
let agentGrant = "";

/** A ready picture on a page, as an upload leaves it. */
const picture = async (who: Person, docId: string) =>
  (
    await pool.query<{ id: string }>(
      `INSERT INTO page_files (user_id, doc_id, name, mime, kind, bytes, status)
       VALUES ($1, $2, 'cover.png', 'image/png', 'image', 10, 'ready')
       RETURNING id`,
      [who.id, docId],
    )
  ).rows[0].id;

const newPage = async (who: Person, title: string) => {
  const r = await h.call(who.token, "POST", "/docs", { title });
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as { id: string; version: number };
};

const newProject = async (who: Person, name: string) => {
  const r = await h.call(who.token, "POST", "/projects", { name });
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as { id: string };
};

async function tool(name: string, args: Record<string, unknown>) {
  limiter.reset();
  strikes.reset();
  const r = await h.tool(agentKey, name, args);
  assert.ok(r, `${name}: no result`);
  assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
  return r;
}

const undoLast = async () => {
  const act = (
    await pool.query<{ id: string }>(
      "SELECT id FROM agent_activity WHERE grant_id = $1 ORDER BY id DESC LIMIT 1",
      [agentGrant],
    )
  ).rows[0];
  const r = await h.call(
    ana.token,
    "POST",
    `/me/agents/activity/${act.id}/undo`,
  );
  assert.equal(r.statusCode, 200, r.body);
};

before(async () => {
  await migrate();
  ana = await h.register("home-ana", "Ana Home");
  bo = await h.register("home-bo", "Bo Home");
  const k = await h.agentKey(ana, {
    access: "write",
    team_ids: [],
    toolsets: ["core", "workspace"],
  });
  agentKey = k.key;
  agentGrant = k.id;
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(
    network.calls,
    [],
    "Home and covers never reach the network",
  );
  network.restore();
  await app.close();
  await pool.end();
});

// ------------------------------------------------------------ W1 prefs ---

test("Home's layout follows the account: defaults, a round trip, and its checks", async () => {
  const first = (await h.call(ana.token, "GET", "/me/prefs")).json();
  assert.deepEqual(first.home, DEFAULT_HOME);
  assert.deepEqual(
    first.home.hubs.map((x: { title: string }) => x.title),
    ["Projects", "Study", "Docs"],
  );

  const quotes = await newPage(ana, "My quotes");
  const photos = await newPage(ana, "Photos");
  const pic = await picture(ana, photos.id);
  const project = await newProject(ana, "Thesis");
  const home = {
    hubs: [
      {
        id: "uni",
        title: "Uni",
        cover_file_id: pic,
        icon: "🎓",
        auto: null,
        links: [
          { kind: "project", id: project.id, label: "Thesis", tag: "Now" },
          { kind: "page", id: quotes.id, label: "My quotes" },
        ],
      },
      { ...DEFAULT_HOME.hubs[0] },
    ],
    order: ["reflection", "goals", "hubs", "routines"],
    hidden: ["routines"],
    quote: { on: true, doc_id: quotes.id },
  };
  const saved = await h.call(ana.token, "PUT", "/me/prefs", { home });
  assert.equal(saved.statusCode, 200, saved.body);
  // The other choices stay as they were.
  await h.call(ana.token, "PUT", "/me/prefs", {
    views: { tasks: { layout: "board" } },
  });
  const now = (await h.call(ana.token, "GET", "/me/prefs")).json();
  assert.deepEqual(now.home, home);
  assert.equal(now.views.tasks.layout, "board");
  // Someone else's Home is their own.
  assert.deepEqual(
    (await h.call(bo.token, "GET", "/me/prefs")).json().home,
    DEFAULT_HOME,
  );
  // A hub can't wear a picture its owner can't see.
  const bosPage = await newPage(bo, "Bo's photos");
  const bosPic = await picture(bo, bosPage.id);
  const hidden = await h.call(ana.token, "PUT", "/me/prefs", {
    home: { ...home, hubs: [{ ...home.hubs[0], cover_file_id: bosPic }] },
  });
  assert.equal(hidden.statusCode, 404, hidden.body);
  for (const bad of [
    { ...home, hubs: [home.hubs[0], home.hubs[0]] },
    { ...home, order: ["sidebar"] },
    { ...home, hubs: [{ ...home.hubs[0], icon: "not an icon" }] },
    {
      ...home,
      hubs: [
        {
          ...home.hubs[0],
          links: Array.from({ length: 7 }, () => home.hubs[0].links[0]),
        },
      ],
    },
  ])
    assert.equal(
      (await h.call(ana.token, "PUT", "/me/prefs", { home: bad })).statusCode,
      422,
      JSON.stringify(bad),
    );
  assert.equal(
    (await h.call(null, "PUT", "/me/prefs", { home })).statusCode,
    401,
  );
  // Back as it came.
  assert.equal(
    (await h.call(ana.token, "DELETE", "/me/prefs")).statusCode,
    204,
  );
  assert.deepEqual(
    (await h.call(ana.token, "GET", "/me/prefs")).json().home,
    DEFAULT_HOME,
  );
});

// ------------------------------------------------------ W1 panels ---

test("Home's panels: active goals with progress and check-in, routines, and reflection on the agenda", async () => {
  const who = await h.register("home-cy", "Cy Home");
  const project = await newProject(who, "Marathon");
  for (const [title, status] of [
    ["Run 5k", "done"],
    ["Run 10k", "todo"],
  ])
    await h.call(who.token, "POST", "/items", {
      kind: "task",
      title,
      status,
      project_id: project.id,
    });
  const goal = await h.call(who.token, "POST", "/me/goals", {
    title: "Run a marathon",
    project_id: project.id,
  });
  assert.equal(goal.statusCode, 201, goal.body);
  await h.call(who.token, "POST", "/me/goals", {
    title: "Finished thing",
    status: "done",
  });
  const routine = await h.call(who.token, "POST", "/me/agent-routines", {
    instruction: "Check my week",
    rrule: "FREQ=DAILY",
    next_run_at: new Date(Date.now() + 3600_000).toISOString(),
  });
  assert.ok([200, 201, 202].includes(routine.statusCode), routine.body);

  let home = await h.call(who.token, "GET", "/me/home");
  assert.equal(home.statusCode, 200, home.body);
  let body = home.json();
  assert.equal(body.goals.length, 1, "only active goals");
  assert.equal(body.goals[0].title, "Run a marathon");
  assert.equal(body.goals[0].progress, 0.5);
  assert.equal(body.goals[0].progress_label, "1 of 2 tasks");
  assert.match(body.goals[0].next_checkin, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(body.brief, null);
  assert.deepEqual(body.reflection, []);
  if (routine.statusCode === 201)
    assert.equal(body.routines[0].name, "Check my week");

  // A goal on a project kept out of AI isn't shown as the assistant's.
  const off = await h.call(
    who.token,
    "PUT",
    `/projects/${project.id}/assistant`,
    { off: true },
  );
  assert.equal(off.statusCode, 200, off.body);
  body = (await h.call(who.token, "GET", "/me/home")).json();
  assert.equal(body.goals.length, 0);

  // "How did today go?" writes today's agenda if need be, under Reflection.
  const one = await h.call(who.token, "POST", "/me/home/reflection", {
    text: "  A good long run.  ",
  });
  assert.equal(one.statusCode, 201, one.body);
  const two = await h.call(who.token, "POST", "/me/home/reflection", {
    text: "Tired but happy",
  });
  assert.equal(two.statusCode, 201, two.body);
  assert.deepEqual(two.json().reflection, [
    "A good long run.",
    "Tired but happy",
  ]);
  const doc = (
    await pool.query<{ kind: string; content: DocBlock[]; user_id: string }>(
      "SELECT kind, content, user_id FROM docs WHERE id = $1",
      [two.json().doc_id],
    )
  ).rows[0];
  assert.equal(doc.kind, "agenda");
  assert.equal(doc.user_id, who.id);
  const at = doc.content.findIndex(
    (b) => b.type === "heading" && b.text === "Reflection",
  );
  assert.ok(at >= 0, "a Reflection heading");
  assert.deepEqual(
    doc.content.slice(at + 1, at + 3).map((b) => ("text" in b ? b.text : "")),
    ["A good long run.", "Tired but happy"],
  );
  assert.equal(
    doc.content.filter((b) => b.type === "heading" && b.text === "Reflection")
      .length,
    1,
  );
  // The state before is kept for history.
  const versions = await pool.query(
    "SELECT 1 FROM doc_versions WHERE doc_id = $1",
    [two.json().doc_id],
  );
  assert.ok(versions.rowCount! >= 1);
  home = await h.call(who.token, "GET", "/me/home");
  assert.equal(home.json().agenda_doc_id, two.json().doc_id);
  assert.deepEqual(home.json().reflection, [
    "A good long run.",
    "Tired but happy",
  ]);

  // Checks.
  assert.equal((await h.call(null, "GET", "/me/home")).statusCode, 401);
  assert.equal(
    (await h.call(null, "POST", "/me/home/reflection", { text: "x" }))
      .statusCode,
    401,
  );
  for (const bad of [
    {},
    { text: "   " },
    { text: "x".repeat(501) },
    { text: 1 },
  ])
    assert.equal(
      (await h.call(who.token, "POST", "/me/home/reflection", bad)).statusCode,
      422,
      JSON.stringify(bad),
    );
  // Nobody else's agenda is touched.
  assert.deepEqual(
    (await h.call(bo.token, "GET", "/me/home")).json().reflection,
    [],
  );
});

// ------------------------------------------------------ W6 covers ---

test("a project's cover and icon: set, cleared, only with a picture you can see, only by who may change it", async () => {
  const project = await newProject(ana, "Garden");
  const photos = await newPage(ana, "Garden photos");
  const pic = await picture(ana, photos.id);
  const set = await h.call(ana.token, "PUT", `/projects/${project.id}`, {
    cover_file_id: pic,
    icon: "🌱",
  });
  assert.equal(set.statusCode, 200, set.body);
  assert.equal(set.json().cover_file_id, pic);
  assert.equal(set.json().icon, "🌱");
  const read = (
    await h.call(ana.token, "GET", `/projects/${project.id}`)
  ).json();
  assert.equal(read.cover_file_id ?? read.project?.cover_file_id, pic);
  // One of the app's icons by name; the cover stays when left out.
  const named = await h.call(ana.token, "PUT", `/projects/${project.id}`, {
    icon: "icon:target",
  });
  assert.equal(named.json().icon, "icon:target");
  assert.equal(named.json().cover_file_id, pic);
  // A picture someone else keeps to themselves is "not found".
  const bosPage = await newPage(bo, "Bo's garden");
  const bosPic = await picture(bo, bosPage.id);
  assert.equal(
    (
      await h.call(ana.token, "PUT", `/projects/${project.id}`, {
        cover_file_id: bosPic,
      })
    ).statusCode,
    404,
  );
  // Only someone who may change the project.
  assert.equal(
    (
      await h.call(bo.token, "PUT", `/projects/${project.id}`, {
        icon: "🔥",
      })
    ).statusCode,
    404,
  );
  for (const icon of ["hello", "icon:nope", "🌱".repeat(20)])
    assert.equal(
      (await h.call(ana.token, "PUT", `/projects/${project.id}`, { icon }))
        .statusCode,
      422,
      icon,
    );
  // Cleared.
  const cleared = await h.call(ana.token, "PUT", `/projects/${project.id}`, {
    cover_file_id: null,
    icon: null,
  });
  assert.equal(cleared.json().cover_file_id, null);
  assert.equal(cleared.json().icon, null);
  // A picture taken off starts its 30 days, as a removed line's does.
  const file = (
    await pool.query("SELECT unused_since FROM page_files WHERE id = $1", [pic])
  ).rows[0];
  assert.ok(file.unused_since);
});

test("a page's cover and icon: its version stays, others can't set them, and whoever reads the page sees the cover", async () => {
  const crew = await h.team(ana, "Home crew", [[bo, "member"]]);
  const mine = await newPage(ana, "Recipes");
  const pic = await picture(ana, mine.id);
  const set = await h.call(ana.token, "PUT", `/docs/${mine.id}/look`, {
    cover_file_id: pic,
    icon: "icon:coffee",
  });
  assert.equal(set.statusCode, 200, set.body);
  assert.deepEqual(set.json(), { cover_file_id: pic, icon: "icon:coffee" });
  const doc = (await h.call(ana.token, "GET", `/docs/${mine.id}`)).json();
  assert.equal(doc.cover_file_id, pic);
  assert.equal(doc.icon, "icon:coffee");
  assert.equal(doc.version, mine.version, "a cover isn't an edit");
  const listed = (await h.call(ana.token, "GET", "/docs")).json();
  assert.equal(
    listed.find((d: { id: string }) => d.id === mine.id).icon,
    "icon:coffee",
  );
  // Someone else can't set covers on your pages (nor learn they exist).
  assert.equal(
    (await h.call(bo.token, "PUT", `/docs/${mine.id}/look`, { icon: "🔥" }))
      .statusCode,
    404,
  );
  // A team page: a teammate who reads it sees its cover, even one from
  // the setter's own page.
  const shared = (
    await h.call(ana.token, "POST", "/docs", {
      title: "Team menu",
      team_id: crew,
    })
  ).json();
  assert.equal(
    (
      await h.call(ana.token, "PUT", `/docs/${shared.id}/look`, {
        cover_file_id: pic,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await h.call(bo.token, "GET", `/docs/files/${pic}`)).statusCode,
    200,
  );
  // One only, not a picture they can't see; and something to change.
  const bosPage = await newPage(bo, "Bo's recipes");
  const bosPic = await picture(bo, bosPage.id);
  assert.equal(
    (
      await h.call(ana.token, "PUT", `/docs/${mine.id}/look`, {
        cover_file_id: bosPic,
      })
    ).statusCode,
    404,
  );
  for (const bad of [
    {},
    { icon: "words" },
    { cover_file_id: "nope" },
    { colour: "red" },
  ])
    assert.equal(
      (await h.call(ana.token, "PUT", `/docs/${mine.id}/look`, bad)).statusCode,
      422,
      JSON.stringify(bad),
    );
  assert.equal(
    (await h.call(null, "PUT", `/docs/${mine.id}/look`, { icon: "🔥" }))
      .statusCode,
    401,
  );
  // Cleared.
  const cleared = await h.call(ana.token, "PUT", `/docs/${mine.id}/look`, {
    cover_file_id: null,
    icon: null,
  });
  assert.deepEqual(cleared.json(), { cover_file_id: null, icon: null });
  // Your pictures, to choose from.
  const pictures = (await h.call(ana.token, "GET", "/me/pictures")).json();
  assert.ok(pictures.some((x: { id: string }) => x.id === pic));
  assert.ok(!pictures.some((x: { id: string }) => x.id === bosPic));
  assert.equal((await h.call(null, "GET", "/me/pictures")).statusCode, 401);
});

test("the sweeper keeps pictures that covers and hubs wear", async () => {
  const page = await newPage(ana, "Old photos");
  const [asCover, asHub, loose] = [
    await picture(ana, page.id),
    await picture(ana, page.id),
    await picture(ana, page.id),
  ];
  await pool.query(
    "UPDATE page_files SET created_at = now() - interval '60 days' WHERE id = ANY ($1::uuid[])",
    [[asCover, asHub, loose]],
  );
  await h.call(ana.token, "PUT", `/docs/${page.id}/look`, {
    cover_file_id: asCover,
  });
  await h.call(ana.token, "PUT", "/me/prefs", {
    home: {
      ...DEFAULT_HOME,
      hubs: [{ ...DEFAULT_HOME.hubs[0], cover_file_id: asHub }],
    },
  });
  const { SWEEP_RULES } = await import("../src/lib/sweep.js");
  const rule = (SWEEP_RULES as { key: string; where: string }[]).find(
    (r) => r.key === "page_files",
  )!;
  const gone = (
    await pool.query<{ id: string }>(
      `SELECT id FROM page_files WHERE id = ANY ($1::uuid[]) AND (${rule.where})`,
      [[asCover, asHub, loose]],
    )
  ).rows.map((r) => r.id);
  assert.deepEqual(gone, [loose]);
  await h.call(ana.token, "DELETE", "/me/prefs");
});

test("agents set covers and icons with update_project and organize look, and undo takes them back", async () => {
  const project = await newProject(ana, "Novel");
  const page = await newPage(ana, "Chapter one");
  const pic = await picture(ana, page.id);
  await tool("update_project", {
    project: `project:${project.id}`,
    cover: `orbyn://file/${pic}`,
    icon: "icon:graduationCap",
  });
  let row = (
    await pool.query("SELECT cover_file_id, icon FROM projects WHERE id = $1", [
      project.id,
    ])
  ).rows[0];
  assert.deepEqual(row, { cover_file_id: pic, icon: "icon:graduationCap" });
  await undoLast();
  row = (
    await pool.query("SELECT cover_file_id, icon FROM projects WHERE id = $1", [
      project.id,
    ])
  ).rows[0];
  assert.deepEqual(row, { cover_file_id: null, icon: null });

  await tool("organize", {
    changes: [{ do: "look", id: `doc:${page.id}`, cover: pic, icon: "📖" }],
  });
  row = (
    await pool.query("SELECT cover_file_id, icon FROM docs WHERE id = $1", [
      page.id,
    ])
  ).rows[0];
  assert.deepEqual(row, { cover_file_id: pic, icon: "📖" });
  await undoLast();
  row = (
    await pool.query("SELECT cover_file_id, icon FROM docs WHERE id = $1", [
      page.id,
    ])
  ).rows[0];
  assert.deepEqual(row, { cover_file_id: null, icon: null });

  // A picture the connection can't reach, and an icon that isn't one.
  const bosPage = await newPage(bo, "Bo's chapter");
  const bosPic = await picture(bo, bosPage.id);
  limiter.reset();
  strikes.reset();
  const refused = await h.tool(agentKey, "update_project", {
    project: `project:${project.id}`,
    cover: `orbyn://file/${bosPic}`,
  });
  assert.ok(refused?.isError);
  const badIcon = await h.tool(agentKey, "organize", {
    changes: [{ do: "look", id: `doc:${page.id}`, icon: "hello" }],
  });
  assert.ok(
    badIcon?.isError || badIcon?.structuredContent?.skipped?.length,
    JSON.stringify(badIcon),
  );
});
