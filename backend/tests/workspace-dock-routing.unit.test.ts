import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  dockReducer,
  initialDock,
} from "../../desktop/src/app/workspace-dock-state";
const source = readFileSync(
  new URL("../../desktop/src/app/App.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "App.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function actual(name: string, context: Record<string, unknown>) {
  let expression: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
      expression = node.initializer;
    if (
      name === "chromeRun.current" &&
      ts.isBinaryExpression(node) &&
      node.left.getText(ast) === name
    )
      expression = node.right;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, `actual ${name} exists`);
  const js = ts.transpileModule(
    `const actual = ${expression.getText(ast)}; actual`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return runInNewContext(js, context);
}
test("dock deduplicates Notifications and object identities, retains inactive state and restores neighboring tab", () => {
  let state = initialDock("a");
  state = dockReducer(state, { type: "open", account: "a" });
  state = dockReducer(state, { type: "open", account: "a" });
  assert.equal(state.tabs.length, 1);
  state = dockReducer(state, {
    type: "open",
    account: "a",
    target: { kind: "doc", id: "one" },
  });
  const retained = state.tabs[0];
  state = dockReducer(state, {
    type: "open",
    account: "a",
    target: { kind: "project", id: "one" },
  });
  assert.equal(state.tabs.length, 3);
  assert.equal(state.tabs[0], retained);
  state = dockReducer(state, {
    type: "close",
    account: "a",
    id: state.activeId,
  });
  assert.equal(state.activeId, "object:doc:one");
  state = dockReducer(state, { type: "hide", account: "a" });
  assert.equal(state.open, false);
  assert.equal(state.tabs.length, 2);
  state = dockReducer(state, { type: "open", account: "a" });
  assert.equal(state.open, true);
  assert.equal(state.tabs.length, 2);
  state = dockReducer(state, {
    type: "close",
    account: "a",
    id: "object:doc:one",
  });
  state = dockReducer(state, {
    type: "close",
    account: "a",
    id: "notifications",
  });
  assert.equal(state.open, false);
  assert.equal(state.activeId, "");
});
test("account reset discards mounted panel identities and late old-account events cannot repopulate", () => {
  const opened = dockReducer(initialDock("a"), { type: "open", account: "a" });
  const reset = dockReducer(opened, { type: "reset", account: "b" });
  assert.deepEqual(reset, initialDock("b"));
  assert.equal(dockReducer(reset, { type: "open", account: "a" }), reset);
  assert.equal(
    dockReducer(initialDock(null), { type: "open", account: null }).tabs.length,
    0,
  );
});
test("bounded dock refuses new panel without evicting retained content", () => {
  let state = initialDock("a");
  for (let i = 0; i < 8; i++)
    state = dockReducer(state, {
      type: "open",
      account: "a",
      target: { kind: "doc", id: String(i) },
    });
  assert.equal(dockReducer(state, { type: "open", account: "a" }), state);
  assert.equal(
    dockReducer(state, {
      type: "open",
      account: "a",
      target: { kind: "doc", id: "0" },
    }).activeId,
    "object:doc:0",
  );
});
test("actual sidebar/bell/command chrome navigation opens dock before main departure or navigation locks", () => {
  let opened = 0,
    hidden = 0;
  const forbidden = () => {
    throw Error("must not touch main draft/navigation");
  };
  for (const name of ["navigate", "chromeRun.current"]) {
    const fn = actual(name, {
      onOpenNotifications: () => opened++,
      setMobileNav: (value: boolean) => {
        assert.equal(value, false);
        hidden++;
      },
      chromeNavigation: { current: true },
      preparePageLeave: forbidden,
      setView: forbidden,
      planner: { setError: forbidden },
    });
    fn(
      name === "navigate"
        ? "Notifications"
        : { kind: "navigate", view: "Notifications" },
    );
  }
  assert.equal(opened, 2);
  assert.equal(hidden, 2);
});
test("actual tab open/go/replace forwarding never mutates main tab state or invokes departure guards", async () => {
  let opened = 0;
  const forbidden = () => {
    throw Error("main draft/tab mutation");
  };
  for (const name of ["tabAct", "tabActNow"])
    for (const type of ["open", "go", "replace"]) {
      const fn = actual(name, {
        onOpenNotifications: () => opened++,
        preparePageLeave: forbidden,
        tabs: { act: forbidden },
        tabsLive: false,
      });
      assert.equal(await fn({ type, place: { view: "Notifications" } }), false);
    }
  assert.equal(opened, 6);
});
test("actual restored notification place forwards without clearing document/chat selections", () => {
  let opened = 0;
  const ref = { current: 0 };
  actual("showPlace", {
    tabPlaceRead: ref,
    onOpenNotifications: () => opened++,
    setNoteDoc: () => {
      throw Error("draft cleared");
    },
  })({ view: "Notifications" });
  assert.equal(opened, 1);
});
test("App integration source contract: single primary portal, retained workspace, no secondary heading strip", () => {
  assert.equal((source.match(/<WorkspaceDock\b/g) || []).length, 1);
  assert.match(source, /minMainWidth=\{paired \? 960 : 480\}/);
  assert.match(
    source,
    /!secondary\s*&&\s*notificationsHost\s*&&\s*createPortal/,
  );
  assert.doesNotMatch(source, /view === "Notifications" &&/);
  assert.doesNotMatch(source, /className="workspace-pane-toolbar"/);
  assert.match(source, /aria-label="Close second pane"/);
  assert.match(source, /aria-label="Second working pane"/);
  assert.match(
    source,
    /const singlePane = \(mainLayout.width \|\| window.innerWidth\) < 960/,
  );
  const css = readFileSync(
    new URL("../../desktop/src/app/workspace.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /@container workspace-main \(max-width: 959px\)/);
  assert.match(css, /container: workspace-main \/ inline-size/);
  assert.match(
    css,
    /\.shell > \.workspace-pane-tabs \{[\s\S]*?height: var\(--topbar-h\)/,
  );
});
test("actual old history and reopened notification tabs forward before main departure or mutation", async () => {
  let opened = 0;
  const before = { tabs: [], active: "current" };
  const fn = actual("tabAct", {
    onOpenNotifications: () => opened++,
    tabNavigation: { current: 0 },
    tabs: {
      ref: { current: before },
      act: () => {
        throw Error("main tabs mutated");
      },
    },
    activeTab: (state: unknown) =>
      state === before
        ? { place: { view: "Docs", id: "draft" } }
        : { place: { view: "Notifications" } },
    placeOf: (tab: any) => tab.place,
    tabsReducer: () => ({}),
    preparePageLeave: () => {
      throw Error("draft departure attempted");
    },
  });
  for (const type of ["back", "forward", "reopen"])
    assert.equal(await fn({ type }), false);
  assert.equal(opened, 3);
});
test("shared split navigation preserves preferred rail and uses a drawer only at the phone viewport", async () => {
  const { sidebarLayout } =
    await import("../../desktop/src/app/chrome/SidebarResizer");
  for (const available of [1440, 1280, 1100, 900]) {
    const layout = sidebarLayout(72, available);
    assert.equal(layout.width, 72);
    assert.equal(layout.railed, true);
  }
  assert.match(
    source,
    /sidebarLayout\(\s*sidebarWidth,\s*navigationAvailableWidth/,
  );
  assert.match(source, /railed=\{narrowNavigation \? false : railed\}/);
  assert.doesNotMatch(source, /railed=\{sharedChromeHost \? false/);
  assert.match(source, /phone=\{narrowNavigation\}/);
  assert.match(source, /useMediaQuery\("\(max-width: 800px\)"\)/);
  const shared = readFileSync(
    new URL(
      "../../desktop/src/app/chrome/SharedNarrowChrome.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(shared, /!phone && navigation/);
  assert.match(shared, /phone && \(\s*<dialog/);
  assert.match(shared, /!phone && railed \? " is-railed"/);
  assert.match(shared, /--workspace-sidebar-width/);
});

test("secondary pane never inherits the primary navigation rail inset", () => {
  const css = readFileSync(
    new URL("../../desktop/src/app/workspace.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.workspace-duo \.app\.workspace\.is-secondary-pane > \.shell \{\s*margin-left: 0;/,
  );
  assert.match(source, /minMainWidth=\{paired \? 960 : 480\}/);
  assert.match(
    source,
    /const singlePane = \(mainLayout.width \|\| window.innerWidth\) < 960/,
  );
});
test("dock-origin ordinary and modified links route exactly once; stale account and non-dock focus fail closed", async () => {
  const { routeDockLink } =
    await import("../../desktop/src/app/workspace-dock-state");
  const calls: string[] = [];
  const actions = {
    open: (url: string) => calls.push(`open:${url}`),
    peek: (target: any) => calls.push(`peek:${target.id}`),
    yieldToMain: () => calls.push("main"),
  };
  const owner = {
    focused: true,
    account: "a",
    dockAccount: "a",
    ownerAccount: "a",
  };
  assert.equal(
    routeDockLink(
      { ...owner, kind: "open", detail: "orbyn://doc/page#block" },
      actions,
    ),
    true,
  );
  assert.deepEqual(calls, ["main", "open:orbyn://doc/page#block"]);
  calls.length = 0;
  assert.equal(
    routeDockLink(
      { ...owner, kind: "peek", detail: { kind: "doc", id: "next" } },
      actions,
    ),
    true,
  );
  assert.deepEqual(calls, ["peek:next"]);
  calls.length = 0;
  for (const invalid of [
    { focused: false },
    { account: "b" },
    { dockAccount: "b" },
    { ownerAccount: "b" },
    { account: null },
  ]) {
    assert.equal(
      routeDockLink(
        { ...owner, ...invalid, kind: "open", detail: "orbyn://doc/page" },
        actions,
      ),
      false,
    );
    assert.equal(
      routeDockLink(
        {
          ...owner,
          ...invalid,
          kind: "peek",
          detail: { kind: "doc", id: "next" },
        },
        actions,
      ),
      false,
    );
  }
  assert.equal(
    routeDockLink(
      { ...owner, kind: "open", detail: "javascript:alert(1)" },
      actions,
    ),
    false,
  );
  assert.equal(
    routeDockLink(
      { ...owner, kind: "peek", detail: { kind: "person", id: "next" } },
      actions,
    ),
    false,
  );
  assert.deepEqual(calls, []);
  assert.equal(
    (source.match(/dockLinkOwner=\{dockLinkOwner\}/g) || []).length,
    1,
  );
  assert.match(source, /if \(handled\) event.stopImmediatePropagation\(\)/);
  assert.match(source, /!dockOwnsInput\(\)/);
});
