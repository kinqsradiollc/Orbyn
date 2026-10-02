import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function refresh(platform: "desktop" | "mobile", variable = "refreshUser") {
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
      node.name.getText(source) === variable
    )
      initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(initializer, "Exercise the actual profile refresh callback");
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  const response = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const tokenRef = { current: "owner" };
  const profiles: unknown[] = [];
  let calls = 0;
  const callback = vm.runInNewContext(
    ts.transpileModule(`(${initializer.getText(source)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      tokenRef,
      client: {
        updatePreferences: () => {
          calls++;
          return response;
        },
        me: () => {
          calls++;
          return response;
        },
      },
      setUser: (profile: unknown) => profiles.push(profile),
      act: (work: () => Promise<void>) => work(),
    },
  );
  return { callback, tokenRef, profiles, resolve, reject, calls: () => calls };
}

for (const next of ["owner", "", "another-owner"]) {
  test(`desktop: preference profile belongs to its starting session (${next || "logout"})`, async () => {
    const f = refresh("desktop", "setEmailReminders");
    const pending = f.callback(true);
    f.tokenRef.current = next;
    const profile = { id: "owner", email_reminders: true };
    f.resolve(profile);
    await pending;
    assert.deepEqual(f.profiles, next === "owner" ? [profile] : []);
  });
}
test("desktop: signed-out preferences send no request", async () => {
  const f = refresh("desktop", "setEmailReminders");
  f.tokenRef.current = "";
  await f.callback(true);
  assert.equal(f.calls(), 0);
});

for (const platform of ["desktop", "mobile"] as const) {
  test(`${platform}: current session accepts its profile`, async () => {
    const f = refresh(platform);
    const pending = f.callback();
    const profile = { id: "owner", name: "Current account" };
    f.resolve(profile);
    await pending;
    assert.deepEqual(f.profiles, [profile]);
  });
  for (const next of ["", "another-owner"]) {
    test(`${platform}: logout/account switch discards late profile (${next || "logout"})`, async () => {
      const f = refresh(platform);
      const pending = f.callback();
      f.tokenRef.current = next;
      f.resolve({ id: "old-owner" });
      await pending;
      assert.deepEqual(f.profiles, []);
    });
  }
  test(`${platform}: late failure cannot invalidate the new session`, async () => {
    const f = refresh(platform);
    const pending = f.callback();
    f.tokenRef.current = "new-owner";
    f.reject(new Error("old session unauthorized"));
    await pending;
    assert.deepEqual(f.profiles, []);
  });
  test(`${platform}: current-session failure remains visible`, async () => {
    const f = refresh(platform);
    const pending = f.callback();
    f.reject(new Error("current session unauthorized"));
    await assert.rejects(pending, /current session unauthorized/);
  });
  test(`${platform}: signed-out refresh sends no request`, async () => {
    const f = refresh(platform);
    f.tokenRef.current = "";
    await f.callback();
    assert.equal(f.calls(), 0);
  });
}
