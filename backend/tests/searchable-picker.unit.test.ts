import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as core from "@orbyn/core";

// Run the actual component closures with deterministic hooks. Geometry, focus
// trapping and native rendering are separate browser/native acceptance gates.
function renderer(
  file: string,
  exportName: string,
  extra: Record<string, unknown> = {},
) {
  const states: any[] = [];
  const effects: (() => void)[] = [];
  let cursor = 0;
  let focuses = 0;
  const dom = {
    focus: () => focuses++,
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 40, width: 300 }),
    offsetHeight: 100,
    contains: () => false,
  };
  const jsx = (type: unknown, props: any) => ({ type, props });
  const array = (x: any) =>
    x == null ? [] : Array.isArray(x) ? x.flat(Infinity) : [x];
  const hooks = {
    Children: {
      forEach: (children: any, fn: any) => array(children).forEach(fn),
      toArray: array,
    },
    isValidElement: (x: any) => !!x && typeof x === "object" && "type" in x,
    useId: () => {
      cursor++;
      return "fixture-list";
    },
    useState: (initial: any) => {
      const i = cursor++;
      if (!(i in states))
        states[i] = typeof initial === "function" ? initial() : initial;
      return [
        states[i],
        (next: any) => {
          states[i] = typeof next === "function" ? next(states[i]) : next;
        },
      ];
    },
    useRef: (initial: any) => {
      const i = cursor++;
      return states[i] ?? (states[i] = { current: initial ?? dom });
    },
    useEffect: (fn: any, deps: any[]) => {
      const i = cursor++;
      const prev = states[i];
      if (!prev || deps.some((x, n) => !Object.is(x, prev[n]))) {
        states[i] = deps;
        effects.push(fn);
      }
    },
    useLayoutEffect: () => {
      cursor++;
    },
  };
  const dependencies: any = {
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-dom": { createPortal: (x: any) => x },
    "lucide-react": { Check: "Check", ChevronDown: "ChevronDown" },
    "@orbyn/core": core,
    ...extra,
  };
  const module: { exports: any } = { exports: {} };
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const code = transformSync(source, {
    loader: "tsx",
    format: "cjs",
    jsx: "automatic",
  }).code;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `unexpected dependency ${name}`);
      return dependencies[name];
    },
    document: { body: {}, addEventListener() {}, removeEventListener() {} },
    window: {
      innerWidth: 390,
      innerHeight: 844,
      addEventListener() {},
      removeEventListener() {},
    },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    Date,
  });
  let props: any;
  let tree: any;
  return {
    render(next: any) {
      props = next;
      for (let pass = 0; pass < 3; pass++) {
        cursor = 0;
        tree = module.exports[exportName](props);
        effects.splice(0).forEach((fn) => fn());
      }
      return tree;
    },
    get focuses() {
      return focuses;
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
const option = (value: string, disabled = false) => ({
  type: "option",
  props: { value, children: value, disabled },
});
const key = (value: string) => ({
  key: value,
  preventDefault() {},
  stopPropagation() {},
  metaKey: false,
  ctrlKey: false,
});
const web = () => renderer("../../desktop/src/components/Select.tsx", "Select");
const trigger = (tree: any) => nodes(tree, (x) => x.type === "button")[0];
const search = (tree: any) =>
  nodes(
    tree,
    (x) => x.type === "input" && x.props.placeholder === "Search…",
  )[0];
const options = (tree: any) => nodes(tree, (x) => x.props?.role === "option");

test("choice search preserves identity, order, disabled flags and full values", () => {
  const original = [
    { value: "one", label: "OpenAI", disabled: true, searchText: "Cloud" },
    { value: "two", label: "Mistral", disabled: false, searchText: "Cloud" },
  ];
  assert.deepEqual(core.filterChoices(original, "  CLOUD mistral "), [
    original[1],
  ]);
  assert.equal(core.filterChoices(original, "openai")[0], original[0]);
  assert.equal(core.filterChoices(original, "nothing").length, 0);
  assert.deepEqual(core.filterChoices(original, ""), original);
});
test("actual web picker bounds a 5000-model catalog and search never changes the saved value", () => {
  const r = web();
  const changes: string[] = [];
  const props = {
    value: "model-4999",
    searchable: true,
    "aria-label": "Models",
    children: Array.from({ length: 5000 }, (_, i) => option(`model-${i}`)),
    onChange: (e: any) => changes.push(e.target.value),
  };
  let tree = r.render(props);
  trigger(tree).props.onClick();
  tree = r.render(props);
  assert.equal(options(tree).length, 100);
  assert.ok(options(tree).some((x) => x.props["aria-selected"]));
  search(tree).props.onChange({ target: { value: "4998" } });
  tree = r.render(props);
  assert.equal(options(tree).length, 1);
  assert.equal(changes.length, 0);
  assert.equal(trigger(tree).props.children[0].props.children, "model-4999");
  options(tree)[0].props.onClick();
  assert.deepEqual(changes, ["model-4998"]);
  assert.ok(r.focuses > 0);
});
test("actual search keyboard keeps spaces, chooses a filtered result and closes on Escape", () => {
  const r = web();
  const changes: string[] = [];
  const props = {
    value: "first",
    searchable: true,
    children: [option("first"), option("cloud model")],
    onChange: (e: any) => changes.push(e.target.value),
  };
  let tree = r.render(props);
  trigger(tree).props.onClick();
  tree = r.render(props);
  search(tree).props.onChange({ target: { value: "cloud" } });
  tree = r.render(props);
  search(tree).props.onKeyDown(key(" "));
  assert.equal(changes.length, 0);
  search(tree).props.onKeyDown(key("Enter"));
  assert.deepEqual(changes, ["cloud model"]);
  tree = r.render(props);
  assert.equal(options(tree).length, 0);
  trigger(tree).props.onClick();
  tree = r.render(props);
  search(tree).props.onKeyDown(key("Escape"));
  tree = r.render(props);
  assert.equal(options(tree).length, 0);
  assert.ok(r.focuses > 0);
});
test("actual web picker closes when disabled and cannot call change", () => {
  const r = web();
  let changes = 0;
  const props = {
    value: "one",
    searchable: true,
    children: [option("one"), option("two")],
    onChange: () => changes++,
  };
  let tree = r.render(props);
  trigger(tree).props.onClick();
  tree = r.render({ ...props, disabled: true });
  assert.equal(options(tree).length, 0);
  trigger(tree).props.onKeyDown(key("Enter"));
  assert.equal(changes, 0);
});
test("actual web picker empty search remains keyboard safe", () => {
  const r = web();
  let changes = 0;
  const props = {
    value: "one",
    searchable: true,
    children: [option("one")],
    onChange: () => changes++,
  };
  let tree = r.render(props);
  trigger(tree).props.onClick();
  tree = r.render(props);
  search(tree).props.onChange({ target: { value: "absent" } });
  tree = r.render(props);
  assert.equal(options(tree).length, 0);
  search(tree).props.onKeyDown(key("ArrowDown"));
  search(tree).props.onKeyDown(key("Enter"));
  assert.equal(changes, 0);
});
test("ordinary Select still supports full-catalog typeahead without a search input", () => {
  const r = web();
  let selected = "";
  const props = {
    value: "one",
    children: [option("one"), option("two")],
    onChange: (e: any) => (selected = e.target.value),
  };
  const tree = r.render(props);
  trigger(tree).props.onKeyDown(key("t"));
  assert.equal(selected, "two");
  assert.equal(search(tree), undefined);
});
test("Home and End skip disabled options and Tab restores trigger focus", () => {
  const r = web();
  const changes: string[] = [];
  const props = {
    searchable: true,
    value: "first",
    children: [option("disabled", true), option("first"), option("last")],
    onChange: (e: any) => changes.push(e.target.value),
  };
  let tree = r.render(props);
  trigger(tree).props.onClick();
  tree = r.render(props);
  trigger(tree).props.onKeyDown(key("End"));
  tree = r.render(props);
  trigger(tree).props.onKeyDown(key("Enter"));
  assert.deepEqual(changes, ["last"]);
  tree = r.render(props);
  trigger(tree).props.onClick();
  tree = r.render(props);
  trigger(tree).props.onKeyDown(key("Home"));
  tree = r.render(props);
  assert.equal(
    options(tree).find((x) => x.props["data-active"])?.props["aria-disabled"],
    false,
  );
  const before = r.focuses;
  search(tree).props.onKeyDown(key("Tab"));
  tree = r.render(props);
  assert.ok(r.focuses > before);
  assert.equal(search(tree), undefined);
});
test("a disabled result never changes the saved model", () => {
  const r = web();
  let changes = 0;
  const props = {
    searchable: true,
    children: [option("unavailable", true)],
    onChange: () => changes++,
  };
  let tree = r.render(props);
  trigger(tree).props.onClick();
  tree = r.render(props);
  options(tree)[0].props.onClick();
  search(tree).props.onKeyDown(key("Enter"));
  assert.equal(changes, 0);
});
const mobile = () =>
  renderer("../../mobile/src/components/ProviderPicker.tsx", "ProviderPicker", {
    "react-native": {
      FlatList: "FlatList",
      Text: "Text",
      TextInput: "TextInput",
      View: "View",
      StyleSheet: { create: (x: any) => x, hairlineWidth: 1 },
    },
    "../motion": { Pressable: "Pressable" },
    "../styles": { shared: { input: {}, body: {}, small: {} } },
    "../theme": {
      colors: {
        text: "text",
        textSoft: "soft",
        faint: "faint",
        accent: "accent",
        border: "border",
      },
      controls: { tap: 44 },
      fonts: { medium: "medium" },
      themed: (fn: any) => fn(),
    },
    "./Icon": { Icon: "Icon" },
    "./Sheet": { Sheet: "Sheet" },
  });
test("actual mobile provider search is separate from the saved kind and selection changes once", () => {
  const r = mobile();
  const changes: string[] = [];
  const props = {
    value: "openai",
    onChange: (kind: string) => changes.push(kind),
  };
  let tree = r.render(props);
  nodes(tree, (x) => x.type === "Pressable")[0].props.onPress();
  tree = r.render(props);
  assert.equal(nodes(tree, (x) => x.type === "Sheet")[0].props.visible, true);
  nodes(tree, (x) => x.type === "TextInput")[0].props.onChangeText(
    "perplexity",
  );
  tree = r.render(props);
  const list = nodes(tree, (x) => x.type === "FlatList")[0];
  assert.equal(list.props.data.length, 1);
  assert.equal(list.props.data[0].value, "perplexity");
  assert.equal(changes.length, 0);
  list.props.renderItem({ item: list.props.data[0] }).props.onPress();
  assert.deepEqual(changes, ["perplexity"]);
  tree = r.render(props);
  assert.equal(nodes(tree, (x) => x.type === "Sheet")[0].props.visible, false);
});
test("actual mobile provider picker closes and rejects selection while busy", () => {
  const r = mobile();
  let changes = 0;
  const props = { value: "openai", onChange: () => changes++ };
  let tree = r.render(props);
  nodes(tree, (x) => x.type === "Pressable")[0].props.onPress();
  tree = r.render({ ...props, disabled: true });
  assert.equal(nodes(tree, (x) => x.type === "Sheet")[0].props.visible, false);
  const list = nodes(tree, (x) => x.type === "FlatList")[0];
  list.props.renderItem({ item: list.props.data[0] }).props.onPress();
  assert.equal(changes, 0);
});
test("mobile picker preserves visibility policy and a saved hidden provider", () => {
  const hidden = core.AI_PROVIDER_KINDS.find(
    (kind) => !core.AI_PROVIDERS[kind].pickerVisible,
  );
  assert.ok(hidden);
  const r = mobile();
  let tree = r.render({ value: "openai", onChange() {} });
  let list = nodes(tree, (x) => x.type === "FlatList")[0];
  assert.ok(!list.props.data.some((x: any) => x.value === hidden));
  tree = r.render({ value: hidden, onChange() {} });
  list = nodes(tree, (x) => x.type === "FlatList")[0];
  assert.ok(list.props.data.some((x: any) => x.value === hidden));
});
