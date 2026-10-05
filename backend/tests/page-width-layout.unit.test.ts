import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
function fixture(observer = true) {
  let width = 640;
  const element = { getBoundingClientRect: () => ({ width }) };
  const values: number[] = [];
  let callback: (entries: unknown[]) => void = () => {};
  let observed: unknown;
  let disconnected = 0;
  const listeners = new Map<string, () => void>();
  const context = {
    exports: {},
    window: {
      addEventListener: (name: string, listener: () => void) =>
        listeners.set(name, listener),
      removeEventListener: (name: string, listener: () => void) => {
        assert.equal(listeners.get(name), listener);
        listeners.delete(name);
      },
    },
    ...(observer
      ? {
          ResizeObserver: class {
            constructor(fn: typeof callback) {
              callback = fn;
            }
            observe(node: unknown) {
              observed = node;
            }
            disconnect() {
              disconnected++;
            }
          },
        }
      : {}),
  };
  runInNewContext(
    ts.transpileModule(read("desktop/src/hooks/element-width.ts"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    context,
  );
  const { observeElementWidth } = context.exports as {
    observeElementWidth: (
      element: unknown,
      onWidth: (width: number) => void,
    ) => () => void;
  };
  const stop = observeElementWidth(element, (value) => values.push(value));
  return {
    element,
    values,
    stop,
    listeners,
    get observed() {
      return observed;
    },
    get disconnected() {
      return disconnected;
    },
    resize: (next: number, target: unknown = element) => {
      width = next;
      if (observer) callback([{ target, contentRect: { width } }]);
      else listeners.get("resize")?.();
    },
  };
}

test("page observer measures available width, follows panel resizes and disconnects", () => {
  const f = fixture();
  assert.equal(f.observed, f.element);
  assert.deepEqual(f.values, [640]);
  f.resize(1180);
  f.resize(620);
  f.resize(300, {});
  assert.deepEqual(f.values, [640, 1180, 620]);
  f.stop();
  assert.equal(f.disconnected, 1);
});

test("invalid element widths cannot enable wide layout", () => {
  const f = fixture();
  for (const width of [NaN, Infinity, -1, 0]) f.resize(width);
  assert.deepEqual(f.values, [640, 0, 0, 0, 0]);
  f.stop();
});

test("fallback listener measures element width and is removed on unmount", () => {
  const f = fixture(false);
  assert.equal(f.listeners.size, 1);
  f.resize(320);
  assert.deepEqual(f.values, [640, 320]);
  f.stop();
  assert.equal(f.listeners.size, 0);
});

test("page hook follows mounted and replaced nodes, not only initial loading", () => {
  const source = read("desktop/src/hooks/useElementWidth.ts");
  assert.match(source, /useState<HTMLElement \| null>\(null\)/);
  assert.match(source, /return observeElementWidth\(element, setWidth\)/);
  assert.match(source, /\}, \[element\]\)/);
  assert.match(source, /return \{ ref, width \}/);
});

for (const [feature, file, boundary] of [
  ["views", "ViewsView", 640],
  ["review", "ReviewView", 520],
] as const) {
  test(`${feature} stacks by page width while preserving window fallbacks`, () => {
    const source = read(`desktop/src/features/${feature}/${file}.tsx`);
    const css = read(`desktop/src/features/${feature}/${feature}.css`);
    assert.match(source, /ref=\{pageRef\}/);
    assert.ok(source.includes('pageWidth < 900 ? " is-compact"'));
    assert.ok(source.includes(`pageWidth < ${boundary} ? " is-small"`));
    assert.match(
      css,
      new RegExp(
        `\\.${feature}-(?:screen|view)\\.is-compact\\s*\\{[^}]*grid-template-columns: minmax\\(0, 1fr\\)`,
      ),
    );
    assert.ok(css.includes("@media (max-width: 900px)"));
    assert.ok(!css.includes("container-type:")); // Fixed dialogs must remain viewport-owned.
  });
}

test("small review actions and metadata wrap on both clients; gallery cells fit their page", () => {
  const review = read("desktop/src/features/review/review.css");
  const views = read("desktop/src/features/views/views.css");
  const mobile = read("mobile/src/screens/ReviewSheet.tsx");
  assert.match(review, /\.review-actions\s*\{[^}]*flex-wrap: wrap/);
  assert.match(review, /\.review-rows\s*\{[^}]*table-layout: fixed/);
  assert.match(views, /minmax\(min\(200px, 100%\), 1fr\)/);
  assert.equal((mobile.match(/style=\{s.actionButton\}/g) ?? []).length, 2);
  assert.match(mobile, /actions: \{[^}]*flexWrap: "wrap"/);
  assert.match(mobile, /actionButton: \{[^}]*flexBasis: 140[^}]*minWidth: 0/);
  assert.match(mobile, /changeHead: \{[^}]*flexWrap: "wrap"/);
});
