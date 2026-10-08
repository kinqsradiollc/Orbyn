import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as core from "@orbyn/core";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("web connection help is optional and keeps the developer route available", () => {
  const source = read("desktop/src/features/settings/ConnectedAgents.tsx");
  const start = source.indexOf('<details className="agents-help">');
  assert.ok(start > 0);
  const jsx = source.slice(start, source.indexOf("</details>", start) + 10);
  const code = ts.transpileModule(`result = (${jsx});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context: any = { React };
  runInNewContext(code, context);
  assert.equal(context.result.type, "details");
  assert.equal(context.result.props.open, undefined);
  const html = renderToStaticMarkup(context.result);
  assert.match(html, /<summary>How connections work<\/summary>/);
  assert.match(html, /href="\/developers\/mcp"/);
  assert.match(html, /spaces you allow/);
  assert.match(html, /Review permissions when connecting/);
  assert.ok(
    source.indexOf(
      "onClick={openConnect}",
      source.indexOf('className="agents-head"'),
    ) < start,
  );
});

function mobileHelp(open: boolean) {
  let index = 0;
  let next: boolean | undefined;
  const exports: any = {};
  const hookReact = {
    ...React,
    useState(initial: any) {
      const slot = index++;
      return [
        slot === 1 ? open : initial,
        (value: boolean) => {
          if (slot === 1) next = value;
        },
      ];
    },
    useEffect() {},
  };
  const component = () => null;
  const stubs = new Proxy(
    {},
    {
      get: (_target, name) => (name === "animateLayout" ? () => {} : component),
    },
  );
  const source = read("mobile/src/screens/ConnectedAgents.tsx");
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      require: (name: string) =>
        name === "react"
          ? hookReact
          : name === "@orbyn/core"
            ? core
            : name === "react-native"
              ? {
                  StyleSheet: { create: (styles: any) => styles },
                  Text: "Text",
                  View: "View",
                  Switch: "Switch",
                  TextInput: "TextInput",
                }
              : name === "../theme"
                ? {
                    colors: {},
                    fonts: {},
                    radii: {},
                    controls: { tap: 44 },
                    themed: (factory: any) => factory(),
                  }
                : name === "../styles"
                  ? { shared: {} }
                  : name === "../lib/api"
                    ? { client: {} }
                    : stubs,
    },
  );
  const tree = exports.ConnectedAgentsCard({ busy: false, run() {} });
  const elements: any[] = [];
  function visit(value: any) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value?.props) {
      elements.push(value);
      visit(value.props.children);
    }
  }
  visit(tree);
  const control = elements.find(
    (node) =>
      node.props.accessibilityState?.expanded === open && node.props.onPress,
  );
  assert.ok(control);
  return { tree, control, elements, next: () => next };
}

test("mobile help starts closed, toggles accessibly and retains permission explanation", () => {
  for (const open of [false, true]) {
    const view = mobileHelp(open);
    assert.equal(view.control.props.accessibilityRole, "button");
    assert.equal(view.control.props.style.minHeight, 44);
    view.control.props.onPress();
    assert.equal(view.next(), !open);
    const text = JSON.stringify(view.tree);
    assert.equal(text.includes("Review permissions when connecting"), open);
    assert.ok(text.includes("Choose what connected agents can access."));
  }
});
