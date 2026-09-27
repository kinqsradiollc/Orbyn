import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { parseDoc, type DocBlock } from "@orbyn/core";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";

/**
 * H3: agents write pages like a person. create_doc and edit_doc take the
 * whole Orbyn Markdown dialect and store real blocks; fetch returns the
 * same dialect with anchors that edit_doc takes back; edit_doc's section
 * operations (replace, append to, delete, move) by heading words or
 * anchor, all or nothing, version-checked, undoable, and suggestions on
 * team pages. No AI provider is ever reached.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

let olga: Person;
let mo: Person;
let crew = "";
const keys: Record<string, string> = {};
const grants: Record<string, string> = {};

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
    version: number;
    content: DocBlock[];
  };
/** A page's body as fetch returns it (the header is the first paragraph). */
const fetched = async (key: string, id: string) => {
  const r = ok(await tool(key, "fetch", { id: `doc:${id}` }), "fetch");
  return (r.text as string).split("\n\n").slice(1).join("\n\n");
};
const shape = (bs: DocBlock[]) =>
  bs.map((b) => `${b.type}${"text" in b ? `:${b.text}` : ""}`);

let picture = "";
let hidden = "";

before(async () => {
  await migrate();
  olga = await h.register("ap-olga", "Olga");
  mo = await h.register("ap-mo", "Mo");
  crew = await h.team(olga, "Crew", [[mo, "member"]]);
  for (const [name, who, body] of [
    ["write", olga, { access: "write", team_ids: [crew] }],
    ["read", olga, { access: "read", team_ids: [crew] }],
  ] as const) {
    const k = await h.agentKey(who, body);
    keys[name] = k.key;
    grants[name] = k.id;
  }
  // A picture on one of Olga's pages, and one on Mo's own page.
  const home = (
    await h.call(olga.token, "POST", "/docs", { title: "Photos" })
  ).json();
  const theirs = (
    await h.call(mo.token, "POST", "/docs", { title: "Mo's photos" })
  ).json();
  const file = async (user: string, doc: string) =>
    (
      await pool.query(
        `INSERT INTO page_files (user_id, doc_id, name, mime, kind, bytes, status)
         VALUES ($1, $2, 'board.png', 'image/png', 'image', 10, 'ready')
         RETURNING id`,
        [user, doc],
      )
    ).rows[0].id as string;
  picture = await file(olga.id, home.id);
  hidden = await file(mo.id, theirs.id);
  // Pages to link to by title.
  await h.call(olga.token, "POST", "/docs", {
    title: "Reading list",
    content: [
      { id: "brl1", type: "heading", level: 2, text: "Week 3" },
      { id: "brl2", type: "paragraph", text: "Chapter 4" },
    ],
  });
  await h.call(olga.token, "POST", "/docs", { title: "Twin" });
  await h.call(olga.token, "POST", "/docs", { title: "Twin" });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  assert.deepEqual(network.calls, [], "pages never reach the network");
  network.restore();
  await app.close();
  await pool.end();
});

test("create_doc: every kind of line lands as a real block, and fetch gives it back", async () => {
  const embedDoc = "0f1e2d3c-4b5a-4968-8776-655443322110";
  const markdown = [
    "# Lecture 5 ^top",
    "Intro with ==amber==, =={green}green== and ~~old~~ words[^1].",
    "## Results ^results",
    "- Top",
    "    - Under",
    "        - Deeper",
    "3. Third",
    "4. Fourth",
    "- [ ] Read chapter 4",
    "- [x] Done already",
    "> A quote",
    "> [!tip] Start early",
    "> [!warning]- Folded away",
    "```ts\nconst a = 1;\n```",
    "```mermaid\ngraph TD\n  A --> B\n```",
    `\`\`\`orbyn-embed\norbyn://doc/${embedDoc}#bx\n\`\`\``,
    '```orbyn-list\n{"source":"tasks","filters":{"due_within_days":7}}\n```',
    "$$\nE = mc^2\n$$",
    "---",
    "| Term | Meaning |\n| :--- | ---: |\n| CAP | a \\| b |",
    `![The board](orbyn://file/${picture}?w=60)`,
    `[board.png](orbyn://file/${picture})`,
    "What is CAP? :: Consistency, availability, partitions",
    "The {{mitochondria}} makes energy.",
    "See [[Reading list#Week 3]] and [[Reading list|the list]].",
    "\\# not a heading",
    "[^1]: From the lecture.",
  ].join("\n\n");
  const made = ok(
    await tool(keys.write, "create_doc", { title: "Lecture 5", markdown }),
    "create_doc",
  ).done[0];
  const doc = await page(idOf(made.id));
  const c = doc.content;
  assert.ok(
    c.every((b) => b.id),
    "every line has an id",
  );
  assert.deepEqual(
    c.map((b) => b.type),
    [
      "heading",
      "paragraph",
      "heading",
      "bullet",
      "bullet",
      "bullet",
      "numbered",
      "numbered",
      "todo",
      "todo",
      "quote",
      "callout",
      "callout",
      "code",
      "code",
      "code",
      "code",
      "math",
      "divider",
      "table",
      "image",
      "file",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "footnote",
    ],
  );
  assert.equal(c[0].id, "top", "an anchor the agent named is kept");
  assert.equal(c[2].id, "results");
  assert.deepEqual(
    c.slice(3, 6).map((b) => (b as { depth?: number }).depth ?? 0),
    [0, 1, 2],
  );
  assert.equal((c[6] as { start?: number }).start, 3);
  assert.deepEqual(
    c.slice(11, 13).map((b) => b.type === "callout" && [b.kind, !!b.folded]),
    [
      ["tip", false],
      ["warning", true],
    ],
  );
  assert.deepEqual(
    c.slice(13, 17).map((b) => b.type === "code" && b.lang),
    ["ts", "mermaid", "orbyn-embed", "orbyn-list"],
  );
  assert.equal(
    (c[19] as { text: string }).text,
    "| Term | Meaning |\n| :--- | ---: |\n| CAP | a \\| b |",
  );
  assert.deepEqual(
    { ...c[20], id: undefined },
    {
      type: "image",
      file: picture,
      text: "The board",
      width: 60,
      id: undefined,
    },
  );
  const links = (c[24] as { text: string }).text;
  assert.match(
    links,
    /\[Reading list › Week 3\]\(orbyn:\/\/doc\/[0-9a-f-]{36}#brl1\)/,
  );
  assert.match(links, /\[the list\]\(orbyn:\/\/doc\/[0-9a-f-]{36}\)/);
  assert.doesNotMatch(links, /\[\[/);
  assert.equal((c[25] as { text: string }).text, "# not a heading");
  assert.deepEqual(c[26], {
    id: c[26].id,
    type: "footnote",
    label: "1",
    text: "From the lecture.",
  });

  // fetch returns the same dialect: read back with anchors, the same page.
  const body = await fetched(keys.write, doc.id);
  assert.match(body, /^# Lecture 5 \^top$/m);
  assert.match(body, /^        - Deeper \^/m, "nested lines indented");
  assert.match(body, /\| CAP \| a \\\| b \|\n\^b/, "a table's anchor under it");
  assert.match(
    body,
    /!\[The board\]\(orbyn:\/\/file\//,
    "pictures keep their file",
  );
  assert.deepEqual(parseDoc(body, { anchors: true }), c);

  // A fetched line, changed and sent back with its anchor, keeps its id.
  const line = body.split("\n").find((l) => l.startsWith("- [ ] Read"))!;
  const anchor = line.split(" ^")[1];
  ok(
    await tool(keys.write, "edit_doc", {
      doc: made.id,
      version: doc.version,
      edits: [
        {
          op: "replace",
          block: anchor,
          markdown: line.replace("chapter 4", "chapter 5"),
        },
      ],
    }),
    "replace from fetch",
  );
  const edited = await page(doc.id);
  const todo = edited.content.find((b) => b.id === anchor)!;
  assert.deepEqual(todo, {
    id: anchor,
    type: "todo",
    done: false,
    text: "Read chapter 5",
  });
  assert.equal(edited.content.length, c.length);
});

test("create_doc: links, pictures and settings that can't be kept are refused", async () => {
  const refused = async (markdown: string, why: RegExp) => {
    const r = await tool(keys.write, "create_doc", { title: "Nope", markdown });
    assert.equal(code(r), "INVALID", markdown);
    assert.match(r.content[0].text, why, markdown);
  };
  await refused("See [[No such page]].", /No page called/);
  await refused("See [[Twin]].", /Several pages are called/);
  await refused("See [[Reading list#Week 9]].", /no heading or line/);
  await refused("See [[#Somewhere]].", /doesn't exist yet/);
  await refused(`![x](orbyn://file/${hidden})`, /no picture or file/);
  await refused("![x](https://example.com/a.png)", /files already in Orbyn/);
  await refused("```orbyn-embed\nnonsense\n```", /orbyn-embed/);
  await refused("```orbyn-list\n{nope\n```", /orbyn-list/);
  // Inside code, [[ ]] is just text.
  const made = ok(
    await tool(keys.write, "create_doc", {
      title: "Code",
      markdown: "`[[not a link]]` and $[[x]]$",
    }),
  ).done[0];
  assert.equal(
    (await page(idOf(made.id))).content[0].type === "paragraph" &&
      ((await page(idOf(made.id))).content[0] as { text: string }).text,
    "`[[not a link]]` and $[[x]]$",
  );
  // A read-only connection can't write at all.
  const read = await tool(keys.read, "create_doc", {
    title: "Nope",
    markdown: "# Hi",
  });
  assert.ok(read.isError);
});

const SECTIONS = [
  "# Top",
  "intro",
  "## A",
  "a1",
  "### A.1",
  "a11",
  "## B",
  "b1",
  "## C",
  "c1",
].join("\n\n");

async function sectioned() {
  const made = ok(
    await tool(keys.write, "create_doc", {
      title: "Sections",
      markdown: SECTIONS,
    }),
  ).done[0];
  return page(idOf(made.id));
}

test("edit_doc sections: replace, append, move and delete by heading words or anchor", async () => {
  const doc = await sectioned();
  const idAt = (text: string) =>
    doc.content.find((b) => "text" in b && b.text === text)!.id!;
  const done = ok(
    await tool(keys.write, "edit_doc", {
      doc: `doc:${doc.id}`,
      version: doc.version,
      edits: [
        // Only what is under ## A (its ### part included) is replaced.
        { op: "replace_section", heading: "a", markdown: "new a\n\n- more" },
        { op: "append_to_section", heading: "## B", markdown: "b2" },
        // Before ## A's own line, by anchor.
        { op: "move_section", heading: `^${idAt("C")}`, block: idAt("A") },
      ],
    }),
  );
  assert.equal(done.status, "done");
  const after = await page(doc.id);
  assert.deepEqual(shape(after.content), [
    "heading:Top",
    "paragraph:intro",
    "heading:C",
    "paragraph:c1",
    "heading:A",
    "paragraph:new a",
    "bullet:more",
    "heading:B",
    "paragraph:b1",
    "paragraph:b2",
  ]);
  const A = after.content.find((b) => "text" in b && b.text === "A")!;
  assert.equal(A.id, idAt("A"), "the kept heading keeps its anchor");

  // A heading in the Markdown replaces the heading too, keeping its anchor;
  // the last section runs to the page's end; a section can be deleted.
  const again = ok(
    await tool(keys.write, "edit_doc", {
      doc: `doc:${doc.id}`,
      version: after.version,
      edits: [
        { op: "replace_section", heading: "B", markdown: "## Bee\n\nbuzz" },
        { op: "delete_section", heading: "C" },
      ],
    }),
  );
  assert.equal(again.status, "done");
  const last = await page(doc.id);
  assert.deepEqual(shape(last.content), [
    "heading:Top",
    "paragraph:intro",
    "heading:A",
    "paragraph:new a",
    "bullet:more",
    "heading:Bee",
    "paragraph:buzz",
  ]);
  assert.equal(last.content[5].id, idAt("B"));
  // Deleting the top heading's section takes the whole page under it.
  const top = await tool(keys.write, "edit_doc", {
    doc: `doc:${doc.id}`,
    version: last.version,
    edits: [{ op: "delete_section", heading: "Top" }],
  });
  ok(top);
  assert.equal((await page(doc.id)).content.length, 0);

  // Undo puts the page back as it was before that edit.
  const act = (
    await pool.query(
      "SELECT id FROM agent_activity WHERE grant_id = $1 ORDER BY id DESC LIMIT 1",
      [grants.write],
    )
  ).rows[0];
  const undo = await h.call(
    olga.token,
    "POST",
    `/me/agents/activity/${act.id}/undo`,
  );
  assert.equal(undo.statusCode, 200, undo.body);
  assert.deepEqual(shape((await page(doc.id)).content), shape(last.content));
});

test("edit_doc sections: missing, doubled and wrong headings change nothing", async () => {
  const doc = await sectioned();
  const edit = (edits: unknown[], version = doc.version) =>
    tool(keys.write, "edit_doc", { doc: `doc:${doc.id}`, version, edits });
  const missing = await edit([
    { op: "append", markdown: "kept?" },
    { op: "delete_section", heading: "Nowhere" },
  ]);
  assert.equal(code(missing), "INVALID");
  assert.match(missing.content[0].text, /no heading “Nowhere”/);
  assert.match(missing.content[0].text, /“A” \^b/, "lists the headings");
  // Two headings reading the same.
  const twice = ok(await edit([{ op: "append", markdown: "## B\n\nagain" }]))
    .done[0];
  const doubled = await edit(
    [{ op: "replace_section", heading: "B", markdown: "x" }],
    twice.version,
  );
  assert.equal(code(doubled), "INVALID");
  assert.match(doubled.content[0].text, /2 headings read “B”/);
  const now = await page(doc.id);
  const para = now.content.find((b) => b.type === "paragraph")!.id!;
  const notHeading = await edit(
    [{ op: "delete_section", heading: `^${para}` }],
    now.version,
  );
  assert.equal(code(notHeading), "INVALID");
  // A section can't move inside itself.
  const A = now.content.find((b) => "text" in b && b.text === "A")!;
  const a11 = now.content.find((b) => "text" in b && b.text === "a11")!;
  const inside = await edit(
    [{ op: "move_section", heading: A.id, block: a11.id }],
    now.version,
  );
  assert.equal(code(inside), "INVALID");
  // An op without what it needs is refused by the schema.
  const bare = await edit(
    [{ op: "replace_section", heading: "A" }],
    now.version,
  );
  assert.ok(bare.isError);
  // A stale version is refused.
  const stale = await edit(
    [{ op: "delete_section", heading: "C" }],
    now.version - 1,
  );
  assert.equal(code(stale), "VERSION_CONFLICT");
  assert.deepEqual(
    shape((await page(doc.id)).content),
    shape(now.content),
    "nothing changed",
  );
  // A read-only connection can't edit.
  const read = await tool(keys.read, "edit_doc", {
    doc: `doc:${doc.id}`,
    version: now.version,
    edits: [{ op: "delete_section", heading: "C" }],
  });
  assert.ok(read.isError);
});

test("edit_doc sections on a team page: deletes are suggestions, rewrites go to review", async () => {
  const teamDoc = (
    await h.call(mo.token, "POST", "/docs", {
      title: "Crew plan",
      team_id: crew,
      content: [
        { id: "bt1", type: "heading", level: 2, text: "Trip" },
        { id: "bt2", type: "paragraph", text: "We fly on Friday." },
        { id: "bt3", type: "bullet", text: "Bring helmets" },
        { id: "bt4", type: "heading", level: 2, text: "Budget" },
        { id: "bt5", type: "paragraph", text: "Tight." },
      ],
    })
  ).json();
  const struck = ok(
    await tool(keys.write, "edit_doc", {
      doc: `doc:${teamDoc.id}`,
      version: teamDoc.version,
      edits: [{ op: "delete_section", heading: "Trip" }],
    }),
  );
  assert.equal(struck.status, "done");
  const suggestions = (
    await pool.query(
      "SELECT block_id, kind FROM doc_suggestions WHERE doc_id = $1 ORDER BY block_id",
      [teamDoc.id],
    )
  ).rows;
  assert.deepEqual(suggestions, [
    { block_id: "bt1", kind: "delete" },
    { block_id: "bt2", kind: "delete" },
    { block_id: "bt3", kind: "delete" },
  ]);
  const review = ok(
    await tool(keys.write, "edit_doc", {
      doc: `doc:${teamDoc.id}`,
      version: teamDoc.version,
      edits: [
        {
          op: "replace_section",
          heading: "Budget",
          markdown: "> [!warning] Tight.",
        },
      ],
    }),
  );
  assert.equal(review.status, "pending_review");
  const unchanged = await page(teamDoc.id);
  assert.equal(unchanged.content.length, 5, "the page itself is unchanged");
});
