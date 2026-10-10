import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as core from "@orbyn/core";

/** Execute the actual section component without starting unrelated rich-block services. */
function section(native: boolean) {
  const path = native
    ? "../../mobile/src/screens/docs/RichBlocks.tsx"
    : "../../desktop/src/features/docs/RichBlocks.tsx";
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const name = native ? "SectionBody" : "SectionEmbed";
  const node = ast.statements.find(
    (entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === name,
  );
  assert.ok(node, `Missing actual ${name} component`);
  const exports: Record<string, (props: unknown) => React.ReactElement> = {};
  const opened: unknown[] = [];
  const urls: string[] = [];
  const guarded = (url: string) => urls.push(url);
  const navigation = React.createContext(null);
  const footnotes = React.createContext(null);
  const blocks: core.DocBlock[] = [
    { type: "paragraph", text: "[Jump](#研究结果)" },
  ];
  const props = {
    docId: "source-page",
    blocks,
    references: [["guide", "#研究结果"]],
  };
  runInNewContext(
    ts.transpileModule(`export ${node.getText(ast)}`, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
      },
    }).outputText,
    {
      exports,
      React,
      ...core,
      useState: () => [
        {
          doc_id: props.docId,
          title: "Source",
          blocks,
          references: props.references,
        },
        () => {},
      ],
      useCallback: (callback: unknown) => callback,
      useEffect: () => {},
      useMemo: (callback: () => unknown) => callback(),
      useContext: () => ({
        onFragment: () => {
          throw new Error("Used containing page");
        },
        onAppLink: guarded,
        report: () => {},
      }),
      DocNavigationContext: navigation,
      FootnoteContext: footnotes,
      FileText: () => null,
      ExternalLink: () => null,
      BlockView: () => null,
      openObject: (
        object: unknown,
        fragment: unknown,
        onAppLink?: (url: string) => void,
      ) => {
        assert.equal(
          onAppLink,
          guarded,
          "Embedded link must retain its parent's guard",
        );
        opened.push([object, fragment]);
      },
      openAppUrl: (url: string) => urls.push(url),
      OPEN_LINK_EVENT: "open-link",
      window: {
        dispatchEvent: (event: { detail: string }) => urls.push(event.detail),
      },
      CustomEvent: class {
        detail: string;
        constructor(_name: string, options: { detail: string }) {
          this.detail = options.detail;
        }
      },
      require: (name: string) => {
        assert.equal(name, "./DocBody");
        return { DocBody: () => null };
      },
    },
  );
  const tree = exports[name](
    native ? props : { doc: props.docId, block: null },
  );
  function find(node: React.ReactNode): any {
    if (!React.isValidElement(node)) return null;
    const value = node.props as { children?: React.ReactNode; value?: unknown };
    if (node.type === navigation.Provider) return value.value;
    return React.Children.toArray(value.children).map(find).find(Boolean);
  }
  const context = find(tree);
  assert.ok(context, "Section must own its navigation context");
  const pressOpenHeader = () => {
    let press: (() => void) | undefined;
    function visit(node: React.ReactNode) {
      if (!React.isValidElement(node)) return;
      const value = node.props as {
        children?: React.ReactNode;
        onClick?: () => void;
      };
      if (node.type === "button" && value.onClick) press = value.onClick;
      React.Children.forEach(value.children, visit);
    }
    visit(tree);
    assert.ok(press, "Expected embedded-section Open button");
    press();
  };
  return { context, opened, urls, pressOpenHeader };
}

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} embedded fragments open the source page, never the containing page`, () => {
    const view = section(native);
    view.context.onFragment("研究结果");
    assert.equal(
      JSON.stringify(view.opened),
      JSON.stringify([[{ kind: "doc", id: "source-page" }, "研究结果"]]),
    );
    view.context.onAppLink("orbyn://doc/another-page#heading");
    assert.deepEqual(view.urls, ["orbyn://doc/another-page#heading"]);
    if (!native) {
      view.pressOpenHeader();
      assert.equal(view.opened.length, 2);
      assert.equal(
        JSON.stringify(view.opened[1]),
        JSON.stringify([{ kind: "doc", id: "source-page" }, undefined]),
      );
    }
  });
}
