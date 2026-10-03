import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function menu(platform: "ios" | "android") {
  const timers: (() => void)[] = [];
  let calls = 0;
  let closed = 0;
  const code = ts.transpileModule(read("mobile/src/components/MoreMenu.tsx"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(code, {
    exports,
    setTimeout: (fn: () => void) => timers.push(fn),
    require: (name: string) => {
      if (name === "react")
        return { ...React, useRef: (value: unknown) => ({ current: value }) };
      if (name === "react-native")
        return {
          Animated: { View: "AnimatedView" },
          Modal: "Modal",
          Platform: { OS: platform },
          ScrollView: "ScrollView",
          Text: "Text",
          View: "View",
          StyleSheet: { create: (value: unknown) => value },
        };
      if (name.endsWith("/motion")) return { Pressable: "Pressable" };
      if (name.endsWith("/Icon")) return { Icon: "Icon" };
      if (name === "react-native-safe-area-context")
        return { useSafeAreaInsets: () => ({ bottom: 34 }) };
      if (name.endsWith("/useSwipeDown"))
        return { useSwipeDown: () => ({ offset: 0, handlers: {} }) };
      if (name.endsWith("/theme"))
        return {
          colors: {},
          controls: { tap: 44 },
          fonts: {},
          radii: {},
          themed: (fn: () => unknown) => fn(),
          tint: () => "",
        };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const tree = exports.ActionSheet({
    visible: true,
    label: "Admin sections",
    title: "Admin sections",
    actions: Array.from({ length: 11 }, (_, index) => ({
      label: `Section ${index}`,
      onPress: () => calls++,
    })),
    onClose: () => closed++,
  });
  const nodes: React.ReactElement<any>[] = [];
  const visit = (value: any) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (value.props) {
      nodes.push(value);
      visit(value.props.children);
    }
  };
  visit(tree);
  return { tree, nodes, timers, calls: () => calls, closed: () => closed };
}

test("native section menu scrolls choices while Cancel remains outside the list", () => {
  const view = menu("ios");
  const scroller = view.nodes.find((node) => node.type === "ScrollView")!;
  assert.ok(scroller);
  assert.equal(scroller.props.keyboardShouldPersistTaps, "handled");
  const items = view.nodes.filter(
    (node) => node.props.accessibilityRole === "menuitem",
  );
  assert.equal(items.length, 11);
  assert.ok(view.nodes.some((node) => node.props.accessibilityViewIsModal));
  const cancel = view.nodes.find(
    (node) =>
      node.type === "Pressable" &&
      node.props.accessibilityRole === "button" &&
      React.isValidElement(node.props.children) &&
      (node.props.children as React.ReactElement<any>).props.children ===
        "Cancel",
  )!;
  assert.ok(cancel);
  assert.ok(!JSON.stringify(scroller.props.children).includes('"Cancel"'));
  cancel.props.onPress();
  assert.equal(view.closed(), 1);
  assert.equal(view.calls(), 0);
});

test("iOS selection runs once after dismissal even when the fallback also fires", () => {
  const view = menu("ios");
  view.nodes
    .find((node) => node.props.accessibilityRole === "menuitem")!
    .props.onPress();
  assert.equal(view.closed(), 1);
  assert.equal(view.calls(), 0);
  view.tree.props.onDismiss();
  for (const timer of view.timers) timer();
  assert.equal(view.calls(), 1);
});

test("Android section selection executes immediately without a second dismissal call", () => {
  const view = menu("android");
  view.nodes
    .find((node) => node.props.accessibilityRole === "menuitem")!
    .props.onPress();
  assert.equal(view.closed(), 1);
  assert.equal(view.calls(), 1);
  assert.equal(view.tree.props.onDismiss, undefined);
});

test("Admin navigation retains permission guards and detail resets on both clients", () => {
  const web = read("desktop/src/features/admin/AdminView.tsx");
  const mobile = read("mobile/src/screens/AdminSheet.tsx");
  assert.ok(web.includes('aria-label="Admin sections"'));
  assert.ok(web.includes('className="admin-section-picker"'));
  for (const permission of [
    "requests:read",
    "analytics:read",
    "ai:manage",
    "system:manage",
  ]) {
    assert.ok(web.includes(permission));
    assert.ok(mobile.includes(permission));
  }
  assert.ok(web.includes("setTeamId(null)"));
  assert.ok(web.includes("setUserId(null)"));
  assert.ok(mobile.includes("setAccount(null)"));
  assert.ok(mobile.includes('label="Choose admin section"'));
  assert.ok(!mobile.includes("<Segmented"));
});

test("budget disclosures preserve validation and bounded menu labels can wrap", () => {
  const web = read("desktop/src/features/admin/AdminAi.tsx");
  const mobile = read("mobile/src/screens/AdminAi.tsx");
  assert.ok(web.includes('className="card ai-budget"'));
  assert.ok(mobile.includes('title="Night-shift budget"'));
  for (const source of [web, mobile]) {
    assert.ok(source.includes("Number(nightBudget) < 1000"));
    assert.ok(source.includes("Number(nightBudget) > 10000000"));
    assert.ok(source.includes("night_token_budget: Number(nightBudget)"));
  }
  const menuSource = read("mobile/src/components/MoreMenu.tsx");
  assert.ok(menuSource.includes('maxHeight: "88%"'));
  assert.ok(menuSource.includes("flexShrink: 1"));
  assert.ok(!menuSource.includes("numberOfLines={1}"));
  const css = read("desktop/src/features/admin/admin-workspace.css");
  assert.ok(css.includes("grid-template-columns: 200px minmax(0, 1fr)"));
  assert.ok(css.includes("@media (max-width: 1000px)"));
});
