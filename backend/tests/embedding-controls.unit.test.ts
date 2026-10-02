import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
const providerId = "00000000-0000-4000-8000-000000000001";
const generation = "00000000-0000-4000-8000-000000000002";
const providers = [
  {
    id: providerId,
    kind: "openai",
    name: "Embedding recipient",
    enabled: true,
  },
];
const settings = {
  provider_id: null,
  model: "",
  source: "none",
  semantic_search: false,
  semantic_possible: true,
  measure_running: true,
  embedding_model: "  embedding-fixture  ",
  embedding_provider_id: providerId,
  embedding_generation: generation,
  updated_at: null,
};

function fixture(mobile: boolean, overrides: object = {}, reject = false) {
  const setters: [number, unknown][] = [];
  const calls: unknown[] = [];
  const pending: Promise<unknown>[] = [];
  let refreshed = 0;
  let index = 0;
  const hooks = {
    ...React,
    useState: (initial: unknown) => {
      const at = index++;
      return [
        at === 1 ? true : initial,
        (value: unknown) => setters.push([at, value]),
      ];
    },
    useEffect: () => {},
  };
  const control = (props: any) =>
    React.createElement("div", null, props.children);
  const source = readFileSync(
    new URL(
      mobile
        ? "../../mobile/src/screens/SemanticSetup.tsx"
        : "../../desktop/src/features/admin/SemanticSetup.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const context = {
    exports: {} as Record<string, any>,
    require: (path: string) => {
      if (path === "react") return hooks;
      if (path.endsWith("/lib/api"))
        return {
          client: {
            setSemanticSearch: async (input: unknown) => {
              calls.push(input);
              if (reject) throw new Error("conflict");
              return settings;
            },
          },
        };
      if (path.endsWith("/Select")) return { Select: control };
      if (path === "react-native")
        return {
          View: control,
          Text: control,
          TextInput: control,
          Switch: control,
          StyleSheet: { create: (value: unknown) => value },
        };
      if (path.endsWith("/theme"))
        return { colors: {}, fonts: {}, themed: (fn: () => unknown) => fn() };
      if (path.endsWith("/styles")) return { shared: {} };
      if (path.endsWith("/motion")) return { FadeIn: control };
      for (const name of ["Button", "Icon", "Pill", "Segmented"])
        if (path.endsWith(`/components/${name}`)) return { [name]: control };
      return require(path);
    },
  };
  runInNewContext(output, context);
  const tree = context.exports.SemanticSetup({
    settings: { ...settings, ...overrides },
    providers,
    busy: false,
    act: (fn: () => Promise<void>) => {
      const promise = fn();
      pending.push(promise);
      return promise;
    },
    onChanged: async () => {
      refreshed++;
    },
    onSettings: () => {},
  });
  const elements: any[] = [];
  const walk = (node: any) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node?.props) {
      elements.push(node);
      walk(node.props.children);
    }
  };
  walk(tree);
  return {
    tree,
    elements,
    calls,
    setters,
    pending,
    refreshed: () => refreshed,
  };
}

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "web"} setup describes missing prerequisites without claiming readiness`, () => {
    const view = fixture(mobile, {
      semantic_possible: false,
      measure_running: false,
      embedding_provider_id: null,
    });
    const html = renderToStaticMarkup(view.tree);
    assert.match(html, /Database measurements are unavailable/);
    assert.match(html, /The measuring service is offline/);
    assert.match(html, /Select an embedding provider/);
    assert.doesNotMatch(
      html,
      /An independent embedding provider is selected|The measuring service is running|The database can store measurements/,
    );
  });

  const platform = mobile ? "mobile" : "web";
  test(`${platform} embedding controls submit the explicit recipient and generation`, async () => {
    const view = fixture(mobile);
    if (mobile)
      view.elements
        .find(
          (node) =>
            node.props.title === "Validate and turn on search by meaning",
        )
        .props.onPress();
    else
      view.elements
        .find((node) => node.type === "form")
        .props.onSubmit({ preventDefault() {} });
    await Promise.all(view.pending);
    assert.deepEqual(JSON.parse(JSON.stringify(view.calls)), [
      {
        on: true,
        embedding_model: "embedding-fixture",
        embedding_provider_id: providerId,
        expected_generation: generation,
        accept: true,
      },
    ]);
    assert.equal(view.refreshed(), 1);
    assert.ok(view.setters.some(([at, value]) => at === 1 && value === false));
  });
  test(`${platform} provider changes clear model and acceptance`, () => {
    const view = fixture(mobile);
    const next = "00000000-0000-4000-8000-000000000003";
    const control = view.elements.find((node) =>
      mobile
        ? node.props.accessibilityLabel === "Embedding provider"
        : node.props.children?.some?.(
            (child: any) => child?.props?.value === "",
          ),
    );
    if (mobile) control.props.onChange(next);
    else control.props.onChange({ target: { value: next } });
    assert.ok(view.setters.some(([at, value]) => at === 0 && value === ""));
    assert.ok(view.setters.some(([at, value]) => at === 1 && value === false));
    assert.ok(view.setters.some(([at, value]) => at === 2 && value === next));
  });
  test(`${platform} conflicts refresh metadata and reset acceptance`, async () => {
    const view = fixture(mobile, {}, true);
    if (mobile)
      view.elements
        .find(
          (node) =>
            node.props.title === "Validate and turn on search by meaning",
        )
        .props.onPress();
    else
      view.elements
        .find((node) => node.type === "form")
        .props.onSubmit({ preventDefault() {} });
    await assert.rejects(view.pending[0], /conflict/);
    assert.equal(view.refreshed(), 1);
    assert.ok(view.setters.some(([at, value]) => at === 1 && value === false));
  });
  test(`${platform} active controls display the embedding recipient and progress`, () => {
    const view = fixture(mobile, {
      semantic_search: true,
      semantic_accepted_at: "2026-10-01T00:00:00Z",
      embedding_dimensions: 3072,
      embedding_indexed_pages: 3,
      embedding_pending_pages: 2,
    });
    const html = renderToStaticMarkup(view.tree);
    assert.match(html, /Embedding recipient/);
    assert.match(html, /3 pages measured; 2 pages waiting/);
    assert.match(html, /3072 dimensions verified/);
    assert.doesNotMatch(html, /undefined dimensions/);
  });
  test(`${platform} missing status is not displayed as measured zero or verified dimensions`, () => {
    const view = fixture(mobile, {
      semantic_search: true,
      semantic_accepted_at: "2026-10-01T00:00:00Z",
    });
    const html = renderToStaticMarkup(view.tree);
    assert.match(html, /Indexing status is unavailable/);
    assert.doesNotMatch(html, /0 pages measured|dimensions verified/);
  });
}
