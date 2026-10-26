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
        let resultInitializer: ts.Expression | undefined;
        const visit = (node: ts.Node) => {
          if (
            ts.isVariableDeclaration(node) &&
            node.name.getText(source) === "act"
          )
            initializer = node.initializer;
          if (
            ts.isVariableDeclaration(node) &&
            node.name.getText(source) === "actResult"
          )
            resultInitializer = node.initializer;
          ts.forEachChild(node, visit);
        };
        visit(source);
        assert.ok(initializer);
        const tokenRef = { current: "starting-session" };
        const session = { token: tokenRef.current, generation: 0 };
        class SessionStorageError extends Error {
          generation = -1;
        }
        let failures = 0,
          clears = 0,
          maintenance = 0;
        const act = vm.runInNewContext(
          ts.transpileModule(
            `${resultInitializer ? `const actResult = ${resultInitializer.getText(source)};` : ""}
(${initializer.getText(source)})`,
            {
              compilerOptions: { target: ts.ScriptTarget.ES2022 },
            },
          ).outputText,
          {
            tokenRef,
            session,
            SessionStorageError,
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
            clearSession: async (expectedToken: string) => {
              if (session.token !== expectedToken) return false;
              session.token = "";
              session.generation++;
              clears++;
              return true;
            },
            resetSession: () => {},
          },
        );
        let reject!: (error: unknown) => void;
        const response = new Promise<void>((_resolve, no) => {
          reject = no;
        });
        const pending = act(() => response);
        if (switched) {
          tokenRef.current = "new-session";
          session.token = "new-session";
          session.generation++;
        }
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
