import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Tags on pages (ORG-01): the #tag shortcut's reading of a line, adding tags
 * by name (made in the page's own space when new), setting a page's tags by
 * id, the library's tag filter, and who may do each.
 */
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  addedInlineTags,
  docInlineTags,
  inlineTags,
  parseDocInline,
  tagRuns,
  tagSpans,
  PAGE_TAG_LIMIT,
} = await import("@orbyn/core");

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

async function newUser(name: string) {
  const r = await call(null, "POST", "/auth/register", {
    email: `ptag-${randomUUID()}@example.com`,
    password: "a-long-test-password",
    name,
  });
  return { token: r.json().token as string, id: r.json().user.id as string };
}

let me: { token: string; id: string };
let viewer: { token: string; id: string };
let stranger: { token: string; id: string };
let team = "";

before(async () => {
  await migrate();
  me = await newUser("Writer");
  viewer = await newUser("Viewer");
  stranger = await newUser("Stranger");
  team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams (name, created_by) VALUES ('Tag crew', $1) RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1,$2,'owner'),($1,$3,'viewer')",
    [team, me.id, viewer.id],
  );
});
after(async () => {
  await app.close();
  await pool.end();
});

const newPage = async (token: string, extra: Json = {}) =>
  (
    await call(token, "POST", "/docs", {
      title: "Tagged",
      content: [{ type: "paragraph", text: "x" }],
      ...extra,
    })
  ).json();

test("a #tag is a word after a space, never a heading, a number, code or a link", () => {
  const line =
    "Revise #physics and #Lab-3, not #1 or `#include` or [x](https://a.b/#frag) or a#b #physics.";
  assert.deepEqual(inlineTags(line), ["physics", "Lab-3"]);
  assert.deepEqual(inlineTags("# Heading"), []);
  assert.deepEqual(inlineTags("#cs101/labs- trailing"), ["cs101/labs"]);
  const spans = tagSpans("see #exam");
  assert.deepEqual(spans, [{ start: 4, end: 9, name: "exam" }]);
  // Code and maths blocks hold no tags.
  assert.deepEqual(
    docInlineTags([
      { type: "paragraph", text: "#one" },
      { type: "code", text: "#two", lang: "" },
      { type: "heading", level: 2, text: "Week #ONE #three" },
    ]),
    ["one", "three"],
  );
  // Only tags new since the line was opened count, whatever their case.
  assert.deepEqual(
    addedInlineTags(
      [{ type: "paragraph", text: "#physics" }],
      [
        { type: "paragraph", text: "#Physics #exam" },
        { type: "todo", text: "Revise #week4", done: false },
      ],
    ),
    ["exam", "week4"],
  );
  // The page draws each tag as a piece of its own, in its place.
  const runs = parseDocInline("Read #ch2 then **bold**#no").flatMap((r) =>
    tagRuns(r, "Read #ch2 then **bold**#no"),
  );
  const tagged = runs.filter((r) => r.tag);
  assert.deepEqual(
    tagged.map((r) => [r.text, r.start, r.tag]),
    [["#ch2", 5, "ch2"]],
  );
  assert.equal(runs.map((r) => r.text).join(""), "Read #ch2 then bold#no");
});

test("adding tags by name makes them in the page's space, once", async () => {
  assert.equal(
    (await call(null, "POST", `/docs/${randomUUID()}/tags`, { names: ["x"] }))
      .statusCode,
    401,
  );
  const page = await newPage(me.token);
  const first = await call(me.token, "POST", `/docs/${page.id}/tags`, {
    names: ["Physics", "physics", "exam"],
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual(first.json().added, ["Physics", "exam"]);
  assert.deepEqual(
    first.json().tags.map((t: Json) => t.name),
    ["exam", "Physics"],
  );
  // Typed again in another case: nothing new, and no second tag is made.
  const again = await call(me.token, "POST", `/docs/${page.id}/tags`, {
    names: ["PHYSICS"],
  });
  assert.deepEqual(again.json().added, []);
  const made = await pool.query(
    "SELECT 1 FROM tags WHERE user_id = $1 AND team_id IS NULL AND lower(name) = 'physics'",
    [me.id],
  );
  assert.equal(made.rowCount, 1);
  // Tasks and pages share the one list.
  const all: Json[] = (await call(me.token, "GET", "/tags")).json();
  assert.ok(all.some((t) => t.name === "exam"));
  // The page reads with its tags, and the library can be narrowed to one.
  const read = (await call(me.token, "GET", `/docs/${page.id}`)).json();
  assert.deepEqual(
    read.tags.map((t: Json) => t.name),
    ["exam", "Physics"],
  );
  const exam = all.find((t) => t.name === "exam")!;
  const filtered: Json[] = (
    await call(me.token, "GET", `/docs?tag=${exam.id}`)
  ).json();
  assert.deepEqual(
    filtered.map((d) => d.id),
    [page.id],
  );
  // Tags aren't the page's words: its version doesn't move.
  assert.equal(read.version, page.version);
});

test("setting a page's tags by id replaces them, from its own space only", async () => {
  const page = await newPage(me.token);
  const a = (
    await call(me.token, "POST", "/tags", {
      name: `a-${randomUUID().slice(0, 6)}`,
    })
  ).json();
  const b = (
    await call(me.token, "POST", "/tags", {
      name: `b-${randomUUID().slice(0, 6)}`,
    })
  ).json();
  let r = await call(me.token, "PUT", `/docs/${page.id}/tags`, {
    tags: [a.id, b.id],
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().tags.length, 2);
  r = await call(me.token, "PUT", `/docs/${page.id}/tags`, { tags: [b.id] });
  assert.deepEqual(
    r.json().tags.map((t: Json) => t.id),
    [b.id],
  );
  // Someone else's tag, or one that doesn't exist, is not found.
  const theirs = (
    await call(stranger.token, "POST", "/tags", { name: "theirs" })
  ).json();
  assert.equal(
    (
      await call(me.token, "PUT", `/docs/${page.id}/tags`, {
        tags: [theirs.id],
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(me.token, "PUT", `/docs/${page.id}/tags`, {
        tags: [randomUUID()],
      })
    ).statusCode,
    404,
  );
  // Nothing changed on the way.
  const read = (await call(me.token, "GET", `/docs/${page.id}`)).json();
  assert.deepEqual(
    read.tags.map((t: Json) => t.id),
    [b.id],
  );
  // Bad input is refused.
  for (const body of [{ tags: ["nope"] }, { tags: [], more: 1 }, {}])
    assert.equal(
      (await call(me.token, "PUT", `/docs/${page.id}/tags`, body)).statusCode,
      422,
    );
  assert.equal(
    (await call(me.token, "POST", `/docs/${page.id}/tags`, { names: [] }))
      .statusCode,
    422,
  );
  assert.equal(
    (
      await call(me.token, "POST", `/docs/${page.id}/tags`, {
        names: ["x".repeat(41)],
      })
    ).statusCode,
    422,
  );
  // Clearing them all is fine.
  r = await call(me.token, "PUT", `/docs/${page.id}/tags`, { tags: [] });
  assert.deepEqual(r.json().tags, []);
  // Someone else's page is not found.
  assert.equal(
    (await call(stranger.token, "PUT", `/docs/${page.id}/tags`, { tags: [] }))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(stranger.token, "POST", `/docs/${page.id}/tags`, {
        names: ["mine"],
      })
    ).statusCode,
    404,
  );
});

test("a team page's tags are the team's; viewers can't change them", async () => {
  const page = await newPage(me.token, { team_id: team });
  const r = await call(me.token, "POST", `/docs/${page.id}/tags`, {
    names: ["standup"],
  });
  assert.equal(r.statusCode, 200, r.body);
  const tag = (
    await pool.query<{ team_id: string | null }>(
      "SELECT team_id FROM tags WHERE id = $1",
      [r.json().tags[0].id],
    )
  ).rows[0];
  assert.equal(tag.team_id, team);
  // A personal tag doesn't belong on a team page.
  const mine = (
    await call(me.token, "POST", "/tags", {
      name: `own-${randomUUID().slice(0, 6)}`,
    })
  ).json();
  assert.equal(
    (await call(me.token, "PUT", `/docs/${page.id}/tags`, { tags: [mine.id] }))
      .statusCode,
    404,
  );
  // Viewers read the page but may not tag it.
  assert.equal(
    (
      await call(viewer.token, "POST", `/docs/${page.id}/tags`, {
        names: ["x"],
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call(viewer.token, "PUT", `/docs/${page.id}/tags`, { tags: [] }))
      .statusCode,
    403,
  );
  assert.equal(
    (await call(stranger.token, "PUT", `/docs/${page.id}/tags`, { tags: [] }))
      .statusCode,
    404,
  );
});

test("a page holds at most its limit of tags; names past it are left off", async () => {
  const page = await newPage(me.token);
  const names = Array.from({ length: PAGE_TAG_LIMIT }, (_, i) => `lim${i}`);
  const full = await call(me.token, "POST", `/docs/${page.id}/tags`, { names });
  assert.equal(full.json().tags.length, PAGE_TAG_LIMIT);
  const over = await call(me.token, "POST", `/docs/${page.id}/tags`, {
    names: ["onemore"],
  });
  assert.equal(over.statusCode, 200);
  assert.deepEqual(over.json().added, []);
  assert.equal(over.json().tags.length, PAGE_TAG_LIMIT);
  // A name left off a full page leaves no tag behind in the space.
  const made = await pool.query(
    "SELECT 1 FROM tags WHERE user_id = $1 AND lower(name) = 'onemore'",
    [me.id],
  );
  assert.equal(made.rowCount, 0);
  // A name the page already has is still "already there", not refused.
  const same = await call(me.token, "POST", `/docs/${page.id}/tags`, {
    names: ["LIM3"],
  });
  assert.deepEqual(same.json().added, []);
});

test("a tag change reaches the page's other open editors, words unchanged", async () => {
  const page = await newPage(me.token);
  // Listen as an open editor's stream does.
  const listener = await pool.connect();
  const heard: {
    docId: string;
    version: number;
    tags?: boolean;
    by: string;
  }[] = [];
  listener.on("notification", (m) => {
    if (m.channel === "doc_changed" && m.payload) {
      const news = JSON.parse(m.payload);
      if (news.docId === page.id) heard.push(news);
    }
  });
  await listener.query("LISTEN doc_changed");
  try {
    const tag = (
      await call(me.token, "POST", "/tags", { name: "live" })
    ).json();
    const set = await app.inject({
      method: "PUT",
      url: `/docs/${page.id}/tags`,
      headers: {
        authorization: `Bearer ${me.token}`,
        "x-orbyn-editor": "tab-one",
      },
      payload: { tags: [tag.id] },
    });
    assert.equal(set.statusCode, 200, set.body);
    await call(me.token, "POST", `/docs/${page.id}/tags`, {
      names: ["another"],
    });
    // Nothing new to add: nobody needs telling.
    await call(me.token, "POST", `/docs/${page.id}/tags`, {
      names: ["another"],
    });
    for (let i = 0; i < 100 && heard.length < 2; i++)
      await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(heard.length, 2);
    assert.ok(heard.every((n) => n.tags === true));
    // The page's words didn't move on, so its version didn't either.
    assert.ok(heard.every((n) => n.version === page.version));
    // The tab that made the change is named, so it isn't told its own news.
    assert.equal(heard[0].by, "tab-one");
  } finally {
    await listener.query("UNLISTEN doc_changed");
    listener.release();
  }
});

test("tag routes answer 429 past the per-minute limit", async () => {
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  const page = await newPage(me.token);
  await settings();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  live.rate_limit_per_minute = 2;
  const from = (method: "PUT" | "POST", body: Json) =>
    app.inject({
      method,
      url: `/docs/${page.id}/tags`,
      headers: { authorization: `Bearer ${me.token}` },
      remoteAddress: "10.73.0.1",
      payload: body,
    });
  try {
    assert.equal((await from("PUT", { tags: [] })).statusCode, 200);
    assert.equal((await from("POST", { names: ["ok"] })).statusCode, 200);
    assert.equal((await from("POST", { names: ["no"] })).statusCode, 429);
  } finally {
    live.rate_limit_per_minute = was;
  }
});
