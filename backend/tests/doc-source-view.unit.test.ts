import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as core from "@orbyn/core";

function fixture(
  native: boolean,
  editable = false,
  options: Record<string, unknown> = {},
) {
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const states: unknown[] = [];
  let at = 0,
    refAt = 0;
  const refs: { current: any }[] = [];
  const dialogEffects: { run: () => any; deps: unknown[] | undefined }[] = [];
  const listeners = new Map<string, (event: any) => void>();
  let focused = 0;
  const document = {
    body: { appendChild() {} },
    createElement: () => ({
      remove() {},
      click: () => {
        downloads++;
      },
    }),
    activeElement: {
      isConnected: true,
      closest: () => null,
      focus: () => {
        focused++;
      },
    },
    addEventListener: (name: string, listener: (event: any) => void) =>
      listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const hooks = {
    ...React,
    useEffect: (fn: () => void, deps?: unknown[]) => {
      // Execute the actual source reconciliation effect, excluding the DOM
      // dialog lifecycle. A second render observes its state update.
      if (deps?.length === 2) fn();
      else dialogEffects.push({ run: fn, deps });
    },
    useId: () => "source-title",
    useMemo: (fn: () => unknown) => fn(),
    useRef: (initial: unknown) =>
      refs[refAt++] ?? (refs[refAt - 1] = { current: initial }),
    useState: (initial: unknown) => {
      const index = at++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        (value: unknown) => {
          states[index] =
            typeof value === "function"
              ? (value as (previous: unknown) => unknown)(states[index])
              : value;
        },
      ];
    },
  };
  const container = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children);
  const notes = React.createContext({});
  const navigationContext = React.createContext({});
  const opened: string[] = [];
  let closed = 0,
    downloads = 0;
  let account = "qa";
  const auth = {
    get: () => account,
    get token() {
      return account;
    },
  };
  const modules: Record<string, unknown> = {
    react: hooks,
    "@orbyn/core": core,
    "../../lib/session": { session: auth },
    "../../components/LatexHtmlPreview": { LatexHtmlPreview: container },
    "../../components/Select": { Select: container },
    "../../lib/download": {
      saveFile: async () => {
        downloads++;
      },
    },
    "lucide-react": { X: () => null },
    "./doc-source.css": {},
    "./DocBlocks": {
      BlockView: ({ block }: { block: core.DocBlock }) =>
        React.createElement(
          "span",
          null,
          "text" in block ? block.text : "Divider",
        ),
    },
    "./RichBlocks": { FootnoteContext: notes },
    "./doc-navigation": { DocNavigationContext: navigationContext },
    "./footnotes": { FootnoteContext: notes },
    "react-native": {
      useWindowDimensions: () => ({ width: 390, height: 800, fontScale: 1 }),
      View: container,
      Pressable: container,
      Text: container,
      ScrollView: container,
      TextInput: ({ value }: { value: string }) =>
        React.createElement("pre", null, value),
    },
    "../../components/Sheet": { Sheet: container },
    "../../components/InlineDetails": {
      InlineDetails: ({ title, children }: any) =>
        React.createElement(
          "details",
          null,
          React.createElement("summary", null, title),
          children,
        ),
    },
    "./DocEditorModes": {
      DocEditorModes: ({ value, onChange }: any) =>
        React.createElement(
          "div",
          null,
          ...["note", "markdown", "latex"].map((mode) =>
            React.createElement(
              "button",
              {
                key: mode,
                onClick: () => onChange(mode),
                "aria-pressed": value === mode,
              },
              mode[0].toUpperCase() + mode.slice(1),
            ),
          ),
        ),
    },
    "../../components/Button": {
      Button: ({ title }: { title: string }) =>
        React.createElement("button", null, title),
    },
    "../../styles": { shared: {} },
    "../../theme": {
      colors: { danger: "danger-token", accent: "accent-token" },
      radii: {},
      fonts: {},
      inputFontSize: 16,
    },
    "./DocBody": {
      DocBody: ({ content }: { content: core.DocBlock[] }) =>
        React.createElement("pre", null, core.serializeDoc(content)),
    },
  };
  // Exercise the real shared focus owner with the same hook state and DOM
  // boundary as the source dialog, rather than substituting its behavior.
  const focusExports: Record<string, unknown> = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../../desktop/src/hooks/useModalFocus.ts", import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports: focusExports,
      document,
      HTMLElement: class {},
      require: (name: string) => {
        if (name === "react") return hooks;
        assert.equal(name, "../lib/dialogLayers");
        return { hasHigherDialog: () => false };
      },
    },
  );
  modules["../../hooks/useModalFocus"] = focusExports;
  modules["./DocLatexPreview"] = { useDocLatexPreview: () => null };
  const exports: Record<string, (props: unknown) => React.ReactElement> = {};
  const path = native
    ? "../../mobile/src/screens/docs/DocSourcePreview.tsx"
    : "../../desktop/src/features/docs/DocSourcePreview.tsx";
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      React,
      AbortController,
      Error,
      Date,
      URL: { createObjectURL: () => "blob:fixture-pdf", revokeObjectURL() {} },
      setTimeout: (fn: () => void) => {
        const id = ++nextTimer;
        timers.set(id, fn);
        return id;
      },
      clearTimeout: (id: number) => timers.delete(id),
      getComputedStyle: () => ({ lineHeight: "20px" }),
      document,
      require: (name: string) => {
        assert.ok(name in modules, name);
        return modules[name];
      },
    },
  );
  const exportPdfHandle: { current: (() => Promise<void>) | null } = {
    current: null,
  };
  const edits: core.DocBlock[][] = [];
  const ownedBlocks = new WeakSet<core.DocBlock[]>();
  let currentBlocks: core.DocBlock[];
  const render = (blocks: core.DocBlock[]) => {
    if (!ownedBlocks.has(blocks)) currentBlocks = blocks;
    at = 0;
    refAt = 0;
    return exports.DocSourcePreview({
      blocks,
      docId: "00000000-0000-4000-8000-000000000001",
      onSourceChange: editable
        ? (text: string, expected: core.DocBlock[]) => {
            const next = core.editDocSource(currentBlocks, text, expected);
            ownedBlocks.add(next);
            currentBlocks = next;
            edits.push(next);
            return next;
          }
        : undefined,
      saveStatus: "Unsaved changes",
      exportPdfHandle,
      onAppLink: (url: string) => opened.push(url),
      report: () => {},
      onClose: () => {
        closed++;
      },
      ...options,
    });
  };
  return Object.assign(render, {
    refs,
    timers,
    dialogEffects,
    listeners,
    focused: () => focused,
    states,
    edits,
    opened,
    closed: () => closed,
    downloads: () => downloads,
    requestPdf: () => exportPdfHandle.current?.() ?? Promise.resolve(),
    hasSourceExport: () => !!exportPdfHandle.current,
    setAccount: (next: string) => {
      account = next;
    },
  });
}
function find(
  node: React.ReactNode,
  predicate: (props: Record<string, any>) => boolean,
): Record<string, any> | undefined {
  if (!React.isValidElement(node)) return;
  const props = node.props as Record<string, any>;
  if (predicate(props)) return props;
  for (const child of React.Children.toArray(props.children)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
for (const native of [false, true]) {
  test(`${native ? "native" : "web"} source view follows the live parent blocks and never edits them`, () => {
    const render = fixture(native);
    const blocks = core.parseDoc("# Draft\n^heading\n\nUnsaved words\n^body", {
      anchors: true,
    });
    const before = structuredClone(blocks);
    const tree = render(blocks);
    const input = find(
      tree,
      (props) => props.value === core.serializeDoc(blocks, { anchors: true }),
    )!;
    assert.ok(input);
    assert.equal(
      native ? input.editable : input.readOnly,
      native ? false : true,
    );
    assert.equal(input.onChange, undefined);
    assert.equal(input.onChangeText, undefined);
    assert.match(renderToStaticMarkup(tree), /Unsaved words/);
    assert.deepEqual(blocks, before);
    assert.doesNotMatch(
      renderToStaticMarkup(
        (() => {
          const next = core.parseDoc("Different page");
          render(next);
          return render(next);
        })(),
      ),
      /Unsaved words/,
    );
  });
}
test("native source selection opens the matching preview block", () => {
  const render = fixture(true);
  const blocks = core.parseDoc("# Heading\n^heading\n\nSecond block\n^second", {
    anchors: true,
  });
  const tree = render(blocks);
  const input = find(
    tree,
    (props) => typeof props.onSelectionChange === "function",
  )!;
  input.onSelectionChange({
    nativeEvent: {
      selection: { start: core.docSourceMap(blocks).ranges[1].start },
    },
  });
  find(tree, (props) => props.title === "Show preview")!.onPress();
  const preview = find(render(blocks), (props) => props.content === blocks)!;
  assert.equal(preview.targetBlockId, "second");
  assert.equal(preview.flash, "second");
});

test("web source selection highlights the owning preview block", () => {
  const render = fixture(false);
  const blocks = core.parseDoc("# Heading\n^heading\n\nSecond block\n^second", {
    anchors: true,
  });
  const tree = render(blocks);
  find(tree, (props) => props["aria-label"] === "Markdown source")!.onSelect({
    currentTarget: {
      selectionStart: core.docSourceMap(blocks).ranges[1].start,
    },
  });
  assert.match(
    renderToStaticMarkup(render(blocks)),
    /data-source-index="1" class="is-selected"/,
  );
});

test("web source and preview scrolling follow block geometry without reciprocal loops", () => {
  const render = fixture(false);
  const blocks = core.parseDoc(
    "# Heading\n^heading\n\n```mermaid\nflowchart LR\nA --> B\n```\n^diagram",
    { anchors: true },
  );
  const tree = render(blocks);
  const range = core.docSourceMap(blocks).ranges[1];
  const input = {
    scrollTop:
      (range.startLine - 1 + (range.endLine - range.startLine) / 2) * 20,
  };
  let writes = 0,
    top = 0;
  const nodes = [0, 1].map((index) => ({
    dataset: { sourceIndex: String(index) },
    getBoundingClientRect: () => ({
      top: 100 + index * 200 - top,
      bottom: 100 + index * 200 - top + (index ? 300 : 200),
      height: index ? 300 : 200,
    }),
  }));
  const pane = {
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      writes++;
      top = value;
    },
    getBoundingClientRect: () => ({ top: 100 }),
    querySelector: () => nodes[1],
    querySelectorAll: () => nodes,
  };
  find(
    tree,
    (props) => props["aria-label"] === "Markdown source",
  )!.ref.current = input;
  find(
    tree,
    (props) => props["aria-label"] === "Rendered preview",
  )!.ref.current = pane;
  const sourceScroll = find(
    tree,
    (props) => props["aria-label"] === "Markdown source",
  )!.onScroll;
  const previewScroll = find(
    tree,
    (props) => props["aria-label"] === "Rendered preview",
  )!.onScroll;
  sourceScroll();
  assert.equal(top, 350);
  previewScroll(); // The programmatic scroll event must not move the source back.
  assert.equal(writes, 1);
  assert.equal(
    input.scrollTop,
    (range.startLine - 1 + (range.endLine - range.startLine) / 2) * 20,
  );
  top = 200; // A real user scrolls to the start of the second rendered block.
  previewScroll();
  assert.equal(input.scrollTop, (range.startLine - 1) * 20);
  sourceScroll();
  assert.equal(writes, 1);
});

test("native preview scrolling preserves the corresponding source block on toggle", () => {
  const render = fixture(true);
  const blocks = core.parseDoc("# Heading\n^heading\n\nSecond block\n^second", {
    anchors: true,
  });
  const first = render(blocks);
  find(first, (props) => props.title === "Show preview")!.onPress();
  const preview = render(blocks);
  const body = find(preview, (props) => props.content === blocks)!;
  body.onLineLayout(0, 0);
  body.onLineLayout(1, 180);
  find(preview, (props) => props.scrollEventThrottle === 32)!.onScroll({
    nativeEvent: { contentOffset: { y: 200 } },
  });
  assert.equal(
    find(render(blocks), (props) => props.content === blocks)!.targetBlockId,
    "second",
    "scroll picks the second block",
  );
  find(render(blocks), (props) => props.title === "Show source")!.onPress();
  const source = find(
    render(blocks),
    (props) => props.accessibilityLabel === "Markdown source",
  )!;
  assert.equal(
    source.selection.start,
    core.docSourceMap(blocks).ranges[1].start,
  );
});

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} preview owns heading navigation and closes before routing another page`, () => {
    const render = fixture(native);
    const blocks = core.parseDoc("# First\n^first\n\n## Next section\n^next", {
      anchors: true,
    });
    let tree = render(blocks);
    if (native) {
      find(tree, (props) => props.title === "Show preview")!.onPress();
      tree = render(blocks);
    }
    const navigation = find(tree, (props) => props.value?.onFragment)?.value;
    assert.ok(navigation);
    navigation.onFragment("next-section");
    if (native)
      assert.equal(
        find(render(blocks), (props) => props.content === blocks)!
          .targetBlockId,
        "next",
      );
    else
      assert.match(
        renderToStaticMarkup(render(blocks)),
        /data-source-index="1" class="is-selected"/,
      );
    assert.equal(render.closed(), 0);
    navigation.onAppLink(
      "orbyn://doc/00000000-0000-4000-8000-000000000001#next",
    );
    assert.equal(render.closed(), 0);
    navigation.onFragment("missing-heading");
    if (native)
      assert.equal(
        find(render(blocks), (props) => props.content === blocks)!
          .targetBlockId,
        "next",
      );
    else
      assert.match(
        renderToStaticMarkup(render(blocks)),
        /data-source-index="1" class="is-selected"/,
      );
    navigation.onAppLink("orbyn://doc/00000000-0000-4000-8000-000000000002");
    assert.equal(render.closed(), 1);
    assert.deepEqual(render.opened, [
      "orbyn://doc/00000000-0000-4000-8000-000000000002",
    ]);
  });
}

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} source edits use the owning callback and retain exact typing`, () => {
    const render = fixture(native, true);
    const blocks = core.parseDoc("# Before ^heading");
    const tree = render(blocks);
    const input = find(
      tree,
      (props) =>
        props["aria-label"] === "Markdown source" ||
        props.accessibilityLabel === "Markdown source",
    )!;
    assert.equal(native ? input.editable : input.readOnly, native);
    const typed = "# After ^heading\n\n\nNew words  ";
    if (native) input.onChangeText(typed);
    else input.onChange({ currentTarget: { value: typed } });
    assert.equal(render.edits.length, 1);
    const after = render(render.edits[0]);
    const nextInput = find(
      after,
      (props) =>
        props["aria-label"] === "Markdown source" ||
        props.accessibilityLabel === "Markdown source",
    )!;
    assert.equal(
      nextInput.value,
      typed,
      "own parsed echo must not normalize the typed buffer",
    );
    assert.match(renderToStaticMarkup(after), /Unsaved changes/);
  });
  test(`${native ? "native" : "web"} invalid anchors remain visible and cannot silently close`, () => {
    const render = fixture(native, true);
    const blocks = core.parseDoc("Safe ^one", { anchors: true });
    const tree = render(blocks);
    const input = find(
      tree,
      (props) =>
        props["aria-label"] === "Markdown source" ||
        props.accessibilityLabel === "Markdown source",
    )!;
    const typed = "First ^one\n\nSecond ^one";
    if (native) input.onChangeText(typed);
    else input.onChange({ currentTarget: { value: typed } });
    assert.equal(render.edits.length, 0);
    const after = render(blocks);
    assert.ok(
      find(
        after,
        (props) =>
          props.role === "alert" || props.accessibilityRole === "alert",
      ),
      "invalid source must expose an actionable validation error",
    );
    if (native)
      find(after, (props) => props.title === "Source and preview")!.onClose();
    else
      find(
        after,
        (props) => props["aria-label"] === "Close source preview",
      )!.onClick();
    assert.equal(render.closed(), 0);
    const restore = find(
      after,
      (props) =>
        props.accessibilityLabel === "Restore current document" ||
        props["aria-label"] === "Restore current document" ||
        props.title === "Restore current document" ||
        React.Children.toArray(props.children).includes(
          "Restore current document",
        ),
    )!;
    (native ? restore.onPress : restore.onClick)();
    const restored = render(blocks);
    assert.doesNotMatch(
      renderToStaticMarkup(restored),
      /This edit has not been saved/,
    );
  });
}

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} delayed own echoes never rewind a newer source input`, () => {
    const render = fixture(native, true);
    const initial = core.parseDoc("# Before ^heading", { anchors: true });
    const tree = render(initial);
    const input = find(
      tree,
      (props) =>
        props["aria-label"] === "Markdown source" ||
        props.accessibilityLabel === "Markdown source",
    )!;
    const type = (value: string) =>
      native
        ? input.onChangeText(value)
        : input.onChange({ currentTarget: { value } });
    type("# First edit ^heading");
    type("# Latest edit ^heading\n\n\nMore words");
    const olderEcho = render(render.edits[0]);
    const olderInput = find(
      olderEcho,
      (props) =>
        props["aria-label"] === "Markdown source" ||
        props.accessibilityLabel === "Markdown source",
    )!;
    assert.equal(olderInput.value, "# Latest edit ^heading\n\n\nMore words");
    const latestEcho = render(render.edits[1]);
    const latestInput = find(
      latestEcho,
      (props) =>
        props["aria-label"] === "Markdown source" ||
        props.accessibilityLabel === "Markdown source",
    )!;
    assert.equal(latestInput.value, "# Latest edit ^heading\n\n\nMore words");
    const external = core.parseDoc("# Remote edit ^heading", { anchors: true });
    render(external);
    const reconciled = render(external);
    assert.equal(
      find(
        reconciled,
        (props) =>
          props["aria-label"] === "Markdown source" ||
          props.accessibilityLabel === "Markdown source",
      )!.value,
      core.docSourceMap(external).source,
    );
  });
}

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} external changes during invalid source require explicit restoration`, () => {
    const render = fixture(native, true);
    const initial = core.parseDoc("Before ^line", { anchors: true });
    const input = find(
      render(initial),
      (props) =>
        props["aria-label"] === "Markdown source" ||
        props.accessibilityLabel === "Markdown source",
    )!;
    const invalid = "First ^line\n\nSecond ^line";
    if (native) input.onChangeText(invalid);
    else input.onChange({ currentTarget: { value: invalid } });
    const remote = core.parseDoc("Remote words ^line", { anchors: true });
    render(remote);
    const conflict = render(remote);
    assert.match(
      renderToStaticMarkup(conflict),
      /Document changed\. Restore to continue/,
    );
    const conflictInput = find(
      conflict,
      (props) =>
        props["aria-label"] === "Markdown source" ||
        props.accessibilityLabel === "Markdown source",
    )!;
    assert.equal(conflictInput.value, invalid);
    if (native) conflictInput.onChangeText("Unsafe overwrite ^line");
    else
      conflictInput.onChange({
        currentTarget: { value: "Unsafe overwrite ^line" },
      });
    assert.equal(render.edits.length, 0);
    const restore = find(
      conflict,
      (props) =>
        props.accessibilityLabel === "Restore current document" ||
        props["aria-label"] === "Restore current document" ||
        props.title === "Restore current document" ||
        React.Children.toArray(props.children).includes(
          "Restore current document",
        ),
    )!;
    (native ? restore.onPress : restore.onClick)();
    const restored = render(remote);
    assert.equal(
      find(
        restored,
        (props) =>
          props["aria-label"] === "Markdown source" ||
          props.accessibilityLabel === "Markdown source",
      )!.value,
      core.docSourceMap(remote).source,
    );
  });
}

test("native source controls are bounded by the available sheet height", () => {
  const render = fixture(true, true);
  const blocks = core.parseDoc("Words ^body", { anchors: true });
  const tree = render(blocks);
  const area = find(
    tree,
    (props) => props.style?.padding === 0 && !!props.onLayout,
  );
  assert.ok(area);
  area.onLayout({ nativeEvent: { layout: { height: 300 } } });
  const compact = render(blocks);
  const controls = find(
    compact,
    (props) => props.keyboardShouldPersistTaps === "handled",
  );
  assert.ok(controls);
  assert.equal(controls.style.maxHeight, (300 - 44) * 0.45);
  assert.equal(controls.style.flexShrink, 1);
  assert.equal(
    find(compact, (props) => props.accessibilityLabel === "Markdown source")
      ?.style.flex,
    1,
  );
  area.onLayout({ nativeEvent: { layout: { height: 600 } } });
  assert.equal(
    find(
      render(blocks),
      (props) => props.keyboardShouldPersistTaps === "handled",
    )?.style.maxHeight,
    (600 - 44) * 0.45,
  );
});

test("native invalid-source recovery is first in the bounded controls", () => {
  const render = fixture(true, true);
  const blocks = core.parseDoc("One ^one", { anchors: true });
  const initial = render(blocks);
  const input = find(
    initial,
    (props) => props.accessibilityLabel === "Markdown source",
  );
  assert.ok(input);
  input.onChangeText("One ^one\n\nDuplicate ^one");
  const controls = find(
    render(blocks),
    (props) => props.keyboardShouldPersistTaps === "handled",
  );
  assert.ok(controls);
  const first = React.Children.toArray(
    controls.children,
  )[0] as React.ReactElement;
  assert.ok(
    find(first, (p) => p.accessibilityLabel === "Restore current document"),
  );
  assert.ok(find(first, (p) => p.accessibilityRole === "alert"));
});

test("web source errors keep the dialog mounted and Escape observes the latest validation state", () => {
  const render = fixture(false, true);
  const blocks = core.parseDoc("Safe ^one", { anchors: true });
  const first = render(blocks);
  const lifecycle = render.dialogEffects.find((effect) =>
    effect.run.toString().includes("showModal"),
  )!;
  const focusLifecycle = render.dialogEffects.find(
    (effect) => effect.deps?.[0] === "source-title",
  )!;
  assert.deepEqual(Array.from(lifecycle.deps ?? []), []);
  let opened = 0,
    closed = 0;
  const modal = {
    showModal: () => {
      opened++;
    },
    close: () => {
      closed++;
    },
  };
  const root = find(first, (props) => props.className === "doc-source-dialog")!;
  root.ref({
    ...modal,
    contains: () => false,
    querySelectorAll: () => [],
    focus: () => {},
  });
  const cleanupFocus = focusLifecycle.run();
  const cleanup = lifecycle.run();
  const input = find(
    first,
    (props) => props["aria-label"] === "Markdown source",
  )!;
  input.onChange({ currentTarget: { value: "First ^one\n\nSecond ^one" } });
  render(blocks);
  const afterError = render.dialogEffects.at(-1)!;
  assert.deepEqual(
    Array.from(afterError.deps ?? []),
    [],
    "parser errors must not restart modal lifetime",
  );
  const escape = () =>
    render.listeners.get("keydown")!({
      key: "Escape",
      preventDefault() {},
      stopImmediatePropagation() {},
    });
  escape();
  assert.equal(
    render.closed(),
    0,
    "invalid source must still prevent dismissal",
  );
  assert.equal(opened, 1);
  assert.equal(closed, 0);
  assert.equal(
    render.focused(),
    0,
    "validation must not focus the page behind the dialog",
  );
  const invalid = render(blocks);
  find(
    invalid,
    (props) => props["aria-label"] === "Restore current document",
  )!.onClick();
  render(blocks);
  escape();
  assert.equal(
    render.closed(),
    1,
    "Escape can close after explicit restoration",
  );
  root.ref(null);
  cleanup();
  cleanupFocus();
  assert.equal(
    closed,
    1,
    "cleanup closes the captured dialog even after its React ref is cleared",
  );
  assert.equal(render.focused(), 1);
  assert.equal(render.listeners.has("keydown"), false);
});

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} stale source events cannot overwrite a newer remote revision`, () => {
    const render = fixture(native, true);
    const original = core.parseDoc("Original ^line", { anchors: true });
    const tree = render(original);
    const input = find(
      tree,
      (props) =>
        props["aria-label"] === "Markdown source" ||
        props.accessibilityLabel === "Markdown source",
    )!;
    const external = core.parseDoc("Remote revision ^line", { anchors: true });
    render(external);
    const text = "Late typing on original ^line";
    if (native) input.onChangeText(text);
    else input.onChange({ currentTarget: { value: text } });
    assert.equal(
      render.edits.length,
      0,
      "the retained input belongs to the older revision",
    );
    const rejected = render(external);
    assert.ok(
      find(
        rejected,
        (props) =>
          props.role === "alert" || props.accessibilityRole === "alert",
      ),
      "stale source must expose a recoverable error",
    );
    assert.equal(
      find(
        rejected,
        (props) =>
          props["aria-label"] === "Markdown source" ||
          props.accessibilityLabel === "Markdown source",
      )!.value,
      text,
      "the rejected typing remains available for recovery",
    );
  });
}

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} opens embedded LaTeX inline with no automatic PDF request and explicit export`, async () => {
    const calls: string[] = [];
    const render = fixture(native, true, {
      inline: true,
      initialMode: "latex",
      initialSourceNumber: 0,
      compileReady: true,
      onCompileLatex: async (source: string) => {
        calls.push(source);
        return new Blob(["PDF"]);
      },
    });
    const blocks = core.withDocLatexSource([], "Saved source");
    const tree = render(blocks);
    const field = find(
      tree,
      (p) =>
        p["aria-label"] === "LaTeX source" ||
        p.accessibilityLabel === "LaTeX source",
    );
    assert.equal(field?.value, "Saved source");
    assert.equal(calls.length, 0);
    assert.equal(
      render.dialogEffects.some(
        (e) => e.deps?.length === 7 && e.deps[0] === "latex",
      ),
      false,
    );
    assert.equal(
      find(tree, (p) =>
        native ? p.title === "Export PDF" : p.children === "Export PDF",
      ),
      undefined,
    );
    assert.equal(render.hasSourceExport(), true);
    await render.requestPdf();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ["Saved source"]);
    assert.equal(render.downloads(), 1);
  });
  test(`${native ? "native" : "web"} explicit export obeys readiness and cancels pending work on departure`, async () => {
    let signal: AbortSignal | undefined, finish!: (blob: Blob) => void;
    const compile = (_: string, requestSignal: AbortSignal) => {
      signal = requestSignal;
      return new Promise<Blob>((resolve) => {
        finish = resolve;
      });
    };
    const blocks = core.withDocLatexSource([], "Draft source");
    const unsaved = fixture(native, true, {
      inline: true,
      initialMode: "latex",
      compileReady: false,
      onCompileLatex: compile,
      initialSourceNumber: 0,
    });
    unsaved(blocks);
    await unsaved.requestPdf();
    assert.equal(signal, undefined);
    const saved = fixture(native, true, {
      inline: true,
      initialMode: "latex",
      compileReady: true,
      onCompileLatex: compile,
      initialSourceNumber: 0,
    });
    const tree = saved(blocks);
    const cleanup = saved.dialogEffects
      .find(
        (e) =>
          e.deps?.length === 0 && e.run.toString().includes("compile.current"),
      )!
      .run();
    const pending = saved.requestPdf();
    assert.ok(signal && !signal.aborted);
    cleanup();
    assert.equal(signal!.aborted, true);
    finish(new Blob(["stale PDF"]));
    await pending;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(saved.downloads(), 0);
  });
}

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} inline navigation allows valid source and blocks an unapplied source error`, () => {
    const leaveCheck: { current: (() => boolean) | null } = { current: null };
    const render = fixture(native, true, { inline: true, leaveCheck });
    const blocks = core.parseDoc("One ^one\n\nTwo ^two", { anchors: true });
    const tree = render(blocks);
    const owner = render.dialogEffects.find(
      (effect) => effect.deps?.[0] === leaveCheck,
    )!;
    const cleanup = owner.run();
    assert.equal(leaveCheck.current?.(), true);
    const input = find(
      tree,
      (props) =>
        props["aria-label"] === "Markdown source" ||
        props.accessibilityLabel === "Markdown source",
    )!;
    const invalid = "First ^one\n\nSecond ^one";
    if (native) input.onChangeText(invalid);
    else input.onChange({ currentTarget: { value: invalid } });
    render(blocks);
    assert.equal(leaveCheck.current?.(), false);
    cleanup?.();
    assert.equal(leaveCheck.current, null);
  });
}

for (const native of [false, true])
  test(`${native ? "mobile" : "web"} source-only presentation leaves HTML rendering to its stable parent`, () => {
    const render = fixture(native, true, {
      inline: true,
      sourceOnly: true,
      initialMode: "latex",
    });
    const tree = render(core.withDocLatexSource([], "Saved LaTeX"));
    assert.ok(
      find(
        tree,
        (p) =>
          p["aria-label"] === "LaTeX source" ||
          p.accessibilityLabel === "LaTeX source",
      ),
    );
    assert.equal(
      find(
        tree,
        (p) =>
          p.title === "Compiled LaTeX PDF" ||
          p["aria-label"] === "Rendered preview",
      ),
      undefined,
    );
    const markdown = fixture(native, true, {
      inline: true,
      sourceOnly: true,
      initialMode: "markdown",
    })([{ type: "paragraph", text: "Mixed note", id: "p" }]);
    assert.equal(
      find(markdown, (p) => p["aria-label"] === "Rendered preview"),
      undefined,
    );
  });

for (const native of [false, true])
  test(`${native ? "Expo" : "web"} whole-document source accepts owner edits, retains invalid draft and reconciles external changes`, () => {
    let blocks: core.DocBlock[] = [
      { type: "heading", text: "Plan", level: 1, id: "heading" },
      { type: "paragraph", text: "Before", id: "line" },
      {
        type: "code",
        lang: "latex-document",
        text: "Embedded",
        id: "embedded",
      },
    ];
    const leaveCheck: { current: (() => boolean) | null } = { current: null };
    const render = fixture(native, true, {
      inline: true,
      sourceOnly: true,
      initialMode: "latex",
      leaveCheck,
      onLatexChange: (
        text: string,
        expected: core.DocBlock[],
        ordinal: number,
      ) => {
        assert.equal(ordinal, -1);
        assert.deepEqual(expected, blocks);
        blocks = core.editDocWholeLatex(blocks, text);
        return blocks;
      },
    });
    const field = (tree: React.ReactNode) =>
      find(
        tree,
        (p) =>
          p["aria-label"] === "LaTeX source" ||
          p.accessibilityLabel === "LaTeX source",
      )!;
    const input = (tree: React.ReactNode, value: string) => {
      const p = field(tree);
      if (native) p.onChangeText(value);
      else p.onChange({ currentTarget: { value } });
    };
    let tree = render(blocks);
    assert.equal(field(tree).value, core.docWholeLatex(blocks));
    assert.match(field(tree).value, /Before/);
    assert.notEqual(field(tree).value, "Embedded");
    render.dialogEffects.find((e) => e.deps?.[0] === leaveCheck)!.run();
    input(tree, field(tree).value.replace("Before", "After"));
    tree = render(blocks);
    assert.equal(blocks[1].text, "After");
    assert.equal(blocks.length, 3);
    assert.equal(blocks[2].text, "Embedded");
    assert.equal(leaveCheck.current?.(), true);
    const invalid = field(tree).value.replace(
      "After",
      String.raw`\unknown{Draft}`,
    );
    input(tree, invalid);
    tree = render(blocks);
    assert.equal(field(tree).value, invalid);
    assert.equal(blocks[1].text, "After");
    assert.equal(leaveCheck.current?.(), false);
    blocks = blocks.map((b) =>
      b.id === "line" ? { ...b, text: "Remote" } : b,
    );
    render(blocks);
    tree = render(blocks);
    assert.equal(field(tree).value, invalid);
    assert.match(renderToStaticMarkup(tree), /Restore to continue/);
    input(tree, invalid.replace(String.raw`\unknown{Draft}`, "Repaired"));
    assert.equal(blocks[1].text, "Remote");
  });

for (const native of [false, true])
  test(`${native ? "Expo" : "web"} whole-document source has no duplicate export, assistant or Help controls`, () => {
    const render = fixture(native, true, {
      inline: true,
      initialMode: "latex",
    });
    const tree = render([{ type: "paragraph", text: "**Rich**", id: "rich" }]);
    assert.equal(render.hasSourceExport(), false);
    assert.equal(
      find(
        tree,
        (p) =>
          p.children === "Export PDF" ||
          p.title === "Export PDF" ||
          p.title === "Ask assistant" ||
          p.children === "Ask assistant",
      ),
      undefined,
    );
    assert.equal(
      find(
        tree,
        (p) => p.className === "document-preview-help" || p.title === "Help",
      ),
      undefined,
    );
    const html = renderToStaticMarkup(tree);
    assert.doesNotMatch(
      html,
      /<summary>Help|About web preview|Export this document from Note|Edit existing text and equations/,
    );
  });

for (const native of [false, true])
  test(`${native ? "Expo" : "web"} routed embedded download reads live save readiness and cancels account-changed output`, async () => {
    let ready = false,
      calls = 0,
      finish!: (blob: Blob) => void;
    const render = fixture(native, true, {
      inline: true,
      initialMode: "latex",
      initialSourceNumber: 0,
      compileReady: () => ready,
      onCompileLatex: () => {
        calls++;
        return new Promise<Blob>((resolve) => {
          finish = resolve;
        });
      },
    });
    const blocks = core.withDocLatexSource([], "Saved embedded source");
    render(blocks);
    await render.requestPdf();
    assert.equal(calls, 0);
    ready = true;
    const pending = render.requestPdf();
    assert.equal(calls, 1);
    render.setAccount("different-account");
    finish(new Blob(["private PDF"]));
    await pending;
    assert.equal(render.downloads(), 0);
    await render.requestPdf();
    assert.equal(calls, 1);
  });

for (const native of [false, true])
  test(`${native ? "Expo" : "web"} compact preview reveals source and selects exact conversion error without rewriting the draft`, () => {
    let blocks: core.DocBlock[] = [
      { type: "paragraph", text: "Before", id: "line" },
    ];
    const render = fixture(native, true, {
      inline: true,
      initialMode: "latex",
      showModes: false,
      onLatexChange: (text: string) => {
        blocks = core.editDocWholeLatex(blocks, text);
        return blocks;
      },
    });
    const field = (tree: React.ReactNode) =>
      find(
        tree,
        (p) =>
          p["aria-label"] === "LaTeX source" ||
          p.accessibilityLabel === "LaTeX source",
      )!;
    const original = core.docWholeLatex(blocks),
      draft = original.replace(
        "Before",
        "Emoji 😀 \\& first\nNext \\unknown{draft}",
      );
    let tree = render(blocks);
    let input = field(tree);
    assert.ok(input.ref, "the actual source input owns diagnostic selection");
    let focused = 0,
      selection: { start: number; end: number } | undefined;
    const element = {
      clientHeight: 200,
      scrollTop: 0,
      focus: () => {
        focused++;
      },
      setSelectionRange: (start: number, end: number) => {
        selection = { start, end };
      },
      setNativeProps: (props: any) => {
        selection = props.selection;
      },
    };
    input.ref.current = element;
    if (native) input.onChangeText(draft);
    else input.onChange({ currentTarget: { value: draft } });
    tree = render(blocks);
    const preview = find(tree, (p) =>
      native ? p.title === "Show preview" : p.children === "Hide source",
    )!;
    assert.ok(preview);
    (native ? preview.onPress : preview.onClick)();
    tree = render(blocks);
    const jump = find(tree, (p) =>
      (p["aria-label"] ?? p.accessibilityLabel ?? "").startsWith(
        "Conversion error. Line",
      ),
    )!;
    assert.ok(jump);
    assert.match(renderToStaticMarkup(tree), /Unsupported command/);
    assert.doesNotMatch(
      renderToStaticMarkup(tree),
      /cannot be converted without losing|Your draft is retained/,
    );
    (native ? jump.onPress : jump.onClick)();
    tree = render(blocks);
    for (const run of render.timers.values()) run();
    render.timers.clear();
    tree = render(blocks);
    const start = draft.indexOf("\\unknown"),
      end = start + "\\unknown".length;
    assert.deepEqual(JSON.parse(JSON.stringify(selection)), { start, end });
    assert.equal(focused, 1);
    assert.equal(field(tree).value, draft);
    assert.equal(blocks[0].text, "Before");
    if (native) {
      assert.deepEqual(JSON.parse(JSON.stringify(field(tree).selection)), {
        start,
        end,
      });
      assert.ok(
        find(
          tree,
          (p) =>
            Array.isArray(p.style) &&
            p.style.some((style: any) => style?.color === "danger-token"),
        ),
      );
    } else {
      assert.equal(field(tree).wrap, "off");
      let marker = find(tree, (p) => p.className === "doc-source-line-marker")!;
      assert.ok(marker);
      const top = marker.style.top;
      element.scrollTop += 20;
      field(tree).onScroll();
      tree = render(blocks);
      marker = find(tree, (p) => p.className === "doc-source-line-marker")!;
      assert.equal(marker.style.top, top - 20);
    }
    const oldJump = jump;
    const repaired = draft.replace("\\unknown{draft}", "Repaired");
    input = field(tree);
    if (native) input.onChangeText(repaired);
    else input.onChange({ currentTarget: { value: repaired } });
    tree = render(blocks);
    assert.equal(
      find(tree, (p) =>
        (p["aria-label"] ?? p.accessibilityLabel ?? "").startsWith(
          "Conversion error. Line",
        ),
      ),
      undefined,
    );
    (native ? oldJump.onPress : oldJump.onClick)();
    for (const run of render.timers.values()) run();
    assert.equal(focused, 1, "a stale range cannot select repaired source");
  });
for (const native of [false, true])
  test(`${native ? "Expo" : "web"} compiler positions are actionable only when explicitly supplied`, async () => {
    const render = fixture(native, true, {
      inline: true,
      initialMode: "latex",
      initialSourceNumber: 0,
      onCompileLatex: async () => {
        throw Object.assign(new Error("Unknown command"), {
          line: 2,
          column: 3,
        });
      },
    });
    const text = "first\nsecond\nthird",
      blocks = core.withDocLatexSource([], text);
    render(blocks);
    await render.requestPdf();
    const tree = render(blocks);
    assert.ok(
      find(tree, (p) =>
        (p["aria-label"] ?? p.accessibilityLabel ?? "").startsWith(
          "Compiler error. Line 2, column 3",
        ),
      ),
    );
  });

for (const native of [false, true])
  test(`${native ? "Expo" : "web"} compiler errors without explicit positions stay unlocated and late errors cannot mark a new owner`, async () => {
    let reject!: (error: Error) => void;
    const render = fixture(native, true, {
      inline: true,
      initialMode: "latex",
      initialSourceNumber: 0,
      onCompileLatex: () =>
        new Promise<Blob>((_, fail) => {
          reject = fail;
        }),
    });
    const blocks = core.withDocLatexSource([], "first\nsecond\nthird");
    render(blocks);
    let pending = render.requestPdf();
    reject(new Error("Bad command at line 2"));
    await pending;
    let tree = render(blocks);
    assert.equal(
      find(tree, (p) =>
        (p["aria-label"] ?? p.accessibilityLabel ?? "").startsWith(
          "Compiler error. Line",
        ),
      ),
      undefined,
    );
    assert.match(
      renderToStaticMarkup(tree),
      /Bad command at line 2|Couldn’t export/,
    );
    pending = render.requestPdf();
    const remote = core.withDocLatexSource(blocks, "different\nowner");
    render(remote);
    render(remote);
    reject(
      Object.assign(new Error("Stale compiler error"), { line: 2, column: 1 }),
    );
    await pending;
    tree = render(remote);
    assert.doesNotMatch(renderToStaticMarkup(tree), /Stale compiler error/);
  });

for (const native of [false, true])
  test(`${native ? "Expo" : "web"} Markdown source does not duplicate the parent assistant action`, () => {
    let called = 0;
    const render = fixture(native, true, {
      initialMode: "markdown",
      onAssist: () => {
        called++;
      },
    });
    const tree = render([
      { type: "paragraph", text: "Selectable words", id: "line" },
    ]);
    assert.equal(
      find(
        tree,
        (p) => p.title === "Ask assistant" || p.children === "Ask assistant",
      ),
      undefined,
    );
    assert.equal(called, 0);
    assert.doesNotMatch(renderToStaticMarkup(tree), /Ask assistant/);
  });

function flushSourceTimers(render: ReturnType<typeof fixture>) {
  const tasks = [...render.timers.values()];
  render.timers.clear();
  for (const task of tasks) task();
}
function selectedSourceField(
  tree: React.ReactNode,
  native: boolean,
  format: "markdown" | "latex",
) {
  const label = format === "latex" ? "LaTeX source" : "Markdown source";
  return find(
    tree,
    (p) => (native ? p.accessibilityLabel : p["aria-label"]) === label,
  )!;
}
function setUserRange(
  field: Record<string, any>,
  native: boolean,
  start: number,
  end: number,
) {
  if (native)
    field.onSelectionChange({ nativeEvent: { selection: { start, end } } });
  else
    field.onSelect({
      currentTarget: {
        value: field.value,
        selectionStart: start,
        selectionEnd: end,
        clientHeight: 240,
        scrollTop: 0,
      },
    });
}
function sourceToolbar(tree: React.ReactNode, native: boolean) {
  return find(
    tree,
    (p) =>
      (native ? p.accessibilityLabel : p["aria-label"]) ===
      "Selected source actions",
  );
}
for (const native of [false, true])
  for (const format of ["markdown", "latex"] as const)
    test(`${native ? "Expo" : "web"} ${format} source gesture retains exact local excerpt for the sole header action without popup`, () => {
      const selectionHandle: { current: (() => any) | null } = {
        current: null,
      };
      const render = fixture(native, true, {
        inline: true,
        sourceOnly: true,
        initialMode: format,
        selectionHandle,
      });
      const blocks: core.DocBlock[] = [
        { type: "paragraph", text: "Alpha 😀 beta", id: "line" },
        { type: "paragraph", text: "Tail", id: "tail" },
      ];
      let tree = render(blocks),
        field = selectedSourceField(tree, native, format);
      const raw = field.value,
        start = raw.indexOf("😀"),
        end = raw.indexOf("beta") + 4;
      assert.equal(sourceToolbar(tree, native), undefined);
      (native ? field.onTouchStart : field.onPointerDown)();
      setUserRange(field, native, start, start + 2);
      tree = render(blocks);
      assert.equal(sourceToolbar(tree, native), undefined);
      assert.equal(render.timers.size, 0);
      setUserRange(field, native, start, end);
      tree = render(blocks);
      assert.equal(sourceToolbar(tree, native), undefined);
      assert.equal(render.timers.size, 0, "drag updates stay in refs");
      assert.equal(selectionHandle.current!(), null);
      (native ? field.onTouchEnd : field.onPointerUp)();
      tree = render(blocks);
      assert.equal(sourceToolbar(tree, native), undefined);
      flushSourceTimers(render);
      tree = render(blocks);
      assert.equal(sourceToolbar(tree, native), undefined);
      const selected = selectionHandle.current!();
      assert.equal(selected.quote, "😀 beta");
      assert.equal(selected.source, raw);
      assert.equal(selected.format, format);
      assert.equal(selected.start, start);
      assert.equal(selected.end, end);
      assert.equal(selected.isCurrent(), true);
      field = selectedSourceField(tree, native, format);
      field.onBlur?.({ relatedTarget: null });
      setUserRange(field, native, 0, 0);
      assert.equal(selectionHandle.current!().quote, selected.quote);
      const changed = raw.replace("beta", "changed");
      field = selectedSourceField(render(blocks), native, format);
      if (native) field.onChangeText(changed);
      else field.onChange({ currentTarget: { value: changed } });
      assert.equal(
        selected.isCurrent(),
        false,
        "local validator rejects a changed raw draft immediately",
      );
    });
for (const native of [false, true])
  test(`${native ? "Expo" : "web"} source selection debounces OS changes and cancels stale gestures without whole-block fallback`, () => {
    const selectionHandle: { current: (() => any) | null } = { current: null };
    const render = fixture(native, true, {
        inline: true,
        sourceOnly: true,
        initialMode: "markdown",
        selectionHandle,
      }),
      blocks: core.DocBlock[] = [
        { type: "paragraph", text: "One two three", id: "line" },
      ];
    let tree = render(blocks),
      field = selectedSourceField(tree, native, "markdown");
    setUserRange(field, native, 0, 3);
    const superseded = [...render.timers.values()];
    setUserRange(field, native, 4, 7);
    for (const task of superseded) task();
    tree = render(blocks);
    assert.equal(sourceToolbar(tree, native), undefined);
    flushSourceTimers(render);
    tree = render(blocks);
    assert.equal(sourceToolbar(tree, native), undefined);
    const stale = selectionHandle.current!();
    assert.equal(stale.quote, "two");
    (native
      ? selectedSourceField(tree, native, "markdown").onScroll
      : selectedSourceField(tree, native, "markdown").onScroll)();
    tree = render(blocks);
    assert.equal(sourceToolbar(tree, native), undefined);
    field = selectedSourceField(tree, native, "markdown");
    (native ? field.onTouchStart : field.onPointerDown)();
    setUserRange(field, native, 0, 7);
    (native ? field.onTouchCancel : field.onPointerCancel)();
    flushSourceTimers(render);
    tree = render(blocks);
    assert.equal(sourceToolbar(tree, native), undefined);
    setUserRange(field, native, 0, 0);
    flushSourceTimers(render);
    assert.equal(sourceToolbar(render(blocks), native), undefined);
    render.setAccount("other");
    render(blocks);
    assert.equal(stale.isCurrent(), false);
    assert.equal(selectionHandle.current!(), null);
  });
for (const native of [false, true])
  test(`${native ? "Expo" : "web"} diagnostic selection never opens source Ask controls`, () => {
    const selectionHandle: { current: (() => any) | null } = { current: null };
    const render = fixture(native, true, {
        inline: true,
        sourceOnly: true,
        initialMode: "latex",
        selectionHandle,
        onLatexChange: (text: string, blocks: core.DocBlock[]) =>
          core.editDocWholeLatex(blocks, text),
      }),
      blocks: core.DocBlock[] = [
        { type: "paragraph", text: "Safe", id: "line" },
      ];
    let tree = render(blocks),
      field = selectedSourceField(tree, native, "latex");
    const draft = field.value.replace("Safe", "\\unknown{draft}");
    const ref = field.ref;
    ref.current = {
      clientHeight: 240,
      scrollTop: 0,
      focus() {},
      setSelectionRange() {},
      setNativeProps() {},
    };
    if (native) field.onChangeText(draft);
    else field.onChange({ currentTarget: { value: draft } });
    tree = render(blocks);
    const jump = find(tree, (p) =>
      (p["aria-label"] ?? p.accessibilityLabel ?? "").startsWith(
        "Conversion error. Line",
      ),
    )!;
    (native ? jump.onPress : jump.onClick)();
    tree = render(blocks);
    field = selectedSourceField(tree, native, "latex");
    const start = draft.indexOf("\\unknown"),
      end = start + "\\unknown".length;
    setUserRange(field, native, start, end);
    flushSourceTimers(render);
    tree = render(blocks);
    assert.equal(sourceToolbar(tree, native), undefined);
    assert.equal(selectionHandle.current!(), null);
    (native ? field.onTouchStart : field.onPointerDown)();
    setUserRange(field, native, start, end);
    (native ? field.onTouchEnd : field.onPointerUp)();
    flushSourceTimers(render);
    assert.ok(
      (render(blocks), selectionHandle.current!()),
      "an intentional user gesture may select the same token",
    );
  });
