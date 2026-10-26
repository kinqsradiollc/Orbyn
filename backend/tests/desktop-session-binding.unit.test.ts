import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function fixture() {
  let blocked = false;
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => {
      if (blocked) throw Error("blocked");
      return values.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (blocked) throw Error("blocked");
      values.set(key, value);
    },
    removeItem: (key: string) => {
      if (blocked) throw Error("blocked");
      values.delete(key);
    },
  };
  let event!: (value: unknown) => void;
  const source = readFileSync(
    new URL("../../desktop/src/lib/session.ts", import.meta.url),
    "utf8",
  );
  const result = vm.runInNewContext(
    ts.transpileModule(
      source.replaceAll("export ", "") + "\n({session,onSessionChange});",
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    {
      localStorage: storage,
      sessionStorage: storage,
      window: {
        addEventListener: (_: string, listener: typeof event) => {
          event = listener;
        },
        removeEventListener: () => {},
      },
    },
  );
  return {
    ...result,
    block: (value: boolean) => {
      blocked = value;
    },
    event: (value: unknown) => event(value),
  };
}
test("blocked persistence retains live session, while an unavailable initial read identifies nobody", () => {
  const f = fixture();
  f.block(true);
  assert.equal(f.session.binding().token, "");
  f.session.set("A");
  assert.equal(f.session.get(), "A");
  assert.equal(f.session.binding().token, "A");
});
test("failed clear cannot reactivate old disk credential, even after storage recovers", () => {
  const f = fixture();
  f.session.set("A");
  f.block(true);
  f.session.clear();
  f.block(false);
  assert.equal(f.session.binding().token, "");
  assert.equal(f.session.get(), "");
});
test("same-token ABA changes generation and cross-tab logout is authoritative", () => {
  const f = fixture();
  f.session.set("A");
  const before = f.session.binding().generation;
  f.session.clear();
  f.session.set("A");
  assert.ok(f.session.binding().generation > before);
  f.onSessionChange(() => {});
  f.event({ key: "orbyn-session", newValue: "B" });
  // The real StorageEvent follows the corresponding storage update.
  f.block(true);
  assert.equal(f.session.binding().token, "B");
  f.event({ key: "orbyn-session", newValue: null });
  assert.equal(f.session.binding().token, "");
});
