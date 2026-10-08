import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
// Use the installed renderer: a stand-in div would conceal unsupported RN Web props.
const nativeWeb = require("react-native-web");
const theme = {
  controls: { tap: 44 },
  radii: { input: 8 },
  colors: { accent: "black", border: "black", surface: "white" },
  fonts: { medium: "sans-serif" },
  themed: (fn: () => unknown) => fn(),
};
function compile(source: string, imports: (path: string) => any) {
  const context = { exports: {} as Record<string, any>, require: imports };
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    context,
  );
  return context.exports;
}
const { SmallAction } = compile(
  readFileSync(
    new URL("../../mobile/src/components/SmallAction.tsx", import.meta.url),
    "utf8",
  ),
  (path) => {
    if (path === "react-native") return nativeWeb;
    if (path === "../motion") return { PressableScale: nativeWeb.Pressable };
    if (path === "../theme") return theme;
    return require(path);
  },
);
const source = readFileSync(
  new URL("../../mobile/src/screens/AdminAi.tsx", import.meta.url),
  "utf8",
);
const tree = ts.createSourceFile(
  "AdminAi.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const row = tree.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "ProviderRow",
);
assert.ok(row);
function fixture(loading: boolean, error: string | null = null) {
  let index = 0;
  const hooks = {
    ...React,
    useState: (initial: unknown) => {
      const value = ["manual-model", ["previous-model"], loading, error, null][
        index++
      ];
      return [value ?? initial, () => {}];
    },
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: () => {},
  };
  const empty = () => null;
  const { ProviderRow } = compile(
    `import React, {useState,useRef,useEffect} from "react";
     import {View,Text,TextInput} from "react-native";
     const {AI_PROVIDERS,SmallAction,FadeIn,PressableScale,Pressable,Switch,MoreMenu,Pill,AiModelControls,shared,s,colors}=require("fixture");
     const MAX_CHIPS=40;
     ${row.getText(tree)}
     exports.ProviderRow=ProviderRow;`,
    (path) => {
      if (path === "react") return hooks;
      if (path === "react-native") return nativeWeb;
      if (path === "fixture")
        return {
          AI_PROVIDERS: {
            "openai-compatible": {
              label: "Test provider",
              listsModels: true,
              suggestedModels: [],
            },
          },
          SmallAction,
          FadeIn: nativeWeb.View,
          PressableScale: nativeWeb.Pressable,
          Pressable: nativeWeb.Pressable,
          Switch: empty,
          MoreMenu: empty,
          Pill: empty,
          AiModelControls: empty,
          shared: {},
          s: {},
          colors: theme.colors,
        };
      return require(path);
    },
  );
  return ProviderRow({
    provider: {
      id: "p",
      name: "Test provider",
      kind: "openai-compatible",
      updated_at: "v1",
      controls_revision: "7",
    },
    expanded: true,
    busy: loading,
    active: false,
    activeModel: "",
  });
}
for (const loading of [true, false]) {
  test(`mobile catalog ${loading ? "pending" : "idle"} uses actual RN Web busy mapping and one live label`, () => {
    const element = fixture(loading);
    const html = renderToStaticMarkup(element);
    assert.match(html, new RegExp(`aria-busy="${loading}"`));
    assert.equal(
      (html.match(/Loading models…/g) ?? []).length,
      loading ? 1 : 0,
    );
    assert.match(html, /aria-live="polite"[^>]*>[^<]*(Loading|Reload) models/);
    if (loading) assert.match(html, /aria-disabled="true"/);
    // Preserve the native-facing state as well as the renderer-supported web prop.
    const nodes: any[] = [];
    const visit = (node: any) => {
      if (!React.isValidElement(node)) return;
      nodes.push(node);
      React.Children.forEach((node.props as any).children, visit);
    };
    visit(element);
    assert.ok(
      nodes.some((node) => node.props.accessibilityState?.busy === loading),
    );
    assert.ok(
      nodes.some(
        (node) =>
          node.type === SmallAction &&
          node.props.accessibilityLiveRegion === "polite",
      ),
    );
  });
}
test("mobile catalog error keeps visible retry and prior manual model without duplicate progress", () => {
  const html = renderToStaticMarkup(
    fixture(false, "Couldn't load models. Try again."),
  );
  assert.match(html, /Retry loading models/);
  assert.match(html, /Couldn&#x27;t load models\. Try again\./);
  assert.match(html, /value="manual-model"/);
  assert.equal((html.match(/Loading models…/g) ?? []).length, 0);
});
