import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

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
test("desktop toolbar starts with title and actions, without duplicate Back or collapse controls", () => {
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
    assert.equal(classOf(children[0], source), "document-toolbar-title");
    if (className === "structured-doc-toolbar")
      assert.equal(classOf(children[1], source), "document-toolbar-actions");
    assert.doesNotMatch(
      header.getText(source),
      /DocumentLibraryButton|PanelLeft|All documents|structured-doc-back/,
    );
  }
  assert.doesNotMatch(
    read("desktop/src/features/docs/structured-doc-editor.css"),
    /\.structured-doc-back\s*\{[^}]*order:/,
  );
});
test("library shares responsive source fitting with one explicit collapse control", () => {
  const library = read("desktop/src/features/docs/DocsView.tsx");
  assert.match(library, /paneWidth > 0 && paneWidth < 900/);
  assert.match(
    library,
    /libraryCollapsed \|\| \(!!open && \(compactLibrary \|\| sourceOpen\)\)/,
  );
  assert.doesNotMatch(
    library,
    /orbyn-docs-library/,
  );
  assert.match(library, /setSourceOpen,/);
  const mobile = read("mobile/src/screens/docs/DocsSheet.tsx");
  assert.match(mobile, /!sourceOpen &&/);
  assert.match(mobile, /setSourceOpen,/);
  for (const file of [
    "desktop/src/features/docs/DocEditor.tsx",
    "desktop/src/features/docs/StructuredDocEditor.tsx",
    "mobile/src/screens/docs/DocEditor.tsx",
    "mobile/src/screens/docs/StructuredDocEditor.tsx",
  ])
    assert.doesNotMatch(read(file), /DocumentLibraryButton/);
});
test("actual workspace effects return library space when source closes or editor unmounts", () => {
  for (const [file, hook, refName] of [
    [
      "desktop/src/features/docs/DocumentWorkspace.tsx",
      "useLayoutEffect",
      "controls",
    ],
    ["mobile/src/screens/docs/DocumentWorkspace.tsx", "useEffect", "latest"],
  ]) {
    const source = parse(file);
    const call = find(
      source,
      (node) =>
        ts.isCallExpression(node) &&
        node.expression.getText(source) === hook &&
        !!node.arguments[0]?.getText(source).includes("setSourceOpen(open)"),
    ) as ts.CallExpression;
    const code = ts.transpileModule(
      `result = (${call.arguments[0].getText(source)})();`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    for (const open of [true, false]) {
      const changes: boolean[] = [];
      const views: string[] = [];
      const scope: any = {
        open,
        result: null,
        [refName]: {
          current: { setSourceOpen: (next: boolean) => changes.push(next) },
        },
        setView: (next: string) => views.push(next),
      };
      runInNewContext(code, scope);
      assert.deepEqual(changes, [open]);
      scope.result();
      assert.deepEqual(changes, [open, false]);
      if (hook === "useLayoutEffect")
        assert.deepEqual(views, open ? ["source"] : []);
    }
  }
});
test("app navigation adapts to width and exposes only the narrow-screen menu", () => {
  assert.match(read("desktop/src/app/App.tsx"), /sidebarLayout\(/);
  assert.match(read("desktop/src/app/App.tsx"), /ref=\{workspacePane.ref\}/);
  assert.doesNotMatch(
    read("desktop/src/app/App.tsx"),
    /orbyn-sidebar|onToggleRail/,
  );
  assert.match(
    read("desktop/src/app/App.tsx"),
    /onResize=\{sharedChromeHost \? undefined : setSidebarWidth\}/,
  );
  const header = read("desktop/src/components/Topbar.tsx");
  assert.doesNotMatch(header, /PanelLeft|workspace-rail-toggle|onToggleRail/);
  assert.match(header, /className="icon-button mobile-menu"/);
  assert.match(header, /aria-expanded=\{navigationOpen\}/);
});
