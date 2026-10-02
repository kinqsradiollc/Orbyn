import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

for (const platform of ["desktop", "mobile"] as const) {
  for (const status of [401, 503]) {
    for (const switched of [false, true]) {
      test(`${platform}: ${status} mutation error belongs only to its starting session (switch=${switched})`, async () => {
        const path = new URL(
          `../../${platform}/src/hooks/usePlanner.ts`,
          import.meta.url,
        );
        const source = ts.createSourceFile(
          path.pathname,
          readFileSync(path, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        let initializer: ts.Expression | undefined;
        const visit = (node: ts.Node) => {
          if (
            ts.isVariableDeclaration(node) &&
            node.name.getText(source) === "act"
          )
            initializer = node.initializer;
          ts.forEachChild(node, visit);
        };
        visit(source);
        assert.ok(initializer);
        const tokenRef = { current: "starting-session" };
        let failures = 0,
          clears = 0,
          maintenance = 0;
        const act = vm.runInNewContext(
          ts.transpileModule(`(${initializer.getText(source)})`, {
            compilerOptions: { target: ts.ScriptTarget.ES2022 },
          }).outputText,
          {
            tokenRef,
            setBusy: () => {},
            setError: (value: string) => {
              if (value) failures++;
            },
            report: () => {
              failures++;
            },
            isOfflineError: () => false,
            errorText: () => "fixture failure",
            checkMaintenance: async () => {
              maintenance++;
            },
            clearSession: async () => {
              clears++;
            },
            resetSession: () => {},
          },
        );
        let reject!: (error: unknown) => void;
        const response = new Promise<void>((_resolve, no) => {
          reject = no;
        });
        const pending = act(() => response);
        if (switched) tokenRef.current = "new-session";
        reject(Object.assign(new Error("fixture failure"), { status }));
        await pending;
        assert.equal(failures, switched ? 0 : 1);
        if (platform === "mobile") {
          assert.equal(clears, !switched && status === 401 ? 1 : 0);
          assert.equal(maintenance, !switched && status === 503 ? 1 : 0);
        }
      });
    }
  }
}
