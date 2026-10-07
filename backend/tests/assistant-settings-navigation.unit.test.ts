import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function source(path: string) {
  return ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

test("mobile Assistant settings dispatches the actual Settings destination and resets old search", () => {
  const page = source("../../mobile/src/app/RootScreen.tsx");
  let open: ts.Expression | undefined;
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(page) === "openSettingsAt"
    )
      open = node.initializer;
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(page) === "AssistantScreen"
    ) {
      for (const attribute of node.attributes.properties)
        if (
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(page) === "onOpenSettings" &&
          attribute.initializer &&
          ts.isJsxExpression(attribute.initializer)
        )
          callback = attribute.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(page);
  assert.ok(
    open && callback,
    "The real Assistant route must expose its settings callback",
  );
  const dispatched: unknown[] = [];
  const searches: unknown[] = [];
  const code = ts.transpileModule(
    `const openSettingsAt=${open.getText(page)}; (${callback.getText(page)})();`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  runInNewContext(code, {
    present: (value: unknown) => dispatched.push(value),
    setSettingsAt: (value: unknown) => searches.push(value),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(dispatched)), [
    { sheet: "settings" },
  ]);
  assert.deepEqual(searches, [null]);
});

test("mobile Assistant drawer names its settings action independently of the agent identity", () => {
  const drawer = source("../../mobile/src/components/AssistantDrawer.tsx");
  const labels: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(drawer) === "accessibilityLabel" &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    )
      labels.push(node.initializer.text);
    ts.forEachChild(node, visit);
  }
  visit(drawer);
  assert.ok(labels.includes("Settings"));
});
