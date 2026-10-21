import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as core from "@orbyn/core";

/** Actual ProviderRow closure; physical rendering is verified separately through browser captures. */
function row() {
  const rowStates: any[] = [];
  const pickerStates: any[] = [];
  let states = rowStates;
  const effects: (() => void)[] = [];
  let cursor = 0;
  let calls = 0;
  const hooks = {
    useState(initial: any) {
      const at = cursor++;
      const owner = states;
      if (!(at in owner))
        owner[at] = typeof initial === "function" ? initial() : initial;
      return [
        owner[at],
        (next: any) => {
          owner[at] = typeof next === "function" ? next(owner[at]) : next;
        },
      ];
    },
    useMemo(fn: () => any, _deps: unknown[]) {
      cursor++;
      return fn();
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
  const pickerModule = { exports: {} as any };
  const pickerCode = transformSync(
    readFileSync(
      new URL("../../mobile/src/components/ModelPicker.tsx", import.meta.url),
      "utf8",
    ),
    { loader: "tsx", format: "cjs", jsx: "automatic" },
  ).code;
  const components = new Proxy({}, { get: (_target, key) => String(key) });
  const requireModule = (name: string): any => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "@orbyn/core") return core;
    if (name === "react-native")
      return {
        FlatList: "FlatList",
        Text: "Text",
        TextInput: "TextInput",
        View: "View",
        StyleSheet: { create: (v: any) => v, hairlineWidth: 1 },
      };
    if (name === "../lib/api") return { client };
    if (name === "../lib/session") return { session: { token: "account" } };
    if (name === "../components/ModelPicker")
      return { ModelPicker: "ModelPicker" };
    if (name === "../theme")
      return { colors: {}, fonts: {}, radii: {}, themed: (fn: any) => fn() };
    if (name === "../styles") return { shared: {} };
    return components;
  };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: requireModule,
  });
  vm.runInNewContext(pickerCode, {
    module: pickerModule,
    exports: pickerModule.exports,
    require: requireModule,
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
        states = rowStates;
        cursor = 0;
        tree = module.exports.ProviderRow(props);
        effects.splice(0).forEach((fn) => fn());
      }
      return tree;
    },
    picker(tree: any) {
      const node = nodes(tree, (x) => x.type === "ModelPicker")[0];
      assert.ok(node);
      states = pickerStates;
      cursor = 0;
      return pickerModule.exports.ModelPicker(node.props);
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
const list = (tree: any) => nodes(tree, (x) => x.type === "FlatList")[0];
async function loaded() {
  const r = row();
  const tree = r.render();
  await nodes(tree, (x) => x.props?.label === "Load models")[0].props.onPress();
  return r;
}
function choose(r: ReturnType<typeof row>) {
  const tree = r.picker(r.render());
  nodes(tree, (x) => x.props?.label === "Choose model")[0].props.onPress();
  return r.picker(r.render());
}
test("exact matching late model remains available and selection updates the manual model", async () => {
  const r = await loaded();
  let picker = choose(r);
  assert.equal(list(picker).props.data.length, 250);
  assert.equal(list(picker).props.initialNumToRender, 16);
  assert.equal(list(picker).props.maxToRenderPerBatch, 20);
  input(picker).props.onChangeText("c1-fixture-model-249");
  picker = r.picker(r.render());
  assert.equal(list(picker).props.data.length, 1);
  const selected = list(picker).props.data[0];
  list(picker).props.renderItem({ item: selected }).props.onPress();
  assert.equal(input(r.render()).props.value, selected);
  picker = choose(r);
  const chip = list(picker).props.renderItem({ item: selected });
  assert.equal(chip.props.accessibilityState.checked, true);
  assert.equal(
    r.calls,
    1,
    "search and selection make no extra catalog request",
  );
});
test("partial, case-insensitive and blank picker searches preserve the manual model", async () => {
  const r = await loaded();
  input(r.render()).props.onChangeText("manual-unlisted-model");
  let picker = choose(r);
  input(picker).props.onChangeText("  C1-FIXTURE-MODEL-24 ");
  picker = r.picker(r.render());
  assert.equal(list(picker).props.data.length, 10);
  assert.equal(input(r.render()).props.value, "manual-unlisted-model");
  input(picker).props.onChangeText("no-matching-model");
  picker = r.picker(r.render());
  assert.equal(list(picker).props.data.length, 0);
  assert.equal(
    list(picker).props.ListEmptyComponent.props.children,
    "No matching models.",
  );
  assert.equal(input(r.render()).props.value, "manual-unlisted-model");
  input(picker).props.onChangeText("");
  picker = r.picker(r.render());
  assert.equal(list(picker).props.data.length, 250);
  input(r.render()).props.onChangeText("");
  assert.equal(
    nodes(r.render(), (x) => x.props?.label === "Test connection")[0].props
      .disabled,
    true,
  );
  assert.equal(r.calls, 1);
});
