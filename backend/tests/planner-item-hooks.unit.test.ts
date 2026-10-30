import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

type Platform = "desktop" | "mobile";
function source(platform: Platform) {
  const file = new URL(
    `../../${platform}/src/features/planner/usePlanner.ts`,
    import.meta.url,
  );
  return ts.createSourceFile(
    file.pathname,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}
function declaration(ast: ts.SourceFile, name: string) {
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
      expression = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(expression, name);
  return expression.getText(ast);
}
function fixture(platform: Platform) {
  const ast = source(platform);
  let generation = 1,
    liveToken = "A",
    userId = "owner",
    fail: string | null = null;
  const error = Object.assign(new Error("companion failed"), { status: 503 });
  let row = { id: "new-item" };
  let itemError: Error | null = null;
  let teamRows = [
    { id: "z", name: "Z", role: "member" },
    { id: "a", name: "A", role: "owner" },
  ];
  const calls: string[] = [];
  const previous = {
    items: [{ id: "old-item" }],
    user: { id: "owner", name: "Old" },
    notices: [{ id: "old-notice" }],
    teams: [{ id: "old-team" }],
    lists: [{ id: "old-list" }],
    tags: [{ id: "old-tag" }],
    planned: { label: "old-planned" },
    today: { label: "old-today" },
  };
  const state: Record<string, unknown> = { ...previous };
  const cache: unknown[] = [];
  const scopes: {
    scope: string | null;
    force: boolean;
    teamIds?: readonly string[];
  }[] = [];
  const tokenRef = { current: "A" };
  const refreshSeq = { current: 0 };
  const lastData = { current: "" };
  const result = (name: string, value: unknown) => {
    calls.push(name);
    return fail === name ? Promise.reject(error) : Promise.resolve(value);
  };
  const session = {
    get token() {
      return liveToken;
    },
    get generation() {
      return generation;
    },
    get userId() {
      return userId;
    },
    binding: () => ({ token: liveToken, generation }),
    clear: () => {
      liveToken = "";
      generation++;
    },
  };
  let teamPromise: Promise<unknown> | undefined;
  const client = {
    me: () => result("me", { id: "owner", name: "New" }),
    listNotifications: () => result("notices", []),
    listTeams: () => teamPromise ?? result("teams", teamRows),
    listLists: () => result("lists", []),
    listTags: () => result("tags", []),
    planned: () => result("planned", { label: "new-planned" }),
    today: () => result("today", { label: "new-today" }),
  };
  let resets = 0,
    due = 300000;
  const itemStore = {
    getSnapshot: () => state.items,
    restrictTeams: (ids: readonly string[]) => {
      calls.push("restrict");
      const before = state.items as { team_id?: string }[];
      const kept = before.filter(
        (item) => !item.team_id || ids.includes(item.team_id),
      );
      if (kept.length !== before.length) state.items = kept;
    },
    refresh: async (
      scope: string | null,
      force: boolean,
      teamIds?: readonly string[],
    ) => {
      calls.push("items");
      scopes.push({ scope, force, teamIds });
      if (itemError) throw itemError;
      state.items = [row];
      return state.items;
    },
    reset: () => {
      resets++;
      state.items = [];
    },
    nextReconcileIn: () => due,
    seed: (items: unknown) => {
      state.items = items;
    },
  };
  const values: Record<string, unknown> = {
    client,
    session,
    token: "A",
    tokenRef,
    refreshSeq,
    lastData,
    itemStore,
    useCallback: (callback: unknown) => callback,
    report: () => {},
    knownTeams: { current: teamRows },
    kept: { current: { planned: previous.planned, today: previous.today } },
    plannedAt: { current: { at: 0, items: "" } },
    PLANNED_EVERY_MS: 120000,
    setSessionUser: async (id: string, expected: string) => {
      if (expected !== liveToken) return false;
      if (!userId) {
        userId = id;
        generation++;
      }
      return userId === id;
    },
    dayBounds: () => ({ from: new Date(0), to: new Date(86400000) }),
    deviceTimeZone: () => "UTC",
    animateLayout: () => {},
    purgeCacheTeams: async () => {
      calls.push("purge");
    },
    forgetLostTeams: async () => {
      calls.push("forget-pages");
    },
    publishGlance: () => {
      calls.push("publish-glance");
    },
    saveCache: async (value: unknown) => {
      cache.push(value);
    },
    clearCache: async () => {},
    clearPageCache: async () => {},
    clearGlance: () => {
      calls.push("clear-glance");
    },
    setRevision: () => {},
  };
  for (const [setter, key] of Object.entries({
    setUser: "user",
    setNotices: "notices",
    setTeams: "teams",
    setLists: "lists",
    setTags: "tags",
    setPlanned: "planned",
    setToday: "today",
    setToken: "token",
    setMaintenance: "maintenance",
    setLoading: "loading",
    setItemRead: "itemRead",
    setRefreshing: "refreshing",
  }))
    values[setter] = (value: unknown) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
    };
  const context = vm.createContext(values);
  const evaluate = (text: string) =>
    vm.runInContext(
      ts.transpileModule(text, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText,
      context,
    );
  const refresh = evaluate(`(${declaration(ast, "refresh")})`);
  return {
    ast,
    context,
    evaluate,
    refresh,
    state,
    previous,
    calls,
    cache,
    scopes,
    itemStore,
    tokenRef,
    error,
    fail(name: string | null) {
      fail = name;
    },
    failItems() {
      itemError = error;
    },
    changeTeam() {
      teamRows = [...teamRows.map((t) => ({ ...t, role: "viewer" }))];
    },
    legacy() {
      userId = "";
    },
    switchAccount() {
      liveToken = "B";
      generation++;
    },
    pauseTeams() {
      let resolve!: (value: unknown) => void;
      teamPromise = new Promise((yes) => {
        resolve = yes;
      });
      return () => resolve(teamRows);
    },
    due(value: number) {
      due = value;
    },
    resets: () => resets,
  };
}
for (const platform of ["desktop", "mobile"] as const) {
  test(`${platform}: manual refresh uses full reconciliation and sorted complete team metadata`, async () => {
    const f = fixture(platform);
    await f.refresh();
    assert.equal(f.scopes[0].force, true);
    const teams = JSON.parse(f.scopes[0].scope!);
    assert.deepEqual(
      teams.map((t: { id: string }) => t.id),
      ["a", "z"],
    );
    assert.equal(teams[0].role, "owner");
    assert.deepEqual(f.scopes[0].teamIds, ["z", "a"]);
    if (platform === "mobile")
      assert.ok(f.calls.indexOf("purge") < f.calls.indexOf("items"));
    f.changeTeam();
    await f.refresh({ silent: true });
    assert.equal(f.scopes[1].force, false);
    assert.notEqual(f.scopes[1].scope, f.scopes[0].scope);
  });
  test(`${platform}: team failure forces reconciliation and preserves the previous teams`, async () => {
    const f = fixture(platform);
    f.fail("teams");
    await assert.rejects(f.refresh({ silent: true }), /companion failed/);
    assert.equal(f.scopes[0].scope, null);
    assert.deepEqual(f.state.items, [{ id: "new-item" }]);
    assert.equal(f.state.teams, f.previous.teams);
    assert.equal(f.cache.length, 0);
  });
  test(`${platform}: notice failure cannot discard successful items or erase previous notices`, async () => {
    const f = fixture(platform);
    f.fail("notices");
    await assert.rejects(f.refresh(), /companion failed/);
    assert.deepEqual(f.state.items, [{ id: "new-item" }]);
    assert.equal(f.state.notices, f.previous.notices);
    assert.equal(f.cache.length, 0);
  });
  test(`${platform}: item failure preserves existing items while successful companions still update`, async () => {
    const f = fixture(platform);
    f.failItems();
    await assert.rejects(f.refresh(), /companion failed/);
    assert.equal(f.state.items, f.previous.items);
    assert.deepEqual(f.state.notices, []);
    assert.equal(f.cache.length, 0);
  });
  test(`${platform}: live account changes before item dispatch and during settlement fence old work`, async () => {
    const f = fixture(platform);
    const resume = f.pauseTeams();
    const request = f.refresh();
    f.switchAccount();
    resume();
    await request;
    assert.equal(f.scopes.length, 0);
    assert.equal(f.state.items, f.previous.items);
    const g = fixture(platform);
    g.switchAccount();
    await g.refresh();
    assert.equal(g.calls.length, 0);
  });
  test(`${platform}: logout callback resets the single item owner`, () => {
    const f = fixture(platform);
    const reset = f.evaluate(
      `(${declaration(f.ast, platform === "desktop" ? "clearSession" : "resetSession")})`,
    );
    reset();
    assert.equal(f.resets(), 1);
    assert.deepEqual(f.state.items, []);
  });
  for (const due of [1200, 0])
    test(`${platform}: active poll schedules deadline=${due} without an overdue hot loop`, async () => {
      const f = fixture(platform);
      f.due(due);
      const delays: number[] = [];
      Object.assign(f.context, {
        alive: true,
        timer: undefined,
        document: { visibilityState: "visible" },
        AppState: { currentState: "active" },
        background: async () => {},
        refresh: async () => {},
        refreshMaintenance: async () => {},
        report: () => {},
        setTimeout: (_: unknown, delay: number) => {
          delays.push(delay);
          return 1;
        },
      });
      const loop = f.evaluate(
        `var loop = ${declaration(f.ast, "loop")}; loop;`,
      );
      await loop();
      assert.deepEqual(delays, [due || 30000]);
    });
}
for (const resource of ["me", "lists", "tags", "planned", "today"])
  test(`mobile: ${resource} failure preserves that companion and never saves a partial cache`, async () => {
    const f = fixture("mobile");
    f.fail(resource);
    await assert.rejects(f.refresh(), /companion failed/);
    assert.deepEqual(f.state.items, [{ id: "new-item" }]);
    assert.equal(
      f.state[resource === "me" ? "user" : resource],
      f.previous[
        resource === "me" ? "user" : (resource as keyof typeof f.previous)
      ],
    );
    assert.equal(f.cache.length, 0);
  });
test("mobile: unknown legacy identity must verify before any item dispatch", async () => {
  const f = fixture("mobile");
  f.legacy();
  await f.refresh();
  assert.equal(f.calls[0], "me");
  assert.equal(f.cache.length, 1);
  const g = fixture("mobile");
  g.legacy();
  g.fail("me");
  await assert.rejects(g.refresh(), /companion failed/);
  assert.equal(g.scopes.length, 0);
});
test("both hooks subscribe to one item store; proven cache seeds that owner", () => {
  for (const platform of ["desktop", "mobile"] as const) {
    const text = source(platform).text;
    assert.match(text, /useSyncExternalStore\([\s\S]*?itemStore.subscribe/);
    assert.doesNotMatch(text, /setItems|listAllItems/);
  }
  const mobile = source("mobile").text;
  assert.match(mobile, /cached.user\?\.id === session.userId/);
  assert.match(mobile, /itemStore.seed\(cached.items\)/);
  assert.match(mobile, /subscribeSession\(\(\) => itemStore.reset\(\)\)/);
});

for (const platform of ["desktop", "mobile"] as const)
  test(`${platform}: receipt/access invalidation may force a silent primary reconciliation`, async () => {
    const f = fixture(platform);
    await f.refresh({ silent: true, force: true });
    assert.equal(f.scopes[0].force, true);
  });
for (const matches of [true, false])
  test(`mobile: startup seeds items only with proven cached account (match=${matches})`, async () => {
    const f = fixture("mobile");
    let callback: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(f.ast) === "useEffect" &&
        node.arguments[0]?.getText(f.ast).includes("loadSession()")
      )
        callback = node.arguments[0];
      ts.forEachChild(node, visit);
    };
    visit(f.ast);
    assert.ok(callback);
    const cached = {
      ...f.previous,
      user: { id: matches ? "owner" : "other-owner" },
      items: [{ id: "cached-item" }],
    };
    Object.assign(f.context, {
      loadSession: async () => "A",
      loadCache: async () => cached,
      setReady: () => {},
      setError: () => {},
    });
    const boot = f.evaluate(`(${callback.getText(f.ast)})`);
    const stop = boot();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.state.items, matches ? cached.items : f.previous.items);
    stop();
  });
test("mobile: receipt, foreground and push invalidations force the existing refresh owner", () => {
  const text = source("mobile").text;
  assert.match(text, /whenSent\([\s\S]*?background\(true\)/);
  assert.match(text, /await refresh\(\{ silent: true, force \}\)/);
  assert.match(
    text,
    /addNotificationReceivedListener\([\s\S]*?background\(true\)/,
  );
});

test("mobile: actual receipt/foreground/push callbacks force refresh and retain 401 session handling", async () => {
  const f = fixture("mobile");
  let effect: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(f.ast) === "useEffect" &&
      node.arguments[0]?.getText(f.ast).includes("whenSent(")
    )
      effect = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(f.ast);
  assert.ok(effect);
  let receipt!: () => void,
    foreground!: (state: string) => void,
    push!: () => void;
  const refreshes: unknown[] = [];
  let expired = false,
    clears = 0,
    resets = 0;
  Object.assign(f.context, {
    checkMaintenance: async () => {},
    flush: async () => {},
    noteOnline: () => {},
    noteOffline: () => {},
    errorText: () => {},
    isOfflineError: () => false,
    SessionStorageError: class extends Error {},
    refresh: async (options: unknown) => {
      refreshes.push(options);
      if (expired) throw { status: 401 };
    },
    clearSession: async (expected: string) => {
      assert.equal(expected, "A");
      clears++;
      Object.defineProperty(f.context.session, "token", { value: "" });
      return true;
    },
    resetSession: () => {
      resets++;
    },
    whenSent: (listener: typeof receipt) => {
      receipt = listener;
    },
    AppState: {
      currentState: "active",
      addEventListener: (_: string, listener: typeof foreground) => {
        foreground = listener;
        return { remove() {} };
      },
    },
    Notifications: {
      addNotificationReceivedListener: (listener: typeof push) => {
        push = listener;
        return { remove() {} };
      },
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const setup = f.evaluate(`(${effect.getText(f.ast)})`);
  const stop = setup();
  await tick();
  refreshes.length = 0;
  receipt();
  await tick();
  foreground("active");
  await tick();
  push();
  await tick();
  assert.equal(refreshes.length, 3);
  for (const options of refreshes)
    assert.equal((options as { force: boolean }).force, true);
  expired = true;
  receipt();
  await tick();
  assert.equal(clears, 1);
  assert.equal(resets, 1);
  stop();
});

test("mobile: account change while purging old team access prevents item dispatch", async () => {
  const f = fixture("mobile");
  let release!: () => void;
  Object.assign(f.context, {
    purgeCacheTeams: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  });
  const running = f.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  f.switchAccount();
  release();
  await running;
  assert.equal(f.scopes.length, 0);
  assert.equal(f.state.items, f.previous.items);
});
test("desktop: overdue reconciliation failure retries after 30 seconds", async () => {
  const f = fixture("desktop");
  f.due(0);
  const delays: number[] = [];
  Object.assign(f.context, {
    alive: true,
    timer: undefined,
    document: { visibilityState: "visible" },
    refresh: async () => {
      throw new Error("offline");
    },
    refreshMaintenance: async () => {},
    report: () => {},
    setTimeout: (_: unknown, delay: number) => {
      delays.push(delay);
      return 1;
    },
  });
  const loop = f.evaluate(`var loop = ${declaration(f.ast, "loop")}; loop;`);
  await loop();
  assert.deepEqual(delays, [30000]);
});

test("mobile: failed durable team purge prunes immediately, publishes fresh private items and reports the cache fault", async () => {
  const f = fixture("mobile");
  f.state.items = [{ id: "personal" }, { id: "gone", team_id: "revoked" }];
  Object.assign(f.context, {
    purgeCacheTeams: async () => {
      assert.deepEqual(f.state.items, [{ id: "personal" }]);
      assert.ok(f.calls.includes("clear-glance"));
      throw new Error("storage unavailable");
    },
  });
  await assert.rejects(f.refresh(), /storage unavailable/);
  assert.deepEqual(f.state.items, [{ id: "new-item" }]);
  assert.equal(f.scopes.length, 1);
  assert.deepEqual(f.state.notices, []);
  assert.ok(f.calls.includes("publish-glance"));
  assert.ok(f.calls.includes("restrict"));
  assert.equal(f.cache.length, 0);
});

test("presence and native receipt caller options explicitly force primary reconciliation", () => {
  for (const [platform, path] of [
    ["desktop", "app/App.tsx"],
    ["mobile", "app/RootScreen.tsx"],
  ] as const) {
    const text = readFileSync(
      new URL(`../../${platform}/src/${path}`, import.meta.url),
      "utf8",
    );
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    let presence = 0,
      flushed = 0;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(ast) === "usePresence"
      ) {
        assert.match(node.arguments[1].getText(ast), /force: true/);
        presence++;
      }
      if (
        ts.isIfStatement(node) &&
        node.expression.getText(ast) === "flushed"
      ) {
        assert.match(node.thenStatement.getText(ast), /force: true/);
        flushed++;
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.equal(presence, 1);
    if (platform === "mobile") assert.equal(flushed, 1);
  }
});

test("mobile: proven team loss prunes failed lists/tags and invalidates failed planned/Today companions", async () => {
  const f = fixture("mobile");
  const error = new Error("offline companion");
  f.state.items = [{ id: "personal" }, { id: "revoked-item", team_id: "gone" }];
  f.state.lists = [
    { id: "personal-list" },
    { id: "gone-list", team_id: "gone" },
  ];
  f.state.tags = [{ id: "personal-tag" }, { id: "gone-tag", team_id: "gone" }];
  const client = f.context.client as Record<string, unknown>;
  for (const method of ["listLists", "listTags", "planned", "today"])
    client[method] = async () => {
      throw error;
    };
  Object.assign(f.context, { knownTeams: { current: [{ id: "gone" }] } });
  await assert.rejects(f.refresh(), /offline companion/);
  assert.deepEqual(f.state.lists, [{ id: "personal-list" }]);
  assert.deepEqual(f.state.tags, [{ id: "personal-tag" }]);
  assert.equal(f.state.planned, null);
  assert.equal(f.state.today, null);
  assert.equal(f.cache.length, 0);
});

test("mobile: proven lost access clears glance before a failing item read; generic failures do not", async () => {
  const f = fixture("mobile");
  Object.assign(f.context, { knownTeams: { current: [{ id: "gone" }] } });
  f.failItems();
  await assert.rejects(f.refresh(), /companion failed/);
  assert.ok(f.calls.includes("clear-glance"));
  assert.ok(f.calls.indexOf("clear-glance") < f.calls.indexOf("items"));
  assert.equal(f.calls.includes("publish-glance"), false);
  const g = fixture("mobile");
  g.fail("teams");
  g.failItems();
  await assert.rejects(g.refresh(), /companion failed/);
  assert.equal(g.calls.includes("clear-glance"), false);
});

test("desktop: initial item failure stays distinct from an empty successful read", async () => {
  const f = fixture("desktop");
  f.failItems();
  await assert.rejects(f.refresh(), /companion failed/);
  assert.equal((f.state.itemRead as { phase: string }).phase, "error");
  const g = fixture("desktop");
  await g.refresh();
  assert.equal((g.state.itemRead as { phase: string }).phase, "ready");
  g.failItems();
  await assert.rejects(g.refresh(), /companion failed/);
  assert.equal((g.state.itemRead as { phase: string }).phase, "ready");
});
