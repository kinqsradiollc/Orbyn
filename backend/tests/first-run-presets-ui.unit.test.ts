import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import {
  firstRunInput,
  withWorkspacePresets,
  workspacePresetChoice,
} from "@orbyn/core";
import * as core from "@orbyn/core";
const require = createRequire(import.meta.url),
  mobileRequire = createRequire(
    new URL("../../mobile/package.json", import.meta.url),
  );

test("preset choices are optional and merging is reversible without replacing custom pins or layout", () => {
  assert.equal(
    firstRunInput.parse({ purpose: "personal" }).workspace_presets,
    undefined,
  );
  assert.equal(
    workspacePresetChoice.safeParse({
      selected: ["engineer", "engineer"],
      expected: [],
    }).success,
    false,
  );
  const original = {
    layout: "custom",
    group: "mine",
    pins: ["private", "student"],
  };
  const both = withWorkspacePresets(original, ["student", "engineer"]);
  assert.deepEqual(both, {
    ...original,
    pins: ["private", "engineer", "student"],
  });
  assert.deepEqual(withWorkspacePresets(both, []), {
    ...original,
    pins: ["private"],
  });
  assert.deepEqual(original.pins, ["private", "student"]);
});

async function fixture(platform: "desktop" | "mobile", stale = false) {
  const { JSDOM } = mobileRequire("jsdom"),
    dom = new JSDOM('<div id="root"></div>', { url: "http://fixture.invalid" });
  const globals = [
    "window",
    "document",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
    "fetch",
  ];
  const saved = globals.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  let network = 0,
    reads = 0;
  for (const name of globals)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value:
        name === "IS_REACT_ACT_ENVIRONMENT"
          ? true
          : name === "fetch"
            ? () => {
                network++;
                throw new Error("No network in first-run UI fixture");
              }
            : dom.window[name],
    });
  const React = require("react"),
    root = require("react-dom/client").createRoot(
      dom.window.document.querySelector("#root"),
    );
  const user = { id: "synthetic-user", name: "Fixture" },
    commands: any[] = [],
    completed: unknown[] = [];
  const button = ({
    children,
    onPress,
    disabled,
    title,
    accessibilityRole,
    accessibilityState,
  }: any) =>
    React.createElement(
      "button",
      {
        disabled,
        onClick: onPress,
        role: accessibilityRole,
        "aria-checked":
          accessibilityState?.checked ?? accessibilityState?.selected,
      },
      title ?? children,
    );
  const box = ({ children }: any) => React.createElement("div", null, children);
  const text = ({ children, accessibilityRole }: any) =>
    React.createElement(
      "span",
      { role: accessibilityRole === "alert" ? "alert" : undefined },
      children,
    );
  const module = { exports: {} as any };
  const path =
    platform === "desktop"
      ? "../../desktop/src/features/firstrun/FirstRun.tsx"
      : "../../mobile/src/features/firstrun/FirstRunSheet.tsx";
  runInNewContext(
    transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
      loader: "tsx",
      format: "cjs",
      jsx: "automatic",
    }).code,
    {
      module,
      exports: module.exports,
      require: (name: string) => {
        if (name === "@orbyn/core") return core;
        if (["react", "react/jsx-runtime", "lucide-react"].includes(name))
          return require(name);
        if (name.endsWith("/session"))
          return {
            session: {
              token: "synthetic-session",
              get: () => "synthetic-session",
            },
          };
        if (name.endsWith("/api"))
          return {
            client: {
              getPrefs: async () => ({
                views: { workspace: { pins: ++reads > 1 ? ["student"] : [] } },
              }),
              finishFirstRun: async (input: unknown) => {
                commands.push(input);
                if (stale && commands.length === 1)
                  throw new Error(
                    "Workspace presets changed. Reload the choices before finishing setup.",
                  );
                return {
                  user,
                  project_id: null,
                  brief_id: null,
                  team_id: null,
                };
              },
              createCalendarSubscription: () =>
                assert.fail(
                  "Skipping calendar setup must not fetch a calendar",
                ),
            },
          };
        if (name.endsWith("/errors"))
          return { errorText: (error: Error) => error.message };
        if (name.endsWith("/useModalFocus"))
          return {
            useModalFocus: () => ({
              id: "fixture-modal",
              ref: React.useRef(null),
            }),
          };
        if (name.endsWith(".css")) return {};
        if (name === "react-native")
          return {
            View: box,
            Text: text,
            ScrollView: box,
            StyleSheet: { create: (value: unknown) => value },
            TextInput: ({
              value,
              onChangeText,
              placeholder,
              editable,
              accessibilityLabel,
            }: any) =>
              React.createElement("input", {
                value,
                placeholder,
                disabled: editable === false,
                "aria-label": accessibilityLabel,
                onChange: (event: any) => onChangeText(event.target.value),
              }),
          };
        if (name.endsWith("/motion")) return { Pressable: button };
        if (name.endsWith("/Button")) return { Button: button };
        if (name.endsWith("/Switch"))
          return {
            Switch: ({
              value,
              onValueChange,
              accessibilityLabel,
              disabled,
            }: any) =>
              React.createElement("input", {
                type: "checkbox",
                checked: value,
                disabled,
                "aria-label": accessibilityLabel,
                onChange: (event: any) => onValueChange(event.target.checked),
              }),
          };
        if (name.endsWith("/Sheet")) return { Sheet: box, sheetStyles: {} };
        if (name.endsWith("/Icon")) return { Icon: () => null };
        if (name.endsWith("/styles")) return { shared: {} };
        if (name.endsWith("/theme"))
          return {
            colors: {},
            fonts: {},
            radii: {},
            themed: (fn: () => unknown) => fn(),
          };
        throw new Error(`Unexpected first-run dependency: ${name}`);
      },
    },
  );
  const click = async (label: string) => {
    const target = [...dom.window.document.querySelectorAll("button")].find(
      (element: any) =>
        element.textContent.trim() === label ||
        element.textContent.trim().startsWith(label),
    );
    assert.ok(target, `Missing ${platform} button: ${label}`);
    await React.act(async () => target.click());
  };
  const toggle = async (label: string) => {
    const target = [
      ...dom.window.document.querySelectorAll('input[type="checkbox"]'),
    ].find((element: any) =>
      (element.getAttribute("aria-label") ?? element.parentElement.textContent)
        .trim()
        .startsWith(label),
    );
    assert.ok(target, `Missing ${platform} switch: ${label}`);
    await React.act(async () => target.click());
  };
  await React.act(async () =>
    root.render(
      React.createElement(
        module.exports[platform === "desktop" ? "FirstRun" : "FirstRunSheet"],
        {
          user,
          visible: true,
          onDone: (...args: unknown[]) => completed.push(args),
        },
      ),
    ),
  );
  return {
    dom,
    React,
    commands,
    completed,
    click,
    toggle,
    reads: () => reads,
    close: async () => {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      assert.equal(network, 0);
    },
  };
}

for (const platform of ["desktop", "mobile"] as const) {
  test(`${platform} first-run leaves presets untouched unless explicitly enabled`, async () => {
    const f = await fixture(platform);
    try {
      await f.click("Next");
      await f.click("Skip this");
      await f.click("Create starter");
      assert.equal(f.reads(), 0);
      assert.equal(f.commands.length, 1);
      assert.equal(Object.hasOwn(f.commands[0], "workspace_presets"), false);
      assert.equal(f.completed.length, 1);
    } finally {
      await f.close();
    }
  });
  test(`${platform} first-run reviews both presets and reloads stale choices without losing starter mode or team name`, async () => {
    const f = await fixture(platform, true);
    try {
      await f.toggle("Choose workspace presets");
      await f.toggle("Engineer");
      await f.toggle("Student");
      await f.click("Team");
      await f.click("Next");
      await f.click("Skip this");
      const input = f.dom.window.document.querySelector(
        'input[placeholder*="team"]',
      );
      assert.ok(input);
      await f.React.act(async () => {
        Object.getOwnPropertyDescriptor(
          f.dom.window.HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, "Authored studio");
        input.dispatchEvent(new f.dom.window.Event("input", { bubbles: true }));
      });
      await f.click("Create starter");
      assert.equal(f.commands.length, 1);
      assert.equal(f.completed.length, 0);
      assert.equal(f.commands[0].team_name, "Authored studio");
      assert.match(
        f.dom.window.document.querySelector('[role="alert"]').textContent,
        /Workspace presets changed/,
      );
      await f.click("Reload workspace choices");
      await f.click("Back");
      await f.click("Back");
      await f.toggle("Engineer");
      await f.click("Next");
      await f.click("Skip this");
      await f.click("Create starter");
      assert.equal(f.commands.length, 2);
      assert.equal(f.commands[1].purpose, "team");
      assert.equal(f.commands[1].starter, "sprint");
      assert.equal(f.commands[1].team_name, "Authored studio");
      assert.deepEqual([...f.commands[1].workspace_presets.selected].sort(), [
        "engineer",
        "student",
      ]);
      assert.deepEqual(
        [...f.commands[1].workspace_presets.expected],
        ["student"],
      );
      assert.equal(f.completed.length, 1);
    } finally {
      await f.close();
    }
  });
}
