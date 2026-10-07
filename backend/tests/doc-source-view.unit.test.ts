import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as core from "@orbyn/core";

function fixture(native: boolean, editable = false, ownedEditable = true) {
  const states: unknown[] = [];
  let at = 0,
    refAt = 0;
  const refs: { current: any }[] = [];
  const dialogEffects: { run: () => any; deps: unknown[] | undefined }[] = [];
  const listeners = new Map<string, (event: any) => void>();
  let focused = 0;
  const document = {
    activeElement: {
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
          states[index] = value;
        },
      ];
    },
  };
  const container = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children);
  const notes = React.createContext({});
  const navigationContext = React.createContext({});
  const opened: string[] = [];
  let closed = 0;
  const modules: Record<string, unknown> = {
    react: hooks,
    "@orbyn/core": core,
    "lucide-react": { X: () => null },
    "./doc-source.css": {},
    "./DocContainerView": { DocContainerView: "owned-preview" },
    "./DocContainerBody": { DocContainerBody: "owned-preview" },
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
      View: container,
      Text: container,
      ScrollView: container,
      TextInput: ({ value }: { value: string }) =>
        React.createElement("pre", null, value),
    },
    "../../components/Sheet": { Sheet: container },
    "../../components/Button": {
      Button: ({ title }: { title: string }) =>
        React.createElement("button", null, title),
    },
    "../../styles": { shared: {} },
    "../../theme": { colors: {}, radii: {}, fonts: {} },
    "./DocBody": {
      DocBody: ({ content }: { content: core.DocBlock[] }) =>
        React.createElement("pre", null, core.serializeDoc(content)),
    },
  };
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
      getComputedStyle: () => ({ lineHeight: "20px" }),
      document,
      require: (name: string) => {
        assert.ok(name in modules, name);
        return modules[name];
      },
    },
  );
  const edits: core.DocBlock[][] = [];
  const ownedBlocks = new WeakSet<core.DocBlock[]>();
  let currentBlocks: core.DocBlock[];
  let currentDocument: core.VersionedDocContent;
  const ownedDocuments = new WeakSet<core.VersionedDocContent>();
  const documentEdits: core.VersionedDocContent[] = [];
  const render = (
    blocks: core.DocBlock[],
    document?: core.VersionedDocContent,
  ) => {
    if (document && !ownedDocuments.has(document)) currentDocument = document;
    if (!ownedBlocks.has(blocks)) currentBlocks = blocks;
    at = 0;
    refAt = 0;
    return exports.DocSourcePreview({
      blocks,
      document,
      onDocumentSourceChange:
        editable && document && ownedEditable
          ? (text: string, expected: core.VersionedDocContent) => {
              const next = core.applyVersionedDocSource(
                currentDocument,
                expected,
                text,
                { projected: true },
              );
              currentDocument = next;
              ownedDocuments.add(next);
              documentEdits.push(next);
              return next;
            }
          : undefined,
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
      onAppLink: (url: string) => opened.push(url),
      report: () => {},
      onClose: () => {
        closed++;
      },
    });
  };
  return Object.assign(render, {
    refs,
    dialogEffects,
    listeners,
    focused: () => focused,
    states,
    edits,
    documentEdits,
    opened,
    closed: () => closed,
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
      renderToStaticMarkup(render(core.parseDoc("Different page"))),
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
  find(tree, (props) => typeof props.onSelect === "function")!.onSelect({
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
  render.refs[1].current = input;
  render.refs[2].current = pane;
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
  assert.equal(render.states[1], 1, "scroll picks the second block");
  find(
    render(blocks),
    (props) => props.title === "Show Markdown source",
  )!.onPress();
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
    assert.equal(render.states[native ? 1 : 0], 1);
    assert.equal(render.closed(), 0);
    navigation.onAppLink(
      "orbyn://doc/00000000-0000-4000-8000-000000000001#next",
    );
    assert.equal(render.closed(), 0);
    navigation.onFragment("missing-heading");
    assert.equal(render.states[native ? 1 : 0], 1);
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
    assert.match(renderToStaticMarkup(after), /This edit has not been saved/);
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
      /document changed while this source edit was invalid/,
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
    (props) => props.style?.padding === 16 && !!props.onLayout,
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
  const firstChild = React.Children.toArray(
    (first.props as any).children,
  )[0] as React.ReactElement;
  assert.equal((firstChild.props as any).title, "Restore current document");
});

test("web source errors keep the dialog mounted and Escape observes the latest validation state", () => {
  const render = fixture(false, true);
  const blocks = core.parseDoc("Safe ^one", { anchors: true });
  const first = render(blocks);
  const lifecycle = render.dialogEffects[0];
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
  render.refs[0].current = modal;
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
  find(invalid, (props) =>
    React.Children.toArray(props.children).includes("Restore current document"),
  )!.onClick();
  render(blocks);
  escape();
  assert.equal(
    render.closed(),
    1,
    "Escape can close after explicit restoration",
  );
  render.refs[0].current = null;
  cleanup();
  assert.equal(
    closed,
    1,
    "cleanup closes the captured dialog even after its React ref is cleared",
  );
  assert.equal(render.focused(), 1);
  assert.equal(render.listeners.has("keydown"), false);
});

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} complete source edits preserve owners and fence stale snapshots`, () => {
    const render = fixture(native, true);
    const document = core.parseVersionedDocContent({
      format: 2,
      nodes: core.parseDocContainers(
        "> 7) [x] First ^first\n> 8) [ ] Second ^second",
        { anchors: true },
      ),
    });
    const projection =
      document.format === 2
        ? core.docContainerBlocks(document.nodes)
        : document.blocks;
    const tree = render(projection, document);
    const inputOf = (tree: React.ReactNode) =>
      find(
        tree,
        (props) =>
          props["aria-label"] === "Markdown source" ||
          props.accessibilityLabel === "Markdown source",
      )!;
    const input = inputOf(tree);
    assert.equal(input.value, core.versionedDocSource(document));
    const text = input.value.replace("First", "Edited");
    if (native) input.onChangeText(text);
    else input.onChange({ currentTarget: { value: text } });
    assert.equal(
      render.edits.length,
      0,
      "the flat callback must never handle owned source",
    );
    assert.equal(render.documentEdits.length, 1);
    const edited = render.documentEdits[0];
    assert.equal(edited.format, 2);
    assert.equal(inputOf(render(projection, edited)).value, text);
    if (edited.format !== 2 || document.format !== 2)
      throw new Error("Lost ownership");
    const unchanged = JSON.parse(JSON.stringify(document));
    core.visitDocContainers(unchanged.nodes, (node) => {
      if (
        node.kind === "block" &&
        node.block.id === "first" &&
        "text" in node.block
      )
        node.block.text = "Edited";
    });
    assert.deepEqual(edited, unchanged);
    const external = core.applyVersionedDocSource(
      edited,
      edited,
      core.versionedDocSource(edited).replace("Second", "Remote"),
    );
    render(projection, external);
    // This retained input belongs to the previous accepted owner, before the external effect settled.
    // The parent's expected-snapshot check, rather than a flat projection, fences it.
    const stale = inputOf(tree);
    if (native) stale.onChangeText(text.replace("Edited", "Late"));
    else
      stale.onChange({
        currentTarget: { value: text.replace("Edited", "Late") },
      });
    assert.equal(render.documentEdits.length, 1);
    assert.match(
      renderToStaticMarkup(render(projection, external)),
      /has not been saved/,
    );
  });
  test(`${native ? "native" : "web"} an owned document is readonly without its matching owner callback`, () => {
    const render = fixture(native, true, false);
    const document = core.parseVersionedDocContent({
      format: 2,
      nodes: core.parseDocContainers("> Nested"),
    });
    const tree = render([], document);
    const input = find(
      tree,
      (props) =>
        props["aria-label"] === "Markdown source" ||
        props.accessibilityLabel === "Markdown source",
    )!;
    assert.equal(native ? input.editable : input.readOnly, !native);
    assert.equal(native ? input.onChangeText : input.onChange, undefined);
  });
}
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
    assert.match(renderToStaticMarkup(render(external)), /has not been saved/);
  });
}

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} delayed owned echoes retain the newest source and preview tree`, () => {
    const render = fixture(native, true);
    const document = core.parseVersionedDocContent({
      format: 2,
      nodes: core.parseDocContainers("> First ^first", { anchors: true }),
    });
    let tree = render([], document);
    const inputOf = (tree: React.ReactNode) =>
      find(
        tree,
        (props) =>
          props["aria-label"] === "Markdown source" ||
          props.accessibilityLabel === "Markdown source",
      )!;
    const input = inputOf(tree);
    const type = (text: string) =>
      native
        ? input.onChangeText(text)
        : input.onChange({ currentTarget: { value: text } });
    type(input.value.replace("First", "Older"));
    const latest = input.value.replace("First", "Latest") + "\n\nLast ^last";
    type(latest);
    assert.equal(render.documentEdits.length, 2);
    tree = render([], render.documentEdits[0]);
    assert.equal(inputOf(tree).value, latest);
    if (native) {
      find(tree, (props) => props.title === "Show preview")!.onPress();
      tree = render([], render.documentEdits[0]);
    }
    const preview = find(tree, (props) => props.nodes && props.renderLeaf)!;
    assert.deepEqual(
      preview.nodes,
      (render.documentEdits[1] as core.VersionedDocContent & { format: 2 })
        .nodes,
    );
    assert.equal(render.closed(), 0);
  });
}

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} identical source does not discard a change of ownership format`, () => {
    const render = fixture(native, true);
    const blocks = core.parseDoc("First ^first", { anchors: true });
    render(blocks);
    const document = core.upgradeDocContent({ format: 1, blocks });
    render(blocks, document);
    const tree = render(blocks, document);
    const input = find(
      tree,
      (props) =>
        props["aria-label"] === "Markdown source" ||
        props.accessibilityLabel === "Markdown source",
    )!;
    const text = input.value.replace("First", "Owned");
    if (native) input.onChangeText(text);
    else input.onChange({ currentTarget: { value: text } });
    assert.equal(render.edits.length, 0);
    assert.equal(render.documentEdits.length, 1);
    assert.equal(render.documentEdits[0].format, 2);
  });
}
