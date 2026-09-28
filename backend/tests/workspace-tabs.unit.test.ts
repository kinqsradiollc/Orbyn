import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeTab,
  initialTabs,
  placeOf,
  restoreTabs,
  saveTabs,
  TAB_LIMIT,
  tabsReducer,
  type TabAction,
  type TabPlace,
  type TabsState,
} from "@orbyn/core";

/** Tabs on the web app (W4): the pure state behind the strip. */

const at = (view: string, id: string | null = null, title = ""): TabPlace => ({
  view,
  id,
  title,
});
const run = (state: TabsState, ...actions: TabAction[]) =>
  actions.reduce(tabsReducer, state);
const views = (s: TabsState) => s.tabs.map((t) => placeOf(t).view);

test("going somewhere moves the tab in front, with back and forward", () => {
  let s = run(initialTabs(), { type: "go", place: at("Calendar") });
  assert.equal(placeOf(activeTab(s)).view, "Calendar");
  assert.equal(s.moves, 1);
  s = run(s, { type: "back" });
  assert.equal(placeOf(activeTab(s)).view, "Overview");
  s = run(s, { type: "forward" });
  assert.equal(placeOf(activeTab(s)).view, "Calendar");
  // Going somewhere new after going back drops what was ahead.
  s = run(s, { type: "back" }, { type: "go", place: at("Docs") });
  assert.deepEqual(
    activeTab(s).history.map((p) => p.view),
    ["Overview", "Docs"],
  );
});

test("a screen opening one of its things is one step, and the same place is none", () => {
  let s = run(
    initialTabs(),
    { type: "go", place: at("Docs") },
    { type: "go", place: at("Docs", "d1", "Notes") },
  );
  assert.equal(activeTab(s).history.length, 2);
  assert.deepEqual(placeOf(activeTab(s)), at("Docs", "d1", "Notes"));
  const same = run(s, { type: "go", place: at("Docs", "d1", "Notes") });
  assert.equal(same, s);
  s = run(s, { type: "go", place: at("Docs", "d2", "Plan") });
  assert.equal(activeTab(s).history.length, 3);
});

test("opening a tab puts it beside this one, in front unless asked not to", () => {
  let s = run(initialTabs(), {
    type: "open",
    place: at("Projects", "p1", "Launch"),
  });
  assert.equal(s.tabs.length, 2);
  assert.equal(placeOf(activeTab(s)).id, "p1");
  s = run(s, { type: "open", place: at("Docs", "d1"), background: true });
  s = run(s, { type: "open", place: at("Calendar"), background: true });
  assert.equal(placeOf(activeTab(s)).id, "p1");
  // Behind the front one, they line up at the end in the order opened.
  assert.deepEqual(views(s), ["Overview", "Projects", "Docs", "Calendar"]);
  s = run(
    s,
    { type: "select", key: "t1" },
    { type: "open", place: at("Lists") },
  );
  assert.deepEqual(views(s), [
    "Overview",
    "Lists",
    "Projects",
    "Docs",
    "Calendar",
  ]);
});

test("a ninth tab closes the oldest unpinned one", () => {
  let s = initialTabs();
  s = run(s, { type: "pin", key: s.active, pinned: true });
  for (let i = 1; i < TAB_LIMIT; i++)
    s = run(s, { type: "open", place: at("Docs", `d${i}`) });
  assert.equal(s.tabs.length, TAB_LIMIT);
  s = run(s, { type: "open", place: at("Docs", "d9") });
  assert.equal(s.tabs.length, TAB_LIMIT);
  const ids = s.tabs.map((t) => placeOf(t).id);
  // The pinned Overview stays; d1, the oldest unpinned, went.
  assert.equal(ids[0], null);
  assert.ok(!ids.includes("d1"));
  assert.ok(ids.includes("d9"));
  assert.equal(placeOf(activeTab(s)).id, "d9");
});

test("with every tab pinned, opening goes there in this tab instead", () => {
  let s = initialTabs();
  for (let i = 1; i < TAB_LIMIT; i++)
    s = run(s, { type: "open", place: at("Docs", `d${i}`) });
  for (const t of s.tabs) s = run(s, { type: "pin", key: t.key, pinned: true });
  s = run(s, { type: "open", place: at("Calendar") });
  assert.equal(s.tabs.length, TAB_LIMIT);
  assert.equal(placeOf(activeTab(s)).view, "Calendar");
});

test("closing moves to the neighbour on the right, and the last tab stays", () => {
  let s = run(
    initialTabs(),
    { type: "open", place: at("Calendar") },
    { type: "open", place: at("Docs") },
    { type: "select", key: "t2" },
  );
  s = run(s, { type: "close", key: "t2" });
  assert.deepEqual(views(s), ["Overview", "Docs"]);
  assert.equal(placeOf(activeTab(s)).view, "Docs");
  s = run(s, { type: "close", key: activeTab(s).key });
  assert.equal(s.tabs.length, 1);
  assert.equal(run(s, { type: "close", key: s.active }), s);
});

test("⌘⇧T reopens the last closed tab where it was", () => {
  let s = run(
    initialTabs(),
    { type: "open", place: at("Docs", "d1", "Notes") },
    { type: "go", place: at("Docs", "d2", "Plan") },
  );
  s = run(s, { type: "close", key: s.active });
  assert.equal(s.tabs.length, 1);
  s = run(s, { type: "reopen" });
  assert.equal(s.tabs.length, 2);
  assert.equal(placeOf(activeTab(s)).id, "d2");
  // Its history came back too.
  assert.equal(placeOf(run(s, { type: "back" }).tabs[1]).id, "d1");
  assert.equal(run(s, { type: "reopen" }), s);
});

test("pinned tabs sit on the left; close others and to the right spare them", () => {
  let s = run(
    initialTabs(),
    { type: "open", place: at("Calendar") },
    { type: "open", place: at("Docs") },
    { type: "open", place: at("Projects") },
  );
  s = run(s, { type: "pin", key: "t3", pinned: true });
  assert.deepEqual(views(s), ["Docs", "Overview", "Calendar", "Projects"]);
  s = run(s, { type: "move", key: "t1", before: "t3" });
  // A tab can't go ahead of the pinned ones.
  assert.deepEqual(views(s), ["Docs", "Overview", "Calendar", "Projects"]);
  s = run(s, { type: "move", key: "t4", before: "t1" });
  assert.deepEqual(views(s), ["Docs", "Projects", "Overview", "Calendar"]);
  const right = run(s, { type: "closeRight", key: "t4" });
  assert.deepEqual(views(right), ["Docs", "Projects"]);
  const others = run(s, { type: "closeOthers", key: "t2" });
  assert.deepEqual(views(others), ["Docs", "Calendar"]);
  assert.equal(placeOf(activeTab(others)).view, "Calendar");
});

test("Ctrl+Tab goes round the tabs both ways", () => {
  let s = run(
    initialTabs(),
    { type: "open", place: at("Calendar") },
    { type: "open", place: at("Docs") },
  );
  s = run(s, { type: "cycle", step: 1 });
  assert.equal(placeOf(activeTab(s)).view, "Overview");
  s = run(s, { type: "cycle", step: -1 });
  assert.equal(placeOf(activeTab(s)).view, "Docs");
});

test("a renamed thing is renamed in every tab showing it", () => {
  const s = run(
    initialTabs(),
    { type: "open", place: at("Docs", "d1", "Notes") },
    { type: "open", place: at("Docs", "d1", "Notes") },
    { type: "retitle", view: "Docs", id: "d1", title: "Minutes" },
  );
  assert.deepEqual(
    s.tabs.map((t) => placeOf(t).title),
    ["", "Minutes", "Minutes"],
  );
});

test("tabs are kept per device and come back, without what's gone", () => {
  let s = run(
    initialTabs(),
    { type: "open", place: at("Docs", "d1", "Notes") },
    { type: "open", place: at("Projects", "p1", "Launch") },
    { type: "pin", key: "t2", pinned: true },
  );
  const back = restoreTabs(saveTabs(s));
  assert.deepEqual(back.tabs, s.tabs);
  assert.equal(back.active, s.active);
  assert.deepEqual(back.closed, []);
  // New tabs get fresh keys.
  const more = run(back, { type: "open", place: at("Calendar") });
  assert.equal(new Set(more.tabs.map((t) => t.key)).size, 4);
  // A screen that no longer exists is left out.
  const known = restoreTabs(saveTabs(s), (v) => v !== "Projects");
  assert.deepEqual(views(known), ["Docs", "Overview"]);
  // A page that's gone drops its tab; the front one moves on.
  s = run(back, { type: "drop", keys: ["t3"] });
  assert.equal(s.tabs.length, 2);
  assert.ok(s.tabs.some((t) => t.key === s.active));
  assert.deepEqual(views(run(s, { type: "drop", keys: ["t1", "t2"] })), [
    "Overview",
  ]);
});

test("unreadable saved tabs start again at one tab", () => {
  for (const saved of [null, "", "not json", "[]", '{"tabs":[{"key":1}]}'])
    assert.deepEqual(restoreTabs(saved), initialTabs());
  const trimmed = restoreTabs(
    JSON.stringify({
      tabs: Array.from({ length: 12 }, (_, i) => ({
        key: `t${i + 1}`,
        history: [{ view: "Docs", id: `d${i}`, title: "" }],
        at: 99,
        opened: i + 1,
      })),
      active: "t12",
    }),
  );
  assert.equal(trimmed.tabs.length, TAB_LIMIT);
  assert.equal(trimmed.active, "t1");
  assert.equal(trimmed.tabs[0].at, 0);
});
