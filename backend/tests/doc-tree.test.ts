import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";

/**
 * W5: pages inside pages. A page nests under another page of its own space
 * and library, takes its folder, never loops, keeps its children while it
 * is in Trash and lets them go when deleted for good; agents nest pages
 * with organize "nest", undoably.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { docTree, treeRows, canNest, nestTargets, treePath, pageStatus } =
  await import("@orbyn/core");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

let ann: Person;
let ben: Person;
let viv: Person;
let crew = "";
let agentKey = "";

type Page = {
  id: string;
  version: number;
  folder_id: string | null;
  parent_id: string | null;
  sort_order: number | null;
  team_id: string | null;
};

const newPage = async (who: Person, body: Record<string, unknown> = {}) => {
  const r = await h.call(who.token, "POST", "/docs", {
    title: "Page",
    ...body,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as Page;
};
const read = async (who: Person, id: string) =>
  (await h.call(who.token, "GET", `/docs/${id}`)).json() as Page;
const move = async (who: Person, id: string, to: Record<string, unknown>) =>
  h.call(who.token, "PUT", `/docs/${id}`, {
    ...to,
    version: (await read(who, id)).version,
  });

before(async () => {
  await migrate();
  ann = await h.register("tree-ann", "Ann");
  ben = await h.register("tree-ben", "Ben");
  viv = await h.register("tree-viv", "Viv");
  crew = await h.team(ann, "Tree crew", [[viv, "viewer"]]);
  agentKey = (
    await h.agentKey(ann, {
      access: "write",
      team_ids: [crew],
      toolsets: ["core", "workspace"],
    })
  ).key;
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, []);
  network.restore();
  await app.close();
  await pool.end();
});

test("a page nests, takes its parent's folder, moves out and is listed with parent_id", async () => {
  const folder = (
    await h.call(ann.token, "POST", "/folders", { name: "Course" })
  ).json() as { id: string };
  const course = await newPage(ann, { title: "Course", folder_id: folder.id });
  const week = await newPage(ann, { title: "Week 1" });

  const nested = await move(ann, week.id, { parent_id: course.id });
  assert.equal(nested.statusCode, 200, nested.body);
  assert.equal(nested.json().parent_id, course.id);
  assert.equal(nested.json().folder_id, folder.id, "takes the parent's folder");

  const listed = (await h.call(ann.token, "GET", "/docs")).json() as Page[];
  assert.equal(listed.find((d) => d.id === week.id)?.parent_id, course.id);
  assert.equal(listed.find((d) => d.id === course.id)?.parent_id, null);

  // Made inside a page straight away: the same.
  const made = await newPage(ann, { title: "Week 2", parent_id: course.id });
  assert.equal(made.parent_id, course.id);
  assert.equal(made.folder_id, folder.id);

  // The parent moves folder: its pages follow it.
  const other = (
    await h.call(ann.token, "POST", "/folders", { name: "Archive box" })
  ).json() as { id: string };
  assert.equal(
    (await move(ann, course.id, { folder_id: other.id })).statusCode,
    200,
  );
  assert.equal((await read(ann, week.id)).folder_id, other.id);
  assert.equal((await read(ann, week.id)).parent_id, course.id);

  // A child filed in another folder on its own leaves its parent.
  const out = await move(ann, made.id, { folder_id: folder.id });
  assert.equal(out.json().parent_id, null);
  assert.equal(out.json().folder_id, folder.id);

  // And back to the top level with parent_id null.
  const top = await move(ann, week.id, { parent_id: null });
  assert.equal(top.json().parent_id, null);
  assert.equal(top.json().folder_id, other.id, "stays in its folder");
});

test("pages keep the order they are put in", async () => {
  const parent = await newPage(ann, { title: "Order" });
  const a = await newPage(ann, { title: "Alpha", parent_id: parent.id });
  const b = await newPage(ann, { title: "Beta", parent_id: parent.id });
  const c = await newPage(ann, { title: "Gamma", parent_id: parent.id });
  const order = async () =>
    (
      await pool.query<{ id: string }>(
        "SELECT id FROM docs WHERE parent_id = $1 ORDER BY sort_order",
        [parent.id],
      )
    ).rows.map((r) => r.id);
  assert.deepEqual(await order(), [a.id, b.id, c.id], "new pages go last");
  assert.equal((await move(ann, c.id, { position: 0 })).statusCode, 200);
  assert.deepEqual(await order(), [c.id, a.id, b.id]);
  // The shared tree reads the same order.
  const listed = (await h.call(ann.token, "GET", "/docs")).json() as never[];
  const node = docTree(listed).find(
    (n: { doc: { id: string } }) => n.doc.id === parent.id,
  )!;
  assert.deepEqual(
    node.children.map((n: { doc: { id: string } }) => n.doc.id),
    [c.id, a.id, b.id],
  );
  assert.equal(node.count, 3);
});

test("loops and pages inside themselves are refused", async () => {
  const top = await newPage(ann, { title: "Top" });
  const mid = await newPage(ann, { title: "Mid", parent_id: top.id });
  const low = await newPage(ann, { title: "Low", parent_id: mid.id });
  const self = await move(ann, top.id, { parent_id: top.id });
  assert.equal(self.statusCode, 422, self.body);
  const loop = await move(ann, top.id, { parent_id: low.id });
  assert.equal(loop.statusCode, 422, loop.body);
  assert.match(loop.body, /inside it/);
  assert.equal((await read(ann, top.id)).parent_id, null);
});

test("another space's page is not a place to nest", async () => {
  const mine = await newPage(ann, { title: "Mine" });
  const teams = await newPage(ann, { title: "Team page", team_id: crew });
  // Personal under team, and team under personal: refused, both ways.
  const a = await move(ann, mine.id, { parent_id: teams.id });
  assert.equal(a.statusCode, 422, a.body);
  const b = await move(ann, teams.id, { parent_id: mine.id });
  assert.equal(b.statusCode, 422, b.body);
  const c = await h.call(ann.token, "POST", "/docs", {
    title: "Made across",
    team_id: crew,
    parent_id: mine.id,
  });
  assert.equal(c.statusCode, 422, c.body);

  // Someone else can't nest into your page: it doesn't exist for them.
  const bens = await newPage(ben, { title: "Ben's" });
  const into = await move(ben, bens.id, { parent_id: mine.id });
  assert.equal(into.statusCode, 404, into.body);
  const made = await h.call(ben.token, "POST", "/docs", {
    title: "Sneaky",
    parent_id: mine.id,
  });
  assert.equal(made.statusCode, 404, made.body);
  // Nor move your page at all.
  const theirs = await h.call(ben.token, "PUT", `/docs/${mine.id}`, {
    parent_id: bens.id,
    version: 1,
  });
  assert.equal(theirs.statusCode, 404, theirs.body);
  // A team viewer reads the team's pages but can't move them.
  const sub = await newPage(ann, { title: "Team sub", team_id: crew });
  const viewer = await h.call(viv.token, "PUT", `/docs/${sub.id}`, {
    parent_id: teams.id,
    version: sub.version,
  });
  assert.equal(viewer.statusCode, 403, viewer.body);
  // In the team, it nests.
  const ok = await move(ann, sub.id, { parent_id: teams.id });
  assert.equal(ok.statusCode, 200, ok.body);
});

test("Memory notes stay personal and keep to Memory", async () => {
  const memo = await newPage(ann, { title: "Coffee", kind: "memory" });
  const page = await newPage(ann, { title: "A page" });
  const teams = await newPage(ann, { title: "Crew page", team_id: crew });
  const underMemo = await move(ann, page.id, { parent_id: memo.id });
  assert.equal(underMemo.statusCode, 422, underMemo.body);
  const memoUnder = await move(ann, memo.id, { parent_id: page.id });
  assert.equal(memoUnder.statusCode, 422, memoUnder.body);
  const teamUnder = await move(ann, teams.id, { parent_id: memo.id });
  assert.equal(teamUnder.statusCode, 422, teamUnder.body);
  // Memory inside Memory is fine, and stays personal.
  const tea = await newPage(ann, {
    title: "Tea",
    kind: "memory",
    parent_id: memo.id,
  });
  assert.equal(tea.parent_id, memo.id);
  assert.equal(tea.team_id, null);
});

test("a parent in Trash keeps its pages; deleted for good, they move up", async () => {
  const parent = await newPage(ann, { title: "Binned" });
  const child = await newPage(ann, { title: "Kept", parent_id: parent.id });
  assert.equal(
    (await h.call(ann.token, "DELETE", `/docs/${parent.id}`)).statusCode,
    204,
  );
  const listed = (await h.call(ann.token, "GET", "/docs")).json() as Page[];
  const shown = listed.find((d) => d.id === child.id);
  assert.ok(shown, "the child is still listed");
  assert.equal(shown.parent_id, parent.id, "it remembers its parent");
  // With the parent gone from the list, the tree shows it at the top.
  assert.ok(docTree(listed).some((n) => n.doc.id === child.id));
  // Nothing can be put inside a page in Trash.
  const other = await newPage(ann, { title: "Other" });
  assert.equal(
    (await move(ann, other.id, { parent_id: parent.id })).statusCode,
    404,
  );
  // Back from Trash, it has its page again; deleted for good, it lets go.
  await h.call(ann.token, "POST", `/docs/${parent.id}/restore`);
  assert.equal((await read(ann, child.id)).parent_id, parent.id);
  await h.call(ann.token, "DELETE", `/docs/${parent.id}`);
  const gone = await h.call(ann.token, "DELETE", `/docs/${parent.id}/forever`);
  assert.equal(gone.statusCode, 204, gone.body);
  assert.equal((await read(ann, child.id)).parent_id, null);
});

test("moving several pages to a folder takes them out of parents left behind", async () => {
  const f = (
    await h.call(ann.token, "POST", "/folders", { name: "Bulk" })
  ).json() as { id: string };
  const parent = await newPage(ann, { title: "Stays" });
  const child = await newPage(ann, { title: "Goes", parent_id: parent.id });
  const grand = await newPage(ann, { title: "Follows", parent_id: child.id });
  const r = await h.call(ann.token, "POST", "/docs/bulk", {
    ids: [child.id],
    folder_id: f.id,
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await read(ann, child.id)).parent_id, null);
  assert.equal((await read(ann, grand.id)).parent_id, child.id);
  assert.equal((await read(ann, grand.id)).folder_id, f.id);
});

test("the tree route answers the usual refusals", async () => {
  const page = await newPage(ann);
  const anon = await h.call(null, "PUT", `/docs/${page.id}`, {
    parent_id: null,
    version: page.version,
  });
  assert.equal(anon.statusCode, 401);
  const bad = await h.call(ann.token, "PUT", `/docs/${page.id}`, {
    parent_id: "not-an-id",
    version: page.version,
  });
  // A body that doesn't fit the schema is refused in words (422, as every
  // docs route does); one that isn't JSON at all is a bad request.
  assert.equal(bad.statusCode, 422, bad.body);
  const negative = await h.call(ann.token, "PUT", `/docs/${page.id}`, {
    position: -1,
    version: page.version,
  });
  assert.equal(negative.statusCode, 422, negative.body);
  const garbled = await app.inject({
    method: "PUT",
    url: `/docs/${page.id}`,
    headers: {
      authorization: `Bearer ${ann.token}`,
      "content-type": "application/json",
    },
    payload: "{not json",
  });
  assert.equal(garbled.statusCode, 400, garbled.body);
  const missing = await move(ann, page.id, {
    parent_id: "00000000-0000-4000-8000-000000000000",
  });
  assert.equal(missing.statusCode, 404, missing.body);
  const stale = await h.call(ann.token, "PUT", `/docs/${page.id}`, {
    parent_id: null,
    version: page.version + 5,
  });
  assert.equal(stale.statusCode, 409, stale.body);
});

test("agents nest pages with organize, and undo puts them back", async () => {
  const f = (
    await h.call(ann.token, "POST", "/folders", { name: "Agent folder" })
  ).json() as { id: string };
  const parent = await newPage(ann, { title: "Unit" });
  const page = await newPage(ann, { title: "Lecture", folder_id: f.id });
  limiter.reset();
  strikes.reset();
  const r = (await h.tool(agentKey, "organize", {
    changes: [{ do: "nest", id: `doc:${page.id}`, to: `doc:${parent.id}` }],
  })) as { isError?: boolean; content: { text: string }[] };
  assert.ok(!r.isError, r.content?.[0]?.text);
  const nested = await read(ann, page.id);
  assert.equal(nested.parent_id, parent.id);
  assert.equal(nested.folder_id, null, "takes the parent's folder");

  // A loop is refused in words.
  limiter.reset();
  strikes.reset();
  const loop = (await h.tool(agentKey, "organize", {
    changes: [{ do: "nest", id: `doc:${parent.id}`, to: `doc:${page.id}` }],
  })) as { isError?: boolean };
  assert.ok(loop.isError);

  const activity = (
    await pool.query<{ id: string }>(
      `SELECT id FROM agent_activity WHERE tool = 'organize' AND user_id = $1
         AND undo IS NOT NULL ORDER BY id DESC LIMIT 1`,
      [ann.id],
    )
  ).rows[0];
  const undone = await h.call(
    ann.token,
    "POST",
    `/me/agents/activity/${activity.id}/undo`,
  );
  assert.equal(undone.statusCode, 200, undone.body);
  const back = await read(ann, page.id);
  assert.equal(back.parent_id, null);
  assert.equal(back.folder_id, f.id, "back in its folder");
});

test("the shared tree helpers nest, order and offer moves as the server does", () => {
  const base = { kind: "doc", user_id: "u", team_id: null };
  const docs = [
    { ...base, id: "a", title: "A", parent_id: null },
    { ...base, id: "b", title: "B", parent_id: "a", sort_order: 2 },
    { ...base, id: "c", title: "C", parent_id: "a", sort_order: 1 },
    { ...base, id: "d", title: "D", parent_id: "c" },
    { ...base, id: "m", title: "M", kind: "memory", parent_id: null },
    { ...base, id: "t", title: "T", team_id: "x", parent_id: null },
    { ...base, id: "gone", title: "Orphan", parent_id: "trashed" },
  ];
  const tree = docTree(docs);
  assert.deepEqual(
    tree.map((n) => n.doc.id),
    ["a", "m", "gone", "t"],
  );
  assert.deepEqual(
    tree[0].children.map((n) => n.doc.id),
    ["c", "b"],
  );
  assert.equal(tree[0].count, 3);
  const open = new Set(["a"]);
  assert.deepEqual(
    treeRows(tree, (id) => open.has(id)).map((r) => [r.doc.id, r.depth]),
    [
      ["a", 0],
      ["c", 1],
      ["b", 1],
      ["m", 0],
      ["gone", 0],
      ["t", 0],
    ],
  );
  assert.ok(!canNest(docs, docs[0], docs[3]), "not inside its own page");
  assert.ok(!canNest(docs, docs[0], docs[4]), "not into Memory");
  assert.ok(!canNest(docs, docs[0], docs[5]), "not into a team");
  assert.ok(canNest(docs, docs[3], docs[1]));
  assert.deepEqual(
    nestTargets(docs, docs[0]).map((d) => d.id),
    ["gone"],
  );
  assert.deepEqual(
    treePath(docs, "d").map((d) => d.id),
    ["a", "c"],
  );
});

test("the status line under a page says what it knows", () => {
  const parts = pageStatus({
    words: 1204,
    minutes: 5,
    linked: 3,
    properties: 2,
    offline: true,
  });
  assert.deepEqual(
    parts.map((p) => p.key),
    ["words", "read", "linked", "properties", "saved"],
  );
  assert.equal(
    parts.map((p) => p.text).join(" · "),
    "1,204 words · 5 min read · 3 linked here · 2 properties · Offline — will save",
  );
  assert.equal(
    pageStatus({ words: 1, minutes: 0, properties: 1, saving: true })
      .map((p) => p.text)
      .join(" · "),
    "1 word · 1 property · Saving…",
  );
});
