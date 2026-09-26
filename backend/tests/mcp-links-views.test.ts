import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";

/**
 * A4: the Obsidian layer for agents. get_links over the object_links index
 * (picker links, checklist tasks, dependencies, related links, filed pages)
 * with visibility at both ends; saved views (save_view, query with a view,
 * relative dates, grouping, links_to, fetch view:, search, the app's
 * saved_views rows); get_project reading the project page's planning panel;
 * and the MCP resources, resource templates, completions and prompts.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { MARKDOWN_SPEC } = await import("../src/capabilities/guides.js");
const { PROMPTS } = await import("../src/capabilities/prompts.js");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

let olga: Person;
let mo: Person;
let vi: Person;
let otto: Person;
let crew = "";
let other = "";
const keys: Record<string, string> = {};
const make = async (
  name: string,
  who: Person,
  body: Record<string, unknown>,
) => {
  keys[name] = (await h.agentKey(who, body)).key;
};

type Result = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};

async function tool(
  key: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Result> {
  limiter.reset();
  strikes.reset();
  const r = await h.tool(key, name, args);
  assert.ok(r, `${name}: no result`);
  return r as Result;
}
const code = (r: Result) => r._meta?.["orbyn/error"]?.code as string;
const ok = (r: Result, what = "call") => {
  assert.ok(!r.isError, `${what}: ${r.content?.[0]?.text}`);
  return r.structuredContent;
};
const rpc = async (
  key: string,
  method: string,
  params: Record<string, unknown> = {},
) => {
  limiter.reset();
  strikes.reset();
  return h.legacy(key, method, params);
};

const newDoc = async (who: Person, body: Record<string, unknown>) =>
  (await h.call(who.token, "POST", "/docs", body)).json() as {
    id: string;
    version: number;
    content: { id: string; text?: string }[];
  };
const newTask = async (who: Person, body: Record<string, unknown>) =>
  (await h.call(who.token, "POST", "/items", body)).json() as {
    id: string;
    version: number;
  };

before(async () => {
  await migrate();
  olga = await h.register("lv-olga", "Olga");
  mo = await h.register("lv-mo", "Mo");
  vi = await h.register("lv-vi", "Vi");
  otto = await h.register("lv-otto", "Otto");
  crew = await h.team(olga, "Crew", [
    [mo, "member"],
    [vi, "viewer"],
  ]);
  other = await h.team(olga, "Other");
  await make("write", olga, {
    access: "write",
    team_ids: [crew, other],
    toolsets: ["core", "workspace"],
  });
  await make("crewOnly", olga, {
    access: "write",
    team_ids: [crew],
    personal: false,
    toolsets: ["core", "workspace"],
  });
  await make("read", olga, {
    access: "read",
    team_ids: [crew],
    toolsets: ["core", "workspace"],
  });
  await make("core", olga, { access: "write", team_ids: [crew] });
  await make("vi", vi, {
    access: "write",
    team_ids: [crew],
    toolsets: ["core", "workspace"],
  });
  await make("otto", otto, {
    access: "write",
    toolsets: ["core", "workspace"],
  });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, [], "A4 never reaches the network");
  network.restore();
  await app.close();
  await pool.end();
});

test("get_links: picker links, checklist tasks, dependencies and filed pages, both ways", async () => {
  const project = (
    await h.call(olga.token, "POST", "/projects", { name: "Thesis" })
  ).json();
  const target = await newDoc(olga, {
    title: "Sources",
    content: [{ type: "paragraph", text: "Reading list" }],
    project_id: project.id,
  });
  const task = await newTask(olga, { title: "Write chapter one" });
  const before = await newTask(olga, { title: "Collect sources" });
  await h.call(olga.token, "PUT", `/items/${task.id}`, {
    title: "Write chapter one",
    version: task.version,
    prerequisite_ids: [before.id],
  });
  const source = await newDoc(olga, {
    title: "Plan",
    content: [
      {
        type: "paragraph",
        text: `See [Sources](orbyn://doc/${target.id}) and [the project](orbyn://project/${project.id}).`,
      },
      { type: "todo", text: "Draft the outline", done: false },
    ],
  });
  // The page's links to Sources, seen from Sources: a backlink with its line.
  const back = ok(
    await tool(keys.write, "get_links", { of: `doc:${target.id}` }),
  );
  const from = back.links.find(
    (l: any) => l.direction === "in" && l.other.id === `doc:${source.id}`,
  );
  assert.ok(from, "the plan links to sources");
  assert.equal(from.kind, "link");
  assert.match(from.line, /See \[Sources\]/);
  assert.equal(from.block, source.content[0].id ?? null);
  // Filed in the project: an outgoing 'project' link.
  const out = ok(
    await tool(keys.write, "get_links", {
      of: `doc:${target.id}`,
      direction: "out",
    }),
  );
  assert.ok(
    out.links.some(
      (l: any) =>
        l.kind === "project" && l.other.id === `project:${project.id}`,
    ),
  );
  // A dependency, from the waiting task.
  const dep = ok(
    await tool(keys.write, "get_links", {
      of: `task:${task.id}`,
      kinds: ["dependency"],
    }),
  );
  assert.equal(dep.links.length, 1);
  assert.equal(dep.links[0].other.id, `task:${before.id}`);
  assert.equal(dep.links[0].direction, "out");
  // A checklist line turned into a task links the page to it.
  const made = (
    await h.call(olga.token, "POST", `/docs/${source.id}/tasks`, {})
  ).json();
  const lineTask = made.items[0].id as string;
  const line = ok(
    await tool(keys.write, "get_links", {
      of: `task:${lineTask}`,
      kinds: ["task_line"],
    }),
  );
  assert.equal(line.links[0].other.id, `doc:${source.id}`);
  assert.equal(line.links[0].direction, "in");
  assert.match(line.links[0].line, /Draft the outline/);
  // The project: what links there, and pages with no links.
  const lonely = await newDoc(olga, {
    title: "Lonely notes",
    content: [{ type: "paragraph", text: "nothing links here" }],
    project_id: project.id,
  });
  const hub = ok(
    await tool(keys.write, "get_links", {
      of: `project:${project.id}`,
      include: ["orphans", "unresolved"],
    }),
  );
  assert.ok(
    hub.links.some(
      (l: any) => l.other.id === `doc:${source.id}` && l.kind === "link",
    ),
  );
  assert.ok(hub.orphans.some((d: any) => d.id === `doc:${lonely.id}`));
  assert.ok(!hub.orphans.some((d: any) => d.id === `doc:${target.id}`));
  // Nothing about something the connection can't see.
  const ottoDoc = await newDoc(otto, {
    title: "Otto's",
    content: [{ type: "paragraph", text: "x" }],
  });
  assert.equal(
    code(await tool(keys.write, "get_links", { of: `doc:${ottoDoc.id}` })),
    "NOT_FOUND",
  );
  assert.equal(
    code(await tool(keys.write, "get_links", { of: "not an id" })),
    "INVALID",
  );
});

test("get_links drops links whose other end is out of reach, without counting them", async () => {
  const shared = await newDoc(olga, {
    title: "Crew handbook",
    team_id: crew,
    content: [{ type: "paragraph", text: "Welcome" }],
  });
  // A personal page links to the team page: only a connection with
  // Personal sees that backlink.
  await newDoc(olga, {
    title: "My private notes",
    content: [
      {
        type: "paragraph",
        text: `Private thoughts on [the handbook](orbyn://doc/${shared.id})`,
      },
    ],
  });
  // Another team's page links to it too.
  await newDoc(olga, {
    title: "Other team's page",
    team_id: other,
    content: [
      { type: "paragraph", text: `[handbook](orbyn://doc/${shared.id})` },
    ],
  });
  const all = ok(
    await tool(keys.write, "get_links", { of: `doc:${shared.id}` }),
  );
  assert.equal(all.links.length, 2);
  const narrow = ok(
    await tool(keys.crewOnly, "get_links", { of: `doc:${shared.id}` }),
  );
  assert.equal(narrow.links.length, 0, "private and other-team pages stay out");
  assert.doesNotMatch(JSON.stringify(narrow), /Private thoughts|Other team/);
  // Orphans too: a crew project page that only a private page links to is
  // an orphan to a connection without Personal, and not to one with it.
  const crewProject = (
    await h.call(olga.token, "POST", "/projects", {
      name: "Crew orphans",
      team_id: crew,
    })
  ).json();
  const filed = await newDoc(olga, {
    title: "Filed crew page",
    team_id: crew,
    project_id: crewProject.id,
    content: [{ type: "paragraph", text: "filed" }],
  });
  await newDoc(olga, {
    title: "Private pointer",
    content: [{ type: "paragraph", text: `[filed](orbyn://doc/${filed.id})` }],
  });
  const orphansOf = async (key: string) =>
    ok(
      await tool(key, "get_links", {
        of: `project:${crewProject.id}`,
        include: ["orphans"],
      }),
    ).orphans.map((d: any) => d.id);
  assert.ok((await orphansOf(keys.crewOnly)).includes(`doc:${filed.id}`));
  assert.ok(!(await orphansOf(keys.write)).includes(`doc:${filed.id}`));
});

test("link related: made from either end, shown both ways, undone by unlinking", async () => {
  const doc = await newDoc(olga, {
    title: "Budget",
    content: [{ type: "paragraph", text: "numbers" }],
  });
  const task = await newTask(olga, { title: "Pay the venue" });
  const linked = ok(
    await tool(keys.write, "link", {
      action: "link",
      kind: "related",
      from: `task:${task.id}`,
      to: `doc:${doc.id}`,
    }),
  );
  assert.equal(linked.status, "done");
  // Again from the other side: still one link.
  ok(
    await tool(keys.write, "link", {
      action: "link",
      kind: "related",
      from: `doc:${doc.id}`,
      to: `task:${task.id}`,
    }),
  );
  const rows = await pool.query(
    "SELECT * FROM object_links WHERE link_kind = 'related' AND (source_id = $1 OR source_id = $2)",
    [doc.id, task.id],
  );
  assert.equal(rows.rowCount, 1);
  const fromDoc = ok(
    await tool(keys.write, "get_links", { of: `doc:${doc.id}` }),
  );
  assert.ok(
    fromDoc.links.some(
      (l: any) => l.kind === "related" && l.other.id === `task:${task.id}`,
    ),
  );
  const fromTask = ok(
    await tool(keys.write, "get_links", { of: `task:${task.id}` }),
  );
  assert.ok(
    fromTask.links.some(
      (l: any) => l.kind === "related" && l.other.id === `doc:${doc.id}`,
    ),
  );
  // Page saves never remove a related link.
  const page = (await h.call(olga.token, "GET", `/docs/${doc.id}`)).json();
  await h.call(olga.token, "PUT", `/docs/${doc.id}`, {
    version: page.version,
    content: [{ type: "paragraph", text: "new numbers" }],
  });
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM object_links WHERE link_kind = 'related' AND source_id = $1",
        [task.id],
      )
    ).rowCount,
    1,
  );
  // Undo takes it away.
  const activity = (
    await pool.query(
      "SELECT id FROM agent_activity WHERE tool = 'link' AND user_id = $1 ORDER BY id LIMIT 1",
      [olga.id],
    )
  ).rows[0];
  const undone = await h.call(
    olga.token,
    "POST",
    `/me/agents/activity/${activity.id}/undo`,
  );
  assert.equal(undone.statusCode, 200, undone.body);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM object_links WHERE link_kind = 'related' AND source_id = $1",
        [task.id],
      )
    ).rowCount,
    0,
  );
  // Unlinking.
  ok(
    await tool(keys.write, "link", {
      action: "link",
      kind: "related",
      from: `doc:${doc.id}`,
      to: `task:${task.id}`,
    }),
  );
  ok(
    await tool(keys.write, "link", {
      action: "unlink",
      kind: "related",
      from: `task:${task.id}`,
      to: `doc:${doc.id}`,
    }),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM object_links WHERE link_kind = 'related' AND (source_id = $1 OR source_id = $2)",
        [doc.id, task.id],
      )
    ).rowCount,
    0,
  );
  // Two projects can't be related; a viewer's agent can't link in the team.
  const p1 = (
    await h.call(olga.token, "POST", "/projects", { name: "P1" })
  ).json();
  const p2 = (
    await h.call(olga.token, "POST", "/projects", { name: "P2" })
  ).json();
  assert.equal(
    code(
      await tool(keys.write, "link", {
        action: "link",
        kind: "related",
        from: `project:${p1.id}`,
        to: `project:${p2.id}`,
      }),
    ),
    "INVALID",
  );
  const crewDoc = await newDoc(olga, {
    title: "Crew doc",
    team_id: crew,
    content: [{ type: "paragraph", text: "x" }],
  });
  const crewTask = await newTask(olga, { title: "Crew task", team_id: crew });
  assert.equal(
    code(
      await tool(keys.vi, "link", {
        action: "link",
        kind: "related",
        from: `doc:${crewDoc.id}`,
        to: `task:${crewTask.id}`,
      }),
    ),
    "READ_ONLY",
  );
  // A link made the other way round (from the crew task to Vi's own page)
  // starts in the team: Vi's agent can't remove it by naming her page first.
  const viDoc = await newDoc(vi, {
    title: "Vi's page",
    content: [{ type: "paragraph", text: "v" }],
  });
  await pool.query(
    `INSERT INTO object_links (source_kind, source_id, target_kind, target_id, link_kind)
     VALUES ('task', $1, 'doc', $2, 'related')`,
    [crewTask.id, viDoc.id],
  );
  assert.equal(
    code(
      await tool(keys.vi, "link", {
        action: "unlink",
        kind: "related",
        from: `doc:${viDoc.id}`,
        to: `task:${crewTask.id}`,
      }),
    ),
    "READ_ONLY",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM object_links WHERE link_kind = 'related' AND source_id = $1 AND target_id = $2",
        [crewTask.id, viDoc.id],
      )
    ).rowCount,
    1,
    "the link stays",
  );
});

/** A saved view as the app keeps it (the views track's table). */
const viewRow = async (id: string) =>
  (
    await pool.query(
      "SELECT id, user_id, team_id, name, source, definition FROM saved_views WHERE id = $1",
      [id],
    )
  ).rows[0];

test("save_view and query: saved, run, changed, starred, and kept as the app keeps views", async () => {
  const { viewDefinition } = await import("@orbyn/core");
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const later = new Date(Date.now() + 20 * 86_400_000).toISOString();
  await newTask(olga, {
    title: "View task soon",
    due_at: soon,
    priority: "high",
  });
  await newTask(olga, { title: "View task later", due_at: later });
  // Only with the workspace toolset, and only with write access.
  assert.equal(
    code(await tool(keys.core, "save_view", { name: "Nope" })),
    "FORBIDDEN",
  );
  assert.equal(
    code(await tool(keys.read, "save_view", { name: "Nope" })),
    "FORBIDDEN",
  );
  // The app's rules: a gallery is for pages, and groups follow the source.
  assert.equal(
    code(
      await tool(keys.write, "save_view", {
        name: "Bad",
        source: "tasks",
        layout: "gallery",
      }),
    ),
    "INVALID",
  );
  assert.equal(
    code(
      await tool(keys.write, "save_view", {
        name: "Bad",
        source: "projects",
        group_by: "priority",
      }),
    ),
    "INVALID",
  );
  const saved = ok(
    await tool(keys.write, "save_view", {
      name: "Due this week",
      source: "tasks",
      filters: { text: "View task", due_within_days: 7 },
      sort: { by: "due" },
      group_by: "priority",
      layout: "board",
      columns: ["title", "due", "priority"],
      star: true,
    }),
  );
  assert.equal(saved.status, "done");
  const viewId = saved.done[0].id as string;
  assert.match(viewId, /^view:[0-9a-f-]{36}$/);
  assert.match(saved.done[0].url, /\/app\/view\//);
  const id = viewId.slice(5);
  // Kept as the app keeps views: source, and a definition the app reads.
  const kept = await viewRow(id);
  assert.equal(kept.source, "tasks");
  assert.equal(kept.team_id, null);
  const def = viewDefinition.parse(kept.definition);
  assert.equal(def.filters.due_within_days, 7);
  assert.equal(def.group_by, "priority");
  assert.equal(def.layout, "board");
  // It runs: days count from today, grouped by priority.
  const run = ok(await tool(keys.write, "query", { view: viewId }));
  assert.deepEqual(
    run.rows.map((r: any) => r.title),
    ["View task soon"],
  );
  assert.equal(run.view.layout, "board");
  assert.equal(run.view.source, "tasks");
  assert.deepEqual(run.view.not_applied, []);
  assert.equal(run.rows[0].group, "high");
  assert.deepEqual(run.groups, [{ key: "high", label: "high", count: 1 }]);
  // A filter given with the view replaces the view's own.
  const wider = ok(
    await tool(keys.write, "query", { view: viewId, due_before: "+30d" }),
  );
  assert.equal(wider.rows.length, 2);
  // A view keeps its source.
  assert.equal(
    code(await tool(keys.write, "query", { view: viewId, over: "docs" })),
    "INVALID",
  );
  // Starred: in favourites.
  const fav = await pool.query(
    "SELECT 1 FROM favourites WHERE user_id = $1 AND kind = 'view' AND target_id = $2",
    [olga.id, id],
  );
  assert.equal(fav.rowCount, 1);
  // fetch runs it as a table; search finds it by name.
  const fetched = ok(await tool(keys.write, "fetch", { id: viewId }));
  assert.equal(fetched.metadata.type, "view");
  assert.match(fetched.text, /\| Group \| Title \|/);
  assert.match(fetched.text, /View task soon/);
  const version = fetched.metadata.version as number;
  assert.equal(version, saved.done[0].version);
  const found = ok(
    await tool(keys.write, "search", {
      query: "Due this week",
      types: ["view"],
    }),
  );
  assert.equal(found.results[0].id, viewId);
  // Changing it needs the version; a stale one is a conflict.
  const stale = await tool(keys.write, "save_view", {
    view: viewId,
    version: 9,
    name: "Renamed",
  });
  assert.equal(code(stale), "VERSION_CONFLICT");
  assert.equal(
    code(
      await tool(keys.write, "save_view", {
        view: viewId,
        version,
        source: "pages",
      }),
    ),
    "INVALID",
  );
  const changed = ok(
    await tool(keys.write, "save_view", {
      view: viewId,
      version,
      name: "Due soon",
      filters: { text: "View task", due_within_days: 30 },
    }),
  );
  assert.ok(changed.done[0].version > version);
  const now = await viewRow(id);
  assert.equal(now.name, "Due soon");
  assert.equal(now.definition.filters.due_within_days, 30);
  assert.equal(now.definition.group_by, "priority", "the rest is kept");
  assert.equal(
    ok(await tool(keys.write, "query", { view: viewId })).rows.length,
    2,
  );
  // Someone else can't see it.
  assert.equal(
    code(await tool(keys.otto, "query", { view: viewId })),
    "NOT_FOUND",
  );
  // Undo of the change puts the old one back.
  const act = (
    await pool.query(
      "SELECT id FROM agent_activity WHERE tool = 'save_view' AND user_id = $1 ORDER BY id DESC LIMIT 1",
      [olga.id],
    )
  ).rows[0];
  assert.equal(
    (await h.call(olga.token, "POST", `/me/agents/activity/${act.id}/undo`))
      .statusCode,
    200,
  );
  const back = await viewRow(id);
  assert.equal(back.name, "Due this week");
  assert.equal(back.definition.filters.due_within_days, 7);
});

test("query runs a view the app saved, and says what only the app applies", async () => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO saved_views (user_id, name, source, definition)
     VALUES ($1, 'Pages by field', 'pages', $2::jsonb) RETURNING id`,
    [
      olga.id,
      JSON.stringify({
        source: "pages",
        filters: {
          fields: [
            {
              field: "00000000-0000-4000-8000-000000000001",
              op: "not_empty",
            },
          ],
        },
        sort: { by: "title", dir: "desc" },
        group_by: "folder",
        layout: "gallery",
      }),
    ],
  );
  await newDoc(olga, { title: "Aardvark notes", content: [] });
  await newDoc(olga, { title: "Zebra notes", content: [] });
  const run = ok(
    await tool(keys.write, "query", {
      view: `view:${rows[0].id}`,
      text: "notes",
    }),
  );
  assert.equal(run.over, "docs");
  assert.equal(run.view.layout, "gallery");
  assert.equal(run.view.not_applied.length, 2);
  const titles = run.rows.map((r: any) => r.title);
  assert.ok(
    titles.indexOf("Zebra notes") < titles.indexOf("Aardvark notes"),
    "sorted by name, reversed",
  );
  const fetched = ok(
    await tool(keys.write, "fetch", { id: `view:${rows[0].id}` }),
  );
  assert.match(fetched.text, /In the app, also:/);
});

test("team views: members share them, viewers' agents only read them", async () => {
  const made = ok(
    await tool(keys.write, "save_view", {
      name: "Crew open work",
      space: crew,
      filters: { team: crew },
    }),
  );
  const viewId = made.done[0].id;
  const idOnly = viewId.slice(5);
  assert.equal((await viewRow(idOnly)).team_id, crew);
  // A member's agent sees it; a viewer's agent can run it but not change
  // it or make a team view.
  await make("mo", mo, {
    access: "write",
    team_ids: [crew],
    toolsets: ["core", "workspace"],
  });
  ok(await tool(keys.mo, "query", { view: viewId }));
  ok(await tool(keys.vi, "query", { view: viewId }));
  assert.equal(
    code(
      await tool(keys.vi, "save_view", { view: viewId, version: 1, name: "x" }),
    ),
    "READ_ONLY",
  );
  assert.equal(
    code(await tool(keys.vi, "save_view", { name: "Vi's", space: crew })),
    "READ_ONLY",
  );
  // A member who didn't make it can't change it (the app's rule: its maker
  // or the team's owners and admins).
  const version = ok(await tool(keys.mo, "fetch", { id: viewId })).metadata
    .version;
  assert.equal(
    code(
      await tool(keys.mo, "save_view", { view: viewId, version, name: "x" }),
    ),
    "FORBIDDEN",
  );
  // Removing it goes through review, and follows the same rule.
  const { deleteView } = await import("../src/capabilities/view-store.js");
  const { transaction } = await import("../src/db/pool.js");
  const moUser = (
    await pool.query("SELECT * FROM users WHERE id = $1", [mo.id])
  ).rows[0];
  const olgaUser = (
    await pool.query("SELECT * FROM users WHERE id = $1", [olga.id])
  ).rows[0];
  await assert.rejects(
    transaction((db) => deleteView(db, moUser, idOnly)),
    /Only whoever made this view/,
  );
  await transaction((db) => deleteView(db, olgaUser, idOnly));
  assert.equal(await viewRow(idOnly), undefined);
});

test("query: links_to and relative dates as ad-hoc filters", async () => {
  const doc = await newDoc(olga, {
    title: "Hub page",
    content: [{ type: "paragraph", text: "hub" }],
  });
  const linked = await newTask(olga, { title: "Linked to the hub" });
  await newTask(olga, { title: "Not linked" });
  ok(
    await tool(keys.write, "link", {
      action: "link",
      kind: "related",
      from: `task:${linked.id}`,
      to: `doc:${doc.id}`,
    }),
  );
  const rows = ok(
    await tool(keys.write, "query", { links_to: `doc:${doc.id}` }),
  ).rows;
  assert.deepEqual(
    rows.map((r: any) => r.title),
    ["Linked to the hub"],
  );
  assert.equal(
    code(await tool(keys.write, "query", { due_before: "next week" })),
    "INVALID",
  );
  assert.equal(
    code(await tool(keys.write, "query", { links_to: "Hub page" })),
    "INVALID",
  );
});

test("get_project reads the project page's planning panel and what links there", async () => {
  const project = (
    await h.call(olga.token, "POST", "/projects", {
      name: "Planned project",
      deadline: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    })
  ).json();
  await newTask(olga, {
    title: "Estimated work",
    project_id: project.id,
    estimate_minutes: 90,
  });
  await newDoc(olga, {
    title: "Points at the project",
    content: [
      {
        type: "paragraph",
        text: `About [it](orbyn://project/${project.id})`,
      },
    ],
  });
  const hub = ok(
    await tool(keys.write, "get_project", { project: `project:${project.id}` }),
  );
  const panel = (
    await h.call(olga.token, "GET", `/projects/${project.id}/planning`)
  ).json();
  assert.equal(hub.planning.needed_minutes, panel.needed_minutes);
  assert.equal(hub.planning.unplanned_minutes, panel.unplanned_minutes);
  assert.equal(hub.planning.team_planned_minutes, null);
  assert.equal(hub.linked_here.length, 1);
  assert.equal(hub.linked_here[0].title, "Points at the project");
  assert.match(hub.linked_here[0].id, /^doc:/);
});

test("resources: guides, days, views, templates, paging and completions", async () => {
  const listed = (await rpc(keys.write, "resources/list")).body.result;
  const uris = listed.resources.map((r: any) => r.uri);
  for (const uri of [
    "orbyn://today",
    "orbyn://me",
    "orbyn://spec/markdown",
    "orbyn://spec/views",
    "orbyn://guide/planning",
  ])
    assert.ok(uris.includes(uri), uri);
  assert.ok(listed.resources.length <= 25);
  if (listed.nextCursor) {
    const next = (
      await rpc(keys.write, "resources/list", { cursor: listed.nextCursor })
    ).body.result;
    assert.ok(next.resources.length > 0);
    const bad = await rpc(keys.write, "resources/list", { cursor: "c1.1.x" });
    assert.ok(bad.body.error, "a forged cursor is refused");
  }
  const templates = (await rpc(keys.write, "resources/templates/list")).body
    .result.resourceTemplates;
  const t = templates.map((x: any) => x.uriTemplate);
  assert.ok(t.includes("orbyn://view/{id}"));
  assert.ok(t.includes("orbyn://day/{date}"));
  const spec = (
    await rpc(keys.write, "resources/read", { uri: "orbyn://spec/markdown" })
  ).body.result.contents[0];
  assert.equal(spec.text, MARKDOWN_SPEC);
  assert.match(spec.text, /orbyn:\/\/doc\/<id>/);
  const day = new Date().toISOString().slice(0, 10);
  const dayRead = (
    await rpc(keys.write, "resources/read", { uri: `orbyn://day/${day}` })
  ).body.result.contents[0];
  assert.match(dayRead.text, new RegExp(`Due ${day}`));
  const views = (
    await pool.query("SELECT id FROM saved_views WHERE user_id = $1", [olga.id])
  ).rows;
  const viewRead = (
    await rpc(keys.write, "resources/read", {
      uri: `orbyn://view/${views[0].id}`,
    })
  ).body.result.contents[0];
  assert.match(viewRead.text, /^# /);
  // Out of reach reads as not found.
  const hidden = await rpc(keys.otto, "resources/read", {
    uri: `orbyn://view/${views[0].id}`,
  });
  assert.equal(hidden.body.error.code, -32602);
  // Completions: only titles this connection can see.
  await h.call(otto.token, "POST", "/projects", { name: "Zeppelin secret" });
  await h.call(olga.token, "POST", "/projects", { name: "Zeppelin launch" });
  const done = (
    await rpc(keys.write, "completion/complete", {
      ref: { type: "ref/prompt", name: "catch_up_on_project" },
      argument: { name: "project", value: "Zeppe" },
    })
  ).body.result.completion;
  assert.deepEqual(done.values, ["Zeppelin launch"]);
  // What is typed matches as written: % and _ are not wildcards.
  for (const value of ["%", "_", "%%"]) {
    const wild = (
      await rpc(keys.write, "completion/complete", {
        ref: { type: "ref/prompt", name: "catch_up_on_project" },
        argument: { name: "project", value },
      })
    ).body.result.completion;
    assert.deepEqual(wild.values, [], value);
  }
  const ids = (
    await rpc(keys.write, "completion/complete", {
      ref: { type: "ref/resource", uri: "orbyn://project/{id}" },
      argument: { name: "id", value: "Zeppelin" },
    })
  ).body.result.completion.values;
  assert.equal(ids.length, 1);
  assert.match(ids[0], /^[0-9a-f-]{36}$/);
  const none = (
    await rpc(keys.write, "completion/complete", {
      ref: { type: "ref/prompt", name: "plan_my_day" },
      argument: { name: "focus", value: "x" },
    })
  ).body.result.completion;
  assert.deepEqual(none.values, []);
});

test("prompts: listed by toolset, filled with arguments, never hiding instructions", async () => {
  const listed = (await rpc(keys.core, "prompts/list")).body.result.prompts;
  const names = listed.map((p: any) => p.name);
  assert.ok(names.includes("plan_my_day"));
  assert.ok(names.includes("ask_project"));
  assert.ok(!names.includes("study_session"), "needs the study toolset");
  assert.ok(!names.includes("catch_up_on_project"), "needs workspace");
  const got = (
    await rpc(keys.write, "prompts/get", {
      name: "ask_project",
      arguments: { project: "Thesis", question: "What did we decide?" },
    })
  ).body.result;
  assert.equal(got.messages[0].role, "user");
  assert.match(got.messages[0].content.text, /find_passages/);
  assert.match(got.messages[0].content.text, /What did we decide\?/);
  const missing = await rpc(keys.write, "prompts/get", {
    name: "ask_project",
    arguments: { project: "Thesis" },
  });
  assert.equal(missing.body.error.code, -32602);
  const unknown = await rpc(keys.write, "prompts/get", { name: "nope" });
  assert.equal(unknown.body.error.code, -32602);
  // Every prompt names only Orbyn's tools, and hides nothing.
  const { registry } = await import("../src/capabilities/index.js");
  for (const p of PROMPTS) {
    const text = p.text(
      Object.fromEntries(p.arguments.map((a) => [a.name, "x"])),
    );
    assert.doesNotMatch(text, /<!--|​|ignore (all|previous)/i, p.name);
    for (const word of text.match(/\b[a-z]+_[a-z_]+\b/g) ?? [])
      if (
        !["plan_token", "start_date", "due_before", "client_ref"].includes(word)
      )
        assert.ok(registry.get(word), `${p.name} names ${word}`);
  }
});

test("the server advertises prompts and completions on both eras", async () => {
  const init = await rpc(keys.write, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  });
  assert.ok(init.body.result.capabilities.prompts);
  assert.ok(init.body.result.capabilities.completions);
  const modern = await h.modern(keys.write, "prompts/list");
  assert.equal(modern.status, 200, JSON.stringify(modern.body));
  assert.ok(modern.body.result.prompts.length >= 5);
});
