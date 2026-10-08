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
    embedding_revision: "7",
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

function fixture(
  mobile: boolean,
  overrides: object = {},
  reject = false,
  providerOverrides: object = {},
  discoveryOverrides: object = {},
  catalogSearch = "",
) {
  const effects: { fn: () => void; deps: unknown[] }[] = [];
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
        at === 1 ? true : mobile && at === 3 ? catalogSearch : initial,
        (value: unknown) => setters.push([at, value]),
      ];
    },
    useEffect: (fn: () => void, deps: unknown[]) => effects.push({ fn, deps }),
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
      // Catalog lifecycle is tested through the real hook in its own suite.
      // This component harness isolates consent/setup and UI event wiring.
      if (path.endsWith("/hooks/useEmbeddingModelCatalog"))
        return {
          useEmbeddingModelCatalog: () => ({
            loading: false,
            catalog: undefined,
            error: undefined,
            load: () => calls.push("catalog-load"),
            ...discoveryOverrides,
          }),
        };
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
      for (const name of ["Button", "Icon", "Pill", "Segmented", "Disclosure"])
        if (path.endsWith(`/components/${name}`)) return { [name]: control };
      return require(path);
    },
  };
  runInNewContext(output, context);
  const tree = context.exports.SemanticSetup({
    settings: { ...settings, ...overrides },
    providers: providers.map((provider) => ({
      ...provider,
      ...providerOverrides,
    })),
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
    effects,
    elements,
    calls,
    setters,
    pending,
    refreshed: () => refreshed,
  };
}

test("mobile no-match catalog omits the empty chip track and preserves the manual model", () => {
  const view = fixture(
    true,
    {},
    false,
    {},
    {
      catalog: { models: ["last-model-249"], catalog_kind: "unclassified" },
    },
    "no-such-model",
  );
  assert.ok(
    view.elements.some((node) => node.props.value === settings.embedding_model),
  );
  assert.match(renderToStaticMarkup(view.tree), /No matching models/);
  assert.equal(
    view.elements.some(
      (node) => node.props.accessibilityLabel === "Embedding catalog models",
    ),
    false,
  );
  assert.deepEqual(view.calls, []);
});

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
        expected_provider_revision: "7",
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

for (const mobile of [false, true]) {
  const platform = mobile ? "mobile" : "web";
  test(`${platform} consent resets for the displayed embedding revision and enable state`, () => {
    const view = fixture(mobile);
    const effect = view.effects.find(
      (effect) =>
        effect.deps.length === 3 &&
        effect.deps[0] === providerId &&
        effect.deps[1] === "7" &&
        effect.deps[2] === true,
    );
    assert.ok(
      effect,
      "consent watches the embedding revision rather than generation controls",
    );
    effect.fn();
    assert.ok(view.setters.some(([at, value]) => at === 1 && value === false));
  });
  test(`${platform} missing embedding revision cannot enable setup`, () => {
    const view = fixture(mobile, {}, false, { embedding_revision: undefined });
    const submit = view.elements.find((node) =>
      mobile
        ? node.props.title === "Validate and turn on search by meaning"
        : node.type === "button" &&
          node.props.children === "Validate and turn on search by meaning",
    );
    assert.equal(submit.props.disabled, true);
  });
}

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "web"} displays failed pages and retry due time separately from worker liveness`, () => {
    const view = fixture(mobile, {
      semantic_search: true,
      semantic_accepted_at: "2026-10-08T00:00:00Z",
      embedding_failed_pages: 2,
      embedding_pending_pages: 3,
      embedding_indexed_pages: 4,
      embedding_next_retry_at: "2026-10-08T00:05:00Z",
      measure_running: false,
    });
    const text = renderToStaticMarkup(view.tree);
    assert.match(text, /2 pages could not be measured/);
    assert.match(text, /Next retry due/);
    assert.match(text, /measuring service is offline/);
    assert.match(text, /4 pages measured; 3 pages waiting/);
  });
}

for (const mobile of [false, true]) {
  const platform = mobile ? "mobile" : "web";
  test(`${platform} catalog loading neither grants consent nor changes semantic settings`, () => {
    const view = fixture(mobile);
    const control = view.elements.find((node) =>
      mobile
        ? node.props.title === "Load embedding model catalog"
        : node.type === "button" &&
          node.props.children === "Load embedding model catalog",
    );
    assert.ok(control);
    if (!mobile) assert.equal(control.props.className, "secondary");
    if (mobile) control.props.onPress();
    else control.props.onClick();
    assert.deepEqual(view.calls, ["catalog-load"]);
    assert.equal(view.setters.length, 0);
  });
  test(`${platform} loading catalog prevents duplicate requests and displays loading`, () => {
    const view = fixture(mobile, {}, false, {}, { loading: true });
    const control = view.elements.find((node) =>
      mobile
        ? node.props.title === "Loading models…"
        : node.type === "button" && node.props.children === "Loading models…",
    );
    assert.ok(control);
    assert.equal(control.props.disabled, true);
  });
  for (const kind of ["manual", "unclassified", "embedding"]) {
    test(`${platform} ${kind} catalog is labelled honestly without granting consent`, () => {
      const view = fixture(
        mobile,
        {},
        false,
        {},
        { catalog: { models: [], catalog_kind: kind } },
      );
      const html = renderToStaticMarkup(view.tree);
      assert.match(
        html,
        kind === "manual"
          ? /Type the deployment or model name manually/
          : kind === "unclassified"
            ? /Embedding support is checked when you validate/
            : /Dimensions are checked when you validate/,
      );
      assert.deepEqual(view.calls, []);
      assert.equal(view.setters.length, 0);
    });
  }
  test(`${platform} catalog failure is visible and keeps the typed model`, () => {
    const view = fixture(
      mobile,
      {},
      false,
      {},
      { error: "Fixture catalog unavailable" },
    );
    const html = renderToStaticMarkup(view.tree);
    assert.match(html, /Fixture catalog unavailable/);
    assert.ok(
      view.elements.some(
        (node) => node.props.value === settings.embedding_model,
      ),
    );
    assert.deepEqual(view.calls, []);
  });
}

for (const name of ["Embedding recipient", "Changed recipient"]) {
  test(`mobile consent switch exposes the displayed scope and recipient: ${name}`, () => {
    const view = fixture(true, {}, false, { name });
    const consent = view.elements.find(
      (node) => node.props.onValueChange && node.props.value === true,
    );
    assert.ok(consent);
    assert.equal(
      consent.props.accessibilityLabel,
      `I understand that the words of every page (except projects and teams kept out of the assistant) are sent to ${name} to be measured.`,
    );
    const text = renderToStaticMarkup(view.tree);
    assert.ok(text.includes(consent.props.accessibilityLabel));
    assert.deepEqual(view.calls, []);
  });
}

test("mobile missing eligible recipient retains full consent scope without enabling", () => {
  const view = fixture(true, {}, false, { enabled: false });
  const consent = view.elements.find((node) => node.props.onValueChange);
  assert.ok(consent);
  assert.match(consent.props.accessibilityLabel, /projects and teams kept out/);
  assert.match(consent.props.accessibilityLabel, /the selected embedding provider/);
  assert.equal(consent.props.disabled, true);
  assert.deepEqual(view.calls, []);
});
