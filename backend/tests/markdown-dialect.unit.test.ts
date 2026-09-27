import { test } from "node:test";
import assert from "node:assert/strict";
import {
  docContent,
  docLines,
  keepStart,
  listLayout,
  parseDoc,
  serializeBlock,
  serializeDoc,
  tableMarkdown,
  type DocBlock,
} from "@orbyn/core";

/**
 * H3: Orbyn's Markdown dialect round-trips. Written with anchors (the form
 * agents read and write), every block comes back exactly: kind, settings,
 * words and id. Written without (exports, editors), everything but ids and
 * empty lines comes back. A fixed page with every kind of block and the
 * awkward cases, then many seeded random pages.
 */

const FILE = "7b0c3f5e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const DOC = "0f1e2d3c-4b5a-4968-8776-655443322110";
const A = { anchors: true };

const every: DocBlock[] = [
  { id: "bh1", type: "heading", level: 1, text: "Lecture 5" },
  { id: "bh2", type: "heading", level: 2, text: "Why **caching** matters" },
  { id: "bh3", type: "heading", level: 3, text: "" },
  {
    id: "bp1",
    type: "paragraph",
    text: "Plain words with ==amber==, =={green}green==, =={rose}rose== and ~~struck~~ text[^1].",
  },
  { id: "bp2", type: "paragraph", text: "" },
  { id: "bb1", type: "bullet", text: "Top" },
  { id: "bb2", type: "bullet", text: "Under it", depth: 1 },
  { id: "bb3", type: "bullet", text: "Deeper", depth: 2 },
  { id: "bb4", type: "bullet", text: "Deepest", depth: 3 },
  { id: "bb5", type: "bullet", text: "" },
  { id: "bn1", type: "numbered", text: "Fifth", start: 5 },
  { id: "bn2", type: "numbered", text: "Sixth" },
  { id: "bn3", type: "numbered", text: "Nested one", depth: 1 },
  { id: "bn4", type: "numbered", text: "Seventh" },
  { id: "bt1", type: "todo", text: "Open task line", done: false },
  { id: "bt2", type: "todo", text: "Done under it", done: true, depth: 1 },
  { id: "bt3", type: "todo", text: "", done: false },
  { id: "bq1", type: "quote", text: "A quote" },
  { id: "bq2", type: "quote", text: "" },
  { id: "bc1", type: "code", lang: "ts", text: "const a = 1;\n\nconst b = 2;" },
  {
    id: "bc2",
    type: "code",
    lang: "md",
    text: "# not a heading\n```\n- not a list\n````\n^bnot",
  },
  { id: "bc3", type: "code", lang: "", text: "" },
  { id: "bc4", type: "code", lang: "mermaid", text: "graph TD\n  A --> B" },
  {
    id: "bc5",
    type: "code",
    lang: "orbyn-embed",
    text: `orbyn://doc/${DOC}#bh2`,
  },
  { id: "bc6", type: "code", lang: "orbyn-embed", text: "tasks: linked" },
  {
    id: "bc7",
    type: "code",
    lang: "orbyn-list",
    text: '{"source":"tasks","filters":{"due_within_days":7}}',
  },
  { id: "bm1", type: "math", text: "\\int_0^1 x^2\\,dx = \\tfrac13" },
  { id: "bm2", type: "math", text: "a^2 + b^2 = c^2", check: true },
  { id: "bd1", type: "divider" },
  { id: "bk1", type: "callout", kind: "note", text: "A note" },
  { id: "bk2", type: "callout", kind: "tip", text: "Folded tip", folded: true },
  { id: "bk3", type: "callout", kind: "warning", text: "" },
  { id: "bk4", type: "callout", kind: "question", text: "Why?" },
  { id: "bk5", type: "callout", kind: "summary", text: "In short" },
  {
    id: "bx1",
    type: "table",
    text: tableMarkdown({
      rows: [
        ["Term", "Meaning"],
        ["a | b", "pipe inside"],
        ["", "empty cell"],
      ],
      align: ["left", "right"],
    }),
  },
  { id: "bi1", type: "image", file: FILE, text: "The diagram", width: 60 },
  { id: "bi2", type: "image", file: FILE, text: "" },
  { id: "bf1", type: "file", file: FILE, text: "Slides.pdf" },
  { id: "bfn", type: "footnote", label: "1", text: "Source: the lecture." },
  {
    id: "bl1",
    type: "paragraph",
    text: `See [the intro](orbyn://doc/${DOC}#bh2) and [Friday](orbyn://date/2026-10-02).`,
  },
  { id: "bs1", type: "paragraph", text: "What is a cache? :: A fast copy" },
  { id: "bs2", type: "bullet", text: "Front ::: Back" },
  { id: "bs3", type: "paragraph", text: "The {{mitochondria}} makes energy." },
  // Words that look like other syntax stay words.
  { id: "be1", type: "paragraph", text: "# not a heading" },
  { id: "be2", type: "paragraph", text: "- not a bullet" },
  { id: "be3", type: "paragraph", text: "1. not numbered" },
  { id: "be4", type: "paragraph", text: "> not a quote" },
  { id: "be5", type: "paragraph", text: "---" },
  { id: "be6", type: "paragraph", text: "```js" },
  { id: "be7", type: "paragraph", text: "$$x$$" },
  { id: "be8", type: "paragraph", text: "[^2]: not a footnote" },
  { id: "be9", type: "paragraph", text: `![x](orbyn://file/${FILE})` },
  { id: "bea", type: "paragraph", text: "^bnot-an-anchor" },
  { id: "beb", type: "paragraph", text: "ends like one ^b123" },
  { id: "bec", type: "paragraph", text: "\\# a backslash kept" },
  { id: "bed", type: "paragraph", text: "\\" },
  { id: "bee", type: "paragraph", text: "\\alpha stays" },
  { id: "bef", type: "bullet", text: "[ ] not a box" },
  { id: "beg", type: "quote", text: "[!tip] not a callout" },
  { id: "beh", type: "paragraph", text: "| just | pipes |" },
  { id: "bei", type: "heading", level: 2, text: "Ends like one ^x" },
  { id: "bej", type: "paragraph", text: "costs ^2 and \\^3" },
  { id: "bek", type: "paragraph", text: "last words" },
];

test("the dialect: every kind of block round-trips exactly with anchors", () => {
  assert.ok(docContent.safeParse(every).success, "the fixture is a valid page");
  const md = serializeDoc(every, A);
  assert.deepEqual(parseDoc(md, A), every);
  // Reading again and writing again changes nothing.
  assert.equal(serializeDoc(parseDoc(md, A), A), md);
});

test("the dialect: without anchors everything but ids and empty lines comes back", () => {
  const strip = (bs: DocBlock[]) =>
    bs
      .filter((b) => b.type !== "paragraph" || b.text.trim())
      .map(({ id: _id, ...b }) => {
        if (b.type === "math") {
          const { check: _c, ...m } = b;
          return m;
        }
        return b;
      });
  // Without anchors, words that end like an anchor are plain words.
  assert.deepEqual(parseDoc(serializeDoc(every)), strip(every));
});

test("the dialect: how the awkward lines are written", () => {
  const lines = docLines(every, A);
  const at = (id: string) => lines[every.findIndex((b) => b.id === id)];
  assert.equal(at("bh1"), "# Lecture 5 ^bh1");
  assert.equal(at("bb3"), "        - Deeper ^bb3");
  assert.equal(at("bn2"), "6. Sixth ^bn2");
  assert.equal(at("bp2"), "\\ ^bp2");
  assert.equal(at("bm2"), "$$ % check\na^2 + b^2 = c^2\n$$\n^bm2");
  assert.equal(at("bd1"), "---\n^bd1");
  assert.equal(at("bk2"), "> [!tip]- Folded tip ^bk2");
  assert.equal(at("bi1"), `![The diagram](orbyn://file/${FILE}?w=60) ^bi1`);
  assert.equal(at("be1"), "\\# not a heading ^be1");
  assert.equal(at("bea"), "\\^bnot-an-anchor ^bea");
  assert.equal(at("beb"), "ends like one \\^b123 ^beb");
  assert.equal(at("bef"), "- \\[ ] not a box ^bef");
  assert.equal(at("beg"), "> \\[!tip] not a callout ^beg");
  assert.ok(at("bc2").startsWith("`````md\n"), "a longer fence");
  assert.ok(at("bx1").endsWith("|\n^bx1"), "a table's anchor under it");
  // The editors' one-line form escapes too, so an edited line keeps its kind.
  assert.equal(serializeBlock({ type: "paragraph", text: "- a" }), "\\- a");
  assert.deepEqual(parseDoc("\\- a"), [{ type: "paragraph", text: "- a" }]);
  // A lone backslash is only an empty line with anchors.
  assert.deepEqual(parseDoc("\\"), [{ type: "paragraph", text: "\\" }]);
});

test("the dialect: what agents type is read forgivingly", () => {
  const md = [
    "## Plan ^intro",
    "",
    "- one ^l1",
    "  - two",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 | ^tbl",
    "",
    "> [!info] line one",
    "> line two ^co",
    "",
    "```python",
    "print(1)",
    "```",
    "^code",
    "",
    "x ^2 is read as an anchor",
  ].join("\n");
  const blocks = parseDoc(md, A);
  assert.deepEqual(
    blocks.map((b) => [b.type, b.id ?? null]),
    [
      ["heading", "intro"],
      ["bullet", "l1"],
      ["bullet", null],
      ["table", "tbl"],
      ["callout", "co"],
      ["code", "code"],
      ["paragraph", null],
    ],
  );
  assert.equal((blocks[2] as { depth?: number }).depth, 1);
  assert.equal((blocks[4] as { text: string }).text, "line one line two");
  // An anchor-looking ending only counts at the very end of a line.
  assert.equal(
    (blocks[6] as { text: string }).text,
    "x ^2 is read as an anchor",
  );
  // Without anchors nothing is taken as one.
  assert.equal(parseDoc("## Plan ^intro")[0].id, undefined);
});

// ------------------------------------------------------------- property ---

/** A small seeded generator, so a failure is repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  "word",
  "two words",
  "# ",
  "## ",
  "- ",
  "* ",
  "1. ",
  "2) ",
  "> ",
  "[!tip] ",
  "[ ] ",
  "[x] ",
  "```",
  "````",
  "$$",
  "---",
  "***",
  "^b12",
  " ^b9",
  "^",
  "\\",
  "\\\\",
  "|",
  " | ",
  `![a](orbyn://file/${FILE})`,
  `[f](orbyn://file/${FILE})`,
  "[^1]: ",
  "[^n]",
  " :: ",
  " ::: ",
  "{{cloze}}",
  "==hi==",
  "=={green}g==",
  "~~x~~",
  "**b**",
  "*i*",
  "`c`",
  "$x$",
  `[link](orbyn://doc/${DOC}#bq)`,
  "[[Page#Heading]]",
  "%",
  "#tag",
];

function words(r: () => number, max = 5): string {
  const n = Math.floor(r() * max);
  let s = "";
  for (let k = 0; k < n; k++) s += PIECES[Math.floor(r() * PIECES.length)];
  return s.replace(/\s+/g, " ").trim();
}

function randomBlock(r: () => number, n: number): DocBlock {
  const id = r() < 0.9 ? `b${n.toString(36)}x` : undefined;
  const pick = Math.floor(r() * 15);
  const depth = Math.floor(r() * 4);
  const d = depth ? { depth } : {};
  let b: DocBlock;
  switch (pick) {
    case 0:
      b = {
        type: "heading",
        level: (1 + Math.floor(r() * 3)) as 1 | 2 | 3,
        text: words(r),
      };
      break;
    case 1:
    case 2:
      b = { type: "paragraph", text: words(r) };
      break;
    case 3:
      b = { type: "bullet", text: words(r), ...d };
      break;
    case 4:
      b = {
        type: "numbered",
        text: words(r),
        ...d,
        ...(r() < 0.3 ? { start: 2 + Math.floor(r() * 50) } : {}),
      };
      break;
    case 5:
      b = { type: "todo", text: words(r), done: r() < 0.5, ...d };
      break;
    case 6:
      b = { type: "quote", text: words(r) };
      break;
    case 7:
      b = {
        type: "code",
        lang: ["", "js", "mermaid", "orbyn-list", "c++"][Math.floor(r() * 5)],
        text: Array.from({ length: Math.floor(r() * 4) }, () =>
          words(r, 3),
        ).join("\n"),
      };
      break;
    case 8:
      b = {
        type: "math",
        text: words(r).replace(/\$/g, "").trim(),
        ...(r() < 0.3 ? { check: true } : {}),
      };
      break;
    case 9:
      b = { type: "divider" };
      break;
    case 10:
      b = {
        type: "callout",
        kind: (["note", "tip", "warning", "question", "summary"] as const)[
          Math.floor(r() * 5)
        ],
        text: words(r),
        ...(r() < 0.4 ? { folded: true } : {}),
      };
      break;
    case 11:
      b = {
        type: "table",
        text: tableMarkdown({
          rows: Array.from({ length: 1 + Math.floor(r() * 3) }, () =>
            Array.from({ length: 2 }, () => words(r, 2)),
          ),
          align: [null, r() < 0.5 ? "center" : null],
        }),
      };
      break;
    case 12:
      b = {
        type: "image",
        file: FILE,
        text: words(r, 2).replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim(),
        ...(r() < 0.5 ? { width: 10 + Math.floor(r() * 90) } : {}),
      };
      break;
    case 13:
      b = {
        type: "file",
        file: FILE,
        text:
          words(r, 2).replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim() ||
          "File",
      };
      break;
    default:
      b = {
        type: "footnote",
        label: String(1 + Math.floor(r() * 9)),
        text: words(r),
      };
  }
  return id ? { ...b, id } : b;
}

/**
 * A page as the apps keep it: a list line at most one step deeper than the
 * list line above, a numbered start only where a list begins.
 */
function canonical(blocks: DocBlock[]): DocBlock[] {
  const layout = listLayout(blocks);
  const out = blocks.map((b, i) => {
    if (b.type !== "bullet" && b.type !== "numbered" && b.type !== "todo")
      return b;
    const { depth: _d, ...rest } = b;
    return (
      layout[i].depth ? { ...rest, depth: layout[i].depth } : rest
    ) as DocBlock;
  });
  let kept = out;
  for (let i = 0; i < kept.length; i++) kept = keepStart(kept, i);
  return kept;
}

test("the dialect: 400 random pages round-trip exactly with anchors", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed);
    const page = canonical(
      Array.from({ length: 1 + Math.floor(r() * 25) }, (_, n) =>
        randomBlock(r, n),
      ),
    );
    const md = serializeDoc(page, A);
    assert.deepEqual(parseDoc(md, A), page, `seed ${seed}:\n${md}`);
  }
});
