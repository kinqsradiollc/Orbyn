import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const source = readFileSync(
  new URL("../../desktop/src/app/chrome/SidebarResizer.tsx", import.meta.url),
  "utf8",
);
function load(saved: string | null = null) {
  const exports: any = {};
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      require: () => ({}),
      localStorage: { getItem: () => saved },
    },
  );
  return exports;
}
test("remembered navigation accepts the icon rail and valid labelled widths", () => {
  for (const [saved, expected] of [
    ["72", 72],
    ["180", 180],
    ["320", 320],
    [null, 224],
    ["120", 224],
    ["900", 224],
    ["invalid", 224],
  ])
    assert.equal(load(saved as string | null).savedSidebarWidth(), expected);
});
test("responsive fitting preserves the preferred width for wider windows", () => {
  const { sidebarLayout } = load();
  assert.equal(sidebarLayout(320, 1000).width, 72);
  assert.equal(sidebarLayout(320, 1200).width, 320);
  assert.equal(sidebarLayout(320, 1600).width, 320);
  assert.equal(sidebarLayout(72, 1600).railed, true);
  assert.equal(sidebarLayout(72, 390).railed, false);
  assert.equal(sidebarLayout(72, 390).width, 224);
});
test("drag widths snap to the same icon rail; resizer remains reachable in rail mode", () => {
  const { boundedSidebarWidth } = load();
  assert.equal(boundedSidebarWidth(179), 72);
  assert.equal(boundedSidebarWidth(180), 180);
  assert.equal(boundedSidebarWidth(700), 400);
  assert.equal(boundedSidebarWidth(200, 100), 72);
  const sidebar = readFileSync(
    new URL("../../desktop/src/app/chrome/Sidebar.tsx", import.meta.url),
    "utf8",
  );
  assert.match(sidebar, /\{onResize && <SidebarResizer/);
  assert.doesNotMatch(sidebar, /!railed && onResize/);
  assert.match(source, /width === SIDEBAR_RAIL_WIDTH\s*\? SIDEBAR_LABEL_WIDTH/);
  assert.doesNotMatch(source, /latest.current.onChange/);
});

test("new sessions start labelled while the saved compact rail offers labels on hover and focus", () => {
  const sidebar = readFileSync(
    new URL("../../desktop/src/app/chrome/Sidebar.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(load().savedSidebarWidth(), 224);
  assert.equal(load("72").savedSidebarWidth(), 72);
  assert.match(sidebar, /onMouseOver=\{/);
  assert.match(sidebar, /onFocus=\{/);
  assert.match(sidebar, /role="tooltip"/);
  assert.match(sidebar, /createPortal\(/);
});
