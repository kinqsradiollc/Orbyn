import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as core from "@orbyn/core";

const source = readFileSync(
  new URL(
    "../../desktop/src/features/settings/SettingsNavigation.tsx",
    import.meta.url,
  ),
  "utf8",
);
const exports: Record<string, any> = {};
const icon = () => React.createElement("svg", { "aria-hidden": true });
runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText,
  {
    exports,
    React,
    require: () => ({
      CalendarCog: icon,
      Plug: icon,
      ShieldCheck: icon,
      Tags: icon,
      UserRound: icon,
    }),
  },
);

test("settings categories render named buttons and only the active category is current", () => {
  for (const selected of [
    "account",
    "planning",
    "tags",
    "connections",
    "privacy",
  ]) {
    const html = renderToStaticMarkup(
      exports.SettingsNavigation({ selected, onSelect() {} }),
    );
    assert.match(html, /aria-label="Settings categories"/);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.match(
      html,
      new RegExp(`id="settings-category-${selected}" aria-current="page"`),
    );
    assert.equal((html.match(/type="button"/g) ?? []).length, 5);
    assert.equal(
      (html.match(/aria-controls="settings-content"/g) ?? []).length,
      5,
    );
  }
});

test("each category action selects its own destination without changing settings values", () => {
  const selected: string[] = [];
  const tree = exports.SettingsNavigation({
    selected: "account",
    onSelect: (id: string) => selected.push(id),
  });
  for (const button of tree.props.children) button.props.onClick();
  assert.deepEqual(selected, [
    "account",
    "planning",
    "tags",
    "connections",
    "privacy",
  ]);
});

test("settings search still selects the tab and opens the matching section", () => {
  const view = readFileSync(
    new URL(
      "../../desktop/src/features/settings/SettingsView.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(view, /setTab\(entry.tab\)/);
  assert.match(view, /key: sectionKey\(entry.section\)/);
  assert.match(
    view,
    /<SettingsNavigation selected=\{tab\} onSelect=\{setTab\}/,
  );
  assert.match(view, /id="settings-content"/);
  assert.match(view, /aria-labelledby=\{"settings-category-" \+ tab\}/);
});

test("settings workspace constrains content and wraps category actions on narrow screens", () => {
  const css = readFileSync(
    new URL(
      "../../desktop/src/features/settings/settings.css",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(css, /grid-template-columns: 190px minmax\(0, 1fr\)/);
  assert.match(css, /\.settings-content \{\s*min-width: 0/);
  assert.match(
    css,
    /\.settings-navigation \{\s*display: flex;\s*flex-wrap: wrap/,
  );
});

function settingsFixture() {
  const states: unknown[] = [];
  let cursor = 0;
  const viewExports: Record<string, any> = {};
  const section = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children);
  const hooks = {
    useEffect() {},
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states))
        states[index] = typeof initial === "function" ? initial() : initial;
      return [
        states[index],
        (next: unknown) => {
          states[index] =
            typeof next === "function" ? next(states[index]) : next;
        },
      ];
    },
  };
  const source = readFileSync(
    new URL(
      "../../desktop/src/features/settings/SettingsView.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
    {
      exports: viewExports,
      React,
      require(name: string) {
        if (name === "react") return hooks;
        if (name === "@orbyn/core") return core;
        if (name === "./SettingsNavigation") return exports;
        if (name === "./SettingsSection")
          return {
            SettingsFocus: { Provider: section },
            SettingsSection: section,
          };
        if (name === "../../lib/theme")
          return { useTheme: () => ["system", () => {}] };
        if (name === "../docs/reading")
          return { readsFirst: () => false, setReadsFirst() {} };
        if (name.endsWith(".css")) return {};
        return new Proxy(
          {},
          {
            get: (_, key) => () =>
              React.createElement("div", null, String(key)),
          },
        );
      },
    },
  );
  const render = () => {
    cursor = 0;
    return viewExports.SettingsView({
      user: { name: "Test", email: "test@example.test" },
      teams: [],
      busy: false,
      report() {},
      onEmailReminders() {},
      onAccountDeleted() {},
    });
  };
  const elements = (node: React.ReactNode): React.ReactElement<any>[] => {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!React.isValidElement<any>(node)) return [];
    return [node, ...elements(node.props.children)];
  };
  return { render, elements };
}

test("real settings view category navigation changes content and its accessible label", () => {
  const fixture = settingsFixture();
  let tree = fixture.render();
  const nav = fixture
    .elements(tree)
    .find((node) => node.type === exports.SettingsNavigation)!;
  nav.props.onSelect("privacy");
  tree = fixture.render();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /aria-labelledby="settings-category-privacy"/);
  assert.match(html, /PrivacySettings/);
  assert.doesNotMatch(html, /Your account/);
});

test("real settings search result chooses its destination and clears the query", () => {
  const fixture = settingsFixture();
  let tree = fixture.render();
  fixture
    .elements(tree)
    .find((node) => node.type === exports.SettingsNavigation)!
    .props.onSelect("privacy");
  tree = fixture.render();
  const input = fixture
    .elements(tree)
    .find((node) => node.type === "input" && node.props.type === "search")!;
  input.props.onChange({ target: { value: "ChatGPT" } });
  tree = fixture.render();
  const found = fixture
    .elements(tree)
    .find((node) => node.props.id === "settings-found")!;
  const first = fixture.elements(found).find((node) => node.type === "button")!;
  first.props.onClick();
  tree = fixture.render();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /aria-labelledby="settings-category-account"/);
  assert.match(html, /ChatgptConnections/);
  assert.doesNotMatch(html, /id="settings-found"/);
});
