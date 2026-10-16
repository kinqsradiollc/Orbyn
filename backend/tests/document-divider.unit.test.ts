import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
const require = createRequire(import.meta.url);
const mobileRequire = createRequire(
  new URL("../../mobile/package.json", import.meta.url),
);
for (const mobile of [false, true])
  test(`${mobile ? "Expo" : "web"} divider retains drag over preview without pointer capture and restores on blur/unmount`, async () => {
    const React = require("react");
    const { JSDOM } = mobileRequire("jsdom");
    const dom = new JSDOM('<!doctype html><div id="root"></div>');
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
    dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
      width: 1000,
      height: 800,
      left: 0,
      top: 60,
      right: 1000,
      bottom: 860,
      x: 0,
      y: 60,
      toJSON() {},
    });
    dom.window.HTMLElement.prototype.setPointerCapture = () => {
      throw new Error("capture unavailable");
    };
    const module = { exports: {} as any };
    const file = mobile
      ? "mobile/src/components/DocumentDivider.web.tsx"
      : "desktop/src/features/docs/DocumentWorkspace.tsx";
    class ResizeObserver {
      observe() {}
      disconnect() {}
    }
    runInNewContext(
      transformSync(
        readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"),
        { loader: "tsx", format: "cjs", jsx: "automatic" },
      ).code,
      {
        module,
        exports: module.exports,
        require: (name: string) =>
          name.endsWith(".css")
            ? {}
            : name === "../theme"
              ? { colors: { surfaceMuted: "neutral", border: "neutral" } }
              : require(name),
        window: dom.window,
        ResizeObserver,
        localStorage: { getItem: () => null, setItem() {} },
        console,
      },
    );
    function Harness() {
      const [value, setValue] = React.useState(50);
      const ref = React.useRef(null);
      const workspace = mobile
        ? null
        : module.exports.useDocumentWorkspace(ref, true);
      return React.createElement(
        "div",
        { ref, style: workspace?.style },
        mobile
          ? React.createElement(module.exports.DocumentDivider, {
              value,
              width: 1000,
              onChange: setValue,
            })
          : workspace.divider,
        React.createElement("iframe", { style: { pointerEvents: "auto" } }),
      );
    }
    const root = require("react-dom/client").createRoot(
      dom.window.document.querySelector("#root"),
    );
    const pointer = (target: any, type: string, x: number) => {
      const event = new dom.window.MouseEvent(type, {
        bubbles: true,
        clientX: x,
        buttons: 1,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      target.dispatchEvent(event);
    };
    try {
      await React.act(() => root.render(React.createElement(Harness)));
      const divider = dom.window.document.querySelector('[role="separator"]')!,
        frame = dom.window.document.querySelector("iframe")!;
      await React.act(() => pointer(divider, "pointerdown", 500));
      assert.equal(frame.style.pointerEvents, "none");
      await React.act(() => pointer(dom.window, "pointermove", 800));
      assert.equal(divider.getAttribute("aria-valuenow"), "70");
      await React.act(() =>
        dom.window.dispatchEvent(new dom.window.Event("blur")),
      );
      assert.equal(frame.style.pointerEvents, "auto");
      await React.act(() =>
        divider.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "ArrowLeft",
            bubbles: true,
          }),
        ),
      );
      assert.equal(divider.getAttribute("aria-valuenow"), "65");
      await React.act(() => pointer(divider, "pointerdown", 650));
      assert.equal(frame.style.pointerEvents, "none");
      await React.act(() => root.unmount());
      assert.equal(frame.style.pointerEvents, "auto");
    } finally {
      if (dom.window.document.querySelector("#root")!.childNodes.length)
        await React.act(() => root.unmount());
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as any)[name];
      }
      dom.window.close();
    }
  });
