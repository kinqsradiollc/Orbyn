import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as core from "@orbyn/core";

function load(native: boolean) {
  const context = { exports: {} };
  const modules: Record<string, unknown> = {
    react: { ...React, useMemo: (fn: () => unknown) => fn() },
    "react/jsx-runtime": jsx,
    "@orbyn/core": core,
    "react-native": { Text: "Text", View: "View" },
    "../../motion": { Pressable: "Pressable" },
    "../../theme": { colors: {}, fonts: {} },
    "./DocBody": { DocBody: "DocBody" },
    "./DocBlocks": { BlockView: "BlockView" },
    "./RichBlocks": { FootnoteContext: { Provider: "Provider" } },
    "./footnotes": { FootnoteContext: { Provider: "Provider" } },
    "./doc-containers.css": {},
  };
  const source = readFileSync(
    new URL(
      native
        ? "../../mobile/src/screens/docs/DocContainerBody.tsx"
        : "../../desktop/src/features/docs/DocContainerView.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    {
      ...context,
      require: (name: string) => {
        assert.ok(name in modules, name);
        return modules[name];
      },
    },
  );
  return (context.exports as Record<string, (props: any) => unknown>)[
    native ? "DocContainerBody" : "DocContainerView"
  ];
}
function elements(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value?.props) return [];
  return [value, ...elements(value.props.children)];
}
for (const native of [false, true]) {
  const label = native ? "mobile" : "desktop";
  test(`${label} nested controls preserve exact owners and reject stale edits`, () => {
    const render = load(native);
    const document = {
      format: 2 as const,
      nodes: core.parseDocContainers(
        "> - [ ] First\n>   - [x] Nested\n> - [ ] Last",
      ),
    };
    const calls: {
      operation: core.DocContentOperation;
      expected: readonly core.DocContainerNode[];
    }[] = [];
    const leaves: number[][] = [];
    const tree = render({
      nodes: document.nodes,
      renderLeaf: (_block: core.DocBlock, _index: number, path: number[]) => {
        leaves.push(path);
        return null;
      },
      onOperation: (
        operation: core.DocContentOperation,
        expected: readonly core.DocContainerNode[],
      ) => calls.push({ operation, expected }),
    });
    const checks = elements(tree).filter((el) =>
      native
        ? el.props.accessibilityRole === "checkbox"
        : el.props.type === "checkbox",
    );
    assert.equal(checks.length, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(leaves)), [
      [0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0],
      [0, 0, 1, 0],
    ]);
    if (native) checks[1].props.onPress();
    else checks[1].props.onChange({ currentTarget: { checked: false } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].expected, document.nodes);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].operation)), {
      kind: "check-item",
      list: [0, 0, 0, 1],
      item: 0,
      checked: false,
    });
    const changed = core.applyDocContentOperation(
      document,
      { format: 2, nodes: calls[0].expected },
      calls[0].operation,
    );
    assert.notDeepEqual(changed, document);
    assert.throws(
      () =>
        core.applyDocContentOperation(changed, document, calls[0].operation),
      /changed/,
    );
    const readOnly = elements(render({ nodes: document.nodes })).filter((el) =>
      native
        ? el.props.accessibilityRole === "checkbox"
        : el.props.type === "checkbox",
    );
    for (const check of readOnly) {
      assert.equal(check.props.disabled, true);
      assert.equal(
        native ? check.props.onPress : check.props.onChange,
        undefined,
      );
    }
  });
}
