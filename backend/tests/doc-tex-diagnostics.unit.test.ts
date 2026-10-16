import { test } from "node:test";
import assert from "node:assert/strict";
import {
  docWholeLatex,
  editDocWholeLatex,
  DocTexConversionError,
  docSourceDiagnostic,
  type DocBlock,
} from "@orbyn/core";
const blocks: DocBlock[] = [
  { type: "heading", level: 1, text: "Plan", id: "heading" },
  { type: "paragraph", text: "Alpha & beta", id: "body" },
];
function rejected(source: string) {
  try {
    editDocWholeLatex(blocks, source);
    assert.fail("Expected conversion rejection");
  } catch (error) {
    assert.ok(error instanceof DocTexConversionError);
    return error.diagnostic;
  }
}
test("scanner reports exact absolute UTF-16 command range after escapes, emoji and newlines", () => {
  const source = docWholeLatex(blocks).replace(
    "Alpha \\& beta",
    "Emoji 😀 \\& text\nNext \\textbf{bold}",
  );
  const diagnostic = rejected(source),
    at = source.indexOf("\\textbf");
  assert.equal(diagnostic.code, "UNSUPPORTED_COMMAND");
  assert.equal(diagnostic.start, at);
  assert.equal(diagnostic.end, at + "\\textbf".length);
  assert.equal(source.slice(diagnostic.start, diagnostic.end), "\\textbf");
  assert.equal(diagnostic.line, source.slice(0, at).split("\n").length);
  assert.equal(diagnostic.column, at - source.lastIndexOf("\n", at - 1));
  assert.equal(diagnostic.message, "Unsupported command \\textbf.");
  assert.equal(diagnostic.origin, "conversion");
});
test("decoded rich text and reserved characters retain their actual raw source ranges", () => {
  for (const [replacement, token, code] of [
    ["A \\& **bold**", "*", "RICH_TEXT"],
    ["A \\& \\$money", "\\$", "RICH_TEXT"],
    ["A & B", "&", "UNESCAPED_CHARACTER"],
  ]) {
    const source = docWholeLatex(blocks).replace("Alpha \\& beta", replacement),
      diagnostic = rejected(source);
    assert.equal(diagnostic.code, code);
    assert.equal(source.slice(diagnostic.start, diagnostic.end), token);
    assert.equal(
      diagnostic.start,
      source.indexOf(token, source.indexOf("% orbyn-block:1")),
    );
  }
});
test("preamble, deleted markers and equation boundaries give explicit nearest positions and codes", () => {
  const original = docWholeLatex(blocks);
  const changed = original.replace("article", "book"),
    preamble = rejected(changed);
  assert.equal(preamble.code, "DOCUMENT_PREAMBLE");
  assert.equal(preamble.start, changed.indexOf("book"));
  assert.equal(preamble.line, 1);
  const missing = original.replace("% orbyn-block:1", "% removed"),
    marker = rejected(missing);
  assert.equal(marker.code, "BLOCK_MARKER");
  assert.equal(marker.start, missing.indexOf("removed"));
  const ending = original.replace("\n% orbyn-end:1", ""),
    end = rejected(ending);
  assert.equal(end.code, "BLOCK_END");
  assert.equal(end.start, ending.indexOf("\n\n\\end{document}"));
  assert.deepEqual(blocks[1], {
    type: "paragraph",
    text: "Alpha & beta",
    id: "body",
  });
});
test("explicit compiler locations are validated; messages alone never manufacture a line", () => {
  const source = "first\nsecond\nthird";
  const explicit = docSourceDiagnostic(
    Object.assign(new Error("Bad command"), { line: 2, column: 3 }),
    source,
  )!;
  assert.equal(explicit.origin, "compiler");
  assert.equal(explicit.start, 8);
  assert.equal(explicit.end, 9);
  assert.equal(explicit.line, 2);
  assert.equal(explicit.column, 3);
  assert.equal(
    docSourceDiagnostic(
      Object.assign(new Error("Bad line"), { line: 3 }),
      source,
    )!.column,
    null,
  );
  assert.equal(
    docSourceDiagnostic({ message: "line 2 column 3: bad command" }, source),
    null,
  );
  assert.equal(docSourceDiagnostic({ line: 99, column: 1 }, source), null);
  assert.equal(docSourceDiagnostic({ line: 2, column: 99 }, source), null);
  const nested = docSourceDiagnostic(
    { message: "Parser failed", location: { start: { line: 2, column: 2 } } },
    source,
  )!;
  assert.equal(nested.start, 7);
});
