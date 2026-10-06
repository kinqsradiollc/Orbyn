import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as core from "@orbyn/core";

const element = (name: string) => name;
const rich = Object.fromEntries(
  [
    "CalloutView",
    "CodeView",
    "DiagramView",
    "EmbedBlock",
    "FileCard",
    "FootnoteLine",
    "ImageBlock",
    "TableView",
  ].map((name) => [name, element(name)]),
);
const modules: Record<string, unknown> = {
  react: { ...React, useRef: (current: unknown) => ({ current }) },
  "react-native": {
    Text: "Text",
    View: "View",
    TextInput: "TextInput",
    StyleSheet: { create: (x: unknown) => x },
  },
  "../../motion": { Pressable: "Pressable" },
  "@orbyn/core": core,
  "./Inline": { Inline: "Inline" },
  "./MathView": { MathView: "MathView" },
  "./RichBlocks": rich,
  "../views/LiveList": { LiveList: "LiveList" },
  "../../components/Icon": { Icon: "Icon" },
  "../../theme": {
    colors: {},
    fonts: {},
    radii: {},
    themed: (fn: () => unknown) => fn(),
  },
};
const source = readFileSync(
  new URL("../../mobile/src/screens/docs/DocBody.tsx", import.meta.url),
  "utf8",
);
const exports: {
  DocBody?: (props: Record<string, unknown>) => React.ReactNode;
} = {};
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
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unmocked module ${name}`);
      return modules[name];
    },
  },
);
const body = exports.DocBody!;
const find = (
  tree: React.ReactNode,
  predicate: (element: React.ReactElement<any>) => boolean,
): React.ReactElement<any>[] => {
  const results: React.ReactElement<any>[] = [];
  const walk = (node: React.ReactNode) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement<any>(child)) return;
      if (predicate(child)) results.push(child);
      walk(child.props.children);
    });
  };
  walk(tree);
  return results;
};
const page: core.DocBlock[] = [
  { type: "heading", id: "heading", level: 1, text: "Heading" },
  { type: "paragraph", id: "words", text: "Owned text" },
  { type: "todo", id: "task", text: "Owned task", done: false },
  {
    type: "image",
    id: "picture",
    text: "Caption",
    file: "00000000-0000-4000-8000-000000000001",
  },
  { type: "table", id: "table", text: "| A |\n| --- |\n| B |" },
];

test("native owned child editing and accessibility target their complete-page index", () => {
  const seen: number[] = [];
  const tree = body({
    content: [page[1]],
    pageContent: page,
    pageIndex: 1,
    onEditBlock: (at: number) => seen.push(at),
  });
  find(
    tree,
    (node) => node.props.accessibilityLabel === "Edit this line",
  )[0].props.onPress();
  assert.deepEqual(seen, [1]);
  const reader = body({
    content: [page[1]],
    pageContent: page,
    pageIndex: 1,
    onDoubleTapBlock: (at: number) => seen.push(at),
  });
  find(
    reader,
    (node) => !!node.props.onAccessibilityAction,
  )[0].props.onAccessibilityAction({ nativeEvent: { actionName: "activate" } });
  assert.deepEqual(seen, [1, 1]);
  const typing = body({
    content: [page[1]],
    pageContent: page,
    pageIndex: 1,
    editing: 1,
    draft: "Draft",
  });
  assert.equal(
    find(typing, (node) => node.type === "TextInput")[0].props.value,
    "Draft",
  );
  assert.equal(
    find(
      body({ content: [page[1]], pageContent: page, pageIndex: 1, editing: 0 }),
      (node) => node.type === "TextInput",
    ).length,
    0,
  );
});

test("owned task toggles, table edits and image replacements use page indexes", () => {
  const seen: number[] = [];
  const task = body({
    content: [page[2]],
    pageContent: page,
    pageIndex: 2,
    onToggleTodo: (at: number) => seen.push(at),
  });
  find(
    task,
    (node) => node.props.accessibilityRole === "checkbox",
  )[0].props.onPress();
  const table = body({
    content: [page[4]],
    pageContent: page,
    pageIndex: 4,
    onEditTable: (at: number) => seen.push(at),
  });
  find(table, (node) => node.type === "TableView")[0].props.onEdit();
  const image = body({
    content: [page[3]],
    pageContent: page,
    pageIndex: 3,
    onReplace: (at: number) => seen.push(at),
  });
  find(image, (node) => node.type === "ImageBlock")[0].props.onChange(page[3]);
  assert.deepEqual(seen, [2, 4, 3]);
});

test("owned children respect whole-page folds and cumulative parent layout offsets", () => {
  const folded = body({
    content: [page[1]],
    pageContent: page,
    pageIndex: 1,
    folds: new Set(["heading"]),
  });
  assert.equal(find(folded, (node) => node.type === "Inline").length, 0);
  const events: unknown[] = [];
  const tree = body({
    content: [page[1]],
    pageContent: page,
    pageIndex: 1,
    layoutOffset: 140,
    targetBlockId: "words",
    onLineLayout: (index: number, y: number) => events.push([index, y]),
    onTargetLayout: (y: number) => events.push(y),
  });
  find(tree, (node) => !!node.props.onLayout)[0].props.onLayout({
    nativeEvent: { layout: { y: 12 } },
  });
  assert.deepEqual(events, [[1, 152], 152]);
  const heading = body({
    content: [page[0]],
    pageContent: page,
    pageIndex: 0,
    onToggleFold: () => {},
  });
  assert.ok(
    find(heading, (node) => node.props.accessibilityState?.expanded === true)
      .length,
  );
});

test("owned body slices can include several children; invalid offsets refuse", () => {
  const seen: number[] = [];
  const tree = body({
    content: page.slice(1, 3),
    pageContent: page,
    pageIndex: 1,
    onEditBlock: (at: number) => seen.push(at),
    onToggleTodo: (at: number) => seen.push(at),
  });
  for (const node of find(
    tree,
    (node) => node.props.accessibilityLabel === "Edit this line",
  ))
    node.props.onPress();
  assert.deepEqual(seen, [1, 2]);
  for (const pageIndex of [-1, 0.5, 5])
    assert.throws(
      () => body({ content: [page[1]], pageContent: page, pageIndex }),
      /position/,
    );
  assert.throws(
    () => body({ content: [page[1]], layoutOffset: NaN }),
    /position/,
  );
});

test("legacy full-page callbacks retain their original positions", () => {
  const seen: number[] = [];
  const tree = body({
    content: page,
    onEditBlock: (at: number) => seen.push(at),
  });
  find(
    tree,
    (node) => node.props.accessibilityLabel === "Edit this line",
  )[1].props.onPress();
  assert.deepEqual(seen, [1]);
});

test("owned embeds retain the full page context and held blocks target their page position", () => {
  const embed: core.DocBlock = {
    type: "code",
    lang: core.EMBED_LANG,
    text: "embed",
    id: "embed",
  };
  const wholePage = [...page, embed];
  const seen: number[] = [];
  const tree = body({
    content: [embed],
    pageContent: wholePage,
    pageIndex: page.length,
    onEditBlock: (at: number) => seen.push(at),
  });
  assert.equal(
    find(tree, (node) => node.type === "EmbedBlock")[0].props.pageBlocks,
    wholePage,
  );
  find(tree, (node) => !!node.props.onLongPress)[0].props.onLongPress();
  assert.deepEqual(seen, [page.length]);
  const reader = body({
    content: [page[1]],
    pageContent: page,
    pageIndex: 1,
    onDoubleTapBlock: (at: number) => seen.push(at),
  });
  const press = find(reader, (node) => !!node.props.onAccessibilityAction)[0]
    .props.onPress;
  press();
  press();
  assert.deepEqual(seen, [page.length, 1]);
});
