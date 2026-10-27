import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const source = readFileSync(
  new URL("../../desktop/src/app/chrome/WorkspaceDock.tsx", import.meta.url),
  "utf8",
);
function fixture(saved: string | null = null) {
  const exports: any = {},
    states: any[] = [],
    refs: any[] = [],
    writes: any[] = [];
  class Element {}
  const effects: (() => any)[] = [];
  const listeners = new Map<string, Function>();
  const doc: any = {
    activeElement: null,
    getElementById: () => ({ focus() {} }),
    addEventListener: (name: string, fn: Function) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  let state = 0,
    ref = 0;
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      require: (name: string) =>
        name === "react"
          ? {
              useState: (initial: any) => {
                const i = state++;
                if (!(i in states))
                  states[i] =
                    typeof initial === "function" ? initial() : initial;
                return [states[i], (next: any) => (states[i] = next)];
              },
              useRef: (initial: any) => {
                const i = ref++;
                return (refs[i] ??= { current: initial });
              },
              useEffect: (effect: () => any) => effects.push(effect),
              useId: () => "dock-test",
            }
          : name === "react/jsx-runtime"
            ? require(name)
            : name === "lucide-react"
              ? { X: () => null }
              : { hasHigherDialog: () => false },
      localStorage: {
        getItem: () => saved,
        setItem: (...args: any[]) => writes.push(args),
      },
      document: doc,
      HTMLElement: Element,
    },
  );
  return {
    exports,
    Element,
    effects,
    refs,
    doc,
    listeners,
    states,
    writes,
    render: (props: any) => {
      state = ref = 0;
      effects.length = 0;
      return exports.WorkspaceDock(props);
    },
  };
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const tabs = [
  { id: "notifications", title: "Notifications", content: "updates" },
  { id: "object/a", title: "Object", content: "draft" },
];
function props() {
  const selected: string[] = [],
    closed: string[] = [];
  return {
    tabs,
    activeId: tabs[0].id,
    onSelect: (id: string) => selected.push(id),
    onCloseTab: (id: string) => closed.push(id),
    selected,
    closed,
  };
}
test("dock width defaults, persisted validation, scope fitting preserve preference", () => {
  for (const [saved, expected] of [
    [null, 400],
    ["600", 600],
    ["0", 400],
    ["900", 400],
    ["NaN", 400],
  ])
    assert.equal(fixture(saved as any).exports.savedDockWidth(), expected);
  const api = fixture().exports;
  assert.equal(api.dockMaximum(900), 420);
  assert.equal(api.dockMaximum(1600), 720);
  assert.equal(api.boundedDockWidth(600, 420), 420);
  assert.equal(api.boundedDockWidth(100), 280);
});
test("tab navigation selects with arrows and Home/End; tab content remains mounted hidden and inert", () => {
  const f = fixture(),
    p = props();
  let tree = f.render(p);
  const all = nodes(tree),
    buttons = all.filter((n) => n.props?.role === "tab"),
    panels = all.filter((n) => n.props?.role === "tabpanel");
  assert.equal(tree.props.role, "complementary");
  assert.equal(tree.props["aria-modal"], undefined);
  assert.equal(panels.length, 2);
  assert.equal(panels[1].props.children, "draft");
  assert.equal(panels[1].props.hidden, true);
  assert.equal(panels[1].props.inert, true);
  assert.equal(buttons[1].props["aria-controls"], panels[1].props.id);
  for (const key of ["ArrowLeft", "Home", "End", "ArrowRight"])
    buttons[0].props.onKeyDown({ key, preventDefault() {} });
  assert.deepEqual(p.selected, [
    "object/a",
    "notifications",
    "object/a",
    "object/a",
  ]);
  const close = all.find((n) => n.props?.["aria-label"] === "Close Object");
  close.props.onClick();
  assert.deepEqual(p.closed, ["object/a"]);
  assert.ok(!nodes(buttons[0].props.children).some((n) => n.type === "button"));
  tree = f.render({ ...p, activeId: "object/a" });
  assert.equal(
    nodes(tree).find((n) => n.props?.role === "tabpanel").props.hidden,
    true,
  );
});
test("resize is keyboard bounded and remembers only completed pointer operations; cancel restores", () => {
  const f = fixture(),
    p = props();
  let edge = nodes(f.render(p)).find(
    (n) => n.props?.role === "separator",
  ).props;
  edge.onKeyDown({ key: "ArrowLeft", preventDefault() {} });
  assert.equal(f.states[0], 410);
  assert.equal(f.writes.length, 1);
  edge = nodes(f.render(p)).find((n) => n.props?.role === "separator").props;
  const target = {
    focus() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture() {
      return true;
    },
  };
  edge.onPointerDown({
    button: 0,
    pointerId: 1,
    clientX: 500,
    currentTarget: target,
    preventDefault() {},
  });
  edge.onPointerMove({ pointerId: 1, clientX: 450 });
  assert.equal(f.states[0], 460);
  edge.onPointerCancel();
  assert.equal(f.states[0], 410);
  assert.equal(f.writes.length, 1);
  edge.onPointerDown({
    button: 0,
    pointerId: 2,
    clientX: 500,
    currentTarget: target,
    preventDefault() {},
  });
  edge.onPointerUp({ pointerId: 2, clientX: 400, currentTarget: target });
  assert.equal(f.states[0], 510);
  assert.equal(f.writes.length, 2);
});
test("overlay keeps same panels and only overlay owns modal focus behavior", () => {
  const f = fixture(),
    p = props();
  f.render(p);
  f.states[1] = 600;
  const tree = f.render(p);
  assert.equal(tree.props.role, "dialog");
  assert.equal(tree.props["aria-modal"], true);
  assert.equal(
    nodes(tree).filter((n) => n.props?.role === "tabpanel").length,
    2,
  );
  assert.equal(
    nodes(tree).find((n) => n.props?.role === "separator"),
    undefined,
  );
  assert.match(source, /if \(!open \|\| !overlay \|\| !tabs.length\) return/);
  assert.match(source, /hasHigherDialog\(panel\)/);
  assert.match(source, /opener\.focus/);
});

test("closing the controlled dock hides without discarding its panel tree", () => {
  const f = fixture(),
    p = props(),
    tree = f.render({ ...p, open: false });
  assert.equal(tree.props.hidden, true);
  assert.equal(tree.props.inert, true);
  assert.equal(
    nodes(tree).filter((n) => n.props?.role === "tabpanel").length,
    2,
  );
});

test("overlay cycles focus, closes with Escape and restores its opener", () => {
  const f = fixture(),
    p = props();
  f.render(p);
  f.states[1] = 600;
  let closed = 0;
  const opener: any = {
    isConnected: true,
    closest: () => null,
    focus() {
      f.doc.activeElement = this;
    },
  };
  const item = () => ({
    closest: () => null,
    getClientRects: () => [{}],
    focus() {
      f.doc.activeElement = this;
    },
  });
  const first = item(),
    last = item();
  const sibling = Object.assign(new f.Element(), { inert: false });
  const panel: any = {
    parentElement: { children: [sibling] },
    contains: (node: any) => node === first || node === last,
    querySelectorAll: () => [first, last],
    focus() {
      f.doc.activeElement = this;
    },
  };
  f.refs[0].current = panel;
  f.doc.activeElement = opener;
  f.render({ ...p, onClose: () => closed++ });
  const cleanup = f.effects[2]();
  assert.equal(sibling.inert, true);
  assert.equal(f.doc.activeElement, first);
  f.doc.activeElement = last;
  let prevented = 0;
  f.listeners.get("keydown")!({
    key: "Tab",
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(f.doc.activeElement, first);
  assert.equal(prevented, 1);
  f.listeners.get("keydown")!({
    key: "Tab",
    shiftKey: true,
    preventDefault() {},
  });
  assert.equal(f.doc.activeElement, last);
  f.listeners.get("keydown")!({
    key: "Escape",
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(closed, 1);
  cleanup();
  assert.equal(sibling.inert, false);
  assert.equal(f.doc.activeElement, opener);
  assert.equal(f.listeners.size, 0);
});

test("closing the focused tab restores the active neighboring tab without stealing external focus", () => {
  const f = fixture(),
    p = props();
  let tree = f.render(p);
  nodes(tree)
    .find((n) => n.props?.["aria-label"] === "Close Object")
    .props.onFocus();
  let restored = "";
  f.doc.activeElement = { isConnected: false };
  f.doc.getElementById = (id: string) => ({
    focus() {
      restored = id;
    },
  });
  tree = f.render({ ...p, tabs: [tabs[0]] });
  f.effects[0]();
  assert.equal(restored, "dock-test-tab-notifications");
  tree = f.render(p);
  nodes(tree)
    .find((n) => n.props?.role === "tab")
    .props.onFocus();
  f.doc.activeElement = { isConnected: true };
  restored = "";
  f.render({ ...p, tabs: [tabs[1]], activeId: tabs[1].id });
  f.effects[0]();
  assert.equal(restored, "");
});
test("capture loss restores uncommitted resize and compact tabs retain coarse targets", () => {
  const f = fixture(),
    p = props(),
    edge = nodes(f.render(p)).find((n) => n.props?.role === "separator").props;
  const currentTarget = { focus() {}, setPointerCapture() {} };
  edge.onPointerDown({
    button: 0,
    pointerId: 1,
    clientX: 500,
    currentTarget,
    preventDefault() {},
  });
  edge.onPointerMove({ pointerId: 1, clientX: 400 });
  assert.equal(f.states[0], 500);
  edge.onLostPointerCapture();
  assert.equal(f.states[0], 400);
  assert.equal(f.writes.length, 0);
  const css = readFileSync(
    new URL("../../desktop/src/app/chrome/workspace-dock.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /min-height: 32px/);
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.match(css, /text-overflow: ellipsis/);
  assert.doesNotMatch(css, /overflow-wrap/);
});

test("a split main-area budget overlays the dock before compressing explicit panes", () => {
  const f = fixture(),
    p = props();
  f.render(p);
  f.states[1] = 1440;
  let tree = f.render({ ...p, minMainWidth: 1280 });
  assert.equal(tree.props.role, "dialog");
  f.states[1] = 1560;
  tree = f.render({ ...p, minMainWidth: 1280 });
  assert.equal(tree.props.role, "complementary");
  assert.equal(tree.props.style.width, 280);
  assert.equal(f.exports.dockMaximum(1800, 1280), 520);
  f.states[1] = 1440;
  tree = f.render(p);
  assert.equal(tree.props.role, "complementary");
});

test("a budget-forced desktop overlay is a right sheet; fullscreen is phone-only", () => {
  const f = fixture("520"),
    p = props();
  f.render(p);
  f.states[1] = 1440;
  const tree = f.render({ ...p, minMainWidth: 1280 });
  assert.equal(tree.props.style["--workspace-dock-preferred-width"], "520px");
  assert.equal(tree.props.style.width, undefined);
  const css = readFileSync(
    new URL("../../desktop/src/app/chrome/workspace-dock.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /inset: 0 0 0 auto/);
  assert.match(
    css,
    /width: min\(var\(--workspace-dock-preferred-width, 400px\), calc\(100vw - 48px\)\)/,
  );
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?width: 100%/);
});

test("the App split budget keeps a remembered 420px dock inline at 1440px", () => {
  const f = fixture("420"),
    p = props();
  f.render(p);
  f.states[1] = 1440;
  const tree = f.render({ ...p, minMainWidth: 960 });
  assert.equal(f.exports.dockMaximum(1440, 960), 480);
  assert.equal(tree.props.role, "complementary");
  assert.equal(tree.props.style.width, 420);
  const separator = nodes(tree).find((n) => n.props?.role === "separator");
  assert.equal(separator.props["aria-valuemax"], 480);
});

test("dock and page tab bars share one chrome height", () => {
  const appCss = readFileSync(
    new URL("../../desktop/src/app/workspace.css", import.meta.url),
    "utf8",
  );
  const dockCss = readFileSync(
    new URL("../../desktop/src/app/chrome/workspace-dock.css", import.meta.url),
    "utf8",
  );
  assert.match(appCss, /--workspace-chrome-height: 56px/);
  assert.match(appCss, /--topbar-h: var\(--workspace-chrome-height, 56px\)/);
  assert.match(dockCss, /height: var\(--workspace-chrome-height, 56px\)/);
  assert.match(dockCss, /box-sizing: border-box/);
});
