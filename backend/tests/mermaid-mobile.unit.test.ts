import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as core from "@orbyn/core";

function preview(windowHeight = 960) {
  let at = 0,
    refAt = 0,
    memoAt = 0;
  const states: any[] = [],
    refs: any[] = [],
    memos: any[] = [];
  const hooks = {
    ...React,
    useId: () => "diagram-test",
    useEffect: () => {},
    useCallback: (callback: unknown) => callback,
    useRef: (initial: unknown) =>
      refs[refAt++] ?? (refs[refAt - 1] = { current: initial }),
    useState: (initial: unknown) => {
      const index = at++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        (value: any) => {
          states[index] =
            typeof value === "function" ? value(states[index]) : value;
        },
      ];
    },
    useMemo: (callback: () => unknown, dependencies: unknown[]) => {
      const index = memoAt++;
      const old = memos[index];
      if (
        !old ||
        dependencies.some(
          (value, at) => !Object.is(value, old.dependencies[at]),
        )
      )
        memos[index] = { dependencies, value: callback() };
      return memos[index].value;
    },
  };
  const container = () => null;
  const surface = () => null;
  const modules: Record<string, unknown> = {
    react: hooks,
    "react-native": {
      View: container,
      Text: container,
      ScrollView: container,
      useWindowDimensions: () => ({ height: windowHeight }),
    },
    "@orbyn/core": core,
    "./DiagramSurface": { DiagramSurface: surface },
    "../theme": {
      colors: core.colors,
      fonts: {},
      radii: {},
      themed: (callback: () => unknown) => callback(),
    },
    "../motion": { Pressable: container },
    "../lib/download": { saveFile: () => Promise.resolve() },
    "../screens/docs/links": { openObject: () => {} },
  };
  const exports: Record<string, (props: unknown) => React.ReactElement> = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL(
          "../../mobile/src/components/MermaidDiagram.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.React,
        },
      },
    ).outputText,
    {
      exports,
      React,
      require: (name: string) => {
        assert.ok(name in modules, name);
        return modules[name];
      },
    },
  );
  function find(node: React.ReactNode): any {
    if (!React.isValidElement(node)) return null;
    if (node.type === surface) return node.props;
    return React.Children.toArray(
      (node.props as { children?: React.ReactNode }).children,
    )
      .map(find)
      .find(Boolean);
  }
  let tree: React.ReactElement;
  return {
    actions() {
      const labels: string[] = [];
      function visit(node: React.ReactNode) {
        if (!React.isValidElement(node)) return;
        const props = node.props as {
          accessibilityLabel?: string;
          children?: React.ReactNode;
        };
        if (props.accessibilityLabel) labels.push(props.accessibilityLabel);
        React.Children.forEach(props.children, visit);
      }
      visit(tree);
      return labels;
    },
    render(text = "sequenceDiagram\nA->>B: Hello") {
      at = refAt = memoAt = 0;
      tree = exports.MermaidDiagram({ text });
      return find(tree);
    },
  };
}

test("native preview fences late results after a source change and bounds surface height", () => {
  const view = preview();
  const first = view.render();
  const firstId = JSON.parse(first.request).id;
  const current = view.render("classDiagram\nA <|-- B");
  const id = JSON.parse(current.request).id;
  assert.notEqual(firstId, id);
  current.onResult(
    JSON.stringify({
      type: "orbyn-diagram-result",
      id: firstId,
      svg: "<svg />",
      height: 90000,
    }),
  );
  assert.equal(view.render("classDiagram\nA <|-- B").height, 240);
  current.onResult(
    JSON.stringify({
      type: "orbyn-diagram-result",
      id,
      svg: "<svg />",
      height: 90000,
    }),
  );
  assert.equal(view.render("classDiagram\nA <|-- B").height, 480);
});

test("native preview rejects malformed, non-finite and oversized bridge output", () => {
  const view = preview();
  const current = view.render();
  const id = JSON.parse(current.request).id;
  for (const data of [
    "not json",
    JSON.stringify({ type: "wrong", id, svg: "<svg />" }),
    JSON.stringify({ type: "orbyn-diagram-result", id, height: "huge" }),
    JSON.stringify({
      type: "orbyn-diagram-result",
      id,
      svg: "x".repeat(core.MERMAID_MAX_SVG + 1),
    }),
  ]) {
    current.onResult(data);
    assert.equal(view.render().height, 240);
  }
});

test("native diagram canvas fits narrow and landscape windows", () => {
  for (const [windowHeight, expected] of [
    [640, 320],
    [320, 160],
    [1200, 480],
  ]) {
    const view = preview(windowHeight);
    const current = view.render();
    current.onResult(
      JSON.stringify({
        type: "orbyn-diagram-result",
        id: JSON.parse(current.request).id,
        svg: "<svg />",
        height: 90000,
      }),
    );
    assert.equal(view.render().height, expected);
  }
});

test("tall fit diagrams expose pan controls without requiring zoom", () => {
  const view = preview(640);
  const current = view.render();
  assert.ok(!view.actions().includes("Pan diagram down"));
  current.onResult(
    JSON.stringify({
      type: "orbyn-diagram-result",
      id: JSON.parse(current.request).id,
      svg: "<svg />",
      height: 600,
    }),
  );
  const rendered = view.render();
  assert.equal(JSON.parse(rendered.request).zoom, 1);
  assert.equal(rendered.height, 320);
  for (const direction of ["left", "right", "up", "down"])
    assert.ok(view.actions().includes(`Pan diagram ${direction}`));
});
