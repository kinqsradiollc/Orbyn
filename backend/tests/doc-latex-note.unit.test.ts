import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as core from "@orbyn/core";
const require = createRequire(import.meta.url);
const mobileRequire = createRequire(
  new URL("../../mobile/package.json", import.meta.url),
);
for (const native of [false, true])
  for (const anchored of [false, true])
    test(`${native ? "mobile" : "web"} ${anchored ? "anchored" : "unanchored"} HTML workspace retains its host, distinct sources and account ownership without compiling PDF`, async () => {
      const React = require("react"),
        { JSDOM } = mobileRequire("jsdom");
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
      const root = require("react-dom/client").createRoot(
        dom.window.document.querySelector("#root"),
      );
      let account = "owner-a",
        calls = 0,
        docId = "note-a",
        context: any;
      const auth = {
        get: () => account,
        get token() {
          return account;
        },
      };
      const module = { exports: {} as any };
      const component = native
        ? "mobile/src/features/documents/source/DocLatexPreview.tsx"
        : "desktop/src/features/documents/source/DocLatexPreview.tsx";
      runInNewContext(
        transformSync(
          readFileSync(new URL(`../../${component}`, import.meta.url), "utf8"),
          { loader: "tsx", format: "cjs", jsx: "automatic" },
        ).code,
        {
          module,
          exports: module.exports,
          require: (name: string) =>
            name === "@orbyn/core"
              ? core
              : name === "../../../lib/session"
                ? { session: auth }
                : name === "../../../components/LatexHtmlPreview"
                  ? {
                      LatexHtmlPreview: ({ source, fill }: any) =>
                        React.createElement("iframe", {
                          "data-source": source,
                          "data-workspace": fill ? "true" : "false",
                          title: "HTML LaTeX",
                        }),
                    }
                  : require(name),
        },
      );
      const {
        DocLatexPreviewProvider,
        DocLatexDocumentPreview,
        DocLatexNote,
        useDocLatexPreview,
      } = module.exports;
      const Capture = () => {
        context = useDocLatexPreview();
        return null;
      };
      const blocks: core.DocBlock[] = [
        {
          type: "code",
          lang: "latex-document",
          text: "FIRST SOURCE",
          ...(anchored ? { id: "first" } : {}),
        },
        {
          type: "code",
          lang: "latex-document",
          text: "SECOND SOURCE",
          id: "second",
        },
      ];
      const render = () =>
        root.render(
          React.createElement(
            DocLatexPreviewProvider,
            {
              blocks,
              docId,
              ready: true,
              canCompile: true,
              compile: async () => {
                calls++;
                return new Blob();
              },
            },
            React.createElement(Capture),
            React.createElement(DocLatexDocumentPreview),
            ...blocks.map((block, index) =>
              React.createElement(DocLatexNote, { key: index, block }),
            ),
          ),
        );
      try {
        await React.act(render);
        const frame = dom.window.document.querySelector(
          '[data-workspace="true"]',
        );
        assert.ok(frame);
        assert.equal(calls, 0);
        assert.equal(dom.window.document.querySelectorAll("iframe").length, 3);
        assert.deepEqual(
          [
            ...dom.window.document.querySelectorAll('[data-workspace="false"]'),
          ].map((node: any) => node.getAttribute("data-source")),
          ["FIRST SOURCE", "SECOND SOURCE"],
        );
        await React.act(() => context.setDraftSource("UNSAVED SECOND SOURCE"));
        assert.equal(
          dom.window.document.querySelector('[data-workspace="true"]'),
          frame,
        );
        assert.equal(
          frame.getAttribute("data-source"),
          "UNSAVED SECOND SOURCE",
        );
        assert.equal(
          dom.window.document
            .querySelector('[data-workspace="false"]')!
            .getAttribute("data-source"),
          "FIRST SOURCE",
        );
        await React.act(render);
        assert.equal(
          dom.window.document.querySelector('[data-workspace="true"]'),
          frame,
        );
        const sourceAFrame = dom.window.document.querySelector(
          '[data-workspace="true"]',
        );
        await React.act(() =>
          context.setDraftSource("\\unknownOrbynCommand{invalid secondary}", 1),
        );
        const sourceBFrame = dom.window.document.querySelector(
          '[data-workspace="true"]',
        );
        assert.notEqual(
          sourceBFrame,
          sourceAFrame,
          "a different source cannot inherit another source's last-good DOM",
        );
        await React.act(() => context.setDraftSource("SECOND SOURCE VALID", 1));
        assert.equal(
          dom.window.document.querySelector('[data-workspace="true"]'),
          sourceBFrame,
        );
        await React.act(() =>
          context.setDraftSource("SECOND SOURCE INVALID", 1),
        );
        assert.equal(
          dom.window.document.querySelector('[data-workspace="true"]'),
          sourceBFrame,
          "same source retains its host through invalid edits",
        );
        assert.equal(blocks[0].text, "FIRST SOURCE");
        assert.equal(blocks[1].text, "SECOND SOURCE");
        assert.equal(calls, 0);
        account = "owner-b";
        docId = "note-b";
        blocks[0] = { ...blocks[0], text: "NEW OWNER SOURCE" };
        await React.act(render);
        const next = dom.window.document.querySelector(
          '[data-workspace="true"]',
        );
        assert.notEqual(next, frame);
        assert.match(next!.getAttribute("data-source")!, /NEW OWNER SOURCE/);
        assert.doesNotMatch(
          dom.window.document.body.innerHTML,
          /UNSAVED SECOND SOURCE/,
        );
        assert.equal(calls, 0);
      } finally {
        await React.act(() => root.unmount());
        for (const [name, descriptor] of saved) {
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else delete (globalThis as any)[name];
        }
        dom.window.close();
      }
    });
