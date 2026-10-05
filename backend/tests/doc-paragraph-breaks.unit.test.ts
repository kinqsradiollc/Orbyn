import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDoc,
  parseDocInline,
  serializeDoc,
  blocksHtml,
  htmlToBlocks,
  plainText,
  cardsInBlocks,
  docContent,
  DOC_PARAGRAPH_MAX,
} from "@orbyn/core";
import { docToDocx } from "../src/modules/docs/docx.js";
import { docxToMarkdown, readZip } from "../src/modules/imports/docx.js";

test("ordinary continuation lines are one paragraph with the original source range", () => {
  const ranges: number[][] = [];
  assert.deepEqual(
    parseDoc("First\nSecond\n\nThird", {
      onSourceRange: (index, start, end) => ranges.push([index, start, end]),
    }),
    [
      { type: "paragraph", text: "First\nSecond" },
      { type: "paragraph", text: "Third" },
    ],
  );
  assert.deepEqual(ranges, [
    [0, 1, 2],
    [1, 4, 4],
  ]);
});

for (const marker of ["  ", "\\"]) {
  test(`hard break ${JSON.stringify(marker)} survives parsing and rendered export`, () => {
    const source = `First${marker}\nSecond`;
    const blocks = parseDoc(source);
    assert.deepEqual(blocks, [{ type: "paragraph", text: source }]);
    assert.equal(blocksHtml(blocks), "<p>First<br>Second</p>");
    assert.equal(plainText(source), "First\nSecond");
    const runs = parseDocInline(source);
    assert.deepEqual(
      runs.find((run) => run.break),
      { text: marker + "\n", start: 5, break: "hard" },
    );
  });
}

test("soft breaks display as spaces and preserve source positions", () => {
  const source = "First\r\n  Second";
  assert.equal(plainText(source), "First Second");
  assert.deepEqual(
    parseDocInline(source).find((run) => run.break),
    { text: "\r\n  ", start: 5, break: "soft" },
  );
  assert.equal(blocksHtml(parseDoc(source)), "<p>First Second</p>");
});

test("escaped backslashes do not create a hard break; code consumes its own newlines", () => {
  assert.equal(plainText("First\\\\\nSecond"), "First\\ Second");
  assert.deepEqual(parseDocInline("`First  \nSecond`"), [
    { text: "First   Second", start: 1, code: true },
  ]);
});

test("breaks preserve emphasis and link label source coordinates", () => {
  const source = "**First\\\nSecond**";
  const runs = parseDocInline(source);
  assert.ok(runs.every((run) => run.bold));
  assert.equal(
    blocksHtml(parseDoc(source)),
    "<p><strong>First</strong><br><strong>Second</strong></p>",
  );
  const label = parseDocInline("[First\nSecond](https://example.test)");
  assert.ok(label.every((run) => run.link === "https://example.test"));
  assert.equal(label.find((run) => run.break)?.start, 6);
});

test("multiline anchored paragraphs preserve their identity and source range", () => {
  const blocks = [
    { type: "paragraph" as const, text: "First\\\nSecond", id: "p1" },
    { type: "paragraph" as const, text: "Third", id: "p2" },
  ];
  const ranges: number[][] = [];
  const source = serializeDoc(blocks, { anchors: true });
  assert.deepEqual(
    parseDoc(source, {
      anchors: true,
      onSourceRange: (index, start, end) => ranges.push([index, start, end]),
    }),
    blocks,
  );
  assert.deepEqual(ranges, [
    [0, 1, 3],
    [1, 5, 5],
  ]);
  assert.deepEqual(parseDoc("First ^p1\nSecond ^p2", { anchors: true }), [
    { type: "paragraph", text: "First", id: "p1" },
    { type: "paragraph", text: "Second", id: "p2" },
  ]);
});

test("blank boundaries and structural blocks interrupt ordinary paragraphs", () => {
  assert.deepEqual(parseDoc("First\nSecond\n\n# Heading\n- Item\nLast\nline"), [
    { type: "paragraph", text: "First\nSecond" },
    { type: "heading", level: 1, text: "Heading" },
    { type: "bullet", text: "Item" },
    { type: "paragraph", text: "Last\nline" },
  ]);
});

test("multiline paragraph literal block syntax and anchor-looking words round trip", () => {
  const blocks = [
    {
      type: "paragraph" as const,
      id: "original",
      text: "First\n# Literal heading\n- Literal item\n^literal\nLast ^words",
    },
  ];
  assert.deepEqual(
    parseDoc(serializeDoc(blocks, { anchors: true }), { anchors: true }),
    blocks,
  );
  assert.deepEqual(
    parseDoc(serializeDoc(blocks)),
    blocks.map(({ id: _id, ...block }) => block),
  );
});

test("HTML paste keeps a hard break inside its paragraph", () => {
  assert.deepEqual(htmlToBlocks("<p>First<br>Second</p><p>Third</p>"), [
    { type: "paragraph", text: "First\\\nSecond" },
    { type: "paragraph", text: "Third" },
  ]);
});

test("Orbyn study-card lines remain independent instead of sharing an answer", () => {
  const cards = cardsInBlocks(
    parseDoc(
      "First :: One\nSecond :: Two\nThird ::: Three\nA {{cloze}} sentence.",
    ),
  );
  assert.deepEqual(
    cards.map(({ question, answer }) => [question, answer]),
    [
      ["First", "One"],
      ["Second", "Two"],
      ["Third", "Three"],
      ["Three", "Third"],
      ["A […] sentence.", "cloze"],
    ],
  );
});

test("continuations cannot turn individually valid imported lines into an unsavable paragraph", () => {
  const line = "x".repeat(999);
  const blocks = parseDoc(Array(25).fill(line).join("\n"));
  assert.ok(docContent.safeParse(blocks).success);
  assert.ok(
    blocks.every(
      (block) =>
        block.type === "paragraph" && block.text.length <= DOC_PARAGRAPH_MAX,
    ),
  );
  assert.equal(
    blocks
      .map((block) => (block.type === "paragraph" ? block.text : ""))
      .join("\n"),
    Array(25).fill(line).join("\n"),
  );
});

test("Word archives use real hard breaks and preserve them through import", () => {
  const blocks = parseDoc("First\\\nSecond\nsoft");
  const bytes = docToDocx("Breaks", blocks);
  const xml = readZip(bytes).get("word/document.xml")!().toString("utf8");
  assert.equal((xml.match(/<w:br\/>/g) ?? []).length, 1);
  assert.deepEqual(parseDoc(docxToMarkdown(bytes).markdown), [
    { type: "heading", level: 1, text: "Breaks" },
    { type: "paragraph", text: "First\\\nSecond soft" },
  ]);
});
