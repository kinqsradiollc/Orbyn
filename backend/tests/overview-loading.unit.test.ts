import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function render(phase: string, current: boolean) {
  const noop = () => null;
  const module = { exports: {} as any };
  const mocks: Record<string, unknown> = {
    "./overview.css": {},
    "../../hooks/useElementWidth": {
      useElementWidth: () => ({ ref: null, width: 1000 }),
    },
    "../../app/planned": {
      usePlanned: () => ({
        ready: true,
        today: current
          ? { rows: [{ item_id: "due-task", title: "Due task" }] }
          : null,
      }),
    },
    "../../app/prefs": { usePrefs: () => ({ viewChoice: () => ({}) }) },
    "@orbyn/core": { ...require("@orbyn/core"), todayIsCurrent: () => current },
    "./TodayCard": {
      TodayCard: ({ today, onOpen }: any) =>
        React.createElement(
          "button",
          { onClick: () => onOpen(today.rows[0].item_id) },
          today.rows[0].title,
        ),
    },
    "./MorningReview": {
      MorningReview: () => React.createElement("section", null, "Recent work"),
    },
    "../../components/EmptyState": {
      EmptyState: ({ title }: any) => React.createElement("p", null, title),
    },
    "./UpNextCard": { UpNextCard: noop },
    "./AssistantIdeasCard": { AssistantIdeasCard: noop },
    "../tasks/ItemRow": { ItemRow: noop },
    "../../components/ProgressBar": { ProgressBar: noop },
    "../../components/StatusPill": { StatusPill: noop },
    "../tasks/tasks": { progressOf: () => 0 },
  };
  runInNewContext(
    transformSync(
      readFileSync(
        new URL(
          "../../desktop/src/features/overview/OverviewView.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      { loader: "tsx", format: "cjs", jsx: "automatic" },
    ).code,
    {
      module,
      exports: module.exports,
      require: (id: string) => (id in mocks ? mocks[id] : require(id)),
    },
  );
  return renderToStaticMarkup(
    React.createElement(module.exports.OverviewView, {
      items: [],
      itemsPhase: phase,
      onNavigate: noop,
      onOpenById: noop,
      onRetryItems: noop,
    }),
  );
}
test("current Today records remain visible while the complete task inventory loads or fails", () => {
  for (const phase of ["loading", "error"]) {
    const html = render(phase, true);
    assert.match(html, /Due task/);
    assert.match(html, /Recent work/);
    assert.match(
      html,
      phase === "loading"
        ? /Loading your tasks/
        : /Your tasks couldn&#x27;t be loaded/,
    );
    if (phase === "error") assert.match(html, /Retry/);
    assert.doesNotMatch(html, /No tasks yet/);
  }
});
test("without current Today data, loading and failure never become an empty success", () => {
  assert.match(render("loading", false), /Loading your tasks/);
  assert.match(render("error", false), /Your tasks couldn&#x27;t be loaded/);
  assert.match(render("ready", false), /No tasks yet/);
  assert.doesNotMatch(render("loading", false), /Due task/);
});
