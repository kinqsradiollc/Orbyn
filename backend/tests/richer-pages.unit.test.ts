import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aliasesInput,
  appPath,
  blocksToClipboard,
  blockToType,
  canFold,
  colourCode,
  colourable,
  docContent,
  docPlainText,
  embedText,
  emptyTable,
  findMention,
  foldableHeadings,
  foldedLines,
  footnoteNumbers,
  highlightCards,
  layoutFlowchart,
  linkHref,
  linkMention,
  nextFootnoteLabel,
  pageFileType,
  parseAppLink,
  parseDoc,
  parseDocInline,
  parseEmbed,
  parseFlowchart,
  parseObjectHref,
  parseTable,
  plainText,
  refFromUrl,
  sectionOf,
  serializeDoc,
  sniffPageFile,
  splitHeadingQuery,
  styleRange,
  tableMarkdown,
  tintRange,
  webLinks,
  withClozeLines,
  diagramKind,
  type DocBlock,
} from "@orbyn/core";

/**
 * Richer links and pages (D4b), the shared rules the apps and the server
 * both read by: the new kinds of line and how they round-trip through
 * Markdown, the new inline marks, links to one line, mentions, folds,
 * cards from highlights, code colouring, flowcharts, rich copy and the
 * checks on files.
 */

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("callouts, tables, pictures, files and footnotes round-trip through Markdown", () => {
  const md = [
    "> [!tip] Start early",
    "",
    "> [!warning]- Folded away",
    "",
    "> [!info] An alias of note",
    "> and its second line",
    "",
    "| Term | Meaning |",
    "| :--- | ---: |",
    "| CAP | Consistency \\| more |",
    "",
    `![The diagram](orbyn://file/${ID}?w=60)`,
    "",
    `[Slides.pdf](orbyn://file/${ID})`,
    "",
    "A claim[^1].",
    "",
    "[^1]: Source: the lecture.",
  ].join("\n");
  const blocks = parseDoc(md);
  assert.deepEqual(blocks, [
    { type: "callout", kind: "tip", text: "Start early" },
    { type: "callout", kind: "warning", text: "Folded away", folded: true },
    {
      type: "callout",
      kind: "note",
      text: "An alias of note and its second line",
    },
    {
      type: "table",
      text: "| Term | Meaning |\n| :--- | ---: |\n| CAP | Consistency \\| more |",
    },
    { type: "image", file: ID, text: "The diagram", width: 60 },
    { type: "file", file: ID, text: "Slides.pdf" },
    { type: "paragraph", text: "A claim[^1]." },
    { type: "footnote", label: "1", text: "Source: the lecture." },
  ]);
  // Written back, then read again: the same lines.
  assert.deepEqual(parseDoc(serializeDoc(blocks)), [
    blocks[0],
    blocks[1],
    {
      type: "callout",
      kind: "note",
      text: "An alias of note and its second line",
    },
    ...blocks.slice(3),
  ]);
  // A quote that isn't a callout stays a quote; a pipe line without a rule
  // under it is a paragraph.
  assert.deepEqual(parseDoc("> [!nonsense] x\n\n| just | pipes |"), [
    { type: "quote", text: "[!nonsense] x" },
    { type: "paragraph", text: "| just | pipes |" },
  ]);
  // Every new kind is a valid block.
  assert.ok(docContent.safeParse(blocks).success);
  assert.ok(
    !docContent.safeParse([{ type: "image", file: "nope", text: "" }]).success,
  );
});

test("tables: cells, alignment, pipes in words, ragged rows", () => {
  const t = parseTable("| a | b |\n|:-:|--|\n| 1 |\n| 2 | 3 | 4 |");
  assert.deepEqual(t.rows, [
    ["a", "b", ""],
    ["1", "", ""],
    ["2", "3", "4"],
  ]);
  assert.deepEqual(t.align, ["center", null, null]);
  assert.equal(
    tableMarkdown({ rows: [["x|y", "z"]], align: [null, "right"] }),
    "| x\\|y | z |\n| --- | ---: |",
  );
  assert.equal(emptyTable(), "|  |  |\n| --- | --- |\n|  |  |");
  assert.equal(
    docPlainText([
      { type: "table", text: "| Term | Meaning |\n| --- | --- |\n| CAP | C |" },
    ]),
    "Term Meaning · CAP C",
  );
});

test("strike, highlighter colours and footnote markers are marks of their own", () => {
  const runs = parseDocInline("~~old~~ =={green}key== ==plain== note[^2]");
  assert.deepEqual(runs, [
    { text: "old", start: 2, strike: true },
    { text: " ", start: 7 },
    { text: "key", start: 17, highlight: true, tint: "green" },
    { text: " ", start: 22 },
    { text: "plain", start: 25, highlight: true },
    { text: " note", start: 32 },
    { text: "2", start: 39, footnote: "2" },
  ]);
  assert.equal(plainText("Word[^1] ~~gone~~"), "Word gone");
  // Strike on, and off again.
  const on = styleRange("an old idea", 3, 6, "strike")!;
  assert.equal(on.text, "an ~~old~~ idea");
  assert.equal(
    styleRange(on.text, on.start, on.end, "strike")!.text,
    "an old idea",
  );
  // A colour for plain words, a new colour for highlighted ones, and amber
  // back as a plain highlight.
  const green = tintRange("a key idea", 2, 5, "green")!;
  assert.equal(green.text, "a =={green}key== idea");
  assert.equal(green.text.slice(green.start, green.end), "key");
  const rose = tintRange(green.text, green.start, green.end, "rose")!;
  assert.equal(rose.text, "a =={rose}key== idea");
  const amber = tintRange(rose.text, rose.start, rose.end, "amber")!;
  assert.equal(amber.text, "a ==key== idea");
  // Removing the highlight from a coloured one takes its colour too.
  assert.equal(
    styleRange("a =={green}key== idea", 11, 14, "highlight")!.text,
    "a key idea",
  );
});

test("footnotes are numbered in reading order, whatever their labels", () => {
  const blocks: DocBlock[] = [
    { type: "paragraph", text: "First[^b] then[^a]" },
    { type: "paragraph", text: "Again[^b]" },
    { type: "footnote", label: "a", text: "A" },
    { type: "footnote", label: "b", text: "B" },
    { type: "footnote", label: "orphan", text: "Nobody points here" },
  ];
  assert.deepEqual(
    [...footnoteNumbers(blocks)],
    [
      ["b", 1],
      ["a", 2],
      ["orphan", 3],
    ],
  );
  assert.equal(nextFootnoteLabel(blocks), "4");
  assert.equal(nextFootnoteLabel([]), "1");
});

test("a link to one line of a page, as stored, as a web link and as an app link", () => {
  const ref = { kind: "doc" as const, id: ID.toUpperCase(), block: "b-raft" };
  assert.equal(linkHref(ref), `orbyn://doc/${ID}#b-raft`);
  assert.deepEqual(parseObjectHref(`orbyn://doc/${ID}#b-raft`), {
    kind: "doc",
    id: ID,
    block: "b-raft",
  });
  // Only a page has lines.
  assert.equal(parseObjectHref(`orbyn://task/${ID}#b-raft`), null);
  assert.equal(parseObjectHref(`orbyn://doc/${ID}#has space`), null);
  assert.equal(
    webLinks(`[Lecture](orbyn://doc/${ID}#b-raft)`, "https://orbyn.dev/"),
    `[Lecture](https://orbyn.dev/app/doc/${ID}#b-raft)`,
  );
  assert.equal(
    appPath({ kind: "doc", id: ID, block: "b1" }),
    `/app/doc/${ID}#b1`,
  );
  assert.equal(
    appPath({ kind: "task", id: ID, block: "b1" }),
    `/app/task/${ID}`,
  );
  assert.deepEqual(parseAppLink(`https://orbyn.dev/app/doc/${ID}#b-raft`), {
    kind: "doc",
    id: ID,
    block: "b-raft",
  });
  assert.deepEqual(parseAppLink(`orbyn://doc/${ID}#b-raft`), {
    kind: "doc",
    id: ID,
    block: "b-raft",
  });
  assert.deepEqual(refFromUrl(`https://orbyn.dev/app/doc/${ID}#b2`), {
    kind: "doc",
    id: ID,
    block: "b2",
  });
  assert.deepEqual(splitHeadingQuery("Lecture 6#raft"), {
    page: "Lecture 6",
    heading: "raft",
  });
  assert.equal(splitHeadingQuery("#raft"), null);
  assert.equal(splitHeadingQuery("no hash"), null);
});

test("a mention is a name said as words of its own, outside links and code", () => {
  assert.deepEqual(findMention("Revise for the Midterm soon", "midterm"), {
    start: 15,
    end: 22,
    matched: "Midterm",
  });
  assert.equal(findMention("midterms are hard", "midterm"), null);
  assert.equal(findMention("`midterm` in code", "midterm"), null);
  assert.equal(
    findMention(`[midterm](orbyn://doc/${ID}) done`, "midterm"),
    null,
  );
  // Too short to look for.
  assert.equal(findMention("AI is here", "AI"), null);
  assert.equal(
    linkMention("Before the Midterm, revise", "Midterm", {
      kind: "project",
      id: ID,
    }),
    `Before the [Midterm](orbyn://project/${ID}), revise`,
  );
  assert.equal(
    linkMention("nothing here", "Midterm", { kind: "doc", id: ID }),
    null,
  );
  assert.deepEqual(aliasesInput.parse([" CS101 ", "cs101", "Intro"]), [
    "CS101",
    "Intro",
  ]);
});

test("folding a heading hides its section, and only its section", () => {
  const blocks: DocBlock[] = [
    { type: "heading", level: 1, text: "One", id: "h1" },
    { type: "paragraph", text: "a" },
    { type: "heading", level: 2, text: "Inner", id: "h2" },
    { type: "paragraph", text: "b" },
    { type: "heading", level: 1, text: "Two", id: "h3" },
    { type: "paragraph", text: "c" },
    { type: "heading", level: 2, text: "Empty", id: "h4" },
  ];
  assert.deepEqual(foldedLines(blocks, new Set(["h2"])), [
    false,
    false,
    false,
    true,
    false,
    false,
    false,
  ]);
  assert.deepEqual(foldedLines(blocks, new Set(["h1", "h2"])), [
    false,
    true,
    true,
    true,
    false,
    false,
    false,
  ]);
  assert.equal(canFold(blocks, 6), false);
  assert.equal(canFold(blocks, 1), false);
  assert.deepEqual(foldableHeadings(blocks), ["h1", "h2", "h3"]);
  assert.deepEqual(
    sectionOf(blocks, "h2").map((b) => (b.type === "divider" ? "" : b.text)),
    ["Inner", "b"],
  );
  assert.deepEqual(sectionOf(blocks, "nope"), []);
});

test("cards from highlights: one cloze line per highlighted line, once", () => {
  const blocks: DocBlock[] = [
    { type: "paragraph", text: "The ==mitochondria== makes =={green}ATP==." },
    { type: "paragraph", text: "Nothing highlighted." },
    { type: "bullet", text: "Q :: A ==not this==" },
  ];
  const lines = highlightCards(blocks);
  assert.deepEqual(lines, ["The {{mitochondria}} makes {{ATP}}."]);
  const next = withClozeLines(blocks, lines);
  assert.equal(next[3].type, "heading");
  assert.equal(next[4].type === "bullet" && next[4].text, lines[0]);
  // Asked again, the card is already there.
  assert.deepEqual(highlightCards(next), []);
});

test("code colouring keeps every character and marks what it knows", () => {
  const src = 'const x = "hi"; // note\nreturn f(42);';
  const tokens = colourCode(src, "ts");
  assert.equal(tokens.map((t) => t.text).join(""), src);
  const kinds = Object.fromEntries(tokens.map((t) => [t.text.trim(), t.kind]));
  assert.equal(kinds.const, "keyword");
  assert.equal(kinds['"hi"'], "string");
  assert.equal(kinds["// note"], "comment");
  assert.equal(kinds["42"], "number");
  assert.equal(kinds.f, "name");
  const sql = colourCode("SELECT id FROM t -- all", "sql");
  assert.equal(sql[0].kind, "keyword");
  assert.equal(sql[sql.length - 1].kind, "comment");
  assert.deepEqual(colourCode("plain words", "klingon"), [
    { text: "plain words", kind: "plain" },
  ]);
  assert.equal(colourable("python"), true);
  assert.equal(colourable(""), false);
  const json = colourCode('{"a": 1}', "json");
  assert.equal(json.find((t) => t.text === '"a"')?.kind, "name");
});

test("flowcharts are read and laid out for the phone; other diagrams are named", () => {
  const chart = parseFlowchart(
    [
      "flowchart LR",
      "  A[Start] --> B{Ready?}",
      "  B -->|yes| C((Go))",
      "  B -.-> A",
      "  B -- later --> D([Wait])",
      `  click C "orbyn://doc/${ID}"`,
      "  style A fill:#fff",
    ].join("\n"),
  )!;
  assert.equal(chart.direction, "LR");
  assert.deepEqual(
    chart.nodes.map((n) => [n.id, n.label, n.shape]),
    [
      ["A", "Start", "box"],
      ["B", "Ready?", "diamond"],
      ["C", "Go", "circle"],
      ["D", "Wait", "stadium"],
    ],
  );
  assert.deepEqual(chart.nodes[2].link, { kind: "doc", id: ID });
  assert.deepEqual(
    chart.edges.map((e) => [e.from, e.to, e.label, e.style, e.arrow]),
    [
      ["A", "B", "", "solid", true],
      ["B", "C", "yes", "solid", true],
      ["B", "A", "", "dotted", true],
      ["B", "D", "later", "solid", true],
    ],
  );
  const layout = layoutFlowchart(chart);
  const x = Object.fromEntries(layout.nodes.map((n) => [n.id, n.x]));
  // Left to right: each step sits right of the one before it.
  assert.ok(x.A < x.B && x.B < x.C);
  assert.ok(layout.width > 0 && layout.height > 0);
  for (const e of layout.edges) assert.equal(e.points.length, 2);
  assert.equal(parseFlowchart("sequenceDiagram\nA->>B: hi"), null);
  assert.equal(diagramKind("%% note\nsequenceDiagram"), "sequence");
});

test("embeds name a page's section or the tasks the page links to", () => {
  assert.deepEqual(parseEmbed(`orbyn://doc/${ID}#b-raft`), {
    kind: "section",
    doc: ID,
    block: "b-raft",
  });
  assert.deepEqual(parseEmbed(`orbyn://doc/${ID}`), {
    kind: "section",
    doc: ID,
    block: null,
  });
  assert.deepEqual(parseEmbed("tasks: linked"), { kind: "tasks" });
  assert.equal(parseEmbed("anything else"), null);
  assert.equal(
    embedText({ kind: "section", doc: ID, block: "x" }),
    `orbyn://doc/${ID}#x`,
  );
  // An embed's words are settings, not something to read.
  assert.equal(
    docPlainText([
      { type: "code", lang: "orbyn-embed", text: "tasks: linked" },
    ]),
    "",
  );
});

test("rich copy writes HTML another app keeps, and the same lines as Markdown", () => {
  const { html, text } = blocksToClipboard(
    [
      { type: "heading", level: 1, text: "Plan" },
      { type: "bullet", text: "**Bold** and =={green}marked==" },
      { type: "table", text: "| a | b |\n| --- | --- |\n| 1 | 2 |" },
      { type: "image", file: ID, text: "Chart" },
    ],
    { fileUrl: (id) => `https://files.example/${id}` },
  );
  assert.match(html, /<h2>Plan<\/h2>/);
  assert.match(
    html,
    /<li><strong>Bold<\/strong> and <mark style="background:#e7f0ea">marked<\/mark>/,
  );
  assert.match(html, /<table style="border-collapse:collapse">/);
  assert.match(
    html,
    new RegExp(`<img src="https://files.example/${ID}" alt="Chart">`),
  );
  assert.equal(text.split("\n")[0], "# Plan");
});

test("a page's files are checked by their first bytes and their names", () => {
  assert.equal(pageFileType("photo.JPG"), "image/jpeg");
  assert.equal(pageFileType("notes", "application/pdf"), "application/pdf");
  assert.equal(pageFileType("run.exe", "application/x-msdownload"), null);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d]);
  assert.equal(sniffPageFile(png, "image/png"), true);
  assert.equal(sniffPageFile(png, "application/pdf"), false);
  assert.equal(sniffPageFile(Uint8Array.from([104, 105]), "text/plain"), true);
  assert.equal(sniffPageFile(Uint8Array.from([104, 0]), "text/plain"), false);
});

test("turning a line into a callout or a table keeps its words", () => {
  const line: DocBlock = {
    type: "paragraph",
    text: "Remember | this",
    id: "b1",
  };
  assert.deepEqual(blockToType(line, "callout"), {
    type: "callout",
    kind: "note",
    text: "Remember | this",
    id: "b1",
  });
  const table = blockToType(line, "table");
  assert.equal(table.type, "table");
  assert.deepEqual(
    parseTable(table.type === "table" ? table.text : "").rows[0],
    ["Remember / this", ""],
  );
});
