import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyPlans, HOME_AGENT_GUIDE } from "@orbyn/core";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("shared task empty state names the state and next action directly", () => {
  assert.equal(emptyPlans.title, "No tasks yet");
  assert.equal(emptyPlans.body, "Add a task or event.");
  for (const path of [
    "desktop/src/features/tasks/TasksView.tsx",
    "mobile/src/features/tasks/TasksScreen.tsx",
  ]) {
    assert.match(read(path), /Add task/);
    assert.match(read(path), /Search tasks/);
  }
});

test("compact task controls preserve named saved-view, progress and filter actions", () => {
  const source = read("desktop/src/features/tasks/TasksView.tsx");
  assert.match(source, /aria-label="Saved view options"/);
  assert.match(source, /aria-label="Done this week"/);
  assert.match(source, /const filtersId = useId\(\);/);
  assert.match(source, /aria-controls=\{filtersId\}/);
  assert.match(source, /id=\{filtersId\}/);
  assert.match(source, /aria-label="Layout"/);
  assert.match(source, /onClick=\{\(\) => setLayout\("board"\)\}/);
  const css = read("desktop/src/styles/planning.css");
  assert.match(css, /\.tasks-heading \.tasks-tools \{\s*display: flex;/);
  assert.match(
    css,
    /\.tasks-heading \.tasks-view-button span \{\s*display: none;/,
  );
  assert.match(
    css,
    /\.tasks-heading \.tasks-tools > \.search \{\s*flex: 1 1 100%;/,
  );
});

test("agent summaries stay short while detailed examples remain available", () => {
  for (const guide of HOME_AGENT_GUIDE) {
    assert.ok(guide.brief.split(/\s+/).length <= 5);
    assert.ok(guide.steps.length > 0);
    assert.ok(guide.pause && guide.result && guide.request);
  }
});

test("Home agent rows open activity and optional guide and characters retain disclosure controls", () => {
  // ADR 003 made each lane an activity action and moved optional guidance below it.
  const web = read("desktop/src/features/overview/HomeCompanions.tsx");
  assert.match(
    web,
    /className="home-agent-row"[\s\S]*?onClick=\{\(\) => setAgentsOpen\(true\)\}/,
  );
  assert.match(web, /aria-haspopup="dialog"/);
  assert.match(web, /aria-expanded=\{guideOpen\}/);
  assert.match(web, /onClick=\{\(\) => setGuideOpen\(!guideOpen\)\}/);
  assert.match(
    web,
    /\{guideOpen && \(\s*<div className="home-companions-guide">/,
  );
  assert.match(web, /\{guideOpen && expanded && \(/);
  const mobile = read("mobile/src/features/home/HomeCompanions.tsx");
  assert.match(mobile, /accessibilityLabel=\{`Open \$\{agent.name\} work`\}/);
  assert.match(mobile, /setOpenLane\([\s\S]*?setAgentsOpen\(true\)/);
  assert.match(mobile, /accessibilityState=\{\{ expanded: guideOpen \}\}/);
  assert.match(mobile, /onPress=\{\(\) => setGuideOpen\(!guideOpen\)\}/);
  assert.match(mobile, /\{guideOpen && \(\s*<View/);
  assert.match(mobile, /\{guideOpen && expanded && \(/);
});

test("Home puts daily work before optional hubs on both clients", () => {
  const web = read("desktop/src/app/App.tsx");
  assert.ok(web.indexOf("<OverviewView") < web.indexOf("<HomeSections"));
  const mobile = read("mobile/src/features/home/TodayScreen.tsx");
  assert.ok(mobile.indexOf("<TodayCard") < mobile.indexOf("<HomeSection"));
  // Optional hubs must still be reachable when there are no planner items.
  assert.ok(
    mobile.indexOf("<HomeSection") < mobile.indexOf("{!items.length ?"),
  );
});

test("Home owns section insets and keeps agenda facts below their titles", () => {
  const overview = read("desktop/src/features/overview/overview.css");
  const workspace = read("desktop/src/app/workspace.css");
  const today = read("desktop/src/features/overview/today.css");
  assert.match(
    overview,
    /\.app\.workspace \.overview-workspace \.section-heading\s*\{\s*padding: 0 0 16px;/,
  );
  const genericGrid = workspace.match(
    /\.app\.workspace \.overview-grid\s*\{([^}]*)\}/,
  )?.[1];
  assert.ok(genericGrid);
  assert.doesNotMatch(genericGrid, /\bgap:/);
  assert.match(today, /\.today-main\s*\{\s*display: grid;/);
  assert.match(
    today,
    /\.app\.workspace \.today-card \.today-action\s*\{\s*min-height: 44px;/,
  );
  assert.match(
    today,
    /\.today-row:has\(\.today-lead\.is-empty\) > \.today-action\s*\{\s*grid-row: 1;/,
  );
});

test("Home task rows inset completion controls from status stripes and align them with titles", () => {
  const css = read("desktop/src/features/overview/overview.css");
  assert.match(
    css,
    /\.overview-main \.item-row\s*\{\s*align-items: flex-start;\s*padding: 14px 16px;/,
  );
  assert.match(
    css,
    /\.overview-main \.item-row > \.check\s*\{\s*margin-top: 3px;/,
  );
  // Preserve the global 44px touch target while aligning its visible checkbox.
  assert.match(
    css,
    /@media \(max-width: 640px\), \(pointer: coarse\)\s*\{\s*\.overview-main \.item-row > \.check\s*\{\s*margin-top: -10px;/,
  );
});

test("Plan today grows with its content instead of a large-screen minimum height", () => {
  const global = read("desktop/src/styles/global.css");
  // The retired 370px desktop minimum stretched a single-action card.
  for (const rule of global.matchAll(/\.assistant-card\s*\{([^}]*)\}/g)) {
    assert.doesNotMatch(rule[1], /\b(?:min-)?height\s*:/);
  }
  const overview = read("desktop/src/features/overview/overview.css");
  assert.match(
    overview,
    /\.overview-aside \.assistant-card\s*\{\s*display: flex;/,
  );
  const view = read("desktop/src/features/overview/OverviewView.tsx");
  assert.match(view, /<button onClick=\{onPlanDay\}>\s*Make a plan/);
});

test("Coming up rows have straight dividers only between adjacent items", () => {
  const css = read("desktop/src/styles/global.css");
  const row = css.match(/\.upcoming\s*\{([^}]*)\}/)?.[1];
  assert.ok(row);
  assert.match(row, /border: 0;/);
  assert.match(row, /border-radius: 0;/);
  assert.doesNotMatch(row, /border-top:/);
  assert.match(
    css,
    /\.upcoming \+ \.upcoming\s*\{\s*border-top: 1px solid var\(--color-divider\);/,
  );
});
