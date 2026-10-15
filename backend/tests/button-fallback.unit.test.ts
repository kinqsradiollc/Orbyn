import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(
  new URL("../../mobile/package.json", import.meta.url),
);
test("unclassified buttons get themed defaults while feature classes keep control", () => {
  const css = readFileSync(
    new URL("../../desktop/src/styles/global.css", import.meta.url),
    "utf8",
  );
  const rule = css.match(/:where\(button\)\s*\{[^}]+\}/)![0];
  assert.match(rule, /appearance: none/);
  assert.match(rule, /border-radius: var\(--radius-sm\)/);
  assert.match(rule, /background: var\(--color-surface\)/);
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(
    `<style>${rule}\n.special { padding: 2px; border-radius: 20px; background: transparent; }</style><button>Generic</button><button class="special">Custom</button>`,
  );
  try {
    const buttons = dom.window.document.querySelectorAll("button");
    assert.equal(dom.window.getComputedStyle(buttons[0]).appearance, "none");
    assert.equal(dom.window.getComputedStyle(buttons[0]).padding, "8px 12px");
    assert.equal(dom.window.getComputedStyle(buttons[1]).padding, "2px");
    assert.equal(dom.window.getComputedStyle(buttons[1]).borderRadius, "20px");
  } finally {
    dom.window.close();
  }
});
test("every structured editor button explicitly uses an app action class", () => {
  const file = new URL(
    "../../desktop/src/features/docs/StructuredDocEditor.tsx",
    import.meta.url,
  );
  const source = ts.createSourceFile(
    file.pathname,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let count = 0;
  function walk(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === "button"
    ) {
      count++;
      assert.ok(
        node.attributes.properties.some(
          (p) => ts.isJsxAttribute(p) && p.name.getText(source) === "className",
        ),
        `Unstyled action at ${source.getLineAndCharacterOfPosition(node.pos).line + 1}`,
      );
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
  assert.ok(count > 15);
});
