import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clipTypeFor,
  compareLegalVersions,
  linkImportedPage,
  mathReadable,
  nextLegalVersion,
  parseQuickAdd,
  planPagesImport,
} from "@orbyn/core";

test("domain organization preserves decimal separators and legal version punctuation", () => {
  const result = parseQuickAdd("Read ~1,5h", {
    timeZone: "UTC",
    now: new Date("2026-10-27T09:00:00Z"),
  });
  assert.equal(result.input.estimate_minutes, 90);
  assert.equal(nextLegalVersion("2026-10-27.2", "2026-10-27"), "2026-10-27.3");
  assert.ok(compareLegalVersions("2026-10-27.10", "2026-10-27.2") > 0);
});

test("domain organization preserves hostname segments and invisible math delimiters", () => {
  assert.equal(
    clipTypeFor("https://course.moodle.example.edu/courses/1"),
    "assignment",
  );
  assert.equal(
    clipTypeFor("https://notmoodle.example.edu/courses/1"),
    "article",
  );
  assert.equal(mathReadable("\\left. x \\right|"), true);
});

test("document imports retain hidden-file filtering and distinct current/parent path segments", () => {
  const plan = planPagesImport(
    [
      { path: "pages/visible.md", text: "Visible" },
      { path: "pages/.hidden.md", text: "Hidden" },
    ],
    "markdown",
    "Fixture",
  );
  assert.equal(plan.pages.length, 1);
  const linked = linkImportedPage(
    {
      path: "folder/nested/page.md",
      title: "Fixture",
      folder: "folder",
      markdown: "[Parent](../other.md) [Current](./same.md)",
    },
    new Map([
      ["folder/other.md", "parent-fixture"],
      ["folder/nested/same.md", "current-fixture"],
    ]),
    new Map(),
  );
  assert.equal(linked.links, 2);
  assert.match(linked.markdown, /parent-fixture/);
  assert.match(linked.markdown, /current-fixture/);
});
