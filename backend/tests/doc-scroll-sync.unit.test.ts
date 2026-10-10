import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const path = "../../desktop/src/features/docs/StructuredDocEditor.tsx";
const source = readFileSync(new URL(path, import.meta.url), "utf8");
const ast = ts.createSourceFile(
  path,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function scrollHandler(name: string, context: Record<string, unknown>) {
  let declaration: ts.VariableDeclaration | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    )
      declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration?.initializer, `Missing ${name} handler`);
  const exports: Record<string, () => void> = {};
  runInNewContext(
    ts.transpileModule(
      `export const ${name} = ${declaration.initializer.getText(ast)};`,
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      },
    ).outputText,
    { exports, ...context },
  );
  return exports[name];
}

test("nested quote/list wrappers cannot shadow visible leaves during preview scroll", () => {
  for (const wrapper of ["quote", "list"]) {
    const elements = [
      { kind: wrapper, path: "0", top: -220, bottom: 600 },
      { kind: "leaf", path: "0/0", top: -220, bottom: -40 },
      { kind: "leaf", path: "0/1/0/0", top: -40, bottom: 180 },
      { kind: "leaf", path: "0/1/1/0", top: 180, bottom: 600 },
    ].map((entry) => ({
      kind: entry.kind,
      dataset: { containerPath: entry.path },
      getBoundingClientRect: () => ({
        top: entry.top,
        bottom: entry.bottom,
        height: entry.bottom - entry.top,
      }),
    }));
    const previewPane = {
      scrollTop: 120,
      scrollHeight: 2000,
      clientHeight: 200,
      getBoundingClientRect: () => ({ top: 0, bottom: 200 }),
      querySelectorAll: (selector: string) => {
        assert.equal(selector, ".structured-doc-leaf[data-container-path]");
        return elements.filter((element) => element.kind === "leaf");
      },
    };
    const sourcePane = { scrollTop: 0, scrollHeight: 2000, clientHeight: 200 };
    const ignoredSourceScroll = { current: null as number | null };
    const ignoredPreviewScroll = { current: null as number | null };
    const context = {
      sourceRef: { current: sourcePane },
      previewRef: { current: previewPane },
      sourceMap: {},
      sourceBlocks: [
        { path: [0, 0], startLine: 1, endLine: 10 },
        { path: [0, 1, 0, 0], startLine: 20, endLine: 30 },
        { path: [0, 1, 1, 0], startLine: 40, endLine: 80 },
      ],
      ignoredSourceScroll,
      ignoredPreviewScroll,
      getComputedStyle: () => ({ lineHeight: "20px" }),
    };
    scrollHandler("syncSourceFromPreview", context)();
    assert.ok(sourcePane.scrollTop > 380 && sourcePane.scrollTop < 600);
    assert.equal(ignoredSourceScroll.current, sourcePane.scrollTop);

    // A synthetic scroll event from the synchronized source must not bounce back.
    const before = previewPane.scrollTop;
    scrollHandler("syncPreviewFromSource", context)();
    assert.equal(previewPane.scrollTop, before);
    assert.equal(ignoredSourceScroll.current, null);
  }
});
