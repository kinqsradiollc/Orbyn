import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardColumns,
  columnPrefill,
  currentHeading,
  docOutline,
  dropChange,
  durationText,
  groupHeader,
  groupTasks,
  isBoardGroup,
  moveSection,
  NO_GROUP,
  refFromUrl,
  sectionRange,
  showsOutline,
  type DocBlock,
  type GroupNames,
  type Item,
} from "@orbyn/core";

/**
 * Views quick wins (D3b): grouping tasks with totals (DATA-04), board
 * columns and what dragging a card between them changes (DATA-03), and a
 * page's headings as its contents (NAV-03).
 */

let n = 0;
const task = (over: Partial<Item> = {}): Item =>
  ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    version: 1,
    title: `Task ${n}`,
    notes: "",
    kind: "task",
    status: "todo",
    priority: "medium",
    due_at: null,
    end_at: null,
    team_id: null,
    progress: 0,
    tag_ids: [],
    list_id: null,
    ...over,
  }) as Item;

const TEAM = "11111111-1111-4111-8111-111111111111";
const names: GroupNames = {
  lists: [
    {
      id: "l-physics",
      name: "Physics",
      color: "#1",
      team_id: null,
      team_name: null,
    },
    {
      id: "l-team",
      name: "Lab",
      color: "#2",
      team_id: TEAM,
      team_name: "Lab team",
    },
  ],
  tags: [
    { id: "t-exam", name: "exam", color: "#3", team_id: null },
    { id: "t-read", name: "reading", color: "#4", team_id: null },
    { id: "t-team", name: "team tag", color: "#5", team_id: TEAM },
  ],
  projects: [{ id: "p-1", name: "Physics 101" }],
  userId: "me",
  now: new Date(2026, 8, 23, 12), // Wednesday 23 Sep 2026
};

test("durations and group headers read as people write them", () => {
  assert.equal(durationText(0), "0 min");
  assert.equal(durationText(45), "45 min");
  assert.equal(durationText(120), "2 h");
  assert.equal(durationText(200), "3 h 20 min");
  assert.equal(
    groupHeader({ title: "Physics", items: new Array(5), minutes: 200 }),
    "Physics · 5 · 3 h 20 min",
  );
  assert.equal(
    groupHeader({ title: "No list", items: new Array(2), minutes: 0 }),
    "No list · 2",
  );
});

test("groups by list total the open tasks' estimates, 'No list' last", () => {
  const items = [
    task({ list_id: "l-physics", estimate_minutes: 60 }),
    task({ list_id: "l-physics", estimate_minutes: 140 }),
    // Finished work is counted in the group but not in the time ahead.
    task({ list_id: "l-physics", estimate_minutes: 90, status: "done" }),
    task({ estimate_minutes: 30 }),
  ];
  const groups = groupTasks(items, "list", names);
  assert.deepEqual(
    groups.map((g) => [g.key, g.title, g.items.length, g.minutes]),
    [
      ["l-physics", "Physics", 3, 200],
      [NO_GROUP, "No list", 1, 30],
    ],
  );
  assert.equal(groupHeader(groups[0]), "Physics · 3 · 3 h 20 min");
});

test("grouping by tag puts a task in each of its tags; by status in step order", () => {
  const both = task({ tag_ids: ["t-exam", "t-read"] });
  const none = task();
  const tags = groupTasks([both, none], "tag", names);
  assert.deepEqual(
    tags.map((g) => g.title),
    ["exam", "reading", "No tag"],
  );
  const statuses = groupTasks(
    [task({ status: "done" }), task({ status: "blocked" }), task()],
    "status",
    names,
  );
  assert.deepEqual(
    statuses.map((g) => g.key),
    ["todo", "blocked", "done"],
  );
});

test("grouping by project, due week, assignee and priority", () => {
  const byProject = groupTasks(
    [task({ project_id: "p-1" }), task()],
    "project",
    names,
  );
  assert.deepEqual(
    byProject.map((g) => g.title),
    ["Physics 101", "No project"],
  );
  const weeks = groupTasks(
    [
      task({ due_at: new Date(2026, 8, 30).toISOString() }), // next week
      task({ due_at: new Date(2026, 8, 24).toISOString() }), // this week
      task({ due_at: new Date(2026, 8, 20).toISOString() }), // overdue
      task({ due_at: new Date(2026, 9, 14).toISOString() }), // week of 11 Oct
      task(),
    ],
    "due_week",
    names,
  );
  assert.deepEqual(
    weeks.map((g) => g.title),
    ["Overdue", "This week", "Next week", "Week of 11 Oct", "No deadline"],
  );
  const people = groupTasks(
    [
      task({ team_id: TEAM, assignee_id: "me", assignee_name: "Me" }),
      task({ team_id: TEAM, assignee_id: "sam", assignee_name: "Sam" }),
      task({ team_id: TEAM }),
    ],
    "assignee",
    names,
  );
  assert.deepEqual(
    people.map((g) => g.title),
    ["Assigned to me", "Sam", "Not assigned"],
  );
  assert.deepEqual(
    groupTasks(
      [task({ priority: "low" }), task({ priority: "high" })],
      "priority",
    ).map((g) => g.key),
    ["high", "low"],
  );
  assert.equal(groupTasks([task()], "none").length, 1);
});

test("a board shows every column a card could go to, unless empty ones are hidden", () => {
  const items = [task({ list_id: "l-physics" })];
  assert.deepEqual(
    boardColumns(items, "list", names).map((c) => [c.key, c.items.length]),
    [
      ["l-physics", 1],
      ["l-team", 0],
      [NO_GROUP, 0],
    ],
  );
  assert.deepEqual(
    boardColumns(items, "list", names, { hideEmpty: true }).map((c) => c.key),
    ["l-physics"],
  );
  assert.deepEqual(
    boardColumns(items, "status", names, { statuses: ["todo", "done"] }).map(
      (c) => c.key,
    ),
    ["todo", "done"],
  );
  assert.deepEqual(
    boardColumns(items, "priority", names).map((c) => c.key),
    ["high", "medium", "low"],
  );
  assert.equal(isBoardGroup("status"), true);
  assert.equal(isBoardGroup("size"), false);
});

test("dropping a card changes the status, priority or list it was grouped by", () => {
  const t = task({ list_id: "l-physics", tag_ids: ["t-exam"] });
  assert.deepEqual(dropChange(t, "status", "todo", "in_progress", names), {
    ok: true,
    change: { status: "in_progress" },
  });
  assert.equal(dropChange(t, "status", "todo", "todo", names), null);
  assert.deepEqual(dropChange(t, "priority", "medium", "high", names), {
    ok: true,
    change: { priority: "high" },
  });
  assert.deepEqual(dropChange(t, "list", "l-physics", NO_GROUP, names), {
    ok: true,
    change: { list_id: null },
  });
  // A personal task can't go into a team's list, and says why.
  const refused = dropChange(t, "list", "l-physics", "l-team", names);
  assert.equal(refused?.ok, false);
  assert.match((refused as { reason: string }).reason, /Lab team/);
});

test("dropping on a tag column swaps that one tag; assignees only on team tasks", () => {
  const t = task({ tag_ids: ["t-exam", "t-read"] });
  assert.deepEqual(dropChange(t, "tag", "t-exam", NO_GROUP, names), {
    ok: true,
    change: { tag_ids: ["t-read"] },
  });
  const fromNone = task();
  assert.deepEqual(dropChange(fromNone, "tag", NO_GROUP, "t-exam", names), {
    ok: true,
    change: { tag_ids: ["t-exam"] },
  });
  assert.equal(dropChange(t, "tag", "t-exam", "t-team", names)?.ok, false);
  assert.equal(dropChange(t, "assignee", NO_GROUP, "sam", names)?.ok, false);
  const shared = task({ team_id: TEAM });
  assert.deepEqual(dropChange(shared, "assignee", NO_GROUP, "sam", names), {
    ok: true,
    change: { assignee_id: "sam" },
  });
});

test("a column's + starts the task in that column", () => {
  assert.deepEqual(columnPrefill("status", "blocked", names), {
    status: "blocked",
  });
  assert.deepEqual(columnPrefill("list", "l-team", names), {
    list_id: "l-team",
    team_id: TEAM,
  });
  assert.deepEqual(columnPrefill("tag", "t-exam", names), {
    tag_ids: ["t-exam"],
  });
  assert.deepEqual(columnPrefill("priority", "nope", names), {});
});

const page: DocBlock[] = [
  { type: "paragraph", text: "Intro" },
  { type: "heading", level: 1, text: "Method", id: "h-method" },
  { type: "paragraph", text: "Steps" },
  { type: "heading", level: 2, text: "**Kit** list" },
  { type: "bullet", text: "Ruler" },
  { type: "heading", level: 1, text: "Results" },
  { type: "paragraph", text: "Numbers" },
  { type: "heading", level: 2, text: "   " },
];

test("a page's outline is its headings' words, and long pages show it", () => {
  const outline = docOutline(page);
  assert.deepEqual(outline, [
    { index: 1, id: "h-method", level: 1, text: "Method" },
    { index: 3, level: 2, text: "Kit list" },
    { index: 5, level: 1, text: "Results" },
  ]);
  assert.equal(showsOutline(outline), true);
  assert.equal(showsOutline(outline.slice(0, 2)), false);
  assert.equal(currentHeading(outline, 0), -1);
  assert.equal(currentHeading(outline, 2), 0);
  assert.equal(currentHeading(outline, 4), 1);
  assert.equal(currentHeading(outline, 7), 2);
});

test("a section runs to the next heading at its level, and moves whole", () => {
  assert.deepEqual(sectionRange(page, 1), { start: 1, end: 5 });
  assert.deepEqual(sectionRange(page, 3), { start: 3, end: 5 });
  assert.deepEqual(sectionRange(page, 5), { start: 5, end: 8 });
  const moved = moveSection(page, 5, 1);
  assert.deepEqual(
    moved.map((b) => (b.type === "divider" ? "-" : b.text)),
    [
      "Intro",
      "Results",
      "Numbers",
      "   ",
      "Method",
      "Steps",
      "**Kit** list",
      "Ruler",
    ],
  );
  // Into itself, or where it already is: the page is unchanged.
  assert.equal(moveSection(page, 1, 3), page);
  assert.equal(moveSection(page, 1, 5), page);
  const toEnd = moveSection(page, 1, page.length);
  assert.deepEqual(
    toEnd.map((b) => (b.type === "divider" ? "-" : b.text)).slice(-4),
    ["Method", "Steps", "**Kit** list", "Ruler"],
  );
  assert.equal(toEnd.length, page.length);
});

test("a link dropped into a page: ours, or the web app's own address", () => {
  const id = "0b7f6d1e-3c1a-4f7e-9d59-2f0a4b6c8e11";
  assert.deepEqual(refFromUrl(`orbyn://task/${id}`), { kind: "task", id });
  assert.deepEqual(
    refFromUrl(`https://orbyn.dev/app/doc/${id.toUpperCase()}`),
    {
      kind: "doc",
      id,
    },
  );
  assert.deepEqual(refFromUrl(` http://localhost:5174/app/project/${id} `), {
    kind: "project",
    id,
  });
  assert.equal(refFromUrl("https://example.com/somewhere"), null);
  assert.equal(refFromUrl(`https://orbyn.dev/app/doc/${id}/extra`), null);
  assert.equal(refFromUrl(""), null);
});
