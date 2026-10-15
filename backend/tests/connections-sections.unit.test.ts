import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
const require = createRequire(import.meta.url),
  mobileRequire = createRequire(
    new URL("../../mobile/package.json", import.meta.url),
  );
test("settings groups mount lazily, retain drafts while folded, and cannot hide pending work", async () => {
  const React = require("react"),
    { JSDOM } = mobileRequire("jsdom"),
    dom = new JSDOM('<div id="root"></div>');
  const keys = [
    "window",
    "document",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const saved = keys.map(
    (k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const,
  );
  for (const k of keys)
    Object.defineProperty(globalThis, k, {
      configurable: true,
      writable: true,
      value: k === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[k],
    });
  const container = React.forwardRef(
    ({ children, style, accessibilityElementsHidden }: any, ref: any) =>
      React.createElement(
        "div",
        {
          ref,
          "aria-hidden": accessibilityElementsHidden || undefined,
          style: {
            display: (Array.isArray(style) ? style : [style])
              .filter(Boolean)
              .at(-1)?.display,
          },
        },
        children,
      ),
  );
  const prefs = new Map();
  const deps: any = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": {
      View: container,
      Text: container,
      StyleSheet: { create: (s: any) => s },
    },
    "../../motion": {
      Pressable: ({ children, onPress, disabled, accessibilityState }: any) =>
        React.createElement(
          "button",
          {
            onClick: onPress,
            disabled,
            "aria-expanded": accessibilityState?.expanded,
          },
          children,
        ),
    },
    "@orbyn/core": { sectionKey: (s: string) => s },
    "../../components/Icon": { Icon: () => null },
    "../../lib/localPrefs": {
      readLocal: (key: string) => prefs.get(key),
      saveLocal: (key: string, value: string) => prefs.set(key, value),
    },
    "../../theme": {
      colors: {},
      fonts: {},
      radii: {},
      themed: (fn: any) => fn(),
    },
    "../../styles": { shared: { card: {} } },
  };
  const module = { exports: {} as any };
  runInNewContext(
    transformSync(
      readFileSync(
        new URL(
          "../../mobile/src/screens/settings/SettingsSection.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      { loader: "tsx", format: "cjs", jsx: "automatic" },
    ).code,
    {
      module,
      exports: module.exports,
      require: (name: string) => {
        assert.ok(name in deps, name);
        return deps[name];
      },
      setTimeout,
      clearTimeout,
    },
  );
  const root = require("react-dom/client").createRoot(
    dom.window.document.querySelector("#root"),
  );
  const render = (disabled = false) =>
    React.createElement(
      module.exports.SettingsSection,
      { title: "Connections test", disabled },
      React.createElement("input", { defaultValue: "" }),
    );
  try {
    await React.act(async () => root.render(render()));
    assert.equal(dom.window.document.querySelector("input"), null);
    const button = () => dom.window.document.querySelector("button")!;
    await React.act(async () => button().click());
    const input = dom.window.document.querySelector("input")!;
    input.value = "Unsent field";
    await React.act(async () => root.render(render(true)));
    assert.equal(button().disabled, true);
    await React.act(async () => button().click());
    assert.equal(button().getAttribute("aria-expanded"), "true");
    await React.act(async () => root.render(render()));
    await React.act(async () => button().click());
    assert.equal(input.closest('[aria-hidden="true"]') !== null, true);
    await React.act(async () => button().click());
    assert.equal(dom.window.document.querySelector("input"), input);
    assert.equal(input.value, "Unsent field");
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
test("Connections groups every service and compiler deployments reap sandbox children", () => {
  const root = readFileSync(
    new URL("../../mobile/src/screens/ConnectionsSheet.tsx", import.meta.url),
    "utf8",
  );
  for (const title of [
    "Messaging apps",
    "Connected agents",
    "API keys",
    "Webhooks",
    "Share a calendar",
    "Calendar subscriptions",
    "Calendar apps",
  ])
    assert.match(root, new RegExp('title="' + title + '"'));
  assert.match(root, /disabled=\{busy \|\| childBusy\}/);
  const agent = readFileSync(
    new URL("../../mobile/src/screens/AgentContext.tsx", import.meta.url),
    "utf8",
  );
  for (const title of [
    "Overnight schedule",
    "Reminders",
    "Agent identity",
    "Agent context",
    "Instructions",
  ])
    assert.match(agent, new RegExp('<SettingsSection title="' + title + '"'));
  const docker = readFileSync(
    new URL("../../backend/Dockerfile", import.meta.url),
    "utf8",
  );
  assert.match(docker, /tini bubblewrap/);
  assert.match(docker, /ENTRYPOINT \["\/usr\/bin\/tini", "--"\]/);
  const kube = readFileSync(
    new URL("../../deploy/k8s/latex.yaml", import.meta.url),
    "utf8",
  );
  assert.match(kube, /command: \["\/usr\/bin\/tini", "--", "node"/);
});
