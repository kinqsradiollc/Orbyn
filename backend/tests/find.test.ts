import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Getting anywhere fast (D2a): the quick switcher's GET /find and its recent
 * list (POST /recents), projects in /search, and the files phones check
 * before opening the web app's links in the app.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { RECENT_KEEP } = await import("../src/modules/search/find.js");
const { appleAppSiteAssociation, assetLinks } =
  await import("../src/modules/app-links/routes.js");
const { SWEEP_RULES } = await import("../src/lib/sweep.js");

const app = await buildApp();

type Person = { token: string; email: string };
let me: Person;
let mate: Person;
let stranger: Person;

let address = 0;
const call = (
  who: Person | null,
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    remoteAddress: `10.81.0.${address++ % 250}`,
    headers: who ? { authorization: `Bearer ${who.token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async (name: string): Promise<Person> => {
  const email = `find-${randomUUID()}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "a-long-test-password", name },
  });
  return { token: res.json().token, email };
};

let pageId = "";
let taskId = "";
let projectId = "";
let teamProjectId = "";
let privateId = "";

before(async () => {
  await migrate();
  me = await register("Finder");
  mate = await register("Mate");
  stranger = await register("Stranger");
  pageId = (
    await call(me, "POST", "/docs", { title: "Kinematics lecture" })
  ).json().id;
  taskId = (
    await call(me, "POST", "/items", { title: "Kick off the lab report" })
  ).json().id;
  projectId = (
    await call(me, "POST", "/projects", {
      name: "Kitchen remodel",
      summary: "Tiles, taps and the worktop",
    })
  ).json().id;
  const team = (await call(mate, "POST", "/teams", { name: "Crew" })).json();
  await call(mate, "POST", `/teams/${team.id}/members`, {
    email: me.email,
    role: "member",
  });
  teamProjectId = (
    await call(mate, "POST", "/projects", {
      name: "Kite festival",
      team_id: team.id,
    })
  ).json().id;
  privateId = (
    await call(stranger, "POST", "/docs", { title: "Kept to myself" })
  ).json().id;
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
});

const ids = (hits: { id: string }[]) => hits.map((h) => h.id);

test("find needs a sign-in and a sensible query", async () => {
  assert.equal((await call(null, "GET", "/find?q=k")).statusCode, 401);
  assert.equal((await call(null, "POST", "/recents", {})).statusCode, 401);
  const broken = await app.inject({
    method: "POST",
    url: "/recents",
    headers: {
      authorization: `Bearer ${me.token}`,
      "content-type": "application/json",
    },
    payload: "{not json",
  });
  assert.equal(broken.statusCode, 400, "a body that isn't JSON");
  assert.equal((await call(me, "GET", "/find?type=event")).statusCode, 422);
  assert.equal((await call(me, "GET", "/find?limit=0")).statusCode, 422);
  assert.equal((await call(me, "GET", "/find?limit=31")).statusCode, 422);
  assert.equal((await call(me, "GET", "/find?what=1")).statusCode, 422);
  assert.equal(
    (await call(me, "GET", `/find?q=${"x".repeat(201)}`)).statusCode,
    422,
  );
  assert.equal(
    (await call(me, "POST", "/recents", { kind: "doc" })).statusCode,
    422,
  );
  assert.equal(
    (await call(me, "POST", "/recents", { kind: "folder", id: pageId }))
      .statusCode,
    422,
  );
  assert.equal(
    (await call(me, "POST", "/recents", { kind: "doc", id: "nope" }))
      .statusCode,
    422,
  );
});

test("one letter finds pages, tasks and projects by name, team ones too", async () => {
  const hits = (await call(me, "GET", "/find?q=k")).json();
  const found = ids(hits);
  for (const id of [pageId, taskId, projectId, teamProjectId])
    assert.ok(found.includes(id), `found ${id}`);
  assert.ok(!found.includes(privateId), "never someone else's page");
  const types = new Set(hits.map((h: { type: string }) => h.type));
  assert.deepEqual(types, new Set(["doc", "task", "project"]));
  const project = hits.find((h: { id: string }) => h.id === projectId);
  assert.equal(project.title, "Kitchen remodel");
  assert.equal(project.hint, "Project");
  // The stranger finds only their own.
  const theirs = ids((await call(stranger, "GET", "/find?q=k")).json());
  assert.deepEqual(theirs, [privateId]);
});

test("the start of a name beats a match inside it, and a typo still finds it", async () => {
  await call(me, "POST", "/docs", { title: "Notes on backpacking" });
  const hits = (await call(me, "GET", "/find?q=kin")).json();
  assert.equal(hits[0].id, pageId, "Kinematics starts with it");
  const typo = ids((await call(me, "GET", "/find?q=kinematcs")).json());
  assert.ok(typo.includes(pageId), "letters that look alike still find it");
});

test("type narrows to one kind of thing", async () => {
  const projects = (await call(me, "GET", "/find?q=k&type=project")).json();
  assert.ok(projects.length >= 2);
  assert.ok(projects.every((h: { type: string }) => h.type === "project"));
  const tasks = (await call(me, "GET", "/find?q=k&type=task")).json();
  assert.deepEqual(ids(tasks), [taskId]);
});

test("% and _ typed are letters, not wildcards", async () => {
  const none = (await call(me, "GET", "/find?q=%25%25%25")).json();
  assert.deepEqual(none, []);
  const odd = (
    await call(me, "POST", "/docs", { title: "Budget 100% final" })
  ).json().id;
  const hits = ids((await call(me, "GET", "/find?q=100%25")).json());
  assert.ok(hits.includes(odd));
});

test("with nothing typed, what you opened last comes first", async () => {
  // Nothing opened yet: what changed last, so the list is never empty.
  const fresh = (await call(me, "GET", "/find")).json();
  assert.ok(fresh.length > 0);
  assert.ok(fresh.every((h: { recent: boolean }) => !h.recent));

  for (const [kind, id] of [
    ["project", teamProjectId],
    ["task", taskId],
    ["doc", pageId],
  ] as const)
    assert.equal(
      (await call(me, "POST", "/recents", { kind, id })).statusCode,
      204,
    );
  const recent = (await call(me, "GET", "/find")).json();
  assert.deepEqual(ids(recent).slice(0, 3), [pageId, taskId, teamProjectId]);
  assert.ok(recent.slice(0, 3).every((h: { recent: boolean }) => h.recent));
  // Opening again moves it back to the top.
  await call(me, "POST", "/recents", { kind: "project", id: teamProjectId });
  assert.equal((await call(me, "GET", "/find")).json()[0].id, teamProjectId);
  // Named ones are lifted when typed for, too.
  const typed = (await call(me, "GET", "/find?q=ki")).json();
  assert.equal(
    typed.find((h: { id: string }) => h.id === teamProjectId).recent,
    true,
  );
  // Only one kind.
  const docs = (await call(me, "GET", "/find?type=doc")).json();
  assert.equal(docs[0].id, pageId);
  assert.ok(docs.every((h: { type: string }) => h.type === "doc"));
});

test("the recent list never shows what you can't see, and keeps the newest", async () => {
  // Someone else's page, recorded anyway, is never listed.
  await call(me, "POST", "/recents", { kind: "doc", id: privateId });
  assert.ok(!ids((await call(me, "GET", "/find")).json()).includes(privateId));
  // A page moved to the Trash leaves the list.
  const gone = (await call(me, "POST", "/docs", { title: "Scratch" })).json()
    .id;
  await call(me, "POST", "/recents", { kind: "doc", id: gone });
  assert.equal((await call(me, "GET", "/find")).json()[0].id, gone);
  await app.inject({
    method: "DELETE",
    url: `/docs/${gone}`,
    headers: { authorization: `Bearer ${me.token}` },
  });
  assert.ok(!ids((await call(me, "GET", "/find")).json()).includes(gone));
  // Only the newest RECENT_KEEP are kept.
  for (let n = 0; n < RECENT_KEEP + 5; n++)
    await call(me, "POST", "/recents", { kind: "task", id: randomUUID() });
  const kept = await pool.query(
    `SELECT count(*)::int AS n FROM recent_opens ro JOIN users u ON u.id = ro.user_id
      WHERE u.email = $1`,
    [me.email],
  );
  assert.equal(kept.rows[0].n, RECENT_KEEP);
  assert.ok(SWEEP_RULES.some((r) => r.table === "recent_opens"));
});

test("find answers 429 past the per-minute limit", async () => {
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  await settings();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  live.rate_limit_per_minute = 2;
  const from = () =>
    app.inject({
      method: "GET",
      url: "/find?q=k",
      remoteAddress: "10.81.1.1",
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

test("search finds projects too, and narrows to them", async () => {
  const all = (await call(me, "GET", "/search?q=worktop")).json();
  assert.deepEqual(ids(all), [projectId], "the summary's words find it");
  assert.equal(all[0].type, "project");
  const only = (await call(me, "GET", "/search?q=kitchen&type=project")).json();
  assert.deepEqual(ids(only), [projectId]);
  // Tags, kinds and a project narrow to pages and tasks.
  const tagged = (
    await call(me, "GET", `/search?q=kitchen&project=${projectId}`)
  ).json();
  assert.ok(!ids(tagged).includes(projectId));
  const stranger_ = (
    await call(stranger, "GET", "/search?q=kitchen&type=project")
  ).json();
  assert.deepEqual(stranger_, []);
  assert.equal(
    (await call(me, "GET", "/search?q=kitchen&type=folder")).statusCode,
    422,
  );
});

test("the phone link files are served, empty until the app ids are set", async () => {
  const apple = await app.inject({
    method: "GET",
    url: "/.well-known/apple-app-site-association",
  });
  assert.equal(apple.statusCode, 200);
  assert.match(apple.headers["content-type"] as string, /application\/json/);
  assert.deepEqual(apple.json(), { applinks: { details: [] } });
  const android = await app.inject({
    method: "GET",
    url: "/.well-known/assetlinks.json",
  });
  assert.equal(android.statusCode, 200);
  assert.deepEqual(android.json(), []);

  assert.deepEqual(appleAppSiteAssociation("ABCDE12345"), {
    applinks: {
      details: [
        {
          appIDs: ["ABCDE12345.com.orbyn.planner"],
          components: [{ "/": "/app/*" }],
        },
      ],
    },
  });
  const print = Array.from({ length: 32 }, () => "ab").join(":");
  const links = assetLinks(`${print}, not-a-fingerprint`);
  assert.equal(links.length, 1);
  assert.equal(links[0].target.package_name, "com.orbyn.planner");
  assert.deepEqual(links[0].target.sha256_cert_fingerprints, [
    print.toUpperCase(),
  ]);
  assert.deepEqual(assetLinks("nonsense"), []);
});
