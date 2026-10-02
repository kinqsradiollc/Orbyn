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
  let at = 0;
  const hooks = {
    ...React,
    useEffect: () => {},
    useId: () => "source-title",
    useMemo: (fn: () => unknown) => fn(),
    useRef: () => ({ current: null }),
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
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      React,
      require: (name: string) => {
        assert.ok(name in modules, name);
        return modules[name];
      },
    },
  );
  return (blocks: core.DocBlock[]) => {
    at = 0;
    return exports.DocSourcePreview({ blocks, onClose: () => {} });
  };
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
