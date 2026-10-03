import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = async (path: string) =>
  readFile(new URL(`../../desktop/src/${path}`, import.meta.url), "utf8");
test("the workspace layout is signed-in scoped and keeps palette values in theme tokens", async () => {
  const css = await source("app/workspace.css");
  assert.ok(css.includes(".app.workspace"));
  assert.ok(!/(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()/i.test(css));
  assert.ok(css.includes("var(--color-canvas)"));
  assert.ok(css.includes(".content:has(.docs-nav-page)"));
});
test("desktop rail and mobile drawer controls reference the same accessible navigation", async () => {
  const [app, top, side] = await Promise.all([
    source("app/App.tsx"),
    source("components/Topbar.tsx"),
    source("components/Sidebar.tsx"),
  ]);
  assert.ok(app.includes("onToggleRail={toggleRail}"));
  assert.ok(app.includes("navigationOpen={mobileNav}"));
  assert.ok(top.includes('aria-controls="workspace-navigation"'));
  assert.ok(top.includes("aria-expanded={navigationOpen}"));
  assert.ok(side.includes('id="workspace-navigation"'));
  assert.ok(side.includes("aria-current="));
});
test("compact layouts preserve touch targets and never show a clipped rail wordmark", async () => {
  const css = await source("app/workspace.css");
  assert.ok(css.includes("@media (max-width: 800px)"));
  assert.ok(css.includes("@media (pointer: coarse)"));
  assert.ok(css.includes("min-height: 44px"));
  assert.ok(
    /\.app\.workspace\.is-railed \.brand-name\s*\{\s*display: none/.test(css),
  );
});
test("task-toolbar restructuring preserves all search, layout, filters and saved-view actions", async () => {
  const task = await source("features/tasks/TasksView.tsx");
  for (const action of [
    'aria-label="Search items"',
    'aria-label="Saved view options"',
    'aria-label="Done this week"',
    'aria-label="Layout"',
    'aria-controls="task-filters"',
    'setLayout("list")',
    'setLayout("board")',
  ])
    assert.ok(task.includes(action), action);
  assert.ok(task.includes("workspace-task-toolbar"));
});
