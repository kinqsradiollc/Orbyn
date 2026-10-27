import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("web view arrangement controls live in the labelled filter disclosure", () => {
  const source = read("desktop/src/features/views/ViewsView.tsx");
  const toolbar = source.slice(
    source.indexOf('<div className="views-toolbar">'),
    source.indexOf("{filtersOpen && ("),
  );
  const options = source.slice(
    source.indexOf("{filtersOpen && ("),
    source.indexOf("{!view.can_edit &&"),
  );
  assert.ok(toolbar.includes('aria-controls="view-filters"'));
  assert.ok(toolbar.includes("layoutsFor(def.source)"));
  assert.ok(!toolbar.includes("VIEW_SORTS.filter"));
  assert.ok(!toolbar.includes("VIEW_GROUPS[def.source]"));
  assert.ok(options.includes('id="view-filters"'));
  assert.ok(options.includes('aria-label="Filters and sort"'));
  assert.ok(options.includes("VIEW_SORTS.filter"));
  assert.ok(options.includes("VIEW_GROUPS[def.source]"));
  assert.ok(options.includes("sourceFields.map"));
  assert.ok(options.includes("<ViewFilters"));
  assert.ok(options.includes("onChange={(filters) => change({ filters })}"));
});

test("view table overflow region is keyboard focusable and named", () => {
  const source = read("desktop/src/features/views/ViewTable.tsx");
  assert.match(
    source,
    /className="view-table-wrap"\s+tabIndex=\{0\}\s+role="region"\s+aria-label="View table"/,
  );
});

test("view library keeps concise empty copy and native arrangement disclosure", () => {
  const web = read("desktop/src/features/views/ViewsView.tsx");
  const mobile = read("mobile/src/features/views/ViewsSheet.tsx");
  assert.ok(
    web.includes("New view"),
    "the empty library retains its creation action",
  );
  assert.ok(web.includes("No view open"));
  assert.ok(!mobile.includes("like\n              “Exam week”"));
  assert.ok(mobile.includes('title="Filter, group and sort"'));
  assert.ok(mobile.includes('accessibilityLabel="Search saved views"'));
  assert.ok(mobile.includes('label="New view"'));
});

test("view layouts bound title widths and retain horizontal table containment", () => {
  const css = read("desktop/src/features/views/views.css");
  assert.match(
    css,
    /\.views-title\s*\{[^}]*min-width: 0;[^}]*flex: 1 1 180px;/,
  );
  assert.match(
    css,
    /\.views-arrangement \.filter-select\s*\{[^}]*flex: 1 1 180px;[^}]*min-width: 0;/,
  );
  assert.match(css, /\.view-table-wrap\s*\{[^}]*overflow-x: auto;/);
  assert.match(css, /\.views-rail-item\s*\{[^}]*max-width: 100%;/);
  assert.match(
    css,
    /\.views-actions\s*\{[^}]*flex-wrap: wrap;[^}]*max-width: 100%;/,
  );
});

test("mobile page gallery adapts to its pane and field labels can wrap", () => {
  const body = read("mobile/src/features/views/ViewBody.tsx");
  const fields = read("mobile/src/features/views/FieldsSection.tsx");
  assert.match(body, /const pane = usePaneWidth\(\);/);
  assert.match(body, /style=\{s.gallery\} onLayout=\{pane.onLayout\}/);
  assert.match(body, /pane.width < 480 && s.gallerySingle/);
  assert.match(body, /gallerySingle: \{ flexBasis: "100%" \}/);
  assert.match(fields, /<Text style=\{s.name\}>/);
  assert.match(fields, /switchLabel: \{ flex: 1, minWidth: 0 \}/);
});
