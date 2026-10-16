import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { characterAppearance } from "@orbyn/core";

// Execute the actual component callbacks, including their response/owner fences.
// Browser qualification separately checks layout, focus and persistence.
for (const mobile of [false, true]) {
  const name = mobile ? "Expo" : "web";
  const file = mobile
    ? "mobile/src/screens/AgentContext.tsx"
    : "desktop/src/features/settings/AgentContext.tsx";
  const parsed = ts.createSourceFile(
    file,
    readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function expression(name: string): string {
    let value: ts.Expression | undefined;
    function visit(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name)
        value = node.initializer;
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    assert.ok(value, `Actual ${file} must define ${name}`);
    return value.getText(parsed);
  }
  function harness(response: "success" | "failure" | "deferred" = "success") {
    const accepted = {
      lane: "background",
      name: "Muse",
      persona: "Warm",
      revision: 2,
      character: characterAppearance({}),
    };
    let resolve!: (value: typeof accepted) => void;
    const deferred = new Promise<typeof accepted>((done) => {
      resolve = done;
    });
    const tasks: Promise<void>[] = [];
    const ctx: any = {
      characterAppearance,
      JSON,
      identity: { ...accepted, name: "Orbyn", persona: "Direct", revision: 1 },
      identityName: " Muse ",
      identityPersona: " Warm ",
      appearance: characterAppearance({}),
      editingLook: true,
      lane: "background",
      mounted: { current: true },
      identityEpoch: { current: 1 },
      session: {
        token: "synthetic-owner",
        get() {
          return this.token;
        },
      },
      client: {
        async updateAutomationAgentIdentity() {
          if (response === "failure") throw new Error("Synthetic save failure");
          return response === "deferred" ? deferred : accepted;
        },
      },
      failure: null,
    };
    const run = (fn: () => Promise<void>) => {
      const task = fn().catch((error) => {
        ctx.failure = error;
      });
      tasks.push(task);
      return task;
    };
    ctx.run = run;
    ctx.action = { run };
    ctx.setIdentity = (v: unknown) => {
      ctx.identity = v;
    };
    ctx.setIdentityName = (v: unknown) => {
      ctx.identityName = v;
    };
    ctx.setIdentityPersona = (v: unknown) => {
      ctx.identityPersona = v;
    };
    ctx.setAppearance = (v: unknown) => {
      ctx.appearance = v;
    };
    ctx.setEditingLook = (v: unknown) => {
      ctx.editingLook = v;
    };
    function evaluate(source: string) {
      runInNewContext(
        ts.transpileModule(`result = (${source});`, {
          compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText,
        ctx,
      );
      return ctx.result;
    }
    return {
      ctx,
      accepted,
      resolve: () => resolve(accepted),
      save: () => evaluate(expression("saveIdentity"))({ preventDefault() {} }),
      cancel: () => evaluate(expression("cancelIdentity"))(),
      dirty: () => evaluate(expression("identityDirty")),
      settled: () => Promise.all(tasks),
    };
  }
  test(`${name}: accepted normalized profile reconciles draft and unlocks lane navigation`, async () => {
    const h = harness();
    assert.equal(h.dirty(), true);
    h.save();
    await h.settled();
    assert.equal(h.ctx.identityName, "Muse");
    assert.equal(h.ctx.identityPersona, "Warm");
    assert.deepEqual(
      h.ctx.appearance,
      characterAppearance(h.accepted.character),
    );
    assert.equal(h.ctx.identity.revision, 2);
    assert.equal(h.dirty(), false);
  });
  test(`${name}: failed profile save retains all draft fields and prior revision`, async () => {
    const h = harness("failure");
    h.save();
    await h.settled();
    assert.ok(h.ctx.failure);
    assert.equal(h.ctx.identityName, " Muse ");
    assert.equal(h.ctx.identityPersona, " Warm ");
    assert.equal(h.ctx.identity.revision, 1);
    assert.equal(h.dirty(), true);
  });
  test(`${name}: stale account or unmounted response cannot adopt normalized profile`, async () => {
    for (const stale of ["account", "unmount", ...(mobile ? ["epoch"] : [])]) {
      const h = harness("deferred");
      h.save();
      if (stale === "account") h.ctx.session.token = "other-synthetic-owner";
      else if (stale === "unmount") h.ctx.mounted.current = false;
      else h.ctx.identityEpoch.current++;
      h.resolve();
      await h.settled();
      assert.equal(h.ctx.identity.revision, 1);
      assert.equal(h.ctx.identityName, " Muse ");
      assert.equal(h.ctx.identityPersona, " Warm ");
    }
  });
  test(`${name}: Cancel restores accepted profile and closes customization`, () => {
    const h = harness();
    h.cancel();
    assert.equal(h.ctx.identityName, "Orbyn");
    assert.equal(h.ctx.identityPersona, "Direct");
    assert.equal(h.ctx.editingLook, false);
    assert.equal(h.dirty(), false);
  });
}
