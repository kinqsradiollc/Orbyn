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
    "mobile/src/screens/TasksScreen.tsx",
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
  const mobile = read("mobile/src/components/HomeCompanions.tsx");
  assert.match(mobile, /accessibilityLabel=\{`Open \$\{agent.name\} work`\}/);
  assert.match(mobile, /setOpenLane\([\s\S]*?setAgentsOpen\(true\)/);
  assert.match(mobile, /accessibilityState=\{\{ expanded: guideOpen \}\}/);
  assert.match(mobile, /onPress=\{\(\) => setGuideOpen\(!guideOpen\)\}/);
  assert.match(mobile, /\{guideOpen && \(\s*<View/);
  assert.match(mobile, /\{guideOpen && expanded && \(/);
});
