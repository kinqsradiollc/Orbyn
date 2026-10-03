import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchSavedViews, fullDefinition, type SavedView } from "@orbyn/core";

const views: SavedView[] = [
  {
    id: "personal",
    name: "Résumé review",
    source: "tasks",
    definition: fullDefinition({ source: "tasks", layout: "board" }),
    team_name: null,
  },
  {
    id: "team",
    name: "Lab reports",
    source: "pages",
    definition: fullDefinition({ source: "pages", layout: "gallery" }),
    team_name: "Health research",
  },
] as SavedView[];

test("saved-view library searches names, teams, source and layout with the same rules", () => {
  assert.deepEqual(searchSavedViews(views, "  RESUME board "), [views[0]]);
  assert.deepEqual(searchSavedViews(views, "health gallery"), [views[1]]);
  assert.deepEqual(searchSavedViews(views, "tasks"), [views[0]]);
  assert.deepEqual(searchSavedViews(views, "lab health"), [views[1]]);
  assert.deepEqual(searchSavedViews(views, "lab board"), []);
  assert.deepEqual(searchSavedViews(views, "[.*]"), []);
});

test("blank library queries preserve order and references without mutating definitions", () => {
  const before = JSON.stringify(views);
  const result = searchSavedViews(views, " \n ");
  assert.deepEqual(result, views);
  assert.notEqual(result, views);
  assert.equal(result[0], views[0]);
  assert.equal(JSON.stringify(views), before);
  assert.deepEqual(searchSavedViews([], "anything"), []);
});

test("both clients wire library search separately from selected rows and view filters", () => {
  for (const path of [
    "desktop/src/features/views/ViewsView.tsx",
    "mobile/src/screens/views/ViewsSheet.tsx",
  ]) {
    const source = readFileSync(
      new URL(`../../${path}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /searchSavedViews\(/);
    assert.match(source, /Search saved views/);
    assert.match(source, /No matching views\./);
    assert.match(source, /setLibraryQuery/);
  }
  const css = readFileSync(
    new URL("../../desktop/src/features/views/views.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /max-height: calc\(100dvh - 100px\)/);
  assert.match(css, /overflow-wrap: anywhere/);
});
