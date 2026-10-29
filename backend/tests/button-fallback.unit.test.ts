import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
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
  assert.match(rule, /min-height: var\(--button-h\)/);
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
    assert.equal(dom.window.getComputedStyle(buttons[0]).padding, "5px 10px");
    assert.equal(dom.window.getComputedStyle(buttons[1]).padding, "2px");
    assert.equal(dom.window.getComputedStyle(buttons[1]).borderRadius, "20px");
  } finally {
    dom.window.close();
  }
});
test("every structured editor button explicitly uses an app action class", () => {
  const file = new URL(
    "../../desktop/src/features/documents/editor/StructuredDocEditor.tsx",
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

test("desktop actions share compact sizing and touch controls keep their target", () => {
  const css = readFileSync(
    new URL("../../desktop/src/styles/global.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /--button-h: 36px/);
  assert.match(css, /--button-h: 44px/);
  for (const selector of [
    ":where(button)",
    ".primary,\n.secondary",
    ".text-button",
    ".icon-button",
  ])
    assert.ok(css.includes(selector + " {\n  min-height: var(--button-h)"));
  assert.match(
    css,
    /\.segmented button \{\n  min-height: calc\(var\(--button-h\) - 4px\)/,
  );
  const doc = readFileSync(
    new URL(
      "../../desktop/src/features/documents/editor/structured-doc-editor.css",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(doc, /min-height: (?:40|44)px/);
  assert.ok(
    !doc.includes(".structured-doc-toolbar button,"),
    "mode members must not get a second surrounding height",
  );
});

test("routine action overrides use the shared size rather than desktop touch minimums", () => {
  const postcss = require("postcss");
  const root = fileURLToPath(new URL("../../desktop/src", import.meta.url));
  const violations: string[] = [];
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (
        !path.endsWith(".css") ||
        /features\/(home|legal|focus|present)\//.test(path)
      )
        continue;
      postcss.parse(readFileSync(path, "utf8")).walkRules((rule: any) => {
        if (
          !/(button|\.primary|\.secondary|\.text-button|\.icon-button)/.test(
            rule.selector,
          )
        )
          return;
        for (let owner = rule.parent; owner; owner = owner.parent)
          if (
            owner.type === "atrule" &&
            owner.name === "media" &&
            /(pointer|width)/.test(owner.params)
          )
            return;
        rule.walkDecls((decl: any) => {
          if (
            (["min-height", "height"].includes(decl.prop) &&
              /^(40|44)px$/.test(decl.value)) ||
            (decl.prop === "min-width" && decl.value === "44px")
          )
            violations.push(
              `${path}:${decl.source.start.line} ${rule.selector}`,
            );
        });
      });
    }
  }
  visit(root);
  assert.deepEqual(violations, []);
});

test("collection toolbar actions share the field height without resizing routine actions", () => {
  const read = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const global = read("desktop/src/styles/global.css");
  const workspace = read("desktop/src/app/workspace.css");
  assert.match(global, /--collection-control-h: 44px;/);
  assert.match(
    global,
    /\.search\s*\{\s*min-height: var\(--collection-control-h\);/,
  );
  assert.match(
    workspace,
    /\.app\.workspace \.workspace-task-toolbar > \.secondary\s*\{\s*min-height: var\(--collection-control-h\);/,
  );
  assert.match(
    workspace,
    /\.app\.workspace \.tasks-tools > \.segmented\s*\{\s*box-sizing: border-box;\s*min-height: var\(--collection-control-h\);/,
  );
  assert.match(global, /--button-h: 36px;/);
});
