import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as core from "@orbyn/core";

function linkedTask(platform: "web" | "mobile") {
  const path =
    platform === "web"
      ? "../../desktop/src/features/docs/RichBlocks.tsx"
      : "../../mobile/src/screens/docs/RichBlocks.tsx";
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(
    (entry) =>
      ts.isFunctionDeclaration(entry) && entry.name?.text === "LinkedTasks",
  );
  assert.ok(declaration, `Missing ${platform} LinkedTasks component`);
  const exports: Record<string, (props: unknown) => React.ReactElement> = {};
  const opened: { ref: core.ObjectRef; handler?: (url: string) => void }[] = [];
  const guarded = (_url: string) => {};
  const component = () => null;
  runInNewContext(
    ts.transpileModule(`export ${declaration.getText(ast)}`, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
      },
    }).outputText,
    {
      exports,
      React,
      useContext: () => ({ onAppLink: guarded }),
      useMemo: (callback: () => unknown) => callback(),
      DocNavigationContext: {},
      docObjectLinks: core.docObjectLinks,
      usePageActions: () => ({ pills: new Map(), onToggle: undefined }),
      usePagePills: () => ({ pills: new Map(), onToggle: undefined }),
      pillKey: () => "task",
      openObject: (
        ref: core.ObjectRef,
        _block?: string,
        handler?: (url: string) => void,
      ) => opened.push({ ref, handler }),
      ClipboardList: component,
      View: component,
      Text: component,
      Pressable: component,
      Icon: component,
      colors: core.colors,
      s: {},
    },
  );
  const id = "11111111-1111-4111-8111-111111111111";
  const tree = exports.LinkedTasks({
    blocks: [{ type: "paragraph", text: `[Task](orbyn://task/${id})` }],
  });
  const actions: Array<() => void> = [];
  function visit(node: React.ReactNode) {
    if (!React.isValidElement(node)) return;
    const props = node.props as {
      children?: React.ReactNode;
      className?: string;
      onClick?: () => void;
      onPress?: () => void;
    };
    if (platform === "web" && props.className?.includes("doc-embed-task"))
      actions.push(props.onClick!);
    if (platform === "mobile" && node.type === component && props.onPress)
      actions.push(props.onPress);
    React.Children.forEach(props.children, visit);
  }
  visit(tree);
  assert.ok(actions.length, `Expected ${platform} linked-task action`);
  actions.at(-1)!();
  return { opened, guarded, id };
}

for (const platform of ["web", "mobile"] as const) {
  test(`${platform} linked tasks route through the owning editor guard`, () => {
    const result = linkedTask(platform);
    assert.equal(result.opened.length, 1);
    assert.equal(result.opened[0].ref.id, result.id);
    assert.equal(result.opened[0].handler, result.guarded);
  });
}
