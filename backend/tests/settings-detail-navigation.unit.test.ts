import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import * as core from "@orbyn/core";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const h = React.createElement;

// Actual React hooks/components in a DOM fixture. Native hosts are adapters only:
// this proves state transitions/mount retention, not layout, native focus or pixels.
async function fixture(platform: "desktop" | "mobile") {
  const dom = new JSDOM("<main></main>", { pretendToBeVisual: true });
  const keys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "CustomEvent",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    CustomEvent: dom.window.CustomEvent,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const key of keys)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: values[key],
    });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const cache = new Map<string, any>();
  const nativeHost = (tag: string) =>
    React.forwardRef<any, any>((props, ref) => {
      const style =
        typeof props.style === "function"
          ? props.style({ pressed: false })
          : props.style;
      const flatten = (value: any): object =>
        Array.isArray(value)
          ? Object.assign({}, ...value.map(flatten))
          : value || {};
      return h(
        tag,
        {
          ref,
          style: flatten(style),
          onClick: props.onPress,
          disabled: props.disabled,
          "data-accessibility-hidden": props.accessibilityElementsHidden,
        },
        props.children,
      );
    });
  const native = {
    View: nativeHost("div"),
    Text: nativeHost("span"),
    StyleSheet: { create: (styles: any) => styles },
  };
  const icon = () => h("span", { "aria-hidden": true });
  function load(path: string): any {
    if (cache.has(path)) return cache.get(path);
    const exports: any = {};
    cache.set(path, exports);
    // Vite substitutes this development-only diagnostic; the fixture runs production behavior.
    const code = ts.transpileModule(
      read(path).replaceAll("import.meta.env.DEV", "false"),
      {
        compilerOptions: {
          jsx: ts.JsxEmit.React,
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      },
    ).outputText;
    runInNewContext(code, {
      exports,
      React,
      window: dom.window,
      document: dom.window.document,
      CustomEvent: dom.window.CustomEvent,
      requestAnimationFrame: values.requestAnimationFrame,
      cancelAnimationFrame: values.cancelAnimationFrame,
      setTimeout,
      clearTimeout,
      require(name: string) {
        if (name === "react") return React;
        if (name === "react-dom") return require("react-dom");
        if (name === "@orbyn/core") return core;
        if (name === "lucide-react") return new Proxy({}, { get: () => icon });
        if (name.endsWith(".css")) return {};
        if (name === "./SettingsModal")
          return load("desktop/src/features/settings/SettingsModal.tsx");
        if (name === "react-native") return native;
        if (name === "../../motion") return { Pressable: nativeHost("button") };
        if (name === "../../components/Icon") return { Icon: icon };
        if (name === "../../theme")
          return {
            colors: {},
            fonts: {},
            radii: {},
            themed: (factory: any) => factory(),
          };
        if (name === "../../styles") return { shared: {} };
        throw new Error(`Unexpected fixture dependency ${name}`);
      },
    });
    return exports;
  }
  const module = load(
    platform === "desktop"
      ? "desktop/src/features/settings/SettingsSection.tsx"
      : "mobile/src/screens/settings/SettingsSection.tsx",
  );
  const root = createRoot(dom.window.document.querySelector("main")!);
  const render = async (node: React.ReactNode) => {
    await act(async () => root.render(node));
  };
  const click = async (label: string) => {
    const button = Array.from(
      dom.window.document.querySelectorAll("button"),
    ).find((node: any) => node.textContent.trim() === label) as
      HTMLButtonElement | undefined;
    assert.ok(button, `Missing ${platform} button: ${label}`);
    await act(async () => button.click());
  };
  const section = (title: string, children: React.ReactNode) =>
    h(module.SettingsSection, { title }, children);
  const isHidden = (element: HTMLElement) => {
    for (
      let node: HTMLElement | null = element;
      node;
      node = node.parentElement
    )
      if (node.hidden || node.style.display === "none") return true;
    return false;
  };
  return {
    dom,
    module,
    render,
    click,
    section,
    isHidden,
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const key of keys) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as any)[key];
      }
    },
  };
}

for (const platform of ["desktop", "mobile"] as const) {
  test(`${platform} detail provider opens one sibling, Back retains mounted draft, category reset restores rows`, async () => {
    const f = await fixture(platform);
    let mounts = 0;
    function Draft() {
      React.useEffect(() => {
        mounts++;
      }, []);
      return h("input", { "data-draft": "alpha", defaultValue: "original" });
    }
    const tree = (category: string) =>
      h(
        f.module.SettingsDetailProvider,
        { resetKey: category },
        f.section("Alpha", h(Draft)),
        f.section("Beta", h("p", { "data-beta": true }, "Beta body")),
      );
    try {
      await f.render(tree("account"));
      await f.click("Alpha");
      const input = f.dom.window.document.querySelector(
        "input",
      ) as HTMLInputElement;
      assert.ok(input);
      assert.equal(f.isHidden(input), false);
      if (platform === "desktop")
        assert.equal(
          f.dom.window.document.activeElement.textContent.trim(),
          "Back",
        );
      input.value = "unsaved draft";
      const betaRow = Array.from(
        f.dom.window.document.querySelectorAll("button"),
      ).find((node: any) => node.textContent === "Beta") as HTMLElement;
      assert.equal(f.isHidden(betaRow), true);
      await f.click(platform === "desktop" ? "Back" : "Back · Alpha");
      assert.equal(f.isHidden(input), true);
      if (platform === "desktop")
        assert.equal(
          f.dom.window.document.activeElement.textContent.trim(),
          "Alpha",
        );
      await f.click("Beta");
      assert.equal(
        f.isHidden(f.dom.window.document.querySelector("[data-beta]")),
        false,
      );
      assert.equal(f.isHidden(input), true);
      await f.render(tree("privacy"));
      assert.equal(
        f.isHidden(f.dom.window.document.querySelector("[data-beta]")),
        true,
      );
      await f.click("Alpha");
      assert.equal(f.dom.window.document.querySelector("input"), input);
      assert.equal(input.value, "unsaved draft");
      assert.equal(mounts, 1);
    } finally {
      await f.close();
    }
  });

  test(`${platform} repeated search reveals a retained nested detail and its parent`, async () => {
    const f = await fixture(platform);
    const tree = (seq: number, key = "") =>
      h(
        f.module.SettingsFocus.Provider,
        { value: { key, seq, scrollTo() {} } },
        h(
          f.module.SettingsDetailProvider,
          { resetKey: "connections" },
          f.section(
            "Outer",
            f.section(
              "Nested",
              h("input", { "data-nested": true, defaultValue: "keep" }),
            ),
          ),
        ),
      );
    try {
      await f.render(tree(0));
      await f.click("Outer");
      await f.click("Nested");
      const input = f.dom.window.document.querySelector(
        "[data-nested]",
      ) as HTMLElement;
      assert.equal(f.isHidden(input), false);
      await f.click(platform === "desktop" ? "Back" : "Back · Outer");
      await f.render(tree(1, core.sectionKey("Nested")));
      assert.equal(
        f.isHidden(input),
        false,
        "nested search must reveal parent too",
      );
      await f.click(platform === "desktop" ? "Back" : "Back · Outer");
      await f.render(tree(2, core.sectionKey("Nested")));
      assert.equal(
        f.isHidden(input),
        false,
        "same result with a new seq reopens",
      );
    } finally {
      await f.close();
    }
  });
}

test("desktop detail navigation invokes the real Settings exit guard and preserves the open detail", async () => {
  const f = await fixture("desktop");
  try {
    await f.render(
      h(
        "div",
        { className: "settings-dialog" },
        h(
          f.module.SettingsDetailProvider,
          null,
          f.section("Protected", h("input", { "data-protected": true })),
          f.section("Other", h("p", null, "Other body")),
        ),
      ),
    );
    await f.click("Protected");
    const marker = f.dom.window.document.createElement("div");
    marker.setAttribute("data-settings-close-guard", "");
    f.dom.window.document.querySelector(".settings-dialog").append(marker);
    let blocked = 0;
    marker.addEventListener("orbyn-settings-exit-blocked", () => blocked++);
    await f.click("Back");
    await f.click("Other");
    assert.equal(blocked, 2);
    assert.equal(
      f.isHidden(f.dom.window.document.querySelector("[data-protected]")),
      false,
    );
    marker.remove();
    await f.click("Back");
    assert.equal(
      f.isHidden(f.dom.window.document.querySelector("[data-protected]")),
      true,
    );
  } finally {
    await f.close();
  }
});

function ast(path: string) {
  return ts.createSourceFile(
    path,
    read(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
function nodes(
  root: ts.Node,
  predicate: (node: ts.Node) => boolean,
): ts.Node[] {
  const result: ts.Node[] = [];
  function visit(node: ts.Node) {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return result;
}

// Structural ownership assertions supplement the state harness; they do not
// establish computed widths, native sheet behavior or successful reconnection.
test("automation customization is categorized separately from external connections on both clients", () => {
  const web = ast("desktop/src/features/settings/SettingsView.tsx");
  const branches = nodes(
    web,
    (node) =>
      ts.isJsxExpression(node) &&
      !!node.expression &&
      ts.isBinaryExpression(node.expression),
  );
  const assistants = branches.find(
    (node) =>
      /tab === "assistants"/.test(node.getText(web)) &&
      /<AgentWarmStart\b/.test(node.getText(web)),
  );
  assert.ok(assistants);
  assert.doesNotMatch(
    assistants.getText(web),
    /<ConnectedAgents\b|<ConnectionsSettings\b/,
  );
  assert.match(
    read("desktop/src/features/settings/ConnectionsSettings.tsx"),
    /<ConnectedAgents\b/,
  );
  assert.doesNotMatch(
    read("desktop/src/features/settings/ConnectionsSettings.tsx"),
    /<AgentWarmStart\b/,
  );
  const mobile = ast("mobile/src/screens/SettingsScreen.tsx");
  const groups = nodes(
    mobile,
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(mobile) === "SettingsGroup",
  );
  const assistantGroup = groups.find((node) =>
    /category="assistants"/.test(node.getText(mobile)),
  );
  const connections = groups.find((node) =>
    /category="connections"/.test(node.getText(mobile)),
  );
  assert.ok(assistantGroup && connections);
  assert.match(assistantGroup.getText(mobile), /<AgentWarmStartCards\b/);
  assert.doesNotMatch(connections.getText(mobile), /<AgentWarmStartCards\b/);
  assert.match(
    read("mobile/src/screens/ConnectionsSheet.tsx"),
    /<ConnectedAgentsCard\b/,
  );
  for (const path of [
    "desktop/src/features/settings/AgentContext.tsx",
    "mobile/src/screens/AgentContext.tsx",
  ])
    assert.match(read(path), /title="Background & overnight"/);
});

test("reconnect-required grants expose sign-in recovery and suppress restoration on both clients", () => {
  for (const path of [
    "desktop/src/features/settings/ConnectedAgents.tsx",
    "mobile/src/screens/ConnectedAgents.tsx",
  ]) {
    const source = ast(path);
    const expressions = nodes(source, (node) => ts.isJsxExpression(node));
    const recovery = expressions.find((node) =>
      /^\{g\.reconnect_required &&/.test(node.getText(source)),
    );
    assert.ok(recovery, `${path}: conditional recovery message`);
    assert.match(recovery.getText(source), /Sign in to Orbyn again from/);
    assert.match(recovery.getText(source), /g\.client_name \|\| g\.name/);
    // Execute the real guard expression, rather than merely searching for its tokens.
    const guards = nodes(
      source,
      (node) =>
        ts.isBinaryExpression(node) &&
        node.getText(source) === "g.suspended_at && !g.reconnect_required",
    );
    assert.ok(
      guards.length >= 2,
      `${path}: pause explanation and restoration share guard`,
    );
    for (const guard of guards) {
      for (const reconnect_required of [true, false]) {
        const allowed = runInNewContext(guard.getText(source), {
          g: { suspended_at: "2026-10-16", reconnect_required },
        });
        assert.equal(allowed, !reconnect_required);
      }
      assert.equal(
        runInNewContext(guard.getText(source), {
          g: { suspended_at: null, reconnect_required: false },
        }),
        null,
      );
    }
  }
});

test("Activity opts into the standalone editor width whose viewport bounds load with the editor", () => {
  const activity = read("desktop/src/features/activity/ActivityDialog.tsx");
  const editor = read("desktop/src/features/settings/SettingsEditor.tsx");
  const css = read("desktop/src/features/settings/settings-editor.css");
  assert.match(activity, /<SettingsEditor wide title="Activity"/);
  assert.match(editor, /import "\.\/settings-editor\.css"/);
  assert.match(editor, /"--settings-editor-width": wide \? "1000px" : "560px"/);
  assert.match(
    css,
    /dialog\.settings-editor\s*\{[^}]*width:\s*min\(var\(--settings-editor-width, 560px\), calc\(100vw - 24px\)\)/,
  );
  assert.match(css, /max-height:\s*calc\(100dvh - 24px\)/);
  assert.doesNotMatch(
    read("desktop/src/features/activity/activity.css"),
    /dialog\.settings-editor\s*\{|(?:^|\})\s*\.settings-editor\s*\{/,
  );
});
