import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as core from "@orbyn/core";
import { LatexPreviewStore } from "../../packages/api-client/src/latex-preview-store.js";
const require = createRequire(import.meta.url);
const mobileRequire = createRequire(
  new URL("../../mobile/package.json", import.meta.url),
);
for (const native of [false, true])
  test(`${native ? "mobile" : "web"} provider keeps its canonical Note viewer and never gives another TeX block that PDF`, async () => {
    const React = require("react"),
      { JSDOM } = mobileRequire("jsdom");
    const dom = new JSDOM('<div id="root"></div>');
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
    const root = require("react-dom/client").createRoot(
      dom.window.document.querySelector("#root"),
    );
    const created: Blob[] = [],
      revoked: string[] = [];
    const dependencies: any = {
      react: React,
      "react/jsx-runtime": require("react/jsx-runtime"),
      "@orbyn/core": core,
      "@orbyn/api-client": { LatexPreviewStore },
      "../../lib/session": { session: { get: () => "owner", token: "owner" } },
      "react-native": {
        View: ({ children }: any) => React.createElement("div", null, children),
        Text: ({ children }: any) =>
          React.createElement("span", null, children),
      },
      "../../components/DocumentPdfPreview": {
        DocumentPdfPreview: () =>
          React.createElement("iframe", {
            title: "Mobile PDF",
            src: "blob:mobile-note",
          }),
      },
      "../../components/Button": {
        Button: ({ title, onPress }: any) =>
          React.createElement("button", { onClick: onPress }, title),
      },
      "../../styles": { shared: { small: {} } },
    };
    const module = { exports: {} as any };
    runInNewContext(
      transformSync(
        readFileSync(
          new URL(
            native
              ? "../../mobile/src/screens/docs/DocLatexPreview.tsx"
              : "../../desktop/src/features/docs/DocLatexPreview.tsx",
            import.meta.url,
          ),
          "utf8",
        ),
        { loader: "tsx", format: "cjs", jsx: "automatic" },
      ).code,
      {
        module,
        exports: module.exports,
        require: (name: string) => {
          assert.ok(name in dependencies, name);
          return dependencies[name];
        },
        URL: {
          createObjectURL: (blob: Blob) => {
            created.push(blob);
            return `blob:note-${created.length}`;
          },
          revokeObjectURL: (url: string) => revoked.push(url),
        },
      },
    );
    const { DocLatexPreviewProvider, DocLatexNote, useDocLatexPreview } =
      module.exports;
    let preview: any,
      calls = 0;
    const compiled: string[] = [];
    const compile = async (source: string) => {
      compiled.push(source);
      calls++;
      return new Blob(["%PDF-note"]);
    };
    const Probe = () => {
      preview = useDocLatexPreview();
      return null;
    };
    const blocks = [
      {
        id: "tex",
        type: "code",
        lang: core.DOC_LATEX_LANGUAGE,
        text: "\\documentclass{article}\\begin{document}Hello\\end{document}",
      },
      {
        id: "tex-second",
        type: "code",
        lang: core.DOC_LATEX_LANGUAGE,
        text: "SECOND DISTINCT TEX SOURCE",
      },
    ];
    const show = (source: boolean) =>
      React.createElement(
        DocLatexPreviewProvider,
        { blocks, docId: "note", ready: true, canCompile: true, compile },
        React.createElement(Probe),
        source
          ? React.createElement("textarea", {
              defaultValue: blocks[0].text,
              "aria-label": "LaTeX source",
            })
          : null,
        ...blocks.map((block) =>
          React.createElement(DocLatexNote, { key: block.id, block }),
        ),
      );
    try {
      await React.act(async () => root.render(show(true)));
      await React.act(async () => {
        preview.retry();
        await new Promise((resolve) => setImmediate(resolve));
      });
      assert.equal(calls, 1);
      assert.equal(
        dom.window.document.querySelector("iframe")?.getAttribute("src"),
        native ? "blob:mobile-note" : "blob:note-1",
      );
      const frame = dom.window.document.querySelector("iframe");
      assert.equal(dom.window.document.querySelectorAll("iframe").length, 1);
      assert.match(
        dom.window.document.body.textContent,
        /SECOND DISTINCT TEX SOURCE/,
      );
      await React.act(async () => root.render(show(false)));
      assert.equal(
        dom.window.document.querySelector("iframe"),
        frame,
        "unchanged Note keeps the actual viewer node",
      );
      assert.equal(dom.window.document.querySelector("textarea"), null);
      assert.equal(
        dom.window.document.querySelector("iframe")?.getAttribute("src"),
        native ? "blob:mobile-note" : "blob:note-1",
      );
      assert.equal(calls, 1);
      assert.deepEqual(revoked, []);
      // A different canonical block must not inherit the preceding block's PDF.
      blocks.reverse();
      await React.act(async () => root.render(show(false)));
      assert.equal(dom.window.document.querySelector("iframe"), null);
      await React.act(async () => {
        preview.retry();
        await new Promise((resolve) => setImmediate(resolve));
      });
      assert.equal(compiled.at(-1), "SECOND DISTINCT TEX SOURCE");
      assert.equal(dom.window.document.querySelectorAll("iframe").length, 1);
      await React.act(async () => root.unmount());
      assert.deepEqual(revoked, native ? [] : ["blob:note-1", "blob:note-2"]);
    } finally {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as any)[name];
      }
    }
  });
