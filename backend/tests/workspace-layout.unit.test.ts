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
test("responsive navigation and mobile drawer reference the same accessible navigation", async () => {
  const [app, top, side] = await Promise.all([
    source("app/App.tsx"),
    source("components/Topbar.tsx"),
    source("components/Sidebar.tsx"),
  ]);
  assert.ok(app.includes("sidebarLayout("));
  assert.ok(app.includes("navigationOpen={mobileNav}"));
  assert.ok(!top.includes("onToggleRail"));
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
    'setLayout("list")',
    'setLayout("board")',
  ])
    assert.ok(task.includes(action), action);
  assert.match(task, /const filtersId = useId\(\);/);
  assert.match(task, /aria-controls=\{filtersId\}/);
  assert.match(task, /id=\{filtersId\}/);
  assert.ok(task.includes("workspace-task-toolbar"));
});

test("booking inbox responds to the measured pane without containing its fixed editor", async () => {
  const [view, css] = await Promise.all([
    source("features/booking/BookingView.tsx"),
    source("features/booking/booking.css"),
  ]);
  assert.ok(view.includes("const pane = useElementWidth();"));
  assert.ok(view.includes("ref={pane.ref}"));
  assert.ok(view.includes("pane.width < 700"));
  assert.ok(view.includes("pane.width < 560"));
  assert.match(
    css,
    /\.booking-workspace\.is-narrow \.booking-row\s*\{[^}]*grid-template-columns: 64px minmax\(0, 1fr\);/,
  );
  assert.match(
    css,
    /\.booking-workspace\.is-small \.booking-stats\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.ok(!/\.booking-workspace\s*\{[^}]*container-type:/.test(css));
});

test("public booking days keep touch width while consent retains essential consequences", async () => {
  const [booking, oauth, consent] = await Promise.all([
    source("features/booking/booking.css"),
    source("features/auth/oauth.css"),
    source("features/auth/OAuthConsent.tsx"),
  ]);
  assert.match(
    booking,
    /\.date-strip\s*\{[^}]*minmax\(44px, 1fr\)[^}]*overflow-x: auto;/,
  );
  assert.match(oauth, /\.oauth-check\s*\{[^}]*min-height: 44px;/);
  for (const consequence of [
    "delete your items",
    "30 days to undo",
    "batches over 50",
    "Teammates’ work",
    "invitations",
    "publishing",
  ])
    assert.ok(consent.includes(consequence), consequence);
  assert.ok(consent.includes("disabled={busy || needsReauth}"));
  assert.ok(consent.includes("onClick={() => void deny()}"));
});
