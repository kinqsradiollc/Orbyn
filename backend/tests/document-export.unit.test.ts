import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as core from "@orbyn/core";
const require = createRequire(import.meta.url),
  nativeRequire = createRequire(
    new URL("../../mobile/package.json", import.meta.url),
  );
test("actual source editor exports only on request and preserves source/HTML on failure and owner departure", async () => {
  const React = require("react"),
    { JSDOM } = nativeRequire("jsdom");
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const names = [
    "window",
    "document",
    "HTMLElement",
    "Node",
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
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 1100,
  });
  let downloads = 0;
  dom.window.HTMLAnchorElement.prototype.click = () => {
    downloads++;
  };
  let account = "owner-a",
    ready = false,
    readOnly = false,
    calls = 0,
    signal: AbortSignal | undefined,
    finish: ((blob: Blob) => void) | undefined,
    fail: ((error: Error) => void) | undefined;
  const snapshots: string[] = [];
  const source = String.raw`\documentclass{article}\begin{document}Saved text\end{document}`;
  const blocks: core.DocBlock[] = [
    { type: "code", lang: "latex-document", id: "main-source", text: source },
  ];
  const module = { exports: {} as any };
  const code = transformSync(
    readFileSync(
      new URL(
        "../../desktop/src/features/docs/DocSourcePreview.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    { loader: "tsx", format: "cjs", jsx: "automatic" },
  ).code;
  const mocks: any = {
    "@orbyn/core": core,
    "../../components/LatexHtmlPreview": {
      LatexHtmlPreview: ({ source }: any) =>
        React.createElement("iframe", {
          title: "HTML result",
          "data-source": source,
        }),
    },
    "../../components/Select": {
      Select: ({ children, ...props }: any) =>
        React.createElement("select", props, children),
    },
    "./DocLatexPreview": { useDocLatexPreview: () => null },
    "./DocBlocks": { BlockView: () => null },
    "./RichBlocks": { FootnoteContext: React.createContext(null) },
    "./doc-navigation": { DocNavigationContext: React.createContext(null) },
    "../../hooks/useModalFocus": {
      useModalFocus: () => ({ ref: React.useRef(null), id: "test-focus" }),
    },
    "../../lib/session": { session: { get: () => account } },
  };
  class ResizeObserver {
    observe() {}
    disconnect() {}
  }
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name: string) =>
      name.endsWith(".css") ? {} : name in mocks ? mocks[name] : require(name),
    window: dom.window,
    document: dom.window.document,
    ResizeObserver,
    AbortController,
    Error,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (callback: any) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    setTimeout,
    clearTimeout,
    URL: { createObjectURL: () => "blob:export", revokeObjectURL: () => {} },
    console,
  });
  const root = require("react-dom/client").createRoot(
    dom.window.document.querySelector("#root"),
  );
  const render = () =>
    root.render(
      React.createElement(module.exports.DocSourcePreview, {
        blocks,
        docId: "test-note",
        inline: true,
        initialMode: "latex",
        showModes: false,
        compileReady: ready,
        onClose: () => {},
        onAppLink: () => {},
        onLatexChange: readOnly
          ? undefined
          : (text: string, expected: core.DocBlock[]) =>
              core.withDocLatexSource(expected, text),
        onCompileLatex: (snapshot: string, requestSignal: AbortSignal) => {
          calls++;
          snapshots.push(snapshot);
          signal = requestSignal;
          return new Promise<Blob>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          });
        },
      }),
    );
  const exportButton = () =>
    [...dom.window.document.querySelectorAll("button")].find(
      (button: any) => button.textContent === "Export PDF",
    ) as HTMLButtonElement | undefined;
  try {
    await React.act(async () => {
      render();
      await new Promise((resolve) => setTimeout(resolve, 1250));
    });
    assert.equal(
      calls,
      0,
      "opening source must never start automatic PDF compilation",
    );
    const frame = dom.window.document.querySelector("iframe")!;
    const input = dom.window.document.querySelector(
      '[aria-label="LaTeX source"]',
    ) as HTMLTextAreaElement;
    assert.ok(exportButton()?.disabled);
    await React.act(() => exportButton()!.click());
    assert.equal(calls, 0);
    ready = true;
    await React.act(render);
    await React.act(() => exportButton()!.click());
    assert.equal(calls, 1);
    assert.equal(snapshots[0], source);
    await React.act(async () => {
      finish!(new Blob(["pdf"], { type: "application/pdf" }));
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.equal(downloads, 1);
    assert.match(dom.window.document.body.textContent!, /PDF ready/);
    const retry = dom.window.document.querySelector(
      'a[download="document.pdf"]',
    );
    assert.equal(retry?.getAttribute("href"), "blob:export");
    assert.equal(dom.window.document.querySelector("iframe"), frame);
    assert.equal(input.value, source);
    await React.act(() => exportButton()!.click());
    await React.act(async () => {
      fail!(new Error("Compiler unavailable"));
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.match(dom.window.document.body.textContent!, /Compiler unavailable/);
    assert.equal(input.value, source);
    assert.equal(dom.window.document.querySelector("iframe"), frame);
    assert.equal(downloads, 1);
    await React.act(() => exportButton()!.click());
    assert.ok(signal && !signal.aborted);
    account = "owner-b";
    await React.act(() => root.unmount());
    assert.equal(signal!.aborted, true);
    await React.act(async () => {
      finish!(new Blob(["late pdf"]));
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.equal(downloads, 1, "departed owner cannot receive a late download");
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
