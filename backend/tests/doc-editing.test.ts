import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { runSweep, SWEEP_RULES } = await import("../src/lib/sweep.js");
const core = await import("@orbyn/core");
const {
  parseDoc,
  serializeDoc,
  serializeBlock,
  listLayout,
  indentBlocks,
  carryBlockIds,
  blockToType,
  docContent,
  parseDocInline,
  plainText,
  styleRange,
  linkRange,
  linkShortcut,
  docStats,
  pageFooter,
  savedAgo,
  htmlToBlocks,
  textToBlocks,
  diffBlocks,
  diffCounts,
  restoreLine,
  reanchorComments,
  trashLeft,
  TRASH_DAYS,
  docToHtml,
  docToText,
} = core;
type DocBlock = import("@orbyn/core").DocBlock;

const app = await buildApp();
let token = "";
let otherToken = "";
let otherEmail = "";

const call = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  as: string | null = token,
) =>
  app.inject({
    method,
    url,
    headers: as ? { authorization: `Bearer ${as}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async (name: string) => {
  const email = `pages-${randomUUID()}@example.com`;
  const res = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "a-long-test-password", name },
    })
  ).json();
  return { token: res.token as string, email };
};

before(async () => {
  await migrate();
  token = (await register("Writer")).token;
  const other = await register("Stranger");
  otherToken = other.token;
  otherEmail = other.email;
});
after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
});

// ------------------------------------------------------ numbered and nested --

test("nested lists round-trip through Markdown with their depth", () => {
  const source = [
    "- Groceries",
    "    - Fruit",
    "        - Apples",
    "    - Bread",
    "- [ ] Call the bank",
    "    - [x] Find the account number",
    "1. First",
    "    1. First, part one",
    "2. Second",
  ].join("\n");
  const blocks = parseDoc(source);
  assert.deepEqual(
    blocks.map((b) => [b.type, "depth" in b ? (b.depth ?? 0) : 0]),
    [
      ["bullet", 0],
      ["bullet", 1],
      ["bullet", 2],
      ["bullet", 1],
      ["todo", 0],
      ["todo", 1],
      ["numbered", 0],
      ["numbered", 1],
      ["numbered", 0],
    ],
  );
  // Top-level lines carry no depth at all, so pages written before nesting
  // existed read exactly as they did.
  assert.equal("depth" in blocks[0], false);
  assert.deepEqual(parseDoc(serializeDoc(blocks)), blocks);
});

test("two-space, four-space and tab indents all read as the same nesting", () => {
  const shape = (md: string) =>
    parseDoc(md).map((b) => ("depth" in b ? (b.depth ?? 0) : 0));
  const two = shape("- a\n  - b\n    - c\n- d");
  assert.deepEqual(two, [0, 1, 2, 0]);
  assert.deepEqual(shape("- a\n    - b\n        - c\n- d"), two);
  assert.deepEqual(shape("- a\n\t- b\n\t\t- c\n- d"), two);
  // A paragraph ends the list: an indented item after it starts afresh.
  assert.deepEqual(shape("- a\n  - b\n\nText\n\n  - c"), [0, 1, 0, 0]);
  // Nothing is ever deeper than three steps.
  assert.deepEqual(
    shape("- a\n  - b\n    - c\n      - d\n        - e"),
    [0, 1, 2, 3, 3],
  );
});

test("numbered lists count, restart after other lines, and keep a start", () => {
  const blocks = parseDoc(
    [
      "1. One",
      "    - an aside",
      "1. Two",
      "1. Three",
      "",
      "Between the lists.",
      "",
      "5. Five",
      "6. Six",
    ].join("\n"),
  );
  const numbers = listLayout(blocks).map((l) => l.number);
  assert.deepEqual(numbers, [1, null, 2, 3, null, 5, 6]);
  // Only the first item of a list says where it starts.
  assert.equal(blocks[5].type === "numbered" && blocks[5].start, 5);
  assert.equal("start" in blocks[6], false);
  // The Markdown is written with the numbers the page shows.
  const md = serializeDoc(blocks);
  assert.match(md, /^1\. One$/m);
  assert.match(md, /^2\. Two$/m);
  assert.match(md, /^3\. Three$/m);
  assert.match(md, /^5\. Five$/m);
  assert.match(md, /^6\. Six$/m);
  assert.deepEqual(parseDoc(md), blocks);
  // A line in the editor shows its own Markdown, without the page's indent.
  assert.equal(serializeBlock({ type: "bullet", text: "x", depth: 2 }), "- x");
});

test("a bullet at the same depth ends a numbered list", () => {
  const layout = listLayout([
    { type: "numbered", text: "a" },
    { type: "numbered", text: "b" },
    { type: "bullet", text: "c" },
    { type: "numbered", text: "d" },
  ]);
  assert.deepEqual(
    layout.map((l) => l.number),
    [1, 2, null, 1],
  );
});

test("a sub-item whose parent went is drawn at the parent's place", () => {
  const layout = listLayout([
    { type: "paragraph", text: "intro" },
    { type: "bullet", text: "orphan", depth: 2 },
    { type: "bullet", text: "child", depth: 3 },
  ]);
  assert.deepEqual(
    layout.map((l) => l.depth),
    [0, 0, 1],
  );
});

test("Tab and Shift+Tab move a line and the lines under it", () => {
  const blocks: DocBlock[] = [
    { type: "bullet", text: "a", id: "a" },
    { type: "bullet", text: "b", id: "b" },
    { type: "bullet", text: "c", id: "c", depth: 1 },
    { type: "bullet", text: "d", id: "d" },
  ];
  // The first line has nothing to go under.
  assert.equal(indentBlocks(blocks, 0, 1), blocks);
  const tucked = indentBlocks(blocks, 1, 1);
  assert.deepEqual(
    tucked.map((b) => ("depth" in b ? (b.depth ?? 0) : 0)),
    [0, 1, 2, 0],
  );
  // Names stay on their lines, so comments and tasks keep their anchors.
  assert.deepEqual(
    tucked.map((b) => b.id),
    ["a", "b", "c", "d"],
  );
  // Only one step deeper than the line above.
  assert.equal(indentBlocks(tucked, 1, 1), tucked);
  const back = indentBlocks(tucked, 1, -1);
  assert.deepEqual(back, blocks);
  // A paragraph doesn't nest.
  const para: DocBlock[] = [
    { type: "bullet", text: "a" },
    { type: "paragraph", text: "b" },
  ];
  assert.equal(indentBlocks(para, 1, 1), para);
});

test("an edited nested line keeps its depth and its name", () => {
  const before: DocBlock = { type: "bullet", text: "old", id: "x", depth: 2 };
  // The editor re-reads a line from its own Markdown, which has no indent.
  const fresh = carryBlockIds(before, parseDoc("- new words"));
  assert.deepEqual(fresh, [
    { type: "bullet", text: "new words", id: "x", depth: 2 },
  ]);
  // Turned into a checklist line, it stays where it was.
  assert.deepEqual(blockToType(before, "todo"), {
    type: "todo",
    text: "old",
    done: false,
    id: "x",
    depth: 2,
  });
  // A heading can't be tucked in, so the depth goes.
  assert.equal("depth" in blockToType(before, "heading"), false);
  // Remarks anchored to a nested line still follow it.
  const moved = reanchorComments(
    [
      {
        id: "c1",
        doc_id: "d",
        user_id: "u",
        author: "A",
        body: "hm",
        block_id: "x",
        quote: "words",
        range_start: 4,
        range_end: 9,
        parent_id: null,
        detached: false,
        mentions: [],
        resolved_at: null,
        created_at: "",
      },
    ],
    fresh,
  );
  assert.deepEqual(moved, []);
});

test("the stored shape keeps depth and start, and refuses nonsense", () => {
  const kept = docContent.parse([
    { type: "bullet", text: "a", depth: 1 },
    { type: "numbered", text: "b", start: 4, depth: 2 },
    { type: "todo", text: "c", done: false, depth: 3 },
  ]);
  assert.equal(kept[0].type === "bullet" && kept[0].depth, 1);
  assert.equal(kept[1].type === "numbered" && kept[1].start, 4);
  assert.equal(
    docContent.safeParse([{ type: "bullet", text: "a", depth: 4 }]).success,
    false,
  );
  assert.equal(
    docContent.safeParse([{ type: "numbered", text: "a", start: -1 }]).success,
    false,
  );
});

test("exports nest lists and count numbers", () => {
  const blocks: DocBlock[] = [
    { type: "numbered", text: "One" },
    { type: "bullet", text: "Aside", depth: 1 },
    { type: "numbered", text: "Two" },
    { type: "paragraph", text: "==Marked== words" },
  ];
  const html = docToHtml("T", blocks);
  assert.match(
    html,
    /<ol>\n<li>One\n<ul>\n<li>Aside<\/li>\n<\/ul><\/li>\n<li>Two<\/li>\n<\/ol>/,
  );
  assert.match(html, /<mark>Marked<\/mark> words/);
  const text = docToText("T", blocks);
  assert.match(text, /^1\. One$/m);
  assert.match(text, /^ {4}• Aside$/m);
  assert.match(text, /^2\. Two$/m);
});

// ------------------------------------------------------ inline and editing --

test("highlights are ==words==, and a == b stays text", () => {
  const runs = parseDocInline("Keep ==this part== in mind");
  const lit = runs.find((r) => r.highlight);
  assert.equal(lit?.text, "this part");
  assert.equal(lit?.start, 7);
  assert.equal(
    plainText("Keep ==this part== in mind"),
    "Keep this part in mind",
  );
  assert.equal(
    parseDocInline("if a == b and c == d").some((r) => r.highlight),
    false,
  );
});

test("styles go on plain words and come off again", () => {
  const bold = styleRange("make this bold", 5, 9, "bold");
  assert.deepEqual(bold, { text: "make **this** bold", start: 7, end: 11 });
  // Inside the bold words, the same shortcut takes the style off.
  assert.deepEqual(styleRange(bold!.text, 7, 11, "bold"), {
    text: "make this bold",
    start: 5,
    end: 9,
  });
  // Spaces at the edges stay outside the markers.
  assert.equal(styleRange("a  word  b", 1, 8, "italic")?.text, "a  *word*  b");
  assert.equal(styleRange("mark me", 0, 7, "highlight")?.text, "==mark me==");
  // Styles don't nest yet: crossing bold words refuses rather than breaks.
  assert.equal(styleRange("x **bold** y", 0, 12, "italic"), null);
  // Nothing selected: markers with the caret between them.
  assert.deepEqual(styleRange("ab", 1, 1, "bold"), {
    text: "a****b",
    start: 3,
    end: 3,
  });
});

test("links wrap plain words, and ⌘K leaves the caret where it's needed", () => {
  assert.equal(
    linkRange("see the plan here", 4, 12, "example.com/plan")?.text,
    "see [the plan](https://example.com/plan) here",
  );
  assert.equal(linkRange("see", 0, 3, "not a link"), null);
  assert.equal(linkRange("see", 0, 3, "javascript:alert(1)"), null);
  const words = linkShortcut("read this", 5, 9);
  assert.equal(words.text, "read [this]()");
  assert.equal(words.start, 12);
  const url = linkShortcut("go https://x.test now", 3, 17);
  assert.equal(url.text, "go [](https://x.test) now");
  assert.equal(url.start, 4);
});

test("the footer counts words and reading time, and says when it was saved", () => {
  const blocks = parseDoc(
    `# Title\n\n${Array.from({ length: 600 }, () => "word").join(" ")}`,
  );
  const stats = docStats(blocks);
  assert.equal(stats.words, 601);
  assert.equal(stats.minutes, 3);
  const now = new Date("2026-09-24T12:00:00Z");
  assert.equal(
    pageFooter({ ...stats, savedAt: "2026-09-24T11:58:00Z", now }),
    "601 words · 3 min read · Saved 2 min ago",
  );
  assert.equal(
    pageFooter({ words: 1204, minutes: 5, selected: 12, saving: true }),
    "12 of 1,204 words · 5 min read · Saving…",
  );
  assert.equal(pageFooter({ words: 0, minutes: 0 }), "0 words");
  assert.equal(savedAgo("2026-09-24T11:59:50Z", now), "just now");
  assert.equal(savedAgo("2026-09-24T09:00:00Z", now), "3 hours ago");
  assert.equal(savedAgo("2026-09-23T10:00:00Z", now), "yesterday");
  assert.equal(savedAgo("2026-09-04T10:00:00Z", now), "on 4 Sep");
});

// ------------------------------------------------------------------ paste --

test("Google Docs HTML keeps headings, nested lists, links and emphasis", () => {
  const html =
    '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">' +
    '<h2 dir="ltr"><span style="font-weight:700">Plan</span></h2>' +
    '<p dir="ltr"><span style="font-weight:400">Read the </span>' +
    '<a href="https://x.test/brief"><span>brief</span></a>' +
    '<span style="font-weight:700"> first</span>' +
    '<span style="font-style:italic"> today</span>.</p>' +
    '<ul><li aria-level="1"><p>Draft</p></li>' +
    '<ul><li aria-level="2"><p>Outline</p></li></ul>' +
    '<li aria-level="1"><p>Send</p></li></ul>' +
    "<ol><li><p>One</p></li><li><p>Two</p></li></ol>" +
    "</b>";
  const blocks = htmlToBlocks(html);
  assert.deepEqual(blocks, [
    { type: "heading", level: 2, text: "Plan" },
    {
      type: "paragraph",
      text: "Read the [brief](https://x.test/brief) **first** *today*.",
    },
    { type: "bullet", text: "Draft" },
    { type: "bullet", text: "Outline", depth: 1 },
    { type: "bullet", text: "Send" },
    { type: "numbered", text: "One" },
    { type: "numbered", text: "Two" },
  ]);
});

test("web page HTML: nested lists, checkboxes, quotes, code and tables", () => {
  const html = `<!--StartFragment--><ul>
      <li>Parent
        <ul><li>Child &amp; more</li></ul>
      </li>
      <li><input type="checkbox" checked> Done thing</li>
    </ul>
    <blockquote><p>Said once</p></blockquote>
    <pre><code>npm test
npm run build</code></pre>
    <table><tr><th>Name</th><th>Role</th></tr><tr><td>Ann</td><td>Lead</td></tr></table>
    <p>Line one<br>Line two</p><hr><script>alert(1)</script><!--EndFragment-->`;
  const blocks = htmlToBlocks(html);
  assert.deepEqual(blocks, [
    { type: "bullet", text: "Parent" },
    { type: "bullet", text: "Child & more", depth: 1 },
    { type: "todo", text: "Done thing", done: true },
    { type: "quote", text: "Said once" },
    { type: "code", text: "npm test\nnpm run build", lang: "" },
    { type: "bullet", text: "Name: Ann · Role: Lead" },
    { type: "paragraph", text: "Line one" },
    { type: "paragraph", text: "Line two" },
    { type: "divider" },
  ]);
});

test("Word's list paragraphs come in as lists", () => {
  const html =
    "<p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'><![if !supportLists]>" +
    "<span style='mso-list:Ignore'>1.<span>&nbsp;&nbsp;</span></span><![endif]>Alpha</p>" +
    "<p class=MsoListParagraphCxSpLast style='mso-list:l0 level2 lfo1'><![if !supportLists]>" +
    "<span style='mso-list:Ignore'>o<span>&nbsp;</span></span><![endif]>Beta</p>";
  assert.deepEqual(htmlToBlocks(html), [
    { type: "numbered", text: "Alpha" },
    { type: "bullet", text: "Beta", depth: 1 },
  ]);
});

test("plain text pastes as Markdown, and ⌘⇧V keeps every line as it is", () => {
  assert.deepEqual(textToBlocks("# Title\n- a\n  - b"), [
    { type: "heading", level: 1, text: "Title" },
    { type: "bullet", text: "a" },
    { type: "bullet", text: "b", depth: 1 },
  ]);
  assert.deepEqual(textToBlocks("# Title\n\n- a", true), [
    { type: "paragraph", text: "# Title" },
    { type: "paragraph", text: "- a" },
  ]);
});

// ------------------------------------------------------------ show changes --

test("show changes: added, removed and edited lines, in place", () => {
  const before: DocBlock[] = [
    { type: "heading", level: 1, text: "Notes", id: "h" },
    { type: "paragraph", text: "Kept line", id: "k" },
    { type: "paragraph", text: "Old wording", id: "e" },
    { type: "bullet", text: "Gone", id: "g" },
    { type: "paragraph", text: "End" },
  ];
  const after: DocBlock[] = [
    { type: "heading", level: 1, text: "Notes", id: "h" },
    { type: "paragraph", text: "Kept line", id: "k" },
    { type: "paragraph", text: "New wording", id: "e" },
    { type: "bullet", text: "Fresh" },
    { type: "paragraph", text: "End" },
  ];
  const lines = diffBlocks(before, after);
  assert.deepEqual(
    lines.map((l) => [
      l.change,
      "text" in l.block ? l.block.text : "",
      !!l.edited,
    ]),
    [
      ["same", "Notes", false],
      ["same", "Kept line", false],
      ["removed", "Old wording", true],
      ["added", "New wording", true],
      ["removed", "Gone", false],
      ["added", "Fresh", false],
      ["same", "End", false],
    ],
  );
  assert.deepEqual(diffCounts(lines), { added: 1, removed: 1, edited: 1 });
  // Nothing changed reads as nothing changed.
  assert.ok(diffBlocks(after, after).every((l) => l.change === "same"));
  // A name alone is not a change.
  assert.ok(
    diffBlocks(
      [{ type: "paragraph", text: "x" }],
      [{ type: "paragraph", text: "x", id: "new" }],
    ).every((l) => l.change === "same"),
  );
});

test("restore this line: edited lines get their words back, gone ones return", () => {
  const before: DocBlock[] = [
    { type: "paragraph", text: "A", id: "a" },
    { type: "paragraph", text: "Old B", id: "b" },
    { type: "paragraph", text: "C", id: "c" },
    { type: "paragraph", text: "D", id: "d" },
  ];
  const now: DocBlock[] = [
    { type: "paragraph", text: "A", id: "a" },
    { type: "paragraph", text: "New B", id: "b" },
    { type: "paragraph", text: "D", id: "d" },
  ];
  // Edited in place: same position, old words, same name.
  assert.deepEqual(restoreLine(now, before, 1)[1], before[1]);
  // Removed: back after the nearest earlier line still on the page.
  const back = restoreLine(now, before, 2);
  assert.deepEqual(
    back.map((b) => b.id),
    ["a", "b", "c", "d"],
  );
  // With nothing above it left, it goes to the top.
  assert.equal(
    restoreLine([{ type: "paragraph", text: "Z" }], before, 0)[0].id,
    "a",
  );
  // A blank page takes the line in place of its one empty line.
  assert.deepEqual(restoreLine([{ type: "paragraph", text: "" }], before, 2), [
    before[2],
  ]);
});

// ------------------------------------------------------------------ trash --

const newDoc = async (content: DocBlock[] = [], extra: object = {}) =>
  (
    await call("POST", "/docs", {
      title: `Page ${randomUUID().slice(0, 6)}`,
      content,
      ...extra,
    })
  ).json() as { id: string; version: number; title: string };

test("nested and numbered lines survive a save", async () => {
  const doc = await newDoc();
  const content: DocBlock[] = [
    { type: "numbered", text: "Start here", start: 3, id: "n1" },
    { type: "bullet", text: "Under it", depth: 1, id: "n2" },
    { type: "todo", text: "Deeper", done: false, depth: 2, id: "n3" },
  ];
  const saved = await call("PUT", `/docs/${doc.id}`, {
    content,
    version: doc.version,
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().content, content);
  const md = (await call("GET", `/docs/${doc.id}/markdown`)).body;
  assert.match(md, /^3\. Start here$/m);
  assert.match(md, /^ {4}- Under it$/m);
  assert.match(md, /^ {8}- \[ \] Deeper$/m);
});

test("deleting a page moves it to Trash, out of everything else", async () => {
  const doc = await newDoc([
    { type: "paragraph", text: "zephyrous lighthouse keeper notes", id: "p1" },
    {
      type: "paragraph",
      text: "What is a lighthouse :: A tower with a light",
      id: "q1",
    },
  ]);
  await call("POST", `/docs/${doc.id}/comments`, {
    body: "A remark that should survive",
    block_id: "p1",
  });
  // Seen by search and study before it goes.
  const found = await call("GET", "/search?q=zephyrous");
  assert.ok(found.json().some((h: { id: string }) => h.id === doc.id));
  const study = (await call("GET", "/study")).json();
  assert.ok(study.decks.some((d: { doc_id: string }) => d.doc_id === doc.id));

  assert.equal((await call("DELETE", `/docs/${doc.id}`)).statusCode, 204);
  assert.equal((await call("GET", `/docs/${doc.id}`)).statusCode, 404);
  assert.equal(
    (await call("PUT", `/docs/${doc.id}`, { title: "x", version: 1 }))
      .statusCode,
    404,
  );
  assert.equal((await call("GET", `/docs/${doc.id}/comments`)).statusCode, 404);
  assert.equal((await call("DELETE", `/docs/${doc.id}`)).statusCode, 404);
  const list = (await call("GET", "/docs")).json() as { id: string }[];
  assert.ok(!list.some((d) => d.id === doc.id));
  const searched = (await call("GET", "/search?q=zephyrous")).json();
  assert.ok(!searched.some((h: { id: string }) => h.id === doc.id));
  const studying = (await call("GET", "/study")).json();
  assert.ok(
    !studying.decks.some((d: { doc_id: string }) => d.doc_id === doc.id),
  );

  const trash = await call("GET", "/docs/trash");
  assert.equal(trash.statusCode, 200);
  // The global per-minute limit covers Trash like any other route.
  assert.ok(trash.headers["ratelimit-limit"] !== undefined);
  const entry = (trash.json() as import("@orbyn/core").TrashedDoc[]).find(
    (d) => d.id === doc.id,
  );
  assert.ok(entry);
  assert.equal(entry.deleted_by, "Writer");
  assert.equal(entry.can_restore, true);
  assert.match(entry.preview, /zephyrous/);
  const days =
    (Date.parse(entry.purge_at) - Date.parse(entry.deleted_at)) / 86_400_000;
  assert.equal(Math.round(days), TRASH_DAYS);
  assert.equal(
    trashLeft(entry.purge_at, new Date(entry.deleted_at)),
    "Deleted for good in 30 days",
  );

  // Restoring brings it back with its remarks, and its cards to study.
  const restored = await call("POST", `/docs/${doc.id}/restore`);
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().id, doc.id);
  assert.equal((await call("GET", `/docs/${doc.id}`)).statusCode, 200);
  const remarks = (await call("GET", `/docs/${doc.id}/comments`)).json();
  assert.equal(remarks.length, 1);
  const again = (await call("GET", "/study")).json();
  assert.ok(again.decks.some((d: { doc_id: string }) => d.doc_id === doc.id));
  const gone = (await call("GET", "/docs/trash")).json() as { id: string }[];
  assert.ok(!gone.some((d) => d.id === doc.id));
  // Restoring what isn't in Trash is "not found".
  assert.equal((await call("POST", `/docs/${doc.id}/restore`)).statusCode, 404);
});

test("Trash routes: signed out, strangers, viewers and bad ids", async () => {
  const doc = await newDoc([{ type: "paragraph", text: "mine" }]);
  await call("DELETE", `/docs/${doc.id}`);
  // Signed out.
  assert.equal(
    (await call("GET", "/docs/trash", undefined, null)).statusCode,
    401,
  );
  assert.equal(
    (await call("POST", `/docs/${doc.id}/restore`, undefined, null)).statusCode,
    401,
  );
  assert.equal(
    (await call("DELETE", `/docs/${doc.id}/forever`, undefined, null))
      .statusCode,
    401,
  );
  // Someone else's page is not found, in Trash or out of it.
  assert.equal(
    (await call("POST", `/docs/${doc.id}/restore`, undefined, otherToken))
      .statusCode,
    404,
  );
  assert.equal(
    (await call("DELETE", `/docs/${doc.id}/forever`, undefined, otherToken))
      .statusCode,
    404,
  );
  const theirs = (
    await call("GET", "/docs/trash", undefined, otherToken)
  ).json();
  assert.ok(!theirs.some((d: { id: string }) => d.id === doc.id));
  // Not an id: refused as invalid before anything is looked up.
  assert.equal((await call("POST", "/docs/not-an-id/restore")).statusCode, 422);
  assert.equal(
    (await call("DELETE", "/docs/not-an-id/forever")).statusCode,
    422,
  );

  // A team viewer sees the team's Trash but can't act on it.
  const team = (await call("POST", "/teams", { name: "Trash team" })).json();
  await call("POST", `/teams/${team.id}/members`, {
    email: otherEmail,
    role: "viewer",
  });
  const shared = await newDoc([{ type: "paragraph", text: "shared" }], {
    team_id: team.id,
  });
  assert.equal(
    (await call("DELETE", `/docs/${shared.id}`, undefined, otherToken))
      .statusCode,
    403,
  );
  assert.equal((await call("DELETE", `/docs/${shared.id}`)).statusCode, 204);
  const seen = (await call("GET", "/docs/trash", undefined, otherToken)).json();
  const row = seen.find((d: { id: string }) => d.id === shared.id);
  assert.ok(row);
  assert.equal(row.can_restore, false);
  assert.equal(row.team_name, "Trash team");
  assert.equal(
    (await call("POST", `/docs/${shared.id}/restore`, undefined, otherToken))
      .statusCode,
    403,
  );
  assert.equal(
    (await call("DELETE", `/docs/${shared.id}/forever`, undefined, otherToken))
      .statusCode,
    403,
  );
});

test("delete for good works only from Trash, and takes the history too", async () => {
  const doc = await newDoc([{ type: "paragraph", text: "one" }]);
  await call("PUT", `/docs/${doc.id}`, {
    content: [{ type: "paragraph", text: "two" }],
    version: doc.version,
  });
  // Not in Trash yet: deleting for good is refused as not found.
  assert.equal(
    (await call("DELETE", `/docs/${doc.id}/forever`)).statusCode,
    404,
  );
  await call("DELETE", `/docs/${doc.id}`);
  assert.equal(
    (await call("DELETE", `/docs/${doc.id}/forever`)).statusCode,
    204,
  );
  const left = await pool.query(
    "SELECT (SELECT count(*) FROM docs WHERE id = $1)::int AS docs, (SELECT count(*) FROM doc_versions WHERE doc_id = $1)::int AS versions",
    [doc.id],
  );
  assert.deepEqual(left.rows[0], { docs: 0, versions: 0 });
});

test("the sweeper empties Trash after 30 days, and not before", async () => {
  const rule = SWEEP_RULES.find((r) => r.key === "doc_trash");
  assert.ok(rule);
  assert.equal(rule.configurable, false);
  const old = await newDoc([{ type: "paragraph", text: "old" }]);
  const recent = await newDoc([{ type: "paragraph", text: "recent" }]);
  const live = await newDoc([{ type: "paragraph", text: "live" }]);
  await call("DELETE", `/docs/${old.id}`);
  await call("DELETE", `/docs/${recent.id}`);
  await pool.query(
    "UPDATE docs SET deleted_at = now() - interval '31 days' WHERE id = $1",
    [old.id],
  );
  await pool.query(
    "UPDATE docs SET deleted_at = now() - interval '29 days' WHERE id = $1",
    [recent.id],
  );
  const result = await runSweep();
  assert.ok(result);
  assert.ok((result.removed.doc_trash ?? 0) >= 1);
  const ids = (
    await pool.query<{ id: string }>("SELECT id FROM docs WHERE id = ANY($1)", [
      [old.id, recent.id, live.id],
    ])
  ).rows.map((r) => r.id);
  assert.ok(!ids.includes(old.id));
  assert.ok(ids.includes(recent.id));
  assert.ok(ids.includes(live.id));
});

test("Make task turns just the lines asked for into tasks", async () => {
  const doc = await newDoc([
    { type: "todo", text: "Only this one", done: false, id: "t1" },
    { type: "todo", text: "Not this one", done: false, id: "t2" },
  ]);
  const made = await call("POST", `/docs/${doc.id}/tasks`, {
    block_ids: ["t1"],
  });
  assert.equal(made.statusCode, 200);
  assert.equal(made.json().created, 1);
  assert.equal(made.json().items[0].title, "Only this one");
  // The other line is still just a line: asking for all makes it now.
  const rest = await call("POST", `/docs/${doc.id}/tasks`, {});
  assert.equal(rest.json().created, 1);
  assert.equal(rest.json().items[0].title, "Not this one");
  // A request that isn't what the route takes is refused.
  assert.equal(
    (await call("POST", `/docs/${doc.id}/tasks`, { block_ids: [] })).statusCode,
    422,
  );
  assert.equal(
    (await call("POST", `/docs/${doc.id}/tasks`, { lines: ["t1"] })).statusCode,
    422,
  );
  // And a body that isn't JSON at all is a bad request.
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/docs/${doc.id}/tasks`,
        payload: "{",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await call("POST", `/docs/${doc.id}/tasks`, {}, null)).statusCode,
    401,
  );
  // A page in Trash has no lines to make tasks from.
  await call("DELETE", `/docs/${doc.id}`);
  assert.equal(
    (await call("POST", `/docs/${doc.id}/tasks`, {})).statusCode,
    404,
  );
});
