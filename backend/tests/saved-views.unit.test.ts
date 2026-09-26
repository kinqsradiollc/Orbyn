import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyView,
  calendarDay,
  cellText,
  checkFieldValue,
  columnTotal,
  daysLeft,
  docCover,
  fieldValueText,
  fullDefinition,
  groupRows,
  isEditableColumn,
  isOverdue,
  layoutsFor,
  liveListText,
  parseLiveList,
  viewDefinition,
  viewFileName,
  viewTable,
  viewTotals,
  type CustomField,
  type Item,
  type ViewRow,
} from "@orbyn/core";

/**
 * Saved views and your own fields (D4a), the rules every place that shows a
 * view shares: which rows a definition keeps, their order and groups, the
 * totals line and column summaries, the ready-made computed columns, CSV,
 * the live list block's text and field values.
 */

const NOW = new Date("2026-09-26T10:00:00Z");
const ctx = { userId: "me", now: NOW, timeZone: "UTC" };

let n = 0;
const row = (over: Partial<ViewRow> = {}): ViewRow => ({
  kind: "task",
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  title: `Row ${n}`,
  team_id: null,
  team_name: null,
  project_id: null,
  project_name: null,
  status: "todo",
  due_at: null,
  priority: "medium",
  estimate_minutes: null,
  spent_minutes: 0,
  list_id: null,
  list_name: null,
  tag_ids: [],
  tags: [],
  assignee_id: null,
  assignee_name: null,
  folder_id: null,
  folder_name: null,
  doc_kind: null,
  preview: "",
  cover: null,
  task_count: null,
  done_count: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-20T00:00:00Z",
  fields: {},
  can_write: true,
  ...over,
});
const withItem = (r: ViewRow): ViewRow => ({
  ...r,
  item: {
    id: r.id,
    version: 1,
    title: r.title,
    notes: "",
    kind: "task",
    status: r.status,
    priority: r.priority,
    due_at: r.due_at,
    estimate_minutes: r.estimate_minutes,
    project_id: r.project_id,
    tag_ids: r.tag_ids,
  } as unknown as Item,
});

const stage: CustomField = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "me",
  team_id: null,
  applies_to: "page",
  name: "Stage",
  type: "select",
  options: ["Draft", "Final"],
  on_calendar: false,
  position: 0,
  created_at: "2026-09-01T00:00:00Z",
};
const budget: CustomField = {
  ...stage,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Budget",
  type: "number",
  options: [],
};
const due: CustomField = {
  ...stage,
  id: "33333333-3333-4333-8333-333333333333",
  name: "Essay due",
  type: "date",
  options: [],
  on_calendar: true,
};

test("definitions fill their defaults and refuse what doesn't fit", () => {
  const def = fullDefinition({ source: "tasks" });
  assert.deepEqual(def.sort, { by: "due", dir: "asc" });
  assert.equal(def.group_by, "none");
  assert.equal(def.layout, "table");
  assert.deepEqual(layoutsFor("tasks"), ["list", "board", "table", "calendar"]);
  assert.ok(layoutsFor("pages").includes("gallery"));
  assert.equal(
    viewDefinition.safeParse({ source: "pages", group_by: "size" }).success,
    false,
  );
  assert.equal(
    viewDefinition.safeParse({
      source: "pages",
      group_by: `field:${stage.id}`,
      sort: { by: `field:${due.id}`, dir: "desc" },
      columns: ["title", `field:${budget.id}`],
    }).success,
    true,
  );
  assert.ok(isEditableColumn("tasks", "due"));
  assert.ok(!isEditableColumn("tasks", "spent"));
  assert.ok(isEditableColumn("pages", `field:${stage.id}`));
});

test("filters: status, days ahead, overdue, words and fields", () => {
  const rows = [
    row({ title: "Due today", due_at: "2026-09-26T15:00:00Z" }),
    row({ title: "Due in a week", due_at: "2026-10-03T09:00:00Z" }),
    row({ title: "Late", due_at: "2026-09-20T09:00:00Z" }),
    row({ title: "Finished", status: "done", due_at: "2026-09-27T09:00:00Z" }),
    row({ title: "Someday" }),
  ];
  const run = (filters: object) =>
    applyView(rows, fullDefinition({ source: "tasks", filters }), ctx).rows.map(
      (r) => r.title,
    );
  assert.deepEqual(run({ due_within_days: 7 }), ["Due today", "Due in a week"]);
  assert.deepEqual(run({ overdue: true }), ["Late"]);
  assert.deepEqual(run({ no_due: true }), ["Someday"]);
  assert.deepEqual(run({ status: "done" }), ["Finished"]);
  assert.equal(run({ status: "any" }).length, 5);
  assert.deepEqual(run({ text: "due WEEK" }), ["Due in a week"]);
  assert.deepEqual(run({ due_after: "2026-09-26", due_before: "2026-09-30" }), [
    "Due today",
  ]);

  const pages = [
    row({
      kind: "page",
      status: null,
      title: "Final one",
      fields: { [stage.id]: "Final", [budget.id]: 900 },
    }),
    row({
      kind: "page",
      status: null,
      title: "Draft one",
      fields: { [stage.id]: "Draft", [budget.id]: 1500 },
    }),
    row({ kind: "page", status: null, title: "Unstaged" }),
  ];
  const pick = (fields: object[]) =>
    applyView(
      pages,
      fullDefinition({
        source: "pages",
        filters: { fields } as never,
        sort: { by: "title", dir: "asc" },
      }),
      ctx,
      [stage, budget],
    ).rows.map((r) => r.title);
  assert.deepEqual(pick([{ field: stage.id, op: "is", value: "final" }]), [
    "Final one",
  ]);
  assert.deepEqual(pick([{ field: stage.id, op: "is_not", value: "Final" }]), [
    "Draft one",
    "Unstaged",
  ]);
  assert.deepEqual(pick([{ field: stage.id, op: "empty" }]), ["Unstaged"]);
  assert.deepEqual(pick([{ field: budget.id, op: "after", value: 1000 }]), [
    "Draft one",
  ]);
});

test("sorting puts things without a value last, either way round", () => {
  const rows = [
    row({ title: "B", due_at: "2026-10-02T00:00:00Z" }),
    row({ title: "None" }),
    row({ title: "A", due_at: "2026-09-28T00:00:00Z" }),
  ];
  const order = (dir: "asc" | "desc") =>
    applyView(
      rows,
      fullDefinition({ source: "tasks", sort: { by: "due", dir } }),
      ctx,
    ).rows.map((r) => r.title);
  assert.deepEqual(order("asc"), ["A", "B", "None"]);
  assert.deepEqual(order("desc"), ["B", "A", "None"]);
  const cut = applyView(rows, fullDefinition({ source: "tasks" }), ctx, [], 2);
  assert.equal(cut.rows.length, 2);
  assert.equal(cut.truncated, true);
});

test("groups: tasks as the task list groups them, pages by a field", () => {
  const physics = { id: "p1", name: "Physics" };
  const tasks = [
    row({ title: "Lab", project_id: "p1", estimate_minutes: 120 }),
    row({ title: "Set", project_id: "p1", estimate_minutes: 80 }),
    row({ title: "Loose" }),
  ].map(withItem);
  const groups = groupRows(
    tasks,
    fullDefinition({ source: "tasks", group_by: "project" }),
    { projects: [physics] },
  );
  assert.deepEqual(
    groups.map((g) => [g.title, g.rows.length, g.minutes]),
    [
      ["Physics", 2, 200],
      ["No project", 1, 0],
    ],
  );
  const pages = [
    row({ kind: "page", status: null, fields: { [stage.id]: "Final" } }),
    row({ kind: "page", status: null, fields: { [stage.id]: "Draft" } }),
    row({ kind: "page", status: null }),
  ];
  assert.deepEqual(
    groupRows(
      pages,
      fullDefinition({ source: "pages", group_by: `field:${stage.id}` }),
      { fields: [stage] },
    ).map((g) => g.title),
    ["Draft", "Final", "No Stage"],
  );
});

test("totals: the line under a table and each column's summary", () => {
  const rows = [
    row({
      estimate_minutes: 120,
      spent_minutes: 30,
      due_at: "2026-09-20T00:00:00Z",
    }),
    row({ estimate_minutes: 80, spent_minutes: 10 }),
    row({ status: "done", estimate_minutes: 60 }),
  ];
  assert.equal(
    viewTotals(rows, "tasks", ctx),
    "3 tasks · 3 h 20 min estimated · 1 overdue",
  );
  assert.equal(viewTotals([row({ kind: "page" })], "pages", ctx), "1 page");
  assert.equal(columnTotal(rows, "done"), "1 of 3 done");
  assert.equal(columnTotal(rows, "estimate"), "4 h 20 min");
  assert.equal(columnTotal(rows, "spent"), "40 min");
  assert.equal(columnTotal(rows, "overdue", [], ctx), "1 overdue");
  const pages = [
    row({ kind: "page", fields: { [budget.id]: 100.5 } }),
    row({ kind: "page", fields: { [budget.id]: 20 } }),
  ];
  assert.equal(columnTotal(pages, `field:${budget.id}`, [budget]), "Sum 120.5");
});

test("computed columns: days left, overdue, spent vs estimate", () => {
  const soon = row({
    due_at: "2026-09-29T09:00:00Z",
    estimate_minutes: 120,
    spent_minutes: 70,
  });
  assert.equal(daysLeft(soon, ctx), 3);
  assert.equal(cellText(soon, "days_left", ctx), "3 days left");
  assert.equal(cellText(soon, "spent_vs_estimate", ctx), "1 h 10 min of 2 h");
  const late = row({ due_at: "2026-09-24T09:00:00Z" });
  assert.equal(cellText(late, "days_left", ctx), "2 days late");
  assert.equal(cellText(late, "overdue", ctx), "Overdue");
  assert.equal(isOverdue({ ...late, status: "done" }, ctx), false);
  // A project's deadline counts in whole days.
  const project = row({
    kind: "project",
    status: "active",
    due_at: "2026-09-26T00:00:00Z",
  });
  assert.equal(cellText(project, "days_left", ctx), "Due today");
  assert.equal(
    cellText(row({ spent_minutes: 40 }), "spent_vs_estimate", ctx),
    "40 min spent",
  );
});

test("CSV keeps formulas as text and quotes what it must", () => {
  const rows = [
    row({
      title: '=cmd|"/c calc"!A1',
      tags: [{ id: "t", name: "exam", color: "blue" }],
    }),
    row({ title: "Plain, with a comma" }),
  ];
  const csv = viewTable(rows, ["done", "title", "tags"], ctx);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], "Done,Name,Tags");
  assert.equal(lines[1], `No,"'=cmd|""/c calc""!A1",exam`);
  assert.equal(lines[2], 'No,"Plain, with a comma",');
  // Tab-separated, to paste into a sheet, leaves the tick out.
  assert.equal(
    viewTable(rows, ["done", "title"], ctx, {}, "\t").split("\r\n")[0],
    "Name",
  );
  assert.equal(viewFileName('Exam / week: "1"'), "Exam week 1.csv");
  assert.equal(viewFileName("///"), "View.csv");
});

test("live list blocks keep a view's id or a definition of their own", () => {
  const id = "44444444-4444-4444-8444-444444444444";
  assert.deepEqual(parseLiveList(`view:${id}`), { id, limit: 10 });
  const text = liveListText({
    definition: {
      source: "tasks",
      filters: { project: id, due_within_days: 7 },
    },
    title: "Open action items",
  });
  const back = parseLiveList(text);
  assert.ok(back && "definition" in back);
  assert.equal(back.title, "Open action items");
  assert.deepEqual(back.definition.filters, {
    project: id,
    due_within_days: 7,
  });
  assert.equal(parseLiveList("not json"), null);
  assert.equal(parseLiveList('{"source":"tasks","layout":"gallery"}'), null);
});

test("covers are only Orbyn's own images", () => {
  assert.equal(
    docCover([{ type: "paragraph", text: "![a](/files/x.png)" }]),
    "/files/x.png",
  );
  assert.equal(
    docCover([{ type: "paragraph", text: "![a](https://evil.test/x.png)" }]),
    null,
  );
  assert.equal(
    docCover([{ type: "paragraph", text: "![a](//evil.test/x.png)" }]),
    null,
  );
});

test("field values are checked by type, and read as words", () => {
  assert.deepEqual(checkFieldValue(stage, "final"), {
    ok: true,
    value: "Final",
  });
  assert.equal(checkFieldValue(stage, "Other").ok, false);
  assert.deepEqual(checkFieldValue(budget, "12.5"), { ok: true, value: 12.5 });
  assert.equal(checkFieldValue(budget, "twelve").ok, false);
  assert.deepEqual(checkFieldValue(budget, ""), { ok: true, value: null });
  assert.deepEqual(checkFieldValue(due, "2026-10-02"), {
    ok: true,
    value: "2026-10-02",
  });
  assert.equal(checkFieldValue(due, "2026-13-40").ok, false);
  assert.equal(
    checkFieldValue({ ...stage, type: "checkbox" }, "yes").ok,
    false,
  );
  assert.equal(
    checkFieldValue({ ...stage, type: "person" }, "someone").ok,
    false,
  );
  assert.deepEqual(checkFieldValue({ ...stage, type: "text" }, "  "), {
    ok: true,
    value: null,
  });
  assert.equal(fieldValueText(due, "2026-10-02"), "2 Oct 2026");
  assert.equal(fieldValueText({ ...stage, type: "checkbox" }, true), "Yes");
  assert.equal(
    fieldValueText({ ...stage, type: "person" }, "u1", [
      { id: "u1", name: "Ada" },
    ]),
    "Ada",
  );
  // The calendar layout puts a page on its date field's day.
  const def = fullDefinition({
    source: "pages",
    layout: "calendar",
    date_by: `field:${due.id}`,
  });
  assert.equal(
    calendarDay(
      row({ kind: "page", fields: { [due.id]: "2026-10-02" } }),
      def,
      "UTC",
    ),
    "2026-10-02",
  );
  assert.equal(calendarDay(row({ kind: "page" }), def, "UTC"), null);
});
