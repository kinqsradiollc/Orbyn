import { test } from "node:test";
import assert from "node:assert/strict";
import {
  docSourceMap,
  docSourceBlockAt,
  docLines,
  parseDoc,
  serializeDoc,
  type DocBlock,
} from "@orbyn/core";

test("source mapping uses exact serializer output for multiline blocks and stable anchors", () => {
  const blocks = parseDoc(
    "---\ntitle: Example\n---\n^metadata\n\n# Heading\n^heading\n\n```mermaid\nflowchart LR\n A --> B\n```\n^diagram\n\n$$\nx^2\n$$\n^math",
    { anchors: true },
  );
  const before = structuredClone(blocks);
  const map = docSourceMap(blocks);
  assert.equal(map.source, serializeDoc(blocks, { anchors: true }));
  docLines(blocks, { anchors: true }).forEach((piece, index) => {
    const range = map.ranges[index];
    assert.equal(map.source.slice(range.start, range.end), piece);
    assert.equal(
      range.startLine,
      map.source.slice(0, range.start).split("\n").length,
    );
    assert.equal(
      range.endLine,
      map.source.slice(0, range.end - 1).split("\n").length,
    );
    assert.equal(docSourceBlockAt(map, range.start)?.blockId, blocks[index].id);
  });
  assert.deepEqual(parseDoc(map.source, { anchors: true }), blocks);
  assert.deepEqual(blocks, before);
});

test("source carets handle Unicode, nested numbered lists, separators and out-of-range offsets", () => {
  const blocks: DocBlock[] = [
    { type: "paragraph", text: "😀 words", id: "first" },
    { type: "numbered", text: "One", id: "one" },
    { type: "numbered", text: "Nested", depth: 1, id: "nested" },
    { type: "numbered", text: "Two", id: "two" },
  ];
  const map = docSourceMap(blocks);
  assert.equal(docSourceBlockAt(map, map.ranges[0].end)?.blockId, "first");
  assert.equal(docSourceBlockAt(map, -5)?.blockId, "first");
  assert.equal(docSourceBlockAt(map, Number.NaN)?.blockId, "first");
  assert.equal(docSourceBlockAt(map, 100000)?.blockId, "two");
  assert.deepEqual(parseDoc(map.source, { anchors: true }), blocks);
});

test("empty source and blocks without writable anchors remain safe and deterministic", () => {
  assert.equal(docSourceBlockAt(docSourceMap([]), 0), null);
  const map = docSourceMap([
    { type: "paragraph", text: "" },
    { type: "paragraph", text: "Text" },
  ]);
  assert.equal(
    map.source,
    serializeDoc(
      [
        { type: "paragraph", text: "" },
        { type: "paragraph", text: "Text" },
      ],
      { anchors: true },
    ),
  );
  assert.equal(
    docSourceBlockAt(map, map.source.indexOf("Text"))?.blockIndex,
    1,
  );
});

test("fractional source scrolling maps to and from multiline rendered blocks", async () => {
  const { docSourcePosition, docSourceLineAt } = await import("@orbyn/core");
  const map = docSourceMap(
    parseDoc(
      "# Heading\n^heading\n\n```mermaid\nflowchart LR\nA --> B\n```\n^diagram",
      { anchors: true },
    ),
  );
  const range = map.ranges[1];
  const line = range.startLine + (range.endLine - range.startLine) / 2;
  const position = docSourcePosition(map, line)!;
  assert.equal(position.range.blockId, "diagram");
  assert.equal(position.progress, 0.5);
  assert.equal(docSourceLineAt(position.range, position.progress), line);
  assert.equal(docSourcePosition(map, -10)?.range.blockIndex, 0);
  assert.equal(docSourcePosition(docSourceMap([]), 1), null);
  assert.equal(docSourceLineAt(range, Number.NaN), range.startLine);
  assert.equal(docSourceLineAt(range, 100), range.endLine);
});
