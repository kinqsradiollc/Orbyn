import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("the actual web block renderer produces all six semantic heading tags", () => {
  const source = readFileSync(
    new URL("../../desktop/src/features/docs/DocBlocks.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export function BlockView(");
  assert.ok(start >= 0);
  // Isolate the actual render function. Inline text is covered by the rich-text suite;
  // unrelated network/embed components are intentionally absent from this pure test.
  const compiled = ts.transpileModule(source.slice(start), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const context = {
    exports: {} as { BlockView: any },
    require: createRequire(import.meta.url),
    Inline: ({ text }: { text: string }) => text,
  };
  runInNewContext(compiled.outputText, context);
  for (const level of [1, 2, 3, 4, 5, 6]) {
    const html = renderToStaticMarkup(
      createElement(context.exports.BlockView, {
        block: { type: "heading", level, text: "A heading" },
      }),
    );
    assert.equal(
      html,
      `<h${level} class="doc-heading" dir="auto">A heading</h${level}>`,
    );
  }
});
