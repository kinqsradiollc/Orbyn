import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/** Execute the actual storage subscription callback, without a browser layout claim. */
function subscription() {
  const path = new URL(
    "../../desktop/src/hooks/usePlanner.ts",
    import.meta.url,
  );
  const source = ts.createSourceFile(
    path.pathname,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let effect: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "useEffect" &&
      node.arguments[0]?.getText(source).includes("onSessionChange")
    )
      effect = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(effect);
  const tokenRef = { current: "old-account" },
    refreshSeq = { current: 3 },
    lastData = { current: "old-data" };
  const state: Record<string, unknown> = {
    user: "old-user",
    items: ["old-item"],
    notices: ["old-notice"],
    teams: ["old-team"],
    maintenance: "old-maintenance",
    error: "old-error",
  };
  let listener!: (token: string) => void;
  let cleared = false;
  vm.runInNewContext(
    ts.transpileModule(`(${effect.getText(source)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      tokenRef,
      refreshSeq,
      lastData,
      onSessionChange: (fn: typeof listener) => {
        listener = fn;
      },
      clearSession: () => {
        cleared = true;
      },
      setUser: (value: unknown) => {
        state.user = value;
      },
      setItems: (value: unknown) => {
        state.items = value;
      },
      setNotices: (value: unknown) => {
        state.notices = value;
      },
      setTeams: (value: unknown) => {
        state.teams = value;
      },
      setMaintenance: (value: unknown) => {
        state.maintenance = value;
      },
      setError: (value: unknown) => {
        state.error = value;
      },
      setToken: (value: string) => {
        assert.equal(tokenRef.current, value);
        assert.equal(state.user, null);
        for (const field of ["items", "notices", "teams"])
          assert.equal((state[field] as unknown[]).length, 0);
        state.token = value;
      },
    },
  )();
  return {
    listener,
    state,
    tokenRef,
    refreshSeq,
    lastData,
    cleared: () => cleared,
  };
}
test("adopting another tab's account clears old data before publishing the token", () => {
  const f = subscription();
  f.listener("new-account");
  assert.equal(f.state.token, "new-account");
  assert.equal(f.lastData.current, "");
  assert.equal(f.refreshSeq.current, 4);
  assert.equal(f.state.maintenance, null);
  assert.equal(f.state.error, "");
});
test("same-session storage events preserve current data", () => {
  const f = subscription();
  f.listener("old-account");
  assert.equal(f.state.user, "old-user");
  assert.equal(f.refreshSeq.current, 3);
});
test("another tab's logout delegates the full session reset", () => {
  const f = subscription();
  f.listener("");
  assert.equal(f.cleared(), true);
});
