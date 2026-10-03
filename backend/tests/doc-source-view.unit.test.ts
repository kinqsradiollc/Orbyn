import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as core from "@orbyn/core";

function fixture(native: boolean) {
  const states: unknown[] = [];
  let at = 0,
    refAt = 0;
  const refs: { current: any }[] = [];
  const hooks = {
    ...React,
    useEffect: () => {},
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
    "../../theme": { colors: {}, radii: {} },
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
      require: (name: string) => {
        assert.ok(name in modules, name);
        return modules[name];
      },
    },
  );
  const render = (blocks: core.DocBlock[]) => {
    at = 0;
    refAt = 0;
    return exports.DocSourcePreview({
      blocks,
      docId: "00000000-0000-4000-8000-000000000001",
      onAppLink: (url: string) => opened.push(url),
      report: () => {},
      onClose: () => {
        closed++;
      },
    });
  };
  return Object.assign(render, { refs, states, opened, closed: () => closed });
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
