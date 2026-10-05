import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  parseDoc,
  parseDocInline,
  docReferenceLinks,
  tagRuns,
  mentionedPerson,
  parseObjectHref,
  docLinkDestination,
  mathToText,
} from "@orbyn/core";

test("real web and mobile Inline bodies display authorized reference titles", () => {
  const references = docReferenceLinks(
    parseDoc('[guide]: https://example.test/guide "Read <guide> & notes"'),
  );
  for (const [path, names] of [
    ["../../desktop/src/features/docs/DocBlocks.tsx", ["Inline", "Pieces"]],
    ["../../mobile/src/screens/docs/Inline.tsx", ["Inline"]],
  ] as const) {
    const source = ts.createSourceFile(
      "Inline.tsx",
      readFileSync(new URL(path, import.meta.url), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const declarations = source.statements
      .filter(
        (node) =>
          ts.isFunctionDeclaration(node) &&
          (names as readonly string[]).includes(node.name?.text ?? ""),
      )
      .map((node) => node.getText(source));
    assert.equal(declarations.length, names.length);
    const exports: { Inline?: React.ComponentType<{ text: string }> } = {};
    const hints: string[] = [];
    const js = ts.transpileModule(declarations.join("\n"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    runInNewContext(js, {
      exports,
      require: (id: string) => {
        assert.equal(id, "react/jsx-runtime");
        return jsxRuntime;
      },
      React,
      Fragment: React.Fragment,
      useContext: React.useContext,
      FootnoteContext: React.createContext({
        references,
        numbers: new Map(),
        texts: new Map(),
      }),
      DocNavigationContext: React.createContext(undefined),
      parseDocInline,
      tagRuns,
      mentionedPerson,
      parseObjectHref,
      docLinkDestination,
      mathToText,
      webOrigin: () => "https://orbyn.test",
      s: {},
      touches: () => false,
      cut: (run: { text: string; start: number }) => [run],
      Text: ({
        accessibilityHint,
        children,
      }: {
        accessibilityHint?: string;
        children: string;
      }) => {
        if (accessibilityHint !== undefined) hints.push(accessibilityHint);
        return React.createElement("span", {}, children);
      },
    });
    assert.ok(exports.Inline);
    const html = renderToStaticMarkup(
      React.createElement(exports.Inline, { text: "[Guide]" }),
    );
    if (path.includes("desktop")) {
      assert.match(html, /href="https:\/\/example.test\/guide"/);
      assert.match(html, /title="Read &lt;guide&gt; &amp; notes"/);
      assert.match(html, /data-src="1"/);
    } else assert.deepEqual(hints, ["Read <guide> & notes"]);
    assert.ok(!html.includes("<guide>"));
  }
});

test("object pill titles require a currently resolved target on both clients", () => {
  for (const [path, name] of [
    ["../../desktop/src/features/docs/DocLinks.tsx", "LinkPillView"],
    ["../../mobile/src/screens/docs/links.tsx", "LinkPillText"],
  ] as const) {
    const source = ts.createSourceFile(
      "Pill.tsx",
      readFileSync(new URL(path, import.meta.url), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const declaration = source.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
    );
    assert.ok(declaration);
    const js = ts.transpileModule(declaration.getText(source), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    for (const state of ["ok", "missing", undefined]) {
      const exports: Record<
        string,
        React.ComponentType<{
          href: string;
          label: string;
          start: number;
          hint: string;
        }>
      > = {};
      const hints: string[] = [];
      runInNewContext(js, {
        exports,
        require: (id: string) => {
          assert.equal(id, "react/jsx-runtime");
          return jsxRuntime;
        },
        React,
        useContext: React.useContext,
        useState: React.useState,
        useRef: React.useRef,
        useEffect: React.useEffect,
        parseObjectHref,
        pillKey: () => "target",
        NOUNS: { doc: "page" },
        ICONS: { doc: () => null },
        canOpenTabs: () => false,
        MOD_CLICK: "Cmd-click",
        Link2: () => null,
        s: {},
        PillContext: React.createContext({
          pills: new Map(state ? [["target", { state, title: "Target" }]] : []),
        }),
        Text: ({
          accessibilityHint,
          children,
        }: {
          accessibilityHint?: string;
          children: React.ReactNode;
        }) => {
          if (accessibilityHint !== undefined) hints.push(accessibilityHint);
          return React.createElement("span", {}, children);
        },
      });
      const html = renderToStaticMarkup(
        React.createElement(exports[name], {
          href: "orbyn://doc/11111111-1111-4111-8111-111111111111",
          label: "Target",
          start: 1,
          hint: "Authored tooltip",
        }),
      );
      assert.equal(
        html.includes('title="Authored tooltip"') ||
          hints.includes("Authored tooltip"),
        state === "ok",
      );
    }
  }
});
