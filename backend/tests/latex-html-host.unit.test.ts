import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
const require = createRequire(import.meta.url),
  nativeRequire = createRequire(
    new URL("../../mobile/package.json", import.meta.url),
  );
for (const native of [false, true])
  test(`${native ? "Expo web" : "web"} actual HTML host stays mounted and never rewrites srcDoc while draft/theme changes`, async () => {
    const { JSDOM } = nativeRequire("jsdom"),
      React = require("react");
    const dom = new JSDOM('<!doctype html><div id="root"></div>');
    const names = [
      "window",
      "document",
      "HTMLElement",
      "MutationObserver",
      "getComputedStyle",
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
        value:
          name === "IS_REACT_ACT_ENVIRONMENT"
            ? true
            : name === "getComputedStyle"
              ? dom.window.getComputedStyle.bind(dom.window)
              : dom.window[name],
      });
    const module = { exports: {} as any };
    const path = new URL(
      `../../${native ? "mobile/src/components/LatexHtmlPreview.web.tsx" : "desktop/src/components/LatexHtmlPreview.tsx"}`,
      import.meta.url,
    ).pathname;
    const code = (
      await build({
        entryPoints: [path],
        bundle: true,
        platform: "node",
        format: "cjs",
        write: false,
        external: ["react"],
        plugins: native
          ? [
              {
                name: "fixture-theme",
                setup(builder) {
                  builder.onResolve({ filter: /^\.\.\/theme$/ }, () => ({
                    path: new URL(
                      "../fixtures/html-preview-theme.ts",
                      import.meta.url,
                    ).pathname,
                  }));
                },
              },
            ]
          : [],
      })
    ).outputFiles[0].text;
    runInNewContext(code, {
      module,
      exports: module.exports,
      require,
      window: dom.window,
      document: dom.window.document,
      MutationObserver: dom.window.MutationObserver,
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
      console,
    });
    const root = require("react-dom/client").createRoot(
      dom.window.document.querySelector("#root"),
    );
    let source = "First document";
    const render = () =>
      root.render(
        React.createElement(module.exports.LatexHtmlPreview, { source }),
      );
    try {
      await React.act(async () => {
        render();
        await new Promise((resolve) => setImmediate(resolve));
      });
      const frame = dom.window.document.querySelector("iframe")!;
      assert.ok(frame);
      const html = frame.srcdoc;
      assert.match(html, /connect-src 'none'/);
      assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
      assert.doesNotMatch(frame.getAttribute("sandbox")!, /same-origin/);
      const messages: any[] = [];
      frame.contentWindow!.postMessage = (data: any) => {
        messages.push(JSON.parse(data));
      };
      source = "Second unsaved document";
      await React.act(render);
      assert.equal(dom.window.document.querySelector("iframe"), frame);
      assert.equal(frame.srcdoc, html);
      assert.equal(messages.at(-1).source, source);
      await React.act(async () => {
        dom.window.document.documentElement.setAttribute("data-theme", "dark");
        await new Promise((resolve) => setImmediate(resolve));
      });
      assert.equal(dom.window.document.querySelector("iframe"), frame);
      assert.equal(frame.srcdoc, html);
      await React.act(() => {
        dom.window.dispatchEvent(
          new dom.window.MessageEvent("message", {
            source: dom.window as any,
            data: JSON.stringify({ type: "orbyn-latex-status", height: 999 }),
          }),
        );
      });
      assert.notEqual(
        frame.style.height,
        "999px",
        "other windows cannot mutate preview dimensions",
      );
    } finally {
      await React.act(() => root.unmount());
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as any)[name];
      }
      dom.window.close();
    }
  });
