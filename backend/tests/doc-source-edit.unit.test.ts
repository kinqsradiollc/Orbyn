import { test } from "node:test";
import assert from "node:assert/strict";
import {
  editDocSource,
  docSourceMap,
  parseDoc,
  type DocBlock,
} from "@orbyn/core";

test("source edits preserve retained identities across headings, tasks, metadata and diagrams", () => {
  const previous = parseDoc(
    "---\ntitle: Before\n---\n^meta\n\n# Before ^heading\n\n- [ ] Work ^task\n\n```mermaid\nflowchart LR\n A --> B\n```\n^diagram",
    { anchors: true },
  );
  const before = structuredClone(previous);
  const text = docSourceMap(previous)
    .source.replaceAll("Before", "After")
    .replace("A --> B", "A --> C");
  const next = editDocSource(previous, text);
  assert.deepEqual(
    next.map((b) => b.id),
    ["meta", "heading", "task", "diagram"],
  );
  assert.ok(docSourceMap(next).source.includes("A --> C"));
  assert.deepEqual(previous, before);
});
test("unchanged source keeps the editor state identity and avoids redundant saves", () => {
  const previous: DocBlock[] = [
    { type: "paragraph", text: "Words", id: "line" },
  ];
  assert.equal(
    editDocSource(previous, docSourceMap(previous).source),
    previous,
  );
});
test("source reorder and insertion preserve anchors rather than position identity", () => {
  const previous = parseDoc("One ^one\n\nTwo ^two", { anchors: true });
  const next = editDocSource(
    previous,
    "Two changed ^two\n\nNew words\n\nOne ^one",
  );
  assert.deepEqual(
    next.map((b) => b.id),
    ["two", undefined, "one"],
  );
});
test("duplicate source anchors reject before saving without mutating the editor", () => {
  const previous: DocBlock[] = [{ type: "paragraph", text: "Safe", id: "one" }];
  assert.throws(
    () => editDocSource(previous, "First ^one\n\nSecond ^one"),
    /anchor.*unique/,
  );
  assert.deepEqual(previous, [{ type: "paragraph", text: "Safe", id: "one" }]);
});
test("clearing a sole line retains its identity and an editable blank block", () => {
  assert.deepEqual(
    editDocSource([{ type: "paragraph", text: "Words", id: "line" }], ""),
    [{ type: "paragraph", text: "", id: "line" }],
  );
  assert.deepEqual(editDocSource([], ""), [{ type: "paragraph", text: "" }]);
});
test("source input remains literal and preserves unknown fences and incomplete Markdown", () => {
  const source =
    "<script>alert(1)</script>\n\n```unknown\n<script>literal</script>";
  const next = editDocSource([], source);
  assert.equal(next[0].type, "paragraph");
  assert.equal((next[0] as { text: string }).text, "<script>alert(1)</script>");
  assert.equal(next[1].type, "code");
  assert.equal((next[1] as { text: string }).text, "<script>literal</script>");
});

test("typed source mapping uses original blank lines, alternate fences and CRLF offsets", () => {
  const raw =
    "\r\n# Heading ^heading\r\n\r\n\r\n~~~python\r\nprint('hi')\r\n~~~\r\n^code\r\n\r\nLast ^last";
  const blocks = editDocSource([], raw);
  const map = docSourceMap(blocks, raw);
  assert.equal(map.source, raw);
  assert.deepEqual(
    map.ranges.map((r) => [r.startLine, r.endLine]),
    [
      [2, 2],
      [5, 8],
      [10, 10],
    ],
  );
  assert.equal(
    raw.slice(map.ranges[1].start, map.ranges[1].end),
    "~~~python\r\nprint('hi')\r\n~~~\r\n^code",
  );
  assert.equal(map.ranges[2].blockId, "last");
});

test("a source edit cannot overwrite an external change that arrived before its event", () => {
  const expected = parseDoc("Before ^line", { anchors: true });
  const current = parseDoc("Remote words ^line", { anchors: true });
  const before = structuredClone(current);
  assert.throws(
    () => editDocSource(current, "Local words ^line", expected),
    /document changed/,
  );
  assert.deepEqual(current, before);
  const next = editDocSource(
    structuredClone(expected),
    "Local words ^line",
    expected,
  );
  assert.equal(next[0].id, "line");
});
