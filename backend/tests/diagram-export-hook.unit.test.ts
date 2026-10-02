import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as core from "@orbyn/core";

/** Execute the real hooks with deterministic effect lifetimes, without accepting terms or using app data. */
function fixture(native: boolean) {
  const source = readFileSync(
    new URL(
      native
        ? "../../mobile/src/screens/docs/use-diagram-export.tsx"
        : "../../desktop/src/features/docs/use-diagram-export.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const slots: any[] = [];
  const cleanup = new Map<number, () => void>();
  const effects: (() => void)[] = [];
  let index = 0;
  const listeners = new Set<(event: unknown) => void>();
  const hooks = {
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in slots))
        slots[slot] = !native && slot === 1 ? "trusted fixture" : initial;
      return [
        slots[slot],
        (value: unknown) => {
          slots[slot] = value;
        },
      ];
    },
    useRef(initial: unknown) {
      const slot = index++;
      return (slots[slot] ??= { current: initial });
    },
    useCallback(callback: unknown) {
      index++;
      return callback;
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const slot = index++;
      if (!slots[slot] || deps.some((value, i) => value !== slots[slot][i])) {
        slots[slot] = deps;
        effects.push(() => {
          cleanup.get(slot)?.();
          const dispose = effect();
          if (dispose) cleanup.set(slot, dispose);
        });
      }
    },
  };
  const modules: Record<string, unknown> = {
    react: { ...React, ...hooks },
    "@orbyn/core": core,
    "react-native": { View: "view" },
    "../../components/DiagramSurface": { DiagramSurface: "diagram-surface" },
  };
  const exports: Record<string, (scope: string) => any> = {};
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      React,
      Error,
      window: {
        addEventListener: (_: string, listener: (event: unknown) => void) =>
          listeners.add(listener),
        removeEventListener: (_: string, listener: (event: unknown) => void) =>
          listeners.delete(listener),
      },
      require(name: string) {
        assert.ok(name in modules, `Unexpected export hook dependency ${name}`);
        return modules[name];
      },
    },
  );
  const render = (scope = "account:doc") => {
    index = 0;
    const result = exports.useDiagramExport(scope);
    effects.splice(0).forEach((effect) => effect());
    return result;
  };
  let current = render();
  const contentWindow = { postMessage() {} };
  const receive = (request: string, spoof = false) => {
    const { id } = JSON.parse(request);
    const data = JSON.stringify({
      type: "orbyn-diagram-result",
      id,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
    if (native) current.surface.props.children.props.onResult(data);
    else
      for (const listener of listeners)
        listener({ source: spoof ? {} : contentWindow, data });
  };
  return {
    render(scope?: string) {
      current = render(scope);
      return current;
    },
    initial: current,
    request() {
      current = render();
      if (!native) current.surface.props.ref.current = { contentWindow };
      return slots[0] as string;
    },
    receive,
    unmount() {
      for (const dispose of cleanup.values()) dispose();
      cleanup.clear();
    },
    listenerCount: () => listeners.size,
  };
}

for (const native of [false, true]) {
  const name = native ? "native" : "web";
  test(`${name} export aborts active and queued work when document or account changes`, async () => {
    const f = fixture(native);
    const signal = f.initial.signal();
    const active = f.initial.render("graph TD; A-->B");
    const queued = f.initial.render("graph TD; C-->D");
    const checks = [
      assert.rejects(active, { name: "AbortError" }),
      assert.rejects(queued, { name: "AbortError" }),
    ];
    await Promise.resolve();
    f.request();
    const next = f.render("other-account:other-doc");
    assert.ok(signal.aborted);
    assert.equal(next.signal().aborted, false);
    await Promise.all(checks);
    f.unmount();
    assert.equal(f.listenerCount(), 0);
  });
  test(`${name} export keeps its local engine alive within a batch and cancels on close`, async () => {
    const f = fixture(native);
    const active = f.initial.render("graph TD; A-->B");
    await Promise.resolve();
    const request = f.request();
    if (!native) {
      f.receive(request, true);
      assert.equal(f.initial.signal().aborted, false);
    }
    f.receive(request);
    assert.match(await active, /^<svg/);
    assert.ok(f.render().surface);
    const pending = f.initial.render("graph TD; B-->C");
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await Promise.resolve();
    f.unmount();
    await rejected;
    assert.equal(f.listenerCount(), 0);
  });
}
