import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as core from "@orbyn/core";

/** Run the real desktop effect with a controlled Mermaid engine, without a browser. */
async function desktopDiagram(source: string, svg = "<svg />") {
  const effects: (() => unknown)[] = [];
  const states: unknown[] = [];
  const calls: string[] = [];
  const configs: Record<string, unknown>[] = [];
  const engine = {
    initialize: (config: Record<string, unknown>) => configs.push(config),
    render: async (_id: string, text: string) => {
      calls.push(text);
      return { svg };
    },
  };
  const hooks = {
    ...React,
    useId: () => "diagram-fixture",
    useMemo: (fn: () => unknown) => fn(),
    useRef: () => ({ current: null }),
    useEffect: (fn: () => unknown) => effects.push(fn),
    useState: (value: unknown) => {
      const index = states.length;
      states.push(value);
      return [value, (next: unknown) => (states[index] = next)];
    },
  };
  const exports: Record<string, (props: unknown) => unknown> = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL(
          "../../desktop/src/features/docs/RichBlocks.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.React,
          esModuleInterop: true,
        },
      },
    ).outputText,
    {
      exports,
      React,
      document: { documentElement: {}, getElementById: () => null },
      getComputedStyle: () => ({
        getPropertyValue: (name: string) =>
          (core.colors as Record<string, string>)[name.replace("--color-", "")],
      }),
      require: (name: string) =>
        name === "react"
          ? hooks
          : name === "@orbyn/core"
            ? core
            : name === "mermaid"
              ? { __esModule: true, default: engine }
              : {},
    },
  );
  exports.Diagram({ text: source });
  for (const effect of effects) effect();
  await new Promise((resolve) => setImmediate(resolve));
  return { calls, configs, failed: states[0] };
}

test("desktop Diagram rejects document configuration and huge input before rendering", async () => {
  for (const source of [
    "%%{init: {securityLevel: 'loose'}}%%\nflowchart LR\nA --> B",
    "x".repeat(core.MERMAID_MAX_SOURCE + 1),
    'flowchart LR\nA@{ img: "https://example.test/private" }',
    "flowchart LR\nA --> B\nclassDef remote fill:url(https://example.test/private);",
  ]) {
    const result = await desktopDiagram(source);
    assert.equal(result.calls.length, 0);
    assert.equal(result.failed, true);
  }
});

test("desktop Diagram pins security, edge bounds and inert labels for normal source", async () => {
  const result = await desktopDiagram("\ufeffflowchart LR\r\nA --> B");
  assert.deepEqual(result.calls, ["flowchart LR\nA --> B"]);
  assert.equal(result.failed, false);
  const config = result.configs[0];
  assert.equal(config.securityLevel, "strict");
  assert.equal(config.maxTextSize, core.MERMAID_MAX_SOURCE);
  assert.equal(config.maxEdges, 512);
  assert.equal(config.htmlLabels, false);
  assert.equal(config.suppressErrorRendering, true);
  assert.deepEqual(Array.from(config.secure as string[]), Object.keys(config));
});

test("desktop Diagram rejects oversized engine output", async () => {
  const result = await desktopDiagram(
    "flowchart LR\nA --> B",
    "x".repeat(core.MERMAID_MAX_SVG + 1),
  );
  assert.equal(result.calls.length, 1);
  assert.equal(result.failed, true);
});
