import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as core from "@orbyn/core";

/** Actual ProviderRow closure; physical rendering is verified separately through browser captures. */
function row() {
  const states: any[] = [];
  const effects: (() => void)[] = [];
  let cursor = 0;
  let calls = 0;
  const hooks = {
    useState(initial: any) {
      const at = cursor++;
      if (!(at in states))
        states[at] = typeof initial === "function" ? initial() : initial;
      return [
        states[at],
        (next: any) => {
          states[at] = typeof next === "function" ? next(states[at]) : next;
        },
      ];
    },
    useRef(initial: any) {
      const at = cursor++;
      return states[at] ?? (states[at] = { current: initial });
    },
    useEffect(fn: () => void, deps: unknown[]) {
      const at = cursor++;
      if (!states[at] || deps.some((v, i) => !Object.is(v, states[at][i]))) {
        states[at] = deps;
        effects.push(fn);
      }
    },
  };
  const jsx = (type: unknown, props: any) => ({ type, props });
  const catalog = Array.from(
    { length: 250 },
    (_, i) => `c1-fixture-model-${String(i).padStart(3, "0")}`,
  );
  const client = {
    listAiModels: async () => {
      calls++;
      return { models: catalog };
    },
  };
  const module = { exports: {} as any };
  const source =
    readFileSync(
      new URL("../../mobile/src/screens/AdminAi.tsx", import.meta.url),
      "utf8",
    ) + "\nexport {ProviderRow};";
  const code = transformSync(source, {
    loader: "tsx",
    format: "cjs",
    jsx: "automatic",
  }).code;
  const components = new Proxy({}, { get: (_target, key) => String(key) });
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(name: string) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@orbyn/core") return core;
      if (name === "react-native")
        return {
          Text: "Text",
          TextInput: "TextInput",
          View: "View",
          StyleSheet: { create: (v: any) => v, hairlineWidth: 1 },
        };
      if (name === "../lib/api") return { client };
      if (name === "../theme")
        return { colors: {}, fonts: {}, radii: {}, themed: (fn: any) => fn() };
      if (name === "../styles") return { shared: {} };
      return components;
    },
  });
  const props = {
    provider: {
      id: "fixture",
      name: "Inert fixture",
      kind: "lmstudio",
      enabled: true,
      has_key: false,
      options: {},
      updated_at: "2026-10-08T00:00:00.000Z",
      controls_revision: "1",
    },
    active: false,
    activeModel: "",
    expanded: true,
    busy: false,
    act: async (fn: any) => fn(),
    onToggle() {},
    onEnabled() {},
    onUse() {
      throw Error("Search must not save selection");
    },
    onEdit() {},
    onControlsSaved() {},
    onDelete() {},
  };
  return {
    render() {
      let tree: any;
      for (let i = 0; i < 3; i++) {
        cursor = 0;
        tree = module.exports.ProviderRow(props);
        effects.splice(0).forEach((fn) => fn());
      }
      return tree;
    },
    get calls() {
      return calls;
    },
  };
}
function nodes(tree: any, predicate: (x: any) => boolean): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((x) => nodes(x, predicate));
  return [
    ...(predicate(tree) ? [tree] : []),
    ...nodes(tree.props?.children, predicate),
  ];
}
const input = (tree: any) => nodes(tree, (x) => x.type === "TextInput")[0];
const chips = (tree: any) =>
  nodes(tree, (x) => x.props?.accessibilityRole === "radio");
const texts = (tree: any) =>
  nodes(tree, (x) => x.type === "Text")
    .flatMap((x) => x.props.children)
    .filter((x) => typeof x === "string")
    .join(" ");
async function loaded() {
  const r = row();
  const tree = r.render();
  await nodes(tree, (x) => x.props?.label === "Load models")[0].props.onPress();
  return r;
}
test("exact matching late model remains visible and selected instead of resetting to first chips", async () => {
  const r = await loaded();
  let tree = r.render();
  assert.equal(chips(tree).length, 40);
  input(tree).props.onChangeText("c1-fixture-model-249");
  tree = r.render();
  assert.equal(chips(tree).length, 1);
  assert.equal(chips(tree)[0].props.accessibilityState.checked, true);
  assert.match(texts(tree), /c1-fixture-model-249/);
  assert.equal(r.calls, 1, "typing makes no extra catalog request");
});
test("partial, case-insensitive and blank queries retain bounded catalog/manual values", async () => {
  const r = await loaded();
  let tree = r.render();
  input(tree).props.onChangeText("  C1-FIXTURE-MODEL-24 ");
  tree = r.render();
  assert.equal(chips(tree).length, 10);
  input(tree).props.onChangeText("manual-unlisted-model");
  tree = r.render();
  assert.equal(chips(tree).length, 0);
  assert.equal(input(tree).props.value, "manual-unlisted-model");
  assert.match(texts(tree), /No matching models/);
  input(tree).props.onChangeText("");
  tree = r.render();
  assert.equal(chips(tree).length, 40);
  assert.equal(
    nodes(tree, (x) => x.props?.label === "Test connection")[0].props.disabled,
    true,
  );
  assert.equal(r.calls, 1);
});
