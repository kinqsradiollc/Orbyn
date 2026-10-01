import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_INDEX,
  settingById,
  settingsCategory,
  searchSettings,
} from "@orbyn/core";

const require = createRequire(import.meta.url);

/** Exercise actual navigation handlers with controlled hooks and DOM fixtures. */
function navigation(open: boolean) {
  const effects: (() => unknown)[] = [];
  const refs: { current: any }[] = [];
  const states: boolean[] = [];
  const choices: string[] = [];
  const document = { body: {}, activeElement: null as any };
  let resized:
    ((entries: { contentRect: { width: number } }[]) => void) | null = null;
  let disconnected = false;
  const source = readFileSync(
    new URL(
      "../../desktop/src/features/settings/SettingsNavigation.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const context = {
    exports: {} as Record<string, any>,
    document,
    ResizeObserver: class {
      constructor(callback: typeof resized) {
        resized = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
    require: (path: string) =>
      path === "react"
        ? {
            useState: () => [open, (value: boolean) => states.push(value)],
            useEffect: (effect: () => unknown) => effects.push(effect),
            useId: () => "navigation-fixture",
            useRef: (current: unknown) => {
              const ref = { current };
              refs.push(ref);
              return ref;
            },
          }
        : path === "react-dom"
          ? { createPortal: (node: unknown) => node }
          : require(path),
  };
  runInNewContext(output, context);
  const element = context.exports.SettingsNavigation({
    category: "ai",
    onChoose: (value: string) => choices.push(value),
  });
  const [rail, opener, dialog] = element.props.children;
  return {
    rail,
    opener,
    dialog,
    refs,
    effects,
    states,
    choices,
    document,
    resize: (width: number) => resized?.([{ contentRect: { width } }]),
    disconnected: () => disconnected,
  };
}

/** Render the actual layout; network-owning control islands are explicit stubs. */
function layout() {
  const load = (name: string, resolve: (path: string) => unknown) => {
    const source = readFileSync(
      new URL(
        `../../desktop/src/features/settings/${name}.tsx`,
        import.meta.url,
      ),
      "utf8",
    );
    // Match Vite's production replacement of its development-only diagnostic.
    const output = ts.transpileModule(
      source.replaceAll("import.meta.env.DEV", "false"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText;
    const context = { exports: {} as Record<string, any>, require: resolve };
    runInNewContext(output, context);
    return context.exports;
  };
  const sections = load("SettingsSection", require);
  const island = (name: string) => () =>
    createElement("div", { "data-control": name });
  const view = load("SettingsView", (path) => {
    if (path === "./SettingsSection") return sections;
    if (path === "./settings.css") return {};
    if (path === "../docs/reading")
      return { readsFirst: () => false, setReadsFirst: () => {} };
    if (path === "../../lib/theme")
      return { useTheme: () => ["light", () => {}] };
    if (path === "./LayoutSettings")
      return Object.fromEntries(
        [
          "ArrangeSettings",
          "HomeArrangeSettings",
          "ShortcutSettings",
          "StartSettings",
        ].map((name) => [name, island(name)]),
      );
    if (path.startsWith("./")) {
      const name = path.slice(2);
      return { [name]: island(name) };
    }
    return require(path);
  });
  return (
    initialTab: string,
    user: any = { name: "Test person", email: "test@example.test" },
    initialSetting?: { id: string; seq: number },
  ) =>
    renderToStaticMarkup(
      createElement(view.SettingsView, {
        initialTab,
        initialSetting,
        user,
        teams: [],
        busy: false,
        report: () => {},
        onEmailReminders: () => {},
        onAccountDeleted: () => {},
        onOpenStatus: () => {},
        onOpenWhatsNew: () => {},
        onOpenSecurity: () => {},
      }),
    );
}

test("settings search destinations follow all eight categories and retain legacy tags links", () => {
  assert.equal(SETTINGS_CATEGORIES.length, 8);
  assert.equal(new Set(SETTINGS_CATEGORIES.map((value) => value.id)).size, 8);
  const categories = new Set(SETTINGS_CATEGORIES.map((value) => value.id));
  for (const entry of SETTINGS_INDEX)
    assert.ok(categories.has(settingsCategory(entry.tab)));
  assert.equal(settingsCategory("tags"), "planning");
  for (const [id, category] of [
    ["theme", "appearance"],
    ["email-reminders", "notifications"],
    ["two-step", "security"],
    ["passkeys", "security"],
    ["signed-in", "security"],
    ["tags", "planning"],
    ["chat", "notifications"],
    ["import", "privacy"],
    ["chatgpt-models", "ai"],
  ])
    assert.equal(settingById(id)?.tab, category, id);
  assert.equal(searchSettings("ChatGPT connections")[0].id, "chatgpt-models");
  assert.ok(
    !searchSettings("ChatGPT connections", "phone").some(
      (entry) => entry.id === "chatgpt-models",
    ),
  );
});

test("the actual settings layout mounts each control group only in its destination", () => {
  const render = layout();
  const expected: Record<string, string[]> = {
    account: [],
    appearance: [
      "StartSettings",
      "ArrangeSettings",
      "HomeArrangeSettings",
      "ShortcutSettings",
    ],
    planning: ["PlanningSettings", "TagSettings"],
    notifications: ["ChatDelivery"],
    ai: ["ChatgptConnections"],
    connections: ["ConnectionsSettings", "ClipperSettings"],
    security: [
      "TwoFactorSettings",
      "PasskeysSettings",
      "SessionsSettings",
      "DevicesSettings",
    ],
    privacy: ["PrivacySettings", "PortabilitySettings"],
  };
  for (const category of SETTINGS_CATEGORIES) {
    const html = render(category.id);
    const controls = [...html.matchAll(/data-control="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((name) => name !== "SettingsNavigation");
    assert.deepEqual(controls, expected[category.id], category.id);
    assert.match(html, new RegExp(`id="settings-panel-${category.id}"`));
    assert.ok(html.includes(category.label.replace(/&/g, "&amp;")));
    assert.match(html, /aria-label|Search settings/);
    assert.ok(
      !html.includes(" hidden="),
      `${category.id}: primary controls should be visible`,
    );
    assert.ok(
      !/<button\b[^>]*>\s*<h2\b/.test(html),
      "section headings must contain their button",
    );
  }
  assert.match(render("tags"), /id="settings-panel-planning"/);
  assert.match(
    render("account", undefined, { id: "passkeys", seq: 1 }),
    /id="settings-panel-security"/,
  );
  assert.match(
    render("account", undefined, { id: "chatgpt-models", seq: 1 }),
    /id="settings-panel-ai"/,
  );
  assert.match(render("account", null), /Loading account details/);
});

test("actual category handlers select destinations and isolate modal keyboard events", () => {
  const fixture = navigation(false);
  assert.equal(fixture.rail.props.children.length, 8);
  assert.equal(
    fixture.rail.props.children.filter(
      (button: any) => button.props["aria-current"],
    ).length,
    1,
  );
  fixture.opener.props.onClick();
  assert.deepEqual(fixture.states, [true]);
  fixture.rail.props.children
    .find((button: any) => button.key === "privacy")
    .props.onClick();
  assert.deepEqual(fixture.choices, ["privacy"]);
  assert.equal(fixture.states.at(-1), false);
  let stopped = 0;
  let prevented = 0;
  fixture.dialog.props.onKeyDown({
    key: "Escape",
    stopPropagation: () => stopped++,
    preventDefault: () => prevented++,
  });
  assert.equal(stopped, 1);
  assert.equal(prevented, 1);
  fixture.dialog.props.onKeyDown({
    key: "k",
    stopPropagation: () => stopped++,
    preventDefault: () => prevented++,
  });
  assert.equal(
    stopped,
    2,
    "global app shortcuts must not launch behind a modal",
  );
  assert.equal(prevented, 1, "ordinary native key behavior remains available");
  assert.equal(
    fixture.dialog.props["aria-modal"],
    undefined,
    "closed menus must not block other app handlers",
  );
});

test("actual category keyboard navigation wraps and respects Home, End and Tab", () => {
  const fixture = navigation(false);
  const buttons = Array.from({ length: 8 }, () => ({
    focus() {
      fixture.document.activeElement = this;
    },
  }));
  fixture.document.activeElement = buttons[0];
  let prevented = 0;
  const press = (key: string) =>
    fixture.rail.props.onKeyDown({
      key,
      currentTarget: { querySelectorAll: () => buttons },
      preventDefault: () => prevented++,
    });
  press("ArrowUp");
  assert.equal(fixture.document.activeElement, buttons[7]);
  press("ArrowDown");
  assert.equal(fixture.document.activeElement, buttons[0]);
  press("End");
  assert.equal(fixture.document.activeElement, buttons[7]);
  press("Home");
  assert.equal(fixture.document.activeElement, buttons[0]);
  press("Tab");
  assert.equal(prevented, 4);
});

test("actual modal lifecycle focuses the selection and observes its owning pane", () => {
  const fixture = navigation(true);
  let focused = 0;
  let restored = 0;
  const element = {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    querySelector: () => ({ focus: () => focused++ }),
  };
  fixture.refs[0].current = element;
  fixture.refs[1].current = { closest: () => ({}), focus: () => restored++ };
  fixture.effects[0]();
  assert.equal(element.open, true);
  assert.equal(focused, 1);
  assert.equal(fixture.dialog.props["aria-modal"], true);
  const cleanup = fixture.effects[1]() as () => void;
  fixture.resize(760);
  assert.deepEqual(fixture.states, []);
  fixture.resize(761);
  assert.deepEqual(fixture.states, [false]);
  cleanup();
  assert.equal(fixture.disconnected(), true);
  fixture.dialog.props.onClose();
  assert.equal(restored, 1);
  const closed = navigation(false);
  closed.refs[0].current = element;
  closed.effects[0]();
  assert.equal(element.open, false);
});
