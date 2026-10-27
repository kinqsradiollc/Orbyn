import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as core from "@orbyn/core";
import { OrbynClient } from "@orbyn/api-client";

test("excerpt context validates local UTF16 slice and serializes no source or callback", () => {
  const source = "first 🌱 repeated repeated";
  const selection = core.docSelectionContext(
    {
      format: "note",
      source,
      start: 6,
      end: 8,
      quote: "🌱",
      isCurrent: () => true,
    },
    7,
  );
  assert.deepEqual(selection, {
    format: "note",
    start: 6,
    end: 8,
    quote: "🌱",
    expected_revision: 7,
  });
  assert.equal("source" in selection, false);
  assert.equal("isCurrent" in selection, false);
  assert.throws(() =>
    core.docSelectionContext(
      { format: "note", source, start: 0, end: 5, quote: "wrong" },
      7,
    ),
  );
  assert.throws(() =>
    core.docSelectionContext(
      {
        format: "note",
        source,
        start: 0,
        end: 5,
        quote: "first",
        isCurrent: () => false,
      },
      7,
    ),
  );
  for (const change of [
    { quote: "x".repeat(4097), start: 0, end: 4097 },
    { start: -1 },
    { end: 1_000_001 },
    { expected_revision: 0 },
    { source: "not allowed" },
  ])
    assert.equal(
      core.docAskSelection.safeParse({ ...selection, ...change }).success,
      false,
    );
});

test("API sends optional excerpt on existing ask route; page request stays unchanged", async () => {
  const calls: any[] = [];
  const client = Object.create(OrbynClient.prototype);
  client.request = async (...args: any[]) => {
    calls.push(args);
    return {};
  };
  const selection = core.docSelectionContext(
    {
      format: "markdown",
      source: "prefix chosen suffix",
      start: 7,
      end: 13,
      quote: "chosen",
    },
    7,
  );
  await client.askDoc("page", "Explain", selection);
  await client.askDoc("page", "Whole page question");
  assert.deepEqual(calls[0], [
    "/docs/page/ask",
    { method: "POST", body: { question: "Explain", selection } },
  ]);
  assert.deepEqual(calls[1][1].body, { question: "Whole page question" });
});

async function routeFixture(
  options: {
    version?: number;
    readable?: boolean;
    allowed?: boolean;
    providerFailure?: boolean;
  } = {},
) {
  const handlers = new Map<string, any>();
  const calls: any[] = [];
  const exports: any = {};
  const source = readFileSync(
    new URL("../src/modules/ai/docs.ts", import.meta.url),
    "utf8",
  );
  const doc = {
    id: "page",
    version: options.version ?? 7,
    title: "PRIVATE TITLE",
    team_id: "team",
    content: [
      { id: "block", type: "paragraph", text: "PRIVATE SAVED CONTENT" },
    ],
  };
  const db = {
    query: async () => ({ rows: options.readable === false ? [] : [doc] }),
  };
  const dependencies: Record<string, any> = {
    "@orbyn/core": core,
    "../../db/pool.js": { reader: () => db },
    "../../lib/auth.js": {
      authenticate: async () => ({ id: "user" }),
      isSessionPrincipal: () => true,
    },
    "../../lib/params.js": { idParam: () => "page", strictRateLimit: {} },
    "../../lib/teams.js": {
      requireAssistantAllowed: async () => {
        if (options.allowed === false) core.fail(403, "AI disabled");
      },
    },
    "./providers/feature-call.js": {
      completePageFeature: async (...args: any[]) => {
        calls.push(args);
        if (options.providerFailure) throw new Error("Provider unavailable");
        return JSON.stringify({ answer: "Explanation", sources: [0] });
      },
    },
    "../../lib/assistant-off.js": {
      docKeptOut: async () => false,
      PAGE_KEPT_OUT: "Disabled",
    },
    "../../lib/visibility.js": { readableDocs: () => "TRUE" },
    "../documents/service.js": {},
    "../links/privacy.js": {
      linkPrivacy: async () => ({ value: (value: any) => value }),
    },
    "../documents/ranges.js": {},
  };
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(name in dependencies, `Unexpected dependency ${name}`);
        return dependencies[name];
      },
    },
  );
  await exports.aiDocRoutes({
    post: (path: string, ...args: any[]) => handlers.set(path, args.at(-1)),
  });
  return {
    calls,
    ask: (body: any) =>
      handlers.get("/docs/:id/ask")({ headers: {}, body, log: { error() {} } }),
  };
}

test("excerpt explanation sends ONLY explicit unsaved quote/question, returns no invented canonical citations", async () => {
  const fixture = await routeFixture();
  const selection = core.docSelectionContext(
    {
      format: "latex",
      source: "\\broken{ unsaved",
      start: 0,
      end: 16,
      quote: "\\broken{ unsaved",
    },
    7,
  );
  const answer = await fixture.ask({
    question: "Explain the selected text",
    selection,
  });
  assert.equal(answer.answer, "Explanation");
  assert.deepEqual(Array.from(answer.sources), []);
  assert.equal(fixture.calls.length, 1);
  const messages = fixture.calls[0][3];
  assert.deepEqual(JSON.parse(messages[1].content), {
    excerpt: { format: "latex", quote: selection.quote },
    question: "Explain the selected text",
  });
  assert.doesNotMatch(
    JSON.stringify(messages),
    /PRIVATE SAVED CONTENT|PRIVATE TITLE/,
  );
  assert.match(messages[0].content, /untrusted data/);
  assert.match(messages[0].content, /unsaved draft/);
});

test("excerpt access, revision and AI authority fail before provider; provider error is recoverable", async () => {
  const selection = core.docSelectionContext(
    { format: "note", source: "chosen", start: 0, end: 6, quote: "chosen" },
    7,
  );
  for (const [options, status] of [
    [{ version: 8 }, 409],
    [{ readable: false }, 404],
    [{ allowed: false }, 403],
  ] as const) {
    const fixture = await routeFixture(options);
    await assert.rejects(
      fixture.ask({ question: "Explain", selection }),
      (error: any) => error.statusCode === status,
    );
    assert.equal(fixture.calls.length, 0);
  }
  const bad = await routeFixture();
  await assert.rejects(
    bad.ask({
      question: "Explain",
      selection: { ...selection, quote: "mismatch" },
    }),
  );
  assert.equal(bad.calls.length, 0);
  const failure = await routeFixture({ providerFailure: true });
  await assert.rejects(
    failure.ask({ question: "Explain", selection }),
    (error: any) => error.statusCode === 502,
  );
});

test("page-wide ask keeps saved document context and canonical citations", async () => {
  const fixture = await routeFixture();
  const answer = await fixture.ask({ question: "Page question" });
  assert.match(fixture.calls[0][3][1].content, /PRIVATE SAVED CONTENT/);
  assert.equal(answer.sources[0].block_id, "block");
});

test("selection gestures publish once after release, handle keyboard/cancel and dispose pending work", () => {
  let text = "first";
  let task: (() => void) | undefined;
  const values: (string | null)[] = [];
  const controller = core.createDocSelectionSettler(
    () => text,
    (value) => values.push(value),
    (callback) => {
      task = () => {
        task = undefined;
        callback();
      };
      return () => {
        task = undefined;
      };
    },
  );
  controller.start();
  controller.change();
  text = "longer";
  controller.change();
  assert.deepEqual(values, [null]);
  assert.equal(task, undefined);
  controller.finish();
  assert.ok(task);
  task();
  assert.deepEqual(values, [null, "longer"]);
  controller.start();
  text = "keyboard";
  controller.change();
  assert.equal(task, undefined);
  controller.finish();
  task!();
  assert.equal(values.at(-1), "keyboard");
  controller.change();
  controller.cancel();
  assert.equal(task, undefined);
  assert.equal(values.at(-1), null);
  controller.change();
  controller.dispose();
  assert.equal(task, undefined);
});

// Execute the actual panel handlers with deterministic hook storage; host views
// are inert. These checks prove dispatch and retained excerpt, not DOM geometry.
for (const platform of ["desktop", "mobile"] as const) {
  test(`${platform} selected Ask waits for Send and never dispatches replacement; stale context retains excerpt`, async () => {
    const React = await import("react");
    const slots: any[] = [];
    let cursor = 0;
    const effects: (() => unknown)[] = [];
    const hooks = {
      ...React,
      useState(initial: any) {
        const at = cursor++;
        if (!(at in slots))
          slots[at] = typeof initial === "function" ? initial() : initial;
        return [
          slots[at],
          (next: any) => {
            slots[at] = typeof next === "function" ? next(slots[at]) : next;
          },
        ];
      },
      useRef(initial: any) {
        const at = cursor++;
        return slots[at] ?? (slots[at] = { current: initial });
      },
      useEffect(callback: () => unknown) {
        effects.push(callback);
      },
    };
    const asks: any[] = [];
    let replacements = 0,
      current = true;
    const session = { token: "account", get: () => "account" };
    const exports: any = {};
    const path =
      platform === "desktop"
        ? "desktop/src/features/documents/collaboration/DocChat.tsx"
        : "mobile/src/features/documents/editor/DocAsk.tsx";
    const source = readFileSync(
      new URL(`../../${path}`, import.meta.url),
      "utf8",
    );
    const empty = () => null;
    const native = {
      ScrollView: empty,
      Text: empty,
      TextInput: empty,
      View: empty,
      StyleSheet: { create: (value: any) => value, hairlineWidth: 1 },
      useWindowDimensions: () => ({ fontScale: 1 }),
    };
    runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.React,
          esModuleInterop: true,
        },
      }).outputText,
      {
        exports,
        React,
        requestAnimationFrame: () => 0,
        require(name: string) {
          if (name === "react") return hooks;
          if (name === "@orbyn/core") return core;
          if (name === "react-native") return native;
          if (name === "../../../lib/api")
            return {
              client: {
                askDoc: async (...args: any[]) => {
                  asks.push(args);
                  return { answer: "answer", sources: [] };
                },
                assistDoc: async () => {
                  replacements++;
                },
              },
            };
          if (name === "../../../lib/session") return { session };
          if (name === "../../../lib/errors")
            return { errorText: (error: any) => error.message };
          if (name === "../../../theme")
            return {
              colors: {},
              fonts: {},
              radii: {},
              spacing: { page: 16 },
              inputFontSize: 16,
              themed: (factory: any) => factory(),
            };
          return new Proxy({}, { get: () => empty });
        },
      },
    );
    const selection = core.docSelectionContext(
      {
        format: "note",
        source: "selected passage",
        start: 0,
        end: 16,
        quote: "selected passage",
      },
      7,
    );
    const props = {
      docId: "page",
      visible: true,
      blocks: [],
      canWrite: true,
      excerpt: { selection, requestId: 1 },
      isSelectionCurrent: () => current,
      onClose() {},
      onNameBlock() {
        return "";
      },
      onSuggested() {},
      onGoToBlock() {},
    };
    const component =
      exports[platform === "desktop" ? "DocChat" : "DocAsk"](props).type;
    const nodes = (node: any): any[] =>
      Array.isArray(node)
        ? node.flatMap(nodes)
        : node?.props
          ? [node, ...nodes(node.props.children)]
          : [];
    const render = () => {
      cursor = 0;
      effects.length = 0;
      return component(props);
    };
    let tree = render();
    for (const effect of [...effects]) effect();
    assert.equal(asks.length, 0, "opening Ask does not send");
    const input = nodes(tree).find((node) =>
      platform === "desktop"
        ? node.type === "textarea"
        : !!node.props.onChangeText,
    );
    assert.ok(input);
    if (platform === "desktop")
      input.props.onChange({ target: { value: "Explain excerpt" } });
    else input.props.onChangeText("Explain excerpt");
    tree = render();
    if (platform === "desktop")
      nodes(tree)
        .find((node) => node.type === "form")
        .props.onSubmit({ preventDefault() {} });
    else
      nodes(tree)
        .find((node) => node.props.accessibilityLabel === "Ask")
        .props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(asks.length, 1);
    assert.equal(asks[0][2].quote, selection.quote);
    assert.equal(replacements, 0);
    current = false;
    tree = render();
    const nextInput = nodes(tree).find((node) =>
      platform === "desktop"
        ? node.type === "textarea"
        : !!node.props.onChangeText,
    );
    if (platform === "desktop")
      nextInput.props.onChange({ target: { value: "Second question" } });
    else nextInput.props.onChangeText("Second question");
    tree = render();
    if (platform === "desktop")
      nodes(tree)
        .find((node) => node.type === "form")
        .props.onSubmit({ preventDefault() {} });
    else
      nodes(tree)
        .find((node) => node.props.accessibilityLabel === "Ask")
        .props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(asks.length, 1, "stale selection is blocked before transport");
    tree = render();
    assert.match(JSON.stringify(tree), /selected passage/);
    assert.match(JSON.stringify(tree), /Second question/);
    assert.match(JSON.stringify(tree), /selection or page changed/);
  });
}

test("DOM excerpt capture supports rendered multi-block text and exact textarea UTF16 without anchors", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(
    "<article><p>First <strong>bold</strong></p><p>second 🌱 line</p></article><textarea></textarea>",
  );
  try {
    const exports: any = {};
    const source = readFileSync(
      new URL(
        "../../desktop/src/features/documents/source/doc-excerpt.ts",
        import.meta.url,
      ),
      "utf8",
    );
    runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText,
      {
        exports,
        document: dom.window.document,
        window: dom.window,
        HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
      },
    );
    const root = dom.window.document.querySelector("article");
    const first = root.querySelector("strong").firstChild,
      last = root.querySelectorAll("p")[1].firstChild;
    const range = dom.window.document.createRange();
    range.setStart(first, 1);
    range.setEnd(last, 8);
    dom.window.getSelection().addRange(range);
    const selected = exports.readDocExcerpt(root, "note");
    assert.ok(selected);
    assert.equal(selected.quote, range.toString());
    assert.equal(
      selected.quote,
      selected.source.slice(selected.start, selected.end),
    );
    assert.equal("blockId" in selected, false);
    dom.window.getSelection().removeAllRanges();
    assert.equal(selected.isCurrent(), true, "blur retains explicit excerpt");
    first.textContent = "changed";
    assert.equal(selected.isCurrent(), false);
    const input = dom.window.document.querySelector("textarea");
    input.value = "raw 🌱 invalid\\tex{";
    input.focus();
    input.setSelectionRange(4, 6);
    const raw = exports.readDocExcerpt(input, "latex");
    assert.equal(raw.quote, "🌱");
    assert.equal(raw.format, "latex");
    input.value += "new";
    assert.equal(raw.isCurrent(), false);
  } finally {
    dom.window.close();
  }
});
