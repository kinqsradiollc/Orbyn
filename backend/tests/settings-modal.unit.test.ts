import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
function harness() {
  const effects: (() => (() => void) | void)[] = [];
  const refs: { current: any }[] = [];
  const handlers = new Map<string, any>();
  const rootHandlers = new Map<string, any>();
  let closed = 0;
  let guard: any = null;
  const overlays: any[] = [];
  const notices: unknown[] = [];
  const fallbacks: any[] = [];
  const app = {
    inert: false,
    style: { position: "", zIndex: "" },
    hidden: null as string | null,
    getAttribute() {
      return this.hidden;
    },
    setAttribute(_key: string, value: string) {
      this.hidden = value;
    },
    removeAttribute() {
      this.hidden = null;
    },
  };
  const document: any = {
    body: { style: { overflow: "scroll" } },
    querySelector: (selector: string) => (selector === ".app" ? app : guard),
    querySelectorAll: (selector: string) =>
      selector.includes("aria-modal")
        ? [root, ...overlays]
        : selector.includes("data-settings-focus-return")
          ? fallbacks
          : [],
    addEventListener: (name: string, fn: unknown) => handlers.set(name, fn),
    removeEventListener: (name: string) => handlers.delete(name),
  };
  const control = () => ({
    isConnected: true,
    hidden: false,
    disabled: false,
    inert: false,
    sidebar: null as any,
    getClientRects() {
      return this.hidden ? [] : [{}];
    },
    closest(selector: string) {
      return selector === ".sidebar"
        ? this.sidebar
        : this.disabled || this.inert
          ? {}
          : null;
    },
    focus() {
      document.activeElement = this;
    },
  });
  const opener = control();
  const close = control();
  const search = control();
  const last = control();
  document.activeElement = opener;
  const controls = [close, search, last];
  const root: any = {
    querySelector: (selector: string) =>
      selector.includes('input[type="search"]') ? search : guard,
    querySelectorAll: () => controls,
    contains: (element: unknown) =>
      element === root || controls.includes(element as any),
    addEventListener: (name: string, fn: unknown) => rootHandlers.set(name, fn),
    removeEventListener: (name: string) => rootHandlers.delete(name),
    compareDocumentPosition: () => 4,
    focus() {
      document.activeElement = root;
    },
  };
  const visual = {
    width: 700,
    height: 500,
    offsetTop: 15,
    offsetLeft: 0,
    addEventListener() {},
    removeEventListener() {},
  };
  const exports: Record<string, any> = {};
  runInNewContext(
    ts.transpileModule(
      read("desktop/src/features/settings/SettingsModal.tsx"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.React,
          esModuleInterop: true,
        },
      },
    ).outputText,
    {
      exports,
      React,
      document,
      window: {
        visualViewport: visual,
        innerWidth: 1024,
        innerHeight: 768,
        addEventListener() {},
        removeEventListener() {},
      },
      Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
      getComputedStyle: (element: any) => ({
        zIndex: String(element.layer ?? 0),
        visibility: element.hidden ? "hidden" : "visible",
        transform: element.transform ?? "none",
      }),
      requestAnimationFrame: (fn: () => void) => fn(),
      CustomEvent: class {
        constructor(
          public type: string,
          public options: unknown,
        ) {}
      },
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
      require: (name: string) => {
        if (name === "react")
          return {
            ...React,
            useId: () => "settings-title",
            useRef: (value: unknown) => {
              const ref = { current: value };
              refs.push(ref);
              return ref;
            },
            useState: (value: any) => [
              typeof value === "function" ? value() : value,
              (next: unknown) => notices.push(next),
            ],
            useEffect: (fn: any) => effects.push(fn),
          };
        if (name === "react-dom")
          return { createPortal: (value: unknown) => value };
        if (name === "lucide-react") return { X: "icon" };
        if (name.endsWith(".css")) return {};
        throw new Error(name);
      },
    },
  );
  const tree = exports.SettingsModal({
    children: "settings content",
    onClose: () => closed++,
  });
  refs[0].current = root;
  const cleanup = effects
    .map((effect) => effect())
    .filter(Boolean) as (() => void)[];
  const key = (key: string, shiftKey = false) => {
    const event = {
      key,
      shiftKey,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
    };
    handlers.get("keydown")(event);
    return event;
  };
  return {
    tree,
    document,
    app,
    root,
    controls,
    opener,
    search,
    last,
    overlays,
    handlers,
    notices,
    fallbacks,
    control,
    exports,
    key,
    closeCount: () => closed,
    setGuard: (value: unknown) => {
      guard = value;
    },
    blocked: (event: any) =>
      rootHandlers.get("orbyn-settings-exit-blocked")(event),
    cleanup: () => cleanup.forEach((fn) => fn()),
  };
}

test("Settings focuses its search and restores workspace focus and scroll state on close", () => {
  const view = harness();
  assert.equal(view.document.activeElement, view.search);
  assert.equal(view.app.inert, true);
  assert.equal(view.app.hidden, "true");
  assert.equal(view.document.body.style.overflow, "hidden");
  assert.equal(view.tree.props.style.height, 500);
  assert.equal(view.tree.props.style.top, 15);
  view.cleanup();
  assert.equal(view.app.inert, false);
  assert.equal(view.app.hidden, null);
  assert.equal(view.document.body.style.overflow, "scroll");
  assert.equal(view.document.activeElement, view.opener);
});
test("hidden Settings opener returns focus to visible navigation after workspace restoration", () => {
  const view = harness();
  view.opener.hidden = true;
  const navigation = view.control();
  const focus = navigation.focus;
  navigation.focus = () => {
    assert.equal(view.app.inert, false);
    focus.call(navigation);
  };
  view.fallbacks.push(navigation);
  view.cleanup();
  assert.equal(view.document.activeElement, navigation);
});
test("removed Settings opener skips hidden, disabled and inert return targets", () => {
  const view = harness();
  view.opener.isConnected = false;
  const hidden = view.control();
  hidden.hidden = true;
  const disabled = view.control();
  disabled.disabled = true;
  const inert = view.control();
  inert.inert = true;
  const navigation = view.control();
  view.fallbacks.push(hidden, disabled, inert, navigation);
  view.cleanup();
  assert.equal(view.document.activeElement, navigation);
});
test("a failed opener focus attempts the visible navigation return target", () => {
  const view = harness();
  view.opener.focus = () => {};
  const navigation = view.control();
  view.fallbacks.push(navigation);
  view.cleanup();
  assert.equal(view.document.activeElement, navigation);
});
test("both responsive workspace navigation controls expose a Settings return target", () => {
  const source = read("desktop/src/components/Topbar.tsx");
  assert.match(
    source,
    /className="icon-button workspace-rail-toggle"\s+data-settings-focus-return/,
  );
  assert.match(
    source,
    /className="icon-button mobile-menu"\s+data-settings-focus-return/,
  );
});
test("closing off-canvas navigation cannot recapture Settings focus before visibility hides", () => {
  const view = harness();
  view.opener.sidebar = {
    classList: { contains: () => false },
    transform: "matrix(1, 0, 0, 1, -10, 0)",
  };
  const navigation = view.control();
  view.fallbacks.push(navigation);
  view.cleanup();
  assert.equal(view.document.activeElement, navigation);
});
test("visible desktop navigation and an open phone sidebar retain their valid opener", () => {
  for (const open of [false, true]) {
    const view = harness();
    view.opener.sidebar = {
      classList: { contains: () => open },
      transform: open ? "matrix(1, 0, 0, 1, 0, 0)" : "none",
    };
    view.fallbacks.push(view.control());
    view.cleanup();
    assert.equal(view.document.activeElement, view.opener);
  }
});
test("Tab remains inside Settings and Escape closes only when no nested overlay owns focus", () => {
  const view = harness();
  view.document.activeElement = view.last;
  assert.equal(view.key("Tab").defaultPrevented, true);
  assert.equal(view.document.activeElement, view.controls[0]);
  view.key("Tab", true);
  assert.equal(view.document.activeElement, view.last);
  view.overlays.push({
    layer: 7,
    contains: () => false,
    closest: () => null,
    getClientRects: () => [{}],
  });
  view.key("Escape");
  assert.equal(view.closeCount(), 0);
  view.overlays.length = 0;
  view.key("Escape");
  assert.equal(view.closeCount(), 1);
  view.cleanup();
});
test("backdrop content clicks do not close Settings and recovery codes block dismissal", () => {
  const view = harness();
  view.tree.props.onMouseDown({ target: {}, currentTarget: view.tree });
  assert.equal(view.closeCount(), 0);
  let signalled = false;
  view.setGuard({
    dispatchEvent() {
      signalled = true;
    },
  });
  view.key("Escape");
  assert.equal(signalled, true);
  assert.equal(view.closeCount(), 0);
  view.setGuard(null);
  const backdrop = {};
  view.tree.props.onMouseDown({ target: backdrop, currentTarget: backdrop });
  assert.equal(view.closeCount(), 1);
  view.cleanup();
});
test("opening Settings preserves the current workspace and ordinary Settings search handles Escape", () => {
  const source = read("desktop/src/app/App.tsx");
  const navigate = source.slice(
    source.indexOf("  const navigate ="),
    source.indexOf("  // ── Tabs"),
  );
  assert.ok(
    navigate.indexOf('v === "Settings"') < navigate.indexOf("setView(v)"),
  );
  assert.ok(navigate.includes("setSettingsOpen(true)"));
  assert.ok(navigate.includes("return;"));
  assert.ok(!source.includes('view === "Settings" &&'));
  assert.equal((source.match(/\{settingsDialog\}/g) ?? []).length, 2);
  const view = read("desktop/src/features/settings/SettingsView.tsx");
  assert.ok(view.includes('e.key === "Escape" && query'));
  assert.ok(view.includes("e.stopPropagation()"));
  assert.ok(
    read("mobile/src/app/RootScreen.tsx").includes(
      'visible={sheet === "settings"}',
    ),
  );
});
