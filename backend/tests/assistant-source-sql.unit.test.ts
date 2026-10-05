import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantSourceVisible } from "../src/lib/assistant-source-visibility.js";

test("known source families emit only their existing permission branch", () => {
  const scope = { user: "$1", teams: "$2", personal: false, ai: true };
  const dynamic = assistantSourceVisible("s.kind", "s.id", "$1", false, scope);
  for (const kind of [
    "page",
    "doc",
    "project",
    "team",
    "calendar",
    "task",
    "record",
    "routine",
    "habit",
    "goal",
    "comment",
    "exam",
  ]) {
    const literal = assistantSourceVisible(
      `'${kind}'`,
      "s.id",
      "$1",
      false,
      scope,
    );
    assert.ok(literal.length < dynamic.length);
    assert.ok(dynamic.includes(`WHEN '${kind}' THEN ${literal.slice(1, -1)}`));
  }
  const task = assistantSourceVisible("'task'", "s.id", "$1", false, scope);
  assert.ok(task.includes("items source_item"));
  assert.ok(!task.includes("study_exams"));
  assert.ok(!task.includes("assistant_page_bindings"));
  assert.ok(dynamic.includes("WHEN 'exam'"));
  assert.ok(dynamic.includes("ELSE false END"));
  assert.ok(!dynamic.includes("WHEN 'job'"));
  assert.ok(assistantSourceVisible("s.kind", "s.id").includes("WHEN 'job'"));
});
