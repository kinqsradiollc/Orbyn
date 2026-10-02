import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as core from "@orbyn/core";

function fixture(mobile: boolean) {
  const path = mobile
    ? "../../mobile/src/components/HomeCompanions.tsx"
    : "../../desktop/src/features/overview/HomeCompanions.tsx";
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const states: unknown[] = [];
  let index = 0;
  let mounted = false;
  let effect: (() => () => void) | undefined;
  let listener: ((value: unknown) => void) | undefined;
  let resolve: ((value: unknown) => void) | undefined;
  let reads = 0;
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in states)) states[slot] = initial;
      return [
        states[slot],
        (value: unknown) => {
          states[slot] = value;
        },
      ];
    },
    useEffect(callback: () => () => void) {
      if (!mounted) effect = callback;
    },
  };
  const container = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children);
  const modules: Record<string, unknown> = {
    react: hooks,
    "@orbyn/core": core,
    "react-native": { Text: container, View: container },
    "../../lib/api": {
      client: {
        agentSettings(options: unknown) {
          assert.deepEqual(JSON.parse(JSON.stringify(options)), {
            fresh: true,
          });
          reads++;
          return new Promise((done) => {
            resolve = done;
          });
        },
        onAgentSettings(callback: (value: unknown) => void) {
          listener = callback;
          return () => {
            listener = undefined;
          };
        },
      },
    },
    "../../components/Character": {
      Character: ({ name }: { name: string }) =>
        React.createElement("span", null, name),
    },
    "../styles": { shared: {} },
    "../theme": { controls: { tap: 44 } },
    "../motion": { Pressable: container },
  };
  modules["../lib/api"] = modules["../../lib/api"];
  modules["./Character"] = modules["../../components/Character"];
  const exports: Record<string, () => React.ReactElement> = {};
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      require: (name: string) => {
        if (!(name in modules))
          throw new Error(`Unexpected UI dependency ${name}`);
        return modules[name];
      },
      React,
    },
  );
  const render = () => {
    index = 0;
    const tree = exports.HomeCompanions();
    mounted = true;
    return tree;
  };
  const first = render();
  const cleanup = effect!();
  return {
    first,
    render,
    cleanup,
    reads: () => reads,
    update: (value: unknown) => listener!(value),
    resolve: async (value: unknown) => {
      resolve!(value);
      await Promise.resolve();
    },
  };
}
function action(node: React.ReactNode): (() => void) | undefined {
  if (!React.isValidElement(node)) return;
  const props = node.props as {
    onClick?: () => void;
    onPress?: () => void;
    children?: React.ReactNode;
  };
  return (
    props.onClick ??
    props.onPress ??
    React.Children.toArray(props.children).map(action).find(Boolean)
  );
}
for (const mobile of [false, true]) {
  const platform = mobile ? "native" : "web";
  test(`${platform} Home browses every preset without changing settings`, () => {
    const view = fixture(mobile);
    assert.doesNotMatch(renderToStaticMarkup(view.first), /Cozy bunny/);
    action(view.first)!();
    const html = renderToStaticMarkup(view.render());
    for (const preset of core.CHARACTER_PRESETS)
      assert.ok(html.includes(preset.name), preset.name);
    assert.equal(view.reads(), 1);
    view.cleanup();
  });
  test(`${platform} Home keeps a live character edit over a stale initial response`, async () => {
    const view = fixture(mobile);
    view.update({
      name: "Current companion",
      character: core.DEFAULT_CHARACTER,
    });
    await view.resolve({
      name: "Stale companion",
      character: core.DEFAULT_CHARACTER,
    });
    const html = renderToStaticMarkup(view.render());
    assert.match(html, /Current companion/);
    assert.doesNotMatch(html, /Stale companion/);
    view.cleanup();
  });
  test(`${platform} closing Home fences a late companion response`, async () => {
    const view = fixture(mobile);
    view.cleanup();
    await view.resolve({
      name: "Closed account",
      character: core.DEFAULT_CHARACTER,
    });
    assert.doesNotMatch(renderToStaticMarkup(view.render()), /Closed account/);
  });
}
