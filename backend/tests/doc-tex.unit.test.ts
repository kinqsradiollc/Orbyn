import { test } from "node:test";
import assert from "node:assert/strict";
import {
  docWholeLatex,
  docWholeLatexCanExport,
  editDocWholeLatex,
  docWholeLatexOperation,
  applyDocContentOperation,
  docContainerBlocks,
  parseVersionedDocContent,
  serializeDoc,
  parseDoc,
  type DocBlock,
} from "@orbyn/core";

test("all document views share accepted text while IDs, rich and embedded blocks survive", () => {
  const before: DocBlock[] = [
    { type: "heading", level: 1, text: "Plan", id: "heading" },
    { type: "paragraph", text: "Read & write", id: "prose" },
    { type: "todo", done: true, depth: 2, text: "Finish", id: "task" },
    {
      type: "code",
      lang: "latex-document",
      text: "\\documentclass{article}\n\\begin{document}Embedded\\end{document}",
      id: "embedded",
    },
    { type: "paragraph", text: "**Rich** text", id: "rich" },
    { type: "math", text: "x^2", check: true, id: "equation" },
  ];
  const tex = docWholeLatex(before);
  assert.match(tex, /Plan/);
  assert.match(tex, /Embedded/);
  assert.equal(editDocWholeLatex(before, tex), before);
  const next = editDocWholeLatex(
    before,
    tex
      .replace("Read \\& write", "Read \\& explain")
      .replace("\\item Finish", "\\item Finished")
      .replace("\\[x^2\\]", "\\[x^3\\]"),
  );
  assert.equal(next[1].text, "Read & explain");
  assert.deepEqual(next[2], { ...before[2], text: "Finished" });
  assert.equal(next[3], before[3]);
  assert.equal(next[4], before[4]);
  assert.equal(next[5].text, "x^3");
  const markdown = serializeDoc(next, { anchors: true });
  assert.match(markdown, /Read & explain/);
  assert.equal(parseDoc(markdown, { anchors: true })[1].id, "prose");
  assert.match(docWholeLatex(next), /Read \\& explain/);
  assert.equal(before[1].text, "Read & write");
});
test("unsupported edits, deleted markers, rich rewrites and preambles are refused atomically", () => {
  const before: DocBlock[] = [
    { type: "paragraph", text: "Safe", id: "safe" },
    { type: "paragraph", text: "**Rich**", id: "rich" },
  ];
  const source = docWholeLatex(before),
    snapshot = JSON.stringify(before);
  for (const draft of [
    source.replace("Safe", "\\unknown{new}"),
    source.replace("**Rich**", "Edited"),
    source.replace("% orbyn-block:0", "% deleted"),
    source.replace("\\documentclass{article}", "\\documentclass{book}"),
    source.replace("Safe", "First\n\nSecond"),
    source.replace("Safe", "**Bold**"),
    source + "extra",
    source.replace("Safe", "x".repeat(21000)),
  ])
    assert.throws(() => editDocWholeLatex(before, draft), /draft is retained/);
  assert.equal(JSON.stringify(before), snapshot);
});
test("whole-document edits preserve nested quote/list/task ownership with one operation", () => {
  const before = parseVersionedDocContent({
    format: 2,
    nodes: [
      {
        kind: "quote",
        id: "quote",
        callout: { tone: "note", folded: true },
        children: [
          {
            kind: "list",
            id: "list",
            ordered: true,
            start: 7,
            delimiter: ")",
            loose: true,
            items: [
              {
                checked: true,
                children: [
                  {
                    kind: "block",
                    block: { type: "paragraph", id: "first", text: "First" },
                  },
                  {
                    kind: "block",
                    block: {
                      type: "paragraph",
                      id: "continued",
                      text: "Continued",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  if (before.format !== 2) throw new Error("fixture");
  const blocks = docContainerBlocks(before.nodes),
    source = docWholeLatex(blocks);
  const next = applyDocContentOperation(
    before,
    before,
    docWholeLatexOperation(
      before,
      source.replace("First", "Changed").replace("Continued", "Also changed"),
    ),
  );
  assert.equal(next.format, 2);
  const expected = JSON.parse(JSON.stringify(before));
  expected.nodes[0].children[0].items[0].children[0].block.text = "Changed";
  expected.nodes[0].children[0].items[0].children[1].block.text =
    "Also changed";
  assert.deepEqual(next, expected);
  assert.equal(docContainerBlocks(before.nodes)[0].text, "First");
  assert.throws(
    () =>
      applyDocContentOperation(before, before, {
        kind: "replace-leaves",
        blocks: [{ ...blocks[0], id: "wrong" }, blocks[1]],
      }),
    /identity/,
  );
  assert.throws(
    () =>
      applyDocContentOperation(
        next,
        before,
        docWholeLatexOperation(before, source),
      ),
    /changed/,
  );
});
test("empty note can be edited in TeX and represented back in Markdown", () => {
  const before: DocBlock[] = [{ type: "paragraph", id: "empty", text: "" }];
  const source = docWholeLatex(before);
  const next = editDocWholeLatex(
    before,
    source.replace("% orbyn-block:0\n\n", "% orbyn-block:0\nHello\n"),
  );
  assert.deepEqual(next, [{ type: "paragraph", id: "empty", text: "Hello" }]);
  assert.match(serializeDoc(next), /Hello/);
});

test("large/rich documents retain exact canonical content without claiming faithful PDF export", () => {
  const rich: DocBlock[] = [
    { type: "paragraph", text: "**Rich**", id: "rich" },
  ];
  assert.equal(docWholeLatexCanExport(rich), false);
  assert.match(docWholeLatex(rich), /Rich/);
  const big: DocBlock[] = Array.from({ length: 4 }, (_, i) => ({
    type: "paragraph",
    text: "x".repeat(9000),
    id: `block${i}`,
  }));
  const source = docWholeLatex(big);
  assert.ok(source.length > 20000);
  assert.equal(docWholeLatexCanExport(big), false);
  assert.throws(() => editDocWholeLatex(big, source), /limit/);
  assert.equal(big.length, 4);
});
test("a truly empty document gets its first canonical leaf only after accepted typing", () => {
  const empty: DocBlock[] = [];
  const tex = docWholeLatex(empty);
  assert.equal(editDocWholeLatex(empty, tex), empty);
  const edited = tex.replace(
    "% orbyn-block:0\n\n",
    "% orbyn-block:0\nFirst line\n",
  );
  const next = editDocWholeLatex(empty, edited);
  assert.equal(next[0].text, "First line");
  assert.ok(next[0].id);
  const document = { format: 2 as const, nodes: [] };
  const result = applyDocContentOperation(
    document,
    document,
    docWholeLatexOperation(document, edited),
  );
  assert.equal(result.format, 2);
  if (result.format === 2)
    assert.equal(docContainerBlocks(result.nodes)[0].text, "First line");
  assert.deepEqual(document.nodes, []);
});
