import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { runInNewContext } from "node:vm";
const require = createRequire(import.meta.url);
const mobileRequire = createRequire(
  new URL("../../mobile/package.json", import.meta.url),
);
const { JSDOM } = mobileRequire("jsdom");
const compile = (file: string) =>
  transformSync(readFileSync(new URL(file, import.meta.url), "utf8"), {
    loader: "tsx",
    format: "cjs",
    jsx: "automatic",
  }).code;
test("pane tabs claim focus while shared header actions retain the current pane", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const module = { exports: {} as any };
  const mocks: Record<string, unknown> = {
    "../hooks/useElementWidth": {
      useElementWidth: () => ({ ref: null, width: 1400 }),
    },
    "../../hooks/useElementWidth": {
      useElementWidth: () => ({ ref: null, width: 1400 }),
    },
    "lucide-react": Object.fromEntries(
      ["Bell", "Menu", "PanelLeftClose", "PanelLeftOpen", "Plus", "Search"].map(
        (name) => [name, () => null],
      ),
    ),
    "../app/views": { navName: (view: string) => view },
    "../views": { navName: (view: string) => view },
    "../app/commands": { commandById: () => ({}), keysFor: () => [] },
    "../commands": { commandById: () => ({}), keysFor: () => [] },
    "../app/prefs": { usePrefs: () => ({ prefs: {} }) },
    "../prefs": { usePrefs: () => ({ prefs: {} }) },
  };
  runInNewContext(compile("../../desktop/src/app/chrome/Topbar.tsx"), {
    module,
    exports: module.exports,
    navigator: { platform: "MacIntel" },
    require: (name: string) => (name in mocks ? mocks[name] : require(name)),
  });
  const dom = new JSDOM(
    renderToStaticMarkup(
      React.createElement(module.exports.Topbar, {
        view: "Home",
        sharedChrome: true,
        tabs: React.createElement("button", { role: "tab" }, "Home"),
      }),
    ),
  );
  try {
    const document = dom.window.document;
    assert.equal(
      document.querySelector('[role="tab"]')!.closest("[data-shared-chrome]"),
      null,
      "clicking a pane tab must reach its owning pane's focus capture",
    );
    for (const label of ["Search or ask", "Notifications", "Toggle navigation"])
      assert.ok(
        document
          .querySelector(`[aria-label="${label}"]`)!
          .closest("[data-shared-chrome]"),
        `${label} must preserve the previously focused pane`,
      );
  } finally {
    dom.window.close();
  }
});
test("retained selections yield shortcuts to another pane, fields, hidden ancestors and dialogs", () => {
  const dom = new JSDOM(
    '<body><section id="a"><p id="text">Retained selection</p><button id="toolbar">Style</button><input id="field"></section><section id="b"><button id="other">Other pane</button></section></body>',
  );
  dom.window.HTMLElement.prototype.getClientRects = function () {
    return this.closest("[hidden]") ? [] : [{}];
  };
  const module = { exports: {} as any };
  runInNewContext(
    compile("../../desktop/src/features/documents/editor/editor-input.ts"),
    {
      module,
      exports: module.exports,
      document: dom.window.document,
      window: dom.window,
      Element: dom.window.Element,
      require: () => ({ hasHigherDialog: () => false }),
    },
  );
  const owns = module.exports.ownsEditorKey;
  const document = dom.window.document,
    root = document.querySelector("#a"),
    text = document.querySelector("#text").firstChild;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 8);
  dom.window.getSelection().addRange(range);
  let pane = "a",
    mutations = 0;
  const listener = (event: KeyboardEvent) => {
    if (!owns(root, event, () => pane === "a")) return;
    event.preventDefault();
    mutations++;
  };
  document.addEventListener("keydown", listener, true);
  const key = (target: any) => {
    const event = new dom.window.KeyboardEvent("keydown", {
      key: "b",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(key(document.body), true);
  assert.equal(mutations, 1);
  pane = "b";
  assert.equal(key(document.querySelector("#other")), false);
  assert.equal(mutations, 1);
  pane = "a";
  root.setAttribute("inert", "");
  assert.equal(key(document.body), false);
  root.removeAttribute("inert");
  root.hidden = true;
  assert.equal(key(document.body), false);
  root.hidden = false;
  assert.equal(key(document.querySelector("#field")), false);
  const modal = document.createElement("dialog");
  modal.setAttribute("open", "");
  modal.innerHTML = '<input id="modal-field">';
  document.body.append(modal);
  assert.equal(key(document.querySelector("#modal-field")), false);
  assert.equal(key(document.body), false);
  modal.remove();
  assert.equal(key(document.querySelector("#toolbar")), true);
  assert.equal(mutations, 2);
  assert.equal(
    dom.window.getSelection().toString(),
    "Retained",
    "yielding does not clear selection",
  );
  document.removeEventListener("keydown", listener, true);
  dom.window.close();
});
test("shared narrow chrome remains outside a hidden primary pane and routes visible controls to the focused controller", async () => {
  const dom = new JSDOM(
    '<body><div id="host"></div><div id="primary" hidden inert><div id="mount"></div><textarea>primary draft</textarea></div><div id="secondary"></div></body>',
    { url: "http://127.0.0.1" },
  );
  const React = require("react");
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
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const { createRoot } = require("react-dom/client");
  const module = { exports: {} as any };
  runInNewContext(
    compile("../../desktop/src/app/chrome/SharedNarrowChrome.tsx"),
    {
      module,
      exports: module.exports,
      require: (name: string) =>
        name === "lucide-react" ? { X: () => null } : require(name),
    },
  );
  const Chrome = module.exports.SharedNarrowChrome,
    root = createRoot(dom.window.document.querySelector("#mount"));
  let focused = "secondary",
    open = false,
    query = "",
    calls: string[] = [];
  const render = () =>
    root.render(
      React.createElement(Chrome, {
        host: dom.window.document.querySelector("#host"),
        open,
        onClose: () => {
          open = false;
          render();
        },
        header: React.createElement(
          "header",
          null,
          React.createElement(
            "button",
            {
              id: "nav",
              onClick: () => {
                open = true;
                render();
              },
            },
            "Navigation",
          ),
          React.createElement("input", {
            id: "search",
            value: query,
            onChange: (e: any) => {
              query = e.target.value;
              render();
            },
          }),
        ),
        navigation: React.createElement(
          "button",
          {
            id: "destination",
            onClick: () => {
              calls.push(focused);
              open = false;
              render();
            },
          },
          "Calendar",
        ),
      }),
    );
  try {
    await React.act(render);
    const document = dom.window.document;
    assert.ok(!document.querySelector("#host")!.closest("[hidden],[inert]"));
    await React.act(() => document.querySelector("#nav")!.click());
    assert.equal(document.querySelector("dialog")!.open, true);
    await React.act(() => document.querySelector("#destination")!.click());
    assert.deepEqual(calls, ["secondary"]);
    assert.equal(document.querySelector("dialog")!.open, false);
    assert.equal(
      document.querySelector("#primary textarea")!.value,
      "primary draft",
    );
    focused = "primary";
    await React.act(() => document.querySelector("#nav")!.click());
    await React.act(() => document.querySelector("#destination")!.click());
    assert.deepEqual(calls, ["secondary", "primary"]);
  } finally {
    await React.act(() => root.unmount());
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
    dom.window.close();
  }
});
