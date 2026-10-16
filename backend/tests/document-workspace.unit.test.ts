import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  docLatexBlock,
  withDocLatexSource,
  docLatexOperation,
  type DocBlock,
} from "@orbyn/core";
const source = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
test("explicit LaTeX source selection preserves the other sources and nested ownership", () => {
  const blocks: DocBlock[] = [
    { type: "paragraph", text: "Keep this note", id: "note" },
    { type: "code", lang: "latex-document", text: "First", id: "first" },
    { type: "code", lang: "latex-document", text: "Second", id: "second" },
  ];
  assert.equal(docLatexBlock(blocks, 1)?.id, "second");
  const next = withDocLatexSource(blocks, "Changed second", 1);
  assert.equal(next[0], blocks[0]);
  assert.equal(next[1], blocks[1]);
  assert.equal(next[2].id, "second");
  assert.equal(withDocLatexSource(next, "Changed second", 1), next);
  const unanchored = blocks.map((block, index) =>
    index === 2
      ? { type: "code" as const, lang: "latex-document", text: "Unanchored" }
      : block,
  );
  assert.equal(
    withDocLatexSource(unanchored, "Still unanchored", 1)[2].id,
    undefined,
  );
  const document = {
    format: 2 as const,
    nodes: [
      { kind: "block" as const, block: blocks[1] },
      {
        kind: "quote" as const,
        children: [{ kind: "block" as const, block: blocks[2] }],
      },
    ],
  };
  const operation = docLatexOperation(document, "Updated", 1);
  assert.equal(operation.kind, "replace-leaf");
  if (operation.kind === "replace-leaf") {
    assert.equal(operation.block.id, "second");
    assert.equal(operation.block.type, "code");
    assert.deepEqual(operation.path, [1, 0]);
    if (operation.block.type === "code")
      assert.equal(operation.block.text, "Updated");
  }
});
test("workspace owns viewport, persistent controls, independent panes and keyboard resize", () => {
  const component = source("desktop/src/features/docs/DocumentWorkspace.tsx"),
    css = source("desktop/src/features/docs/document-workspace.css");
  assert.match(component, /aria-label="Resize source and preview"/);
  assert.match(component, /setPointerCapture/);
  assert.match(component, /ArrowLeft/);
  assert.match(component, /aria-valuenow/);
  assert.match(css, /height: var\(--document-height/);
  assert.match(css, /document-source-size/);
  assert.match(css, /overflow: auto/);
  assert.match(css, /data-pane-view="source"/);
  assert.match(css, /data-pane-view="preview"/);
  for (const path of [
    "desktop/src/features/docs/StructuredDocEditor.tsx",
    "desktop/src/features/docs/DocEditor.tsx",
  ]) {
    const parent = source(path);
    assert.match(parent, /useDocumentWorkspace/);
    assert.match(parent, /DocumentPaneSwitch/);
    assert.match(parent, /DocLatexDocumentPreview/);
  }
});
test("document editing never automatically compiles or mounts a PDF preview", () => {
  for (const client of [
    "desktop/src/features/docs",
    "mobile/src/screens/docs",
  ]) {
    const preview = source(`${client}/DocLatexPreview.tsx`),
      editor = source(`${client}/DocSourcePreview.tsx`);
    assert.match(preview, /LatexHtmlPreview/);
    assert.doesNotMatch(preview, /LatexPreviewStore|DocumentPdfPreview/);
    assert.doesNotMatch(
      editor,
      /compileLatest|lastCompile|DocumentPdfPreview|doc-source-pdf/,
    );
    assert.match(editor, /Export PDF/);
    assert.match(editor, /controller.signal.aborted/);
    assert.match(editor, /onCompileLatex\(snapshot, controller.signal\)/);
    assert.match(editor, /setDraftSource\(latexText\)/);
    assert.match(editor, /sourceNumber/);
  }
});
test("mobile keeps format ownership independent from Source and Preview selection", () => {
  const structured = source("mobile/src/screens/docs/StructuredDocEditor.tsx"),
    legacy = source("mobile/src/screens/docs/DocEditor.tsx");
  assert.match(structured, /value=\{sourceFormat\}/);
  assert.match(structured, /setSourceVisible\(false\)/);
  assert.match(structured, /setSourceVisible\(true\)/);
  assert.match(structured, /DocumentDivider/);
  assert.match(legacy, /DocumentDivider/);
  assert.match(legacy, /setSourcePaneVisible\(false\)/);
  assert.match(legacy, /DocLatexDocumentPreview/);
});
