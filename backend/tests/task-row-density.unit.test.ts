import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as core from "@orbyn/core";

// Render the production row and its fact/progress components. Only providers,
// drag effects and decorative icons are isolated; this is not pixel evidence.
const modules: Record<string, unknown> = {
  "react/jsx-runtime": jsx,
  "@orbyn/core": core,
  "lucide-react": new Proxy(
    {},
    { get: () => () => React.createElement("svg") },
  ),
  "../../app/planned": { usePlanned: () => ({ byItem: new Map() }) },
  "../../app/planning": {
    usePlanning: () => ({ listById: new Map(), tagById: new Map() }),
  },
  "../planner/planning": { minutesLabel: (n: number) => `${n} min` },
  "../../lib/drag": { startDrag: () => undefined },
  "./tasks-w3.css": {},
  "../features/tasks/tasks-w3.css": {},
};
function load(path: string): any {
  const exports = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL(`../../desktop/src/${path}`, import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(name in modules, `Unexpected row dependency ${name}`);
        return modules[name];
      },
    },
  );
  return exports;
}
modules["./tasks"] = load("features/tasks/tasks.ts");
modules["./ItemFacts"] = load("features/tasks/ItemFacts.tsx");
modules["../../components/ProgressBar"] = load("components/ProgressBar.tsx");
modules["../../components/StatusPill"] = load("components/StatusPill.tsx");
const { ItemRow } = load("features/tasks/ItemRow.tsx");
const item = {
  id: "00000000-0000-4000-a000-000000000001",
  title: "Review the launch brief",
  kind: "task",
  status: "todo",
  priority: "medium",
  notes: "",
  progress: 0,
  remaining_minutes: 60,
  estimate_minutes: 60,
  spent_minutes: 0,
};
const render = (change = {}, readOnly = false) =>
  renderToStaticMarkup(
    React.createElement(ItemRow, {
      item: { ...item, ...change },
      busy: false,
      readOnly,
      onToggle: () => undefined,
      onOpen: () => undefined,
    }),
  );

test("untouched tasks show remaining time once without a zero-value progress bar", () => {
  const html = render();
  assert.doesNotMatch(html, /role="progressbar"/);
  assert.equal((html.match(/60 min/g) ?? []).length, 1);
  assert.match(html, /60 min left/);
  assert.match(html, /Open Review the launch brief/);
});
test("partial progress and spent-vs-estimate facts remain visible", () => {
  const html = render({
    status: "in_progress",
    progress: 45,
    spent_minutes: 20,
    remaining_minutes: 40,
  });
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="45"/);
  assert.match(html, /20 min of 60 min/);
  assert.match(html, /40 min left/);
});
test("completed tasks retain reopening and status without a redundant full bar", () => {
  const html = render({ status: "done", progress: 100 });
  assert.doesNotMatch(html, /role="progressbar"/);
  assert.match(html, /Reopen Review the launch brief/);
  assert.match(html, /Done/);
});
test("a checklist still exposes explicit progress even when no step is complete", () => {
  const html = render({ steps_total: 3, steps_done: 0 });
  assert.match(html, /role="progressbar"/);
  assert.match(html, /0 of 3 steps/);
});
test("read-only tasks remain openable while completion is disabled", () => {
  const html = render({}, true);
  assert.match(html, /disabled=""[^>]*class="check/);
  assert.match(html, /aria-label="Open Review the launch brief"/);
});
