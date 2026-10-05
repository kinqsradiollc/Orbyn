import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDoc,
  serializeDoc,
  docContent,
  blocksHtml,
  DOC_QUOTE_MAX,
} from "@orbyn/core";

test("adjacent quote lines retain one paragraph and explicit breaks", () => {
  const blocks = parseDoc(
    "> First  \n> second\n> third\\\n> fourth\n\n> Separate",
  );
  assert.deepEqual(blocks, [
    { type: "quote", text: "First  \nsecond\nthird\\\nfourth" },
    { type: "quote", text: "Separate" },
  ]);
  assert.ok(docContent.safeParse(blocks).success);
  assert.deepEqual(parseDoc(serializeDoc(blocks)), blocks);
});

test("multiline quote anchors preserve exact block identities and literal callouts", () => {
  const blocks = [
    { id: "q1", type: "quote" as const, text: "First\n[!tip] literal\nLast" },
    { id: "q2", type: "quote" as const, text: "Next" },
  ];
  const markdown = serializeDoc(blocks, { anchors: true });
  assert.match(markdown, /> \\\[!tip\] literal/);
  assert.match(markdown, /\n\^q1/);
  assert.deepEqual(parseDoc(markdown, { anchors: true }), blocks);
});

test("legacy inline quote anchors remain separate and source ranges span continuations", () => {
  assert.deepEqual(parseDoc("> One ^q1\n> Two ^q2", { anchors: true }), [
    { id: "q1", type: "quote", text: "One" },
    { id: "q2", type: "quote", text: "Two" },
  ]);
  const ranges: number[][] = [];
  parseDoc("> One\n> Two\n\n> Three", {
    onSourceRange: (...range) => ranges.push(range),
  });
  assert.deepEqual(ranges, [
    [0, 1, 2],
    [1, 4, 4],
  ]);
});

test("quote HTML uses shared soft and hard break semantics", () => {
  const blocks = parseDoc("> First\n> second  \n> third");
  assert.equal(
    blocksHtml(blocks),
    "<blockquote>First second<br>third</blockquote>",
  );
});

test("quote continuation stays within the shared text limit", () => {
  const blocks = parseDoc(`> ${"a".repeat(DOC_QUOTE_MAX)}\n> second`);
  assert.equal(blocks.length, 2);
  assert.ok(docContent.safeParse(blocks).success);
});

test("empty quoted lines remain explicit paragraph boundaries", () => {
  const blocks = parseDoc("> First\n>\n> Second");
  assert.deepEqual(blocks, [
    { type: "quote", text: "First" },
    { type: "quote", text: "" },
    { type: "quote", text: "Second" },
  ]);
  assert.deepEqual(
    parseDoc(serializeDoc(blocks, { anchors: true }), { anchors: true }),
    blocks,
  );
});

test("Word quote export uses one paragraph and only explicit hard breaks", async () => {
  const { docToDocx } = await import("../src/modules/docs/docx.js");
  const { readZip } = await import("../src/modules/imports/docx.js");
  const blocks = parseDoc("> First\n> second  \n> third");
  const files = readZip(
    docToDocx("Quote", blocks, new Date("2026-10-06T00:00:00Z")),
  );
  const document = files.get("word/document.xml")!().toString("utf8");
  assert.equal((document.match(/w:pStyle w:val="Quote"/g) ?? []).length, 1);
  assert.equal((document.match(/<w:br\/>/g) ?? []).length, 1);
  const words = [
    ...document.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:br\/>/g),
  ]
    .map((run) => run[1] ?? "\n")
    .join("");
  assert.equal(words, "QuoteFirst second\nthird");
});
