import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** Load the real UI helper in an isolated DOM harness, without a backend app dependency. */
const context: Record<string, unknown> = { exports: {} };
runInNewContext(
  ts.transpileModule(read("desktop/src/features/docs/doc-layout.ts"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  context,
);
const { docRailLayout, observeDocLayout } = context.exports as {
  docRailLayout: (width: number) => { narrow: boolean; outline: boolean };
  observeDocLayout: (
    element: unknown,
    onWidth: (width: number) => void,
  ) => () => void;
};

test("Docs rails follow available page width after app and library panels", () => {
  for (const width of [0, 320, 600, 899, -1, NaN, Infinity]) {
    assert.deepEqual(
      { ...docRailLayout(width) },
      { narrow: true, outline: false },
    );
  }
  for (const width of [900, 1000, 1059]) {
    assert.deepEqual(
      { ...docRailLayout(width) },
      { narrow: false, outline: false },
    );
  }
  for (const width of [1060, 1400]) {
    assert.deepEqual(
      { ...docRailLayout(width) },
      { narrow: false, outline: true },
    );
  }
});

test("Docs observer measures on mount, handles panel resizes and disconnects", () => {
  const descriptor = Object.getOwnPropertyDescriptor(context, "ResizeObserver");
  let callback: (entries: unknown[]) => void = () => {};
  let observed: unknown;
  let disconnected = false;
  class Observer {
    constructor(onResize: typeof callback) {
      callback = onResize;
    }
    observe(element: unknown) {
      observed = element;
    }
    disconnect() {
      disconnected = true;
    }
  }
  Object.defineProperty(context, "ResizeObserver", {
    configurable: true,
    value: Observer,
  });
  try {
    const element = { getBoundingClientRect: () => ({ width: 1200 }) };
    const widths: number[] = [];
    const stop = observeDocLayout(element as never, (width) =>
      widths.push(width),
    );
    assert.equal(observed, element);
    callback([]);
    callback([{ target: {}, contentRect: { width: 1 } }]);
    callback([{ target: element, contentRect: { width: 700 } }]);
    callback([{ target: element, contentRect: { width: 1100 } }]);
    assert.deepEqual(widths, [1200, 700, 1100]);
    stop();
    assert.equal(disconnected, true);
  } finally {
    if (descriptor)
      Object.defineProperty(context, "ResizeObserver", descriptor);
    else Reflect.deleteProperty(context, "ResizeObserver");
  }
});

test("Docs window fallback measures initially and removes its resize listener", () => {
  const observerDescriptor = Object.getOwnPropertyDescriptor(
    context,
    "ResizeObserver",
  );
  const windowDescriptor = Object.getOwnPropertyDescriptor(context, "window");
  let listener: (() => void) | undefined;
  let removed: unknown;
  Object.defineProperty(context, "ResizeObserver", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(context, "window", {
    configurable: true,
    value: {
      addEventListener(name: string, callback: () => void) {
        assert.equal(name, "resize");
        listener = callback;
      },
      removeEventListener(name: string, callback: () => void) {
        assert.equal(name, "resize");
        removed = callback;
      },
    },
  });
  try {
    let width = 800;
    const widths: number[] = [];
    const stop = observeDocLayout(
      { getBoundingClientRect: () => ({ width }) } as never,
      (value) => widths.push(value),
    );
    width = 1200;
    assert.ok(listener);
    listener();
    stop();
    assert.deepEqual(widths, [800, 1200]);
    assert.equal(removed, listener);
  } finally {
    for (const [name, descriptor] of [
      ["window", windowDescriptor],
      ["ResizeObserver", observerDescriptor],
    ] as const) {
      if (descriptor) Object.defineProperty(context, name, descriptor);
      else Reflect.deleteProperty(context, name);
    }
  }
});

test("Docs container state stacks rails and anchored comments without reserving old height", () => {
  const source = read("desktop/src/features/docs/DocEditor.tsx");
  const css = read("desktop/src/features/docs/docs.css");
  assert.ok(source.includes("observeDocLayout(el, setLayoutWidth)"));
  assert.ok(source.includes('railLayout.narrow ? " is-narrow"'));
  assert.ok(source.includes("showsOutline(outline) && railLayout.outline"));
  assert.match(
    css,
    /\.doc-layout\.is-narrow\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
  assert.match(
    css,
    /\.doc-layout\.is-narrow \.doc-card\.is-anchored\s*\{\s*position: static;/,
  );
  assert.match(
    css,
    /\.doc-layout\.is-narrow \.doc-margin-anchored\s*\{\s*min-height: 0 !important;/,
  );
  assert.match(
    css,
    /\.doc-layout\.is-narrow\.has-info \.page-info\s*\{\s*order: -1;/,
  );
  const mobile = read("mobile/src/screens/docs/DocEditor.tsx");
  assert.ok(mobile.includes("visible={infoOpen}"));
  assert.match(
    mobile,
    /onShowHistory=\{\(\) => \{\s*setInfoOpen\(false\);\s*onShowHistory\?\.\(\);/,
  );
});
