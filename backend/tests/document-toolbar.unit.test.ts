import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const parse = (path: string) =>
  ts.createSourceFile(
    path,
    read(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
function classOf(node: ts.Node, source: ts.SourceFile): string | undefined {
  const opening = ts.isJsxElement(node)
    ? node.openingElement
    : ts.isJsxSelfClosingElement(node)
      ? node
      : null;
  const attr = opening?.attributes.properties.find(
    (item) =>
      ts.isJsxAttribute(item) && item.name.getText(source) === "className",
  ) as ts.JsxAttribute | undefined;
  return attr?.initializer && ts.isStringLiteral(attr.initializer)
    ? attr.initializer.text
    : undefined;
}
function find(
  source: ts.SourceFile,
  predicate: (node: ts.Node) => boolean,
): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (!found && predicate(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found);
  return found;
}
test("both desktop document toolbar DOM orders start with Library, Back and title", () => {
  for (const [file, className] of [
    [
      "desktop/src/features/docs/StructuredDocEditor.tsx",
      "structured-doc-toolbar",
    ],
    ["desktop/src/features/docs/DocEditor.tsx", "doc-bar"],
  ]) {
    const source = parse(file);
    const header = find(
      source,
      (node) => ts.isJsxElement(node) && classOf(node, source) === className,
    ) as ts.JsxElement;
    const children = header.children.filter((node) => !ts.isJsxText(node));
    assert.equal(
      (children[0] as ts.JsxSelfClosingElement).tagName.getText(source),
      "DocumentLibraryButton",
    );
    assert.ok(ts.isJsxExpression(children[1]));
    assert.match(children[1].getText(source), /^\{onBack &&/);
    assert.equal(classOf(children[2], source), "document-toolbar-title");
    if (className === "structured-doc-toolbar")
      assert.equal(classOf(children[3], source), "document-toolbar-actions");
    assert.equal(
      header.getText(source).split("<DocumentLibraryButton").length - 1,
      1,
    );
  }
  assert.doesNotMatch(
    read("desktop/src/features/docs/structured-doc-editor.css"),
    /\.structured-doc-back\s*\{[^}]*order:/,
  );
});
test("the library panel cannot duplicate the editor toggle or compact Browse control", () => {
  const source = parse("desktop/src/features/docs/DocsView.tsx");
  const button = find(
    source,
    (node) =>
      ts.isJsxElement(node) &&
      classOf(node, source)?.includes("docs-library-hide") === true,
  );
  let container = button.parent;
  while (container && !ts.isJsxExpression(container))
    container = container.parent;
  assert.ok(container && ts.isJsxExpression(container));
  const code = ts.transpileModule(
    `result = (${container.expression!.getText(source)});`,
    {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  for (const editor of [null, {}])
    for (const compactLibrary of [false, true]) {
      const scope: any = {
        React,
        editor,
        compactLibrary,
        showLibrary() {},
        PanelLeftClose: () => null,
      };
      runInNewContext(code, scope);
      assert.equal(!!scope.result, !editor && !compactLibrary);
    }
});
test("the shared document toggle exposes its expanded state and keeps its single action", () => {
  const source = parse("desktop/src/features/docs/DocumentWorkspace.tsx");
  const component = find(
    source,
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "DocumentLibraryButton",
  );
  const code = ts.transpileModule(
    component.getText(source) + "\nresult = DocumentLibraryButton();",
    {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  for (const hidden of [true, false]) {
    let toggles = 0;
    const library = {
      hidden,
      controls: "fixture-navigation",
      toggle() {
        toggles++;
      },
    };
    const scope: any = {
      React,
      exports: {},
      result: null,
      useContext: () => library,
      DocumentLibraryContext: {},
      PanelLeftOpen: () => null,
      PanelLeftClose: () => null,
    };
    runInNewContext(code, scope);
    assert.equal(scope.result.type, "button");
    assert.equal(scope.result.props["aria-expanded"], !hidden);
    assert.equal(scope.result.props["aria-controls"], "fixture-navigation");
    scope.result.props.onClick();
    assert.equal(toggles, 1);
  }
});
