import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchProjects, type Project } from "@orbyn/core";

const project = (
  id: string,
  name: string,
  extra: Partial<Project> = {},
): Project => ({
  id,
  name,
  user_id: "owner",
  team_id: null,
  summary: "",
  status: "active",
  deadline: null,
  doc_id: null,
  created_at: "",
  updated_at: "",
  stages: [],
  task_count: 0,
  done_count: 0,
  ...extra,
});
const projects = [
  project("one", "Café research", {
    aliases: ["COMP90089"],
    summary: "Clinical notes",
    team_id: "team",
    team_name: "Health",
  }),
  project("two", "Launch", { summary: "Publish docs", status: "done" }),
];

test("project library search covers normalized names aliases summaries workspaces and status", () => {
  for (const query of [
    "cafe",
    "CAFE\u0301 clinical",
    "COMP90089 health",
    "clinical\nresearch",
  ])
    assert.deepEqual(
      searchProjects(projects, query).map((p) => p.id),
      ["one"],
    );
  assert.deepEqual(
    searchProjects(projects, "personal done").map((p) => p.id),
    ["two"],
  );
  assert.deepEqual(searchProjects(projects, "research launch"), []);
});
test("project library filtering preserves entry identity, input order and authorized input", () => {
  const snapshot = JSON.stringify(projects);
  assert.deepEqual(searchProjects(projects, "  "), projects);
  assert.equal(searchProjects(projects, "cafe")[0], projects[0]);
  assert.equal(JSON.stringify(projects), snapshot);
  assert.deepEqual(searchProjects([], "private"), []);
});
test("both project clients retain open/create/manage actions while using shared library search", () => {
  const web = readFileSync(
    new URL(
      "../../desktop/src/features/projects/ProjectsView.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const mobile = readFileSync(
    new URL("../../mobile/src/screens/docs/ProjectsSheet.tsx", import.meta.url),
    "utf8",
  );
  for (const source of [web, mobile]) {
    assert.match(source, /searchProjects\(projects \?\? \[\], libraryQuery\)/);
    assert.match(source, /Search projects/);
    assert.match(source, /visibleProjects.map/);
    assert.match(source, /No matching projects/);
  }
  assert.match(web, /newTabClick/);
  assert.match(web, /NewProjectDialog/);
  assert.match(web, /TemplatesDialog/);
  assert.match(mobile, /onLongPress/);
  assert.match(mobile, /setHeldProject\(p\)/);
  assert.match(mobile, /getProject\(p.id\)/);
});
test("project row layout bounds the title/status columns and wraps metadata on narrow screens", () => {
  const css = readFileSync(
    new URL(
      "../../desktop/src/features/projects/projects.css",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    css,
    /grid-template-columns: minmax\(0, 1fr\) minmax\(160px, 220px\)/,
  );
  assert.match(
    css,
    /\.project-card-foot \{\s*display: flex;\s*flex-wrap: wrap/,
  );
  assert.match(
    css,
    /@media \(max-width: 640px\) \{\s*\.project-card \{\s*grid-template-columns: minmax\(0, 1fr\)/,
  );
});
