import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PlannerItemStore } from "@orbyn/api-client";
import { freshItem } from "@orbyn/core";

export const plannerStartupSource = () =>
  readFileSync(
    new URL(
      "../../desktop/src/features/planner/usePlanner.ts",
      import.meta.url,
    ),
    "utf8",
  );
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Executes the production refresh closure and real item store, without a server or UI timing claim. */
export function plannerStartupFixture(text = plannerStartupSource()) {
  const ast = ts.createSourceFile(
    "usePlanner.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "refresh")
      expression = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(expression);
  const notices = deferred<unknown[]>(),
    teams = deferred<{ id: string }[]>();
  const items = deferred<{
    items: ReturnType<typeof freshItem>[];
    updated_after: string;
  }>();
  const row = {
    ...freshItem(),
    id: "primary-task",
    title: "Usable task",
    team_id: null,
  };
  const calls: string[] = [];
  let generation = 1;
  const tokenRef = { current: "owner" };
  const state: Record<string, any> = {
    notices: [{ id: "previous-notice" }],
    teams: [],
    itemRead: null,
    loading: false,
    revision: 0,
  };
  const reports: unknown[] = [];
  const itemStore = new PlannerItemStore(
    {
      reconcileItems: () => {
        calls.push("items");
        return items.promise;
      },
      syncItems: async () => {
        throw new Error("Unexpected delta");
      },
      listAllItems: async () => {
        throw new Error("Unexpected legacy read");
      },
    } as any,
    () => generation,
  );
  const usable = deferred<void>();
  const changed = () => {
    if (
      itemStore.getSnapshot().some((i) => i.id === row.id) &&
      state.itemRead?.phase === "ready"
    )
      usable.resolve();
  };
  itemStore.subscribe(changed);
  const context: Record<string, unknown> = {
    token: "owner",
    tokenRef,
    refreshSeq: { current: 0 },
    lastData: { current: "" },
    itemStore,
    session: { binding: () => ({ token: tokenRef.current, generation }) },
    useCallback: (callback: unknown) => callback,
    report: (error: unknown) => reports.push(error),
    client: {
      listNotifications: () => {
        calls.push("notices");
        return notices.promise;
      },
      listTeams: () => {
        calls.push("teams");
        return teams.promise;
      },
    },
  };
  for (const [setter, key] of Object.entries({
    setNotices: "notices",
    setTeams: "teams",
    setLoading: "loading",
    setItemRead: "itemRead",
    setRevision: "revision",
  }))
    context[setter] = (value: unknown) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
      changed();
    };
  const refresh = vm.runInNewContext(
    ts.transpileModule(`(${expression.getText(ast)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  return {
    refresh,
    state,
    calls,
    reports,
    notices,
    teams,
    items,
    itemStore,
    usable: usable.promise,
    row,
    completeItems: () =>
      items.resolve({ items: [row], updated_after: "2026-10-31T00:00:00Z" }),
    switchOwner: () => {
      tokenRef.current = "next-owner";
      generation++;
      itemStore.reset();
    },
  };
}
