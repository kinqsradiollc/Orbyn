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
  keepStart,
  carryBlockIds,
  carryNewIds,
  changeAuthors,
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

test("a number typed on a line in the middle of a list is counted, not kept", () => {
  // The third item opened for editing reads "3. …", and reading that back
  // gives it a start; in the middle of a list the start is let go.
  const blocks: DocBlock[] = [
    { type: "numbered", text: "One" },
    { type: "numbered", text: "Two" },
    ...parseDoc(serializeBlock({ type: "numbered", text: "Three" }, 3)),
  ];
  assert.equal((blocks[2] as { start?: number }).start, 3);
  const kept = keepStart(blocks, 2);
  assert.equal((kept[2] as { start?: number }).start, undefined);
  assert.equal(listLayout(kept)[2].number, 3);
  // The first line of a list keeps the number it was given.
  const first: DocBlock[] = [
    { type: "paragraph", text: "Intro" },
    ...parseDoc("5. Five"),
  ];
  assert.equal(keepStart(first, 1), first);
  assert.equal(listLayout(first)[1].number, 5);
  // Anything that isn't a numbered line with a start is left alone.
  assert.equal(keepStart(blocks, 0), blocks);
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

test("a highlighter is kept, and a page's own background is not", () => {
  // Google Docs' yellow and light yellow pens.
  assert.deepEqual(
    htmlToBlocks(
      '<b style="font-weight:normal;" id="docs-internal-guid-2"><p dir="ltr">' +
        '<span style="background-color:transparent;">Plain </span>' +
        '<span style="background-color:#ffff00;">bright</span>' +
        '<span style="background-color:transparent;"> and </span>' +
        '<span style="background-color:#fff2cc;">soft</span></p></b>',
    ),
    [{ type: "paragraph", text: "Plain ==bright== and ==soft==" }],
  );
  // One highlighted word copied on its own is still highlighted.
  assert.deepEqual(
    htmlToBlocks(
      '<b style="font-weight:normal;" id="docs-internal-guid-3">' +
        '<span style="background-color:#ffff00;">alone</span></b>',
    ),
    [{ type: "paragraph", text: "==alone==" }],
  );
  // Word names its pen; <mark> is one.
  assert.deepEqual(
    htmlToBlocks(
      "<p class=MsoNormal>A <span style='background:yellow;mso-highlight:yellow'>word</span> <mark>here</mark></p>",
    ),
    [{ type: "paragraph", text: "A ==word== ==here==" }],
  );
  // See-through, as a browser writes a span with no background of its own.
  assert.deepEqual(
    htmlToBlocks(
      '<span style="background-color: rgba(0, 0, 0, 0);">plain words</span>',
    ),
    [{ type: "paragraph", text: "plain words" }],
  );
  assert.deepEqual(
    htmlToBlocks(
      '<p>Some <span style="background-color: rgba(0, 0, 0, 0)">plain</span> words</p>',
    ),
    [{ type: "paragraph", text: "Some plain words" }],
  );
  // A dark-mode page's background, on the span wrapping the copy.
  assert.deepEqual(
    htmlToBlocks(
      '<span style="color: rgb(230, 237, 243); background-color: rgb(13, 17, 23);">dark mode words</span>',
    ),
    [{ type: "paragraph", text: "dark mode words" }],
  );
  // An off-white page, on the wrapper and on a line; white on a word.
  assert.deepEqual(
    htmlToBlocks(
      '<div style="background-color:#f6f8fa"><p style="background:#fdf6e3">One ' +
        '<span style="background-color:#f6f8fa">two</span> ' +
        '<span style="background-color:white">three</span></p><p>Four</p></div>',
    ),
    [
      { type: "paragraph", text: "One two three" },
      { type: "paragraph", text: "Four" },
    ],
  );
  // A web page's white wrapper around a word that really is highlighted.
  assert.deepEqual(
    htmlToBlocks(
      '<span style="background-color: rgb(255, 255, 255)">Keep <span style="background: rgb(255, 235, 59) none repeat scroll 0% 0%">this</span> in mind</span>',
    ),
    [{ type: "paragraph", text: "Keep ==this== in mind" }],
  );
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

test("show changes says who made each change since a version", () => {
  // Kept versions, oldest first: Ann worked from the first, Bo from the
  // second, and Ann again from the third to the page as it is now.
  const v1: DocBlock[] = [
    { type: "paragraph", text: "Kept", id: "k" },
    { type: "paragraph", text: "Ann cut this", id: "x" },
    { type: "paragraph", text: "Bo cut this", id: "y" },
  ];
  const v2: DocBlock[] = [
    { type: "paragraph", text: "Kept", id: "k" },
    { type: "paragraph", text: "Bo cut this", id: "y" },
    { type: "paragraph", text: "Ann added this", id: "a" },
  ];
  const v3: DocBlock[] = [
    { type: "paragraph", text: "Kept", id: "k" },
    { type: "paragraph", text: "Ann added this", id: "a" },
    { type: "paragraph", text: "Bo added this", id: "b" },
  ];
  const now: DocBlock[] = [
    ...v3,
    { type: "paragraph", text: "Ann added this later", id: "c" },
  ];
  const lines = diffBlocks(v1, now);
  const who = changeAuthors(lines, [
    { content: v1, author: "Ann" },
    { content: v2, author: "Bo" },
    { content: v3, author: "Ann" },
  ]);
  const said = Object.fromEntries(
    lines.map((l, i) => [
      `${l.change} ${(l.block as { text: string }).text}`,
      who[i],
    ]),
  );
  assert.deepEqual(said, {
    "same Kept": null,
    "removed Ann cut this": "Ann",
    "removed Bo cut this": "Bo",
    "added Ann added this": "Ann",
    "added Bo added this": "Bo",
    "added Ann added this later": "Ann",
  });
  // Without the sittings in between there is only the one name to give.
  assert.deepEqual(
    changeAuthors(diffBlocks(v3, now), [{ content: v3, author: "Ann" }]),
    [null, null, null, "Ann"],
  );
});

test("names given while lines became tasks carry onto a page that moved on", () => {
  const sent: DocBlock[] = [
    { type: "todo", text: "Call Sam", done: false, id: "local-1" },
    { type: "todo", text: "No name yet", done: false },
    { type: "paragraph", text: "Notes" },
  ];
  const answer: DocBlock[] = [
    { type: "todo", text: "Call Sam", done: false, id: "server-1" },
    { type: "todo", text: "No name yet", done: false, id: "server-2" },
    { type: "paragraph", text: "Notes" },
  ];
  // Enter was pressed after the call went out: a new line under the first,
  // and words typed into it; the lines that were sent are still there.
  const now: DocBlock[] = [
    sent[0],
    { type: "todo", text: "Typed meanwhile", done: false },
    sent[1],
    { ...sent[2], text: "Notes, edited" },
  ];
  const carried = carryNewIds(sent, answer, now);
  assert.deepEqual(carried, [
    { type: "todo", text: "Call Sam", done: false, id: "server-1" },
    { type: "todo", text: "Typed meanwhile", done: false },
    { type: "todo", text: "No name yet", done: false, id: "server-2" },
    { type: "paragraph", text: "Notes, edited" },
  ]);
  // Nothing renamed: the same page comes back, untouched.
  assert.equal(carryNewIds(sent, sent, now), now);
  // A copy that doesn't line up with what was sent is not guessed at.
  assert.equal(carryNewIds(sent, answer.slice(1), now), now);
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
  // The global per-minute limit covers Trash like any other route (see the
  // 429 test below).
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

test("Trash and restore show in the project's history and reach open editors", async () => {
  const project = (
    await call("POST", "/projects", { name: "Pages that come and go" })
  ).json();
  const doc = await newDoc([{ type: "paragraph", text: "project page" }], {
    project_id: project.id,
  });
  // Listen as an open editor's stream does.
  const listener = await pool.connect();
  const heard: { docId: string; version: number; trashed?: boolean }[] = [];
  listener.on("notification", (m) => {
    if (m.channel === "doc_changed" && m.payload) {
      const news = JSON.parse(m.payload);
      if (news.docId === doc.id) heard.push(news);
    }
  });
  await listener.query("LISTEN doc_changed");
  try {
    assert.equal((await call("DELETE", `/docs/${doc.id}`)).statusCode, 204);
    const trashedAt = (
      await pool.query<{ event_order: string }>(
        "SELECT max(event_order)::text AS event_order FROM project_activity WHERE project_id = $1",
        [project.id],
      )
    ).rows[0].event_order;
    assert.equal(
      (await call("POST", `/docs/${doc.id}/restore`)).statusCode,
      200,
    );
    for (let i = 0; i < 100 && heard.length < 2; i++)
      await new Promise((r) => setTimeout(r, 20));

    // Editors are told it went, then that it came back.
    assert.equal(heard.length, 2);
    assert.equal(heard[0].trashed, true);
    assert.equal(heard[0].version, doc.version);
    assert.equal(heard[1].trashed, undefined);

    // The project's history has both, by the person who did them.
    const rows = (
      await pool.query<{
        kind: string;
        summary: string;
        actor: string | null;
        after_state: unknown;
      }>(
        `SELECT a.kind, a.summary, u.name AS actor, a.after_state
           FROM project_activity a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.project_id = $1 AND a.entity_id = $2
          ORDER BY a.event_order`,
        [project.id, doc.id],
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => [r.kind, r.summary, r.actor]),
      [
        ["note_added", `Note added: ${doc.title}`, "Writer"],
        ["note_removed", `Note moved to Trash: ${doc.title}`, "Writer"],
        ["note_added", `Note restored: ${doc.title}`, "Writer"],
      ],
    );
    assert.equal(rows[1].after_state, null);
    // Looking back to while it was in Trash, the page isn't in the project.
    const then = await call(
      "GET",
      `/projects/${project.id}/time-machine/${trashedAt}`,
    );
    assert.equal(then.statusCode, 200);
    assert.ok(!then.json().notes.some((n: { id: string }) => n.id === doc.id));
    const feed = (
      await call("GET", `/projects/${project.id}/time-machine/checkpoints`)
    ).json() as { summary: string }[];
    assert.ok(feed.some((c) => c.summary.startsWith("Note restored:")));
  } finally {
    await listener.query("UNLISTEN doc_changed");
    listener.release();
  }
  // A page outside any project leaves no project history behind.
  const loose = await newDoc([{ type: "paragraph", text: "loose" }]);
  await call("DELETE", `/docs/${loose.id}`);
  const none = await pool.query(
    "SELECT 1 FROM project_activity WHERE entity_id = $1",
    [loose.id],
  );
  assert.equal(none.rowCount, 0);
});

test("a page in Trash can't be shown as open", async () => {
  const doc = await newDoc([{ type: "paragraph", text: "open here" }]);
  const beat = () =>
    call("POST", "/presence/heartbeat", {
      device_id: "trash-device-0001",
      platform: "web",
      doc_id: doc.id,
    });
  assert.equal((await beat()).statusCode, 200);
  await call("DELETE", `/docs/${doc.id}`);
  assert.equal((await beat()).statusCode, 404);
  await call("POST", `/docs/${doc.id}/restore`);
  assert.equal((await beat()).statusCode, 200);
});

test("today's agenda brought back from Trash replaces an untouched copy", async () => {
  const first = (await call("GET", "/agenda/today")).json() as {
    id: string;
    title: string;
  };
  await call("DELETE", `/docs/${first.id}`);
  // Opening Agenda while it is in Trash writes a fresh copy.
  const copy = (await call("GET", "/agenda/today")).json() as { id: string };
  assert.notEqual(copy.id, first.id);
  assert.equal(
    (await call("POST", `/docs/${first.id}/restore`)).statusCode,
    200,
  );
  // The untouched copy is let go; Agenda opens the one that came back.
  assert.equal((await call("GET", `/docs/${copy.id}`)).statusCode, 404);
  assert.equal((await call("GET", "/agenda/today")).json().id, first.id);

  // A copy someone wrote in is kept.
  await call("DELETE", `/docs/${first.id}`);
  const written = (await call("GET", "/agenda/today")).json() as {
    id: string;
    version: number;
  };
  await call("PUT", `/docs/${written.id}`, {
    content: [{ type: "paragraph", text: "My own notes" }],
    version: written.version,
  });
  await call("POST", `/docs/${first.id}/restore`);
  assert.equal((await call("GET", `/docs/${written.id}`)).statusCode, 200);
  // Tidy up, so the rest of the file finds one agenda for today.
  await call("DELETE", `/docs/${written.id}`);
  await call("DELETE", `/docs/${written.id}/forever`);
});

test("Trash routes answer 429 past the per-minute limit", async () => {
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  const doc = await newDoc([{ type: "paragraph", text: "limited" }]);
  await call("DELETE", `/docs/${doc.id}`);
  await settings();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  live.rate_limit_per_minute = 2;
  const from = (method: "GET" | "POST" | "DELETE", url: string) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      remoteAddress: "10.71.0.1",
    });
  try {
    assert.equal((await from("GET", "/docs/trash")).statusCode, 200);
    assert.equal((await from("GET", "/docs/trash")).statusCode, 200);
    const limited = await from("GET", "/docs/trash");
    assert.equal(limited.statusCode, 429);
    assert.ok(Number(limited.headers["retry-after"]) > 0);
    assert.equal(
      (await from("POST", `/docs/${doc.id}/restore`)).statusCode,
      429,
    );
    assert.equal(
      (await from("DELETE", `/docs/${doc.id}/forever`)).statusCode,
      429,
    );
  } finally {
    live.rate_limit_per_minute = was;
  }
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

test("making tasks waits for a save in flight and keeps what it wrote", async () => {
  const doc = await newDoc([
    { type: "todo", text: "Book the room", done: false, id: "r1" },
  ]);
  // A save holds the page while the lines are being made tasks.
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT 1 FROM docs WHERE id = $1 FOR UPDATE", [doc.id]);
    const making = call("POST", `/docs/${doc.id}/tasks`, {
      block_ids: ["r1"],
    });
    await new Promise((r) => setTimeout(r, 150));
    await holder.query(
      "UPDATE docs SET content = $2::jsonb, version = version + 1 WHERE id = $1",
      [
        doc.id,
        JSON.stringify([
          { type: "todo", text: "Book the room", done: false, id: "r1" },
          { type: "paragraph", text: "Written meanwhile", id: "w1" },
        ]),
      ],
    );
    await holder.query("COMMIT");
    const made = await making;
    assert.equal(made.statusCode, 200);
    assert.equal(made.json().created, 1);
    // The line written while it waited is still there.
    assert.deepEqual(
      (made.json().doc.content as { text: string }[]).map((b) => b.text),
      ["Book the room", "Written meanwhile"],
    );
  } finally {
    holder.release();
  }
});
