import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as core from "@orbyn/core";
const require = createRequire(import.meta.url),
  mobileRequire = createRequire(
    new URL("../../mobile/package.json", import.meta.url),
  );
test("mounted task import retries the failed response with the same key and retained preview/input", async () => {
  const { JSDOM } = mobileRequire("jsdom"),
    React = require("react");
  const dom = new JSDOM('<body><div id="root"></div></body>', {
    url: "http://127.0.0.1",
  });
  const names = [
    "window",
    "document",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const saved = names.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name],
    });
  const { createRoot } = require("react-dom/client");
  const root = createRoot(dom.window.document.querySelector("#root"));
  const summary = {
    created: 1,
    skipped: 0,
    lists_added: 0,
    tags_added: 0,
    sample: ["Task"],
    errors: [],
  };
  const keys: string[] = [],
    reports: unknown[] = [];
  let attempt!: () => void;
  const first = new Promise<void>((resolve) => (attempt = resolve));
  let retried!: () => void;
  const second = new Promise<void>((resolve) => (retried = resolve));
  const client = {
    importData: async () => summary,
    once: async (key: string, run: () => Promise<unknown>) => {
      keys.push(key);
      if (keys.length === 1) {
        attempt();
        throw Error("response lost");
      }
      const result = await run();
      retried();
      return result;
    },
  };
  const wrapper = ({ children }: any) =>
    React.createElement("div", null, children);
  const dependencies: any = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "lucide-react": {
      Archive: () => null,
      Download: () => null,
      Upload: () => null,
    },
    "@orbyn/core": core,
    "../../lib/api": { client },
    "../../lib/session": { session: { get: () => "same-account" } },
    "./SettingsSection": { SettingsSection: wrapper },
    "./SettingsEditor": { SettingsEditor: wrapper },
    "../../components/Select": { Select: () => null },
    "../../components/FilePicker": {
      FilePicker: ({ onFile }: any) =>
        React.createElement(
          "button",
          {
            onClick: () =>
              onFile({ name: "tasks.csv", text: async () => "title\nTask" }),
          },
          "Choose fixture",
        ),
    },
    "../../components/Outcome": {
      OutcomeNote: () => null,
      useAction: (report: (e: unknown) => void) => ({
        pending: false,
        outcome: null,
        setOutcome: () => {},
        run: async (fn: () => Promise<unknown>) => {
          try {
            return await fn();
          } catch (e) {
            report(e);
          }
        },
      }),
    },
  };
  const module = { exports: {} as any };
  runInNewContext(
    transformSync(
      readFileSync(
        new URL(
          "../../desktop/src/features/settings/PortabilitySettings.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      { loader: "tsx", format: "cjs", jsx: "automatic" },
    ).code,
    {
      module,
      exports: module.exports,
      TextEncoder,
      Uint8Array,
      crypto: webcrypto,
      require: (name: string) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
    },
  );
  const button = (name: string) =>
    [...dom.window.document.querySelectorAll("button")].find(
      (node: any) => node.textContent.trim() === name,
    ) as HTMLButtonElement;
  try {
    await React.act(() =>
      root.render(
        React.createElement(module.exports.PortabilitySettings, {
          report: (e: unknown) => reports.push(e),
        }),
      ),
    );
    await React.act(() => button("Import tasks").click());
    await React.act(async () => {
      button("Choose fixture").click();
    });
    await React.act(async () => {
      button("Preview").click();
    });
    const commit = [...dom.window.document.querySelectorAll("button")].find(
      (node: any) => /Import 1/.test(node.textContent),
    ) as HTMLButtonElement;
    assert.ok(commit, "the actual component offers its previewed import");
    await React.act(async () => {
      commit.click();
      await first;
    });
    assert.equal(reports.length, 1);
    assert.ok(button("Choose fixture"));
    assert.ok(
      dom.window.document.querySelector("textarea")!.value.includes("Task"),
    );
    await React.act(async () => {
      commit.click();
      await second;
    });
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.equal(dom.window.document.querySelector("textarea")!.value, "");
  } finally {
    await React.act(() => root.unmount());
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
    dom.window.close();
  }
});
