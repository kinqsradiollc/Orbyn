import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import type { DocBlock } from "@orbyn/core";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";

/**
 * H2: the agent reads, Orbyn keeps the result. append_doc takes a long
 * page in parts (any order, a part sent again replaces it, 2 MB at most,
 * all or nothing at finish, drafts expire), save_source keeps the sources
 * an agent read once per address per space (never opening them), the
 * page's Info lists them, and fetch reads them back. No request ever
 * leaves Orbyn.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { SWEEP_RULES } = await import("../src/lib/sweep.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

let olga: Person;
let mo: Person;
let zed: Person;
let crew = "";
const keys: Record<string, string> = {};

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
const idOf = (typed: string) => typed.replace(/^\w+:/, "").slice(0, 36);
const page = async (id: string) =>
  (await pool.query("SELECT * FROM docs WHERE id = $1", [id])).rows[0] as {
    id: string;
    title: string;
    version: number;
    deleted_at: Date | null;
    content: DocBlock[];
  };
const words = (bs: DocBlock[]) =>
  bs.map((b) => ("text" in b ? b.text : b.type));

before(async () => {
  await migrate();
  olga = await h.register("ar-olga", "Olga");
  mo = await h.register("ar-mo", "Mo");
  zed = await h.register("ar-zed", "Zed");
  crew = await h.team(olga, "Crew", [[mo, "member"]]);
  const all = ["core", "workspace", "study", "files"];
  for (const [name, who, body] of [
    ["write", olga, { access: "write", team_ids: [crew], toolsets: all }],
    ["other", olga, { access: "write", team_ids: [crew], toolsets: all }],
    ["read", olga, { access: "read", team_ids: [crew], toolsets: all }],
    ["suggest", olga, { access: "suggest", toolsets: all }],
    ["mo", mo, { access: "write", team_ids: [crew], toolsets: all }],
    ["core", olga, { access: "write" }],
  ] as const) {
    const k = await h.agentKey(who, body);
    keys[name] = k.key;
  }
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  network.restore();
  await app.close();
  await pool.end();
});

// --- append_doc ------------------------------------------------------------

test("append_doc: parts in any order make one page in number order", async () => {
  const first = ok(
    await tool(keys.write, "append_doc", {
      title: "Lecture 5 transcript",
      part: 3,
      markdown: "## Part three\n\nThird words [src: Lecture 5, 40:00]",
    }),
    "start",
  );
  assert.equal(first.status, "done");
  const draft = first.done[0].id as string;
  assert.match(draft, /^draft:/);
  assert.match(first.done[0].change, /Part 3 kept/);
  ok(
    await tool(keys.write, "append_doc", {
      draft,
      part: 1,
      markdown: "# Lecture 5\n\nFirst words",
    }),
  );
  // Part 2 sent twice: the second replaces the first.
  ok(
    await tool(keys.write, "append_doc", { draft, part: 2, markdown: "Wrong" }),
  );
  ok(
    await tool(keys.write, "append_doc", {
      draft,
      part: 2,
      markdown: "Second words",
    }),
  );
  // No page yet.
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM docs WHERE user_id = $1 AND title = 'Lecture 5 transcript'",
        [olga.id],
      )
    ).rows[0].n,
    0,
  );
  const made = ok(
    await tool(keys.write, "append_doc", {
      draft,
      finish: true,
      client_ref: "lecture-5-finish",
    }),
    "finish",
  );
  assert.equal(made.done.length, 1);
  const doc = await page(idOf(made.done[0].id));
  assert.equal(doc.title, "Lecture 5 transcript");
  assert.deepEqual(words(doc.content), [
    "Lecture 5",
    "First words",
    "Second words",
    "Part three",
    "Third words [src: Lecture 5, 40:00]",
  ]);
  assert.ok(doc.content.every((b) => b.id));
  // The same client_ref answers the same; finish again (without it) too.
  const again = ok(
    await tool(keys.write, "append_doc", {
      draft,
      finish: true,
      client_ref: "lecture-5-finish",
    }),
  );
  assert.deepEqual(again, made);
  const twice = ok(
    await tool(keys.write, "append_doc", { draft, finish: true }),
  );
  assert.equal(twice.done[0].id, made.done[0].id);
  // A finished draft takes no more parts.
  const more = await tool(keys.write, "append_doc", { draft, markdown: "x" });
  assert.equal(code(more), "INVALID");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM docs WHERE user_id = $1 AND title = 'Lecture 5 transcript'",
        [olga.id],
      )
    ).rows[0].n,
    1,
  );
});

test("append_doc: all or nothing, and each part checked as it arrives", async () => {
  const start = ok(
    await tool(keys.write, "append_doc", { title: "Gappy", markdown: "One" }),
  );
  const draft = start.done[0].id;
  ok(
    await tool(keys.write, "append_doc", { draft, part: 3, markdown: "Three" }),
  );
  const gap = await tool(keys.write, "append_doc", { draft, finish: true });
  assert.equal(code(gap), "INVALID");
  assert.match(gap.content[0].text, /Part 2 is missing/);
  // A part that stops inside a code block is refused, and so is a secret.
  const open = await tool(keys.write, "append_doc", {
    draft,
    part: 2,
    markdown: "```js\nconst a = 1;",
  });
  assert.equal(code(open), "INVALID");
  assert.match(open.content[0].text, /inside a code block/);
  const secret = await tool(keys.write, "append_doc", {
    draft,
    part: 2,
    markdown: "key sk-abcdefghijklmnopqrstuvwxyz0123",
  });
  assert.equal(code(secret), "INVALID");
  // Finishing with a part in the same call that fails keeps nothing of it.
  const bad = await tool(keys.write, "append_doc", {
    draft,
    part: 2,
    markdown: "[[No such page anywhere]]",
    finish: true,
  });
  assert.equal(code(bad), "INVALID");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM agent_doc_draft_parts p JOIN agent_doc_drafts d ON d.id = p.draft_id WHERE d.id = $1",
        [idOf(draft)],
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM docs WHERE user_id = $1 AND title = 'Gappy'",
        [olga.id],
      )
    ).rows[0].n,
    0,
  );
  ok(await tool(keys.write, "append_doc", { draft, part: 2, markdown: "Two" }));
  const done = ok(
    await tool(keys.write, "append_doc", { draft, finish: true }),
  );
  assert.deepEqual(words((await page(idOf(done.done[0].id))).content), [
    "One",
    "Two",
    "Three",
  ]);
  // Nothing to finish, or neither a part nor finish.
  const empty = ok(
    await tool(keys.write, "append_doc", { title: "Empty", markdown: "x" }),
  );
  const neither = await tool(keys.write, "append_doc", {
    draft: empty.done[0].id,
  });
  assert.equal(code(neither), "INVALID");
  // Starting needs a title.
  assert.equal(
    code(await tool(keys.write, "append_doc", { markdown: "x" })),
    "INVALID",
  );
});

test("append_doc: 2 MB at most, refused over it", async () => {
  // 480 KB parts of ordinary paragraphs.
  const part = Array.from(
    { length: 480 },
    (_, i) => `Para ${i} ${"w".repeat(1000)}`,
  ).join("\n\n");
  const start = ok(
    await tool(keys.write, "append_doc", { title: "Huge", markdown: part }),
  );
  const draft = start.done[0].id;
  for (let n = 2; n <= 4; n++)
    ok(
      await tool(keys.write, "append_doc", { draft, markdown: part }),
      `part ${n}`,
    );
  const over = await tool(keys.write, "append_doc", { draft, markdown: part });
  assert.equal(code(over), "INVALID");
  assert.match(over.content[0].text, /over the 2 MB/);
  // One part over 512 KB is refused by its schema.
  const big = await tool(keys.write, "append_doc", {
    draft,
    part: 1,
    markdown: "x".repeat(600 * 1024),
  });
  assert.ok(big.isError);
});

test("append_doc: a transcript over 60 KB becomes linked pages; undo trashes them all", async () => {
  const section = (s: number) =>
    [
      `## Minute ${s * 10}`,
      ...Array.from(
        { length: 30 },
        (_, i) =>
          `Speaker ${i % 2 ? "B" : "A"}: ${"so the idea here is that ".repeat(12)}(${s}.${i})`,
      ),
    ].join("\n\n");
  const parts = [0, 1, 2, 3, 4, 5, 6, 7].map(section);
  const start = ok(
    await tool(keys.write, "append_doc", {
      title: "Seminar transcript",
      kind: "note",
      markdown: parts[0],
    }),
  );
  const draft = start.done[0].id;
  for (const p of parts.slice(1))
    ok(await tool(keys.write, "append_doc", { draft, markdown: p }));
  const made = ok(
    await tool(keys.write, "append_doc", { draft, finish: true }),
  );
  assert.ok(made.done.length > 1, `${made.done.length} pages`);
  const docs = await Promise.all(made.done.map((d: any) => page(idOf(d.id))));
  assert.equal(docs[0].title, "Seminar transcript");
  assert.equal(docs[1].title, `Seminar transcript (part 2 of ${docs.length})`);
  for (const [i, d] of docs.entries()) {
    assert.ok(Buffer.byteLength(JSON.stringify(d.content)) <= 60_000);
    const last = d.content[d.content.length - 1] as { text: string };
    if (i < docs.length - 1)
      assert.match(
        last.text,
        new RegExp(
          `^Continued in \\[.*\\]\\(orbyn://doc/${docs[i + 1].id}\\)$`,
        ),
      );
  }
  const total = docs
    .flatMap((d) => d.content)
    .filter((b) => b.type === "heading");
  assert.equal(total.length, 8);
  // One undo takes every page back to the Trash.
  const changes = ok(
    await tool(keys.write, "list_agent_changes", { limit: 5 }),
  );
  const change = changes.changes.find(
    (c: any) => c.tool === "append_doc" && c.targets.includes(made.done[0].id),
  );
  assert.ok(change, JSON.stringify(changes.changes.map((c: any) => c.tool)));
  ok(await tool(keys.write, "undo", { change: change.id }), "undo");
  for (const d of docs) assert.ok((await page(d.id)).deleted_at);
});

test("append_doc: a draft is its connection's, and expires a day after its last part", async () => {
  const start = ok(
    await tool(keys.write, "append_doc", { title: "Mine", markdown: "Words" }),
  );
  const draft = start.done[0].id;
  // Another connection (even the same person's) can't see it.
  const other = await tool(keys.other, "append_doc", { draft, finish: true });
  assert.equal(code(other), "NOT_FOUND");
  await pool.query(
    "UPDATE agent_doc_drafts SET expires_at = now() - interval '1 minute' WHERE id = $1",
    [idOf(draft)],
  );
  const late = await tool(keys.write, "append_doc", { draft, finish: true });
  assert.equal(code(late), "NOT_FOUND");
  // The sweeper clears expired drafts and their parts.
  const rule = SWEEP_RULES.find((r) => r.key === "agent_doc_drafts")!;
  await pool.query(`DELETE FROM ${rule.table} WHERE ${rule.where}`);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM agent_doc_draft_parts WHERE draft_id = $1",
        [idOf(draft)],
      )
    ).rows[0].n,
    0,
  );
  // A part keeps a draft alive for another day.
  const fresh = ok(
    await tool(keys.write, "append_doc", { title: "Alive", markdown: "A" }),
  );
  const before = (
    await pool.query("SELECT expires_at FROM agent_doc_drafts WHERE id = $1", [
      idOf(fresh.done[0].id),
    ])
  ).rows[0].expires_at as Date;
  assert.ok(before.getTime() > Date.now() + 23 * 3600_000);
});

test("append_doc: reads refuse, suggesting sends the page to review, core alone doesn't list it", async () => {
  // A read-only connection isn't allowed the tool at all.
  const read = await tool(keys.read, "append_doc", {
    title: "No",
    markdown: "x",
  });
  assert.equal(code(read), "FORBIDDEN");
  const start = ok(
    await tool(keys.suggest, "append_doc", {
      title: "Proposed",
      markdown: "Hello",
    }),
  );
  const pending = ok(
    await tool(keys.suggest, "append_doc", {
      draft: start.done[0].id,
      finish: true,
    }),
  );
  assert.equal(pending.status, "pending_review");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM docs WHERE user_id = $1 AND title = 'Proposed'",
        [olga.id],
      )
    ).rows[0].n,
    0,
  );
  const listed = await h.legacy(keys.core, "tools/list", {});
  const names = listed.body.result.tools.map((t: { name: string }) => t.name);
  assert.ok(!names.includes("append_doc") && !names.includes("save_source"));
  assert.ok(names.includes("create_doc"));
  // Unauthenticated calls are refused before any tool runs.
  assert.equal(
    (await h.post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status,
    401,
  );
});

// --- save_source -------------------------------------------------------------

let notes = "";
let teamPage = "";

test("save_source: kept once per address per space, linked to lines, never fetched", async () => {
  const made = ok(
    await tool(keys.write, "create_doc", {
      title: "Cell notes",
      markdown:
        "ATP comes from mitochondria. [src: Nature 2020] ^batp\n\nMore words ^bmore",
    }),
  );
  notes = idOf(made.done[0].id);
  const saved = ok(
    await tool(keys.write, "save_source", {
      url: "https://www.nature.com/articles/atp#section-2",
      title: "How cells make ATP",
      quote: "Mitochondria produce most of the cell's ATP.",
      accessed: "2026-09-20",
      author: "A. Smith",
      doc: `doc:${notes}`,
      lines: ["^batp"],
    }),
    "save",
  );
  assert.equal(saved.saved, "new");
  assert.equal(saved.marker, "[src: How cells make ATP]");
  const id = idOf(saved.source);
  const row = (await pool.query("SELECT * FROM sources WHERE id = $1", [id]))
    .rows[0];
  assert.equal(row.url, "https://www.nature.com/articles/atp");
  assert.equal(row.site, "nature.com");
  assert.equal(row.team_id, null);
  // The same address again: the same source, updated; another line linked.
  const again = ok(
    await tool(keys.write, "save_source", {
      url: "https://www.nature.com/articles/atp",
      title: "How cells make ATP (2nd ed.)",
      accessed: "2026-09-20",
      doc: `doc:${notes}`,
      lines: ["bmore"],
    }),
  );
  assert.equal(again.source, saved.source);
  assert.equal(again.saved, "updated");
  const same = ok(
    await tool(keys.write, "save_source", {
      url: "https://www.nature.com/articles/atp",
      title: "How cells make ATP (2nd ed.)",
      accessed: "2026-09-20",
    }),
  );
  assert.equal(same.saved, "unchanged");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM sources WHERE user_id = $1",
        [olga.id],
      )
    ).rows[0].n,
    1,
  );
  // The page's Info lists it, with the quote kept and the lines that use it.
  const info = await h.call(olga.token, "GET", `/docs/${notes}/info`);
  assert.equal(info.statusCode, 200);
  const [src] = info.json().sources;
  assert.equal(src.title, "How cells make ATP (2nd ed.)");
  assert.equal(src.quote, "Mitochondria produce most of the cell's ATP.");
  assert.equal(src.author, "A. Smith");
  assert.equal(src.accessed_on, "2026-09-20");
  assert.deepEqual(src.lines, ["batp", "bmore"]);
  // fetch names the page's sources, and opens one with its quote fenced.
  const fetched = ok(await tool(keys.write, "fetch", { id: `doc:${notes}` }));
  assert.match(
    fetched.text,
    new RegExp(`Sources: source:${id} How cells make ATP`),
  );
  const opened = ok(await tool(keys.write, "fetch", { id: `source:${id}` }));
  assert.equal(opened.metadata.type, "source");
  assert.match(opened.text, /https:\/\/www\.nature\.com\/articles\/atp/);
  assert.match(opened.text, /<untrusted-content source="web_source">/);
  assert.match(opened.text, new RegExp(`Used on: doc:${notes}`));
  // Orbyn never reached the address.
  assert.deepEqual(network.calls, []);
});

test("save_source: each space keeps its own; teammates see a team page's sources, no one else does", async () => {
  const made = ok(
    await tool(keys.write, "create_doc", {
      title: "Crew reading",
      team: crew,
      markdown: "Shared words ^bshared",
    }),
  );
  teamPage = idOf(made.done[0].id);
  const team = ok(
    await tool(keys.write, "save_source", {
      url: "https://www.nature.com/articles/atp",
      title: "How cells make ATP",
      doc: `doc:${teamPage}`,
      lines: ["bshared"],
    }),
  );
  assert.equal(team.saved, "new");
  const row = (
    await pool.query("SELECT team_id FROM sources WHERE id = $1", [
      idOf(team.source),
    ])
  ).rows[0];
  assert.equal(row.team_id, crew);
  // Mo, in the team, sees the team page's source; through his agent too.
  const info = await h.call(mo.token, "GET", `/docs/${teamPage}/info`);
  assert.equal(info.json().sources.length, 1);
  ok(await tool(keys.mo, "fetch", { id: team.source }));
  // Olga's own source is hers: Mo's agent can't open it, Zed can't see her page.
  const personal = (
    await pool.query(
      "SELECT id FROM sources WHERE user_id = $1 AND team_id IS NULL",
      [olga.id],
    )
  ).rows[0].id;
  assert.equal(
    code(await tool(keys.mo, "fetch", { id: `source:${personal}` })),
    "NOT_FOUND",
  );
  assert.equal(
    (await h.call(zed.token, "GET", `/docs/${notes}/info`)).statusCode,
    404,
  );
  assert.equal(
    (await h.call(null, "GET", `/docs/${notes}/info`)).statusCode,
    401,
  );
  // A source can't be put in another space than its page's.
  const mixed = await tool(keys.write, "save_source", {
    url: "https://example.org/x",
    title: "X",
    doc: `doc:${teamPage}`,
    team: "personal",
  });
  assert.equal(code(mixed), "INVALID");
});

test("save_source: refuses what it can't keep, and undo takes it back", async () => {
  for (const url of [
    "http://example.org/a",
    "https://user:pw@example.org/a",
    "not a url",
  ]) {
    const r = await tool(keys.write, "save_source", { url, title: "Bad" });
    assert.equal(code(r), "INVALID", url);
  }
  const noLine = await tool(keys.write, "save_source", {
    url: "https://example.org/a",
    title: "A",
    doc: `doc:${notes}`,
    lines: ["bnothere"],
  });
  assert.equal(code(noLine), "INVALID");
  assert.equal(
    code(
      await tool(keys.write, "save_source", {
        url: "https://example.org/a",
        title: "A",
        lines: ["b1"],
      }),
    ),
    "INVALID",
  );
  assert.equal(
    code(
      await tool(keys.read, "save_source", {
        url: "https://example.org/a",
        title: "A",
      }),
    ),
    "FORBIDDEN",
  );
  const saved = ok(
    await tool(keys.write, "save_source", {
      url: "https://example.org/undo-me",
      title: "Undo me",
      doc: `doc:${notes}`,
    }),
  );
  const changes = ok(
    await tool(keys.write, "list_agent_changes", { limit: 3 }),
  );
  const change = changes.changes.find((c: any) => c.tool === "save_source");
  ok(await tool(keys.write, "undo", { change: change.id }));
  assert.equal(
    (
      await pool.query("SELECT 1 FROM sources WHERE id = $1", [
        idOf(saved.source),
      ])
    ).rowCount,
    0,
  );
  // Undo of an update puts the words back.
  ok(
    await tool(keys.write, "save_source", {
      url: "https://www.nature.com/articles/atp",
      title: "Renamed",
      accessed: "2026-09-21",
    }),
  );
  const list = ok(await tool(keys.write, "list_agent_changes", { limit: 1 }));
  ok(await tool(keys.write, "undo", { change: list.changes[0].id }));
  const back = (
    await pool.query(
      "SELECT title, to_char(accessed_on, 'YYYY-MM-DD') AS d FROM sources WHERE user_id = $1 AND team_id IS NULL AND url = 'https://www.nature.com/articles/atp'",
      [olga.id],
    )
  ).rows[0];
  assert.deepEqual(back, {
    title: "How cells make ATP (2nd ed.)",
    d: "2026-09-20",
  });
  assert.deepEqual(network.calls, []);
});
