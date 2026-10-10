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
        DocNavigationContext: React.createContext(null),
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

test("mobile object pills use the editor's guarded app-link handler", () => {
  const path = "../../mobile/src/screens/docs/links.tsx";
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declarations = source.statements
    .filter(
      (node) =>
        ts.isFunctionDeclaration(node) &&
        ["openObject", "LinkPillText"].includes(node.name?.text ?? ""),
    )
    .map((node) => node.getText(source));
  assert.equal(declarations.length, 2);
  const exports: Record<
    string,
    React.ComponentType<{ href: string; label: string }>
  > = {};
  const direct: string[] = [];
  const guarded: string[] = [];
  let press: (() => void) | undefined;
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
    useContext: React.useContext,
    parseObjectHref,
    pillKey: () => "target",
    NOUNS: { doc: "page" },
    s: {},
    openAppUrl: (url: string) => direct.push(url),
    PillContext: React.createContext({ pills: new Map() }),
    DocNavigationContext: React.createContext({
      onAppLink: (url: string) => guarded.push(url),
    }),
    Text: ({
      onPress,
      accessibilityRole,
      children,
    }: {
      onPress?: () => void;
      accessibilityRole?: string;
      children: React.ReactNode;
    }) => {
      if (accessibilityRole === "link") press = onPress;
      return React.createElement("span", {}, children);
    },
  });
  renderToStaticMarkup(
    React.createElement(exports.LinkPillText, {
      href: "orbyn://doc/11111111-1111-4111-8111-111111111111#target-block",
      label: "Return to launcher",
    }),
  );
  assert.ok(press, "The object pill must expose a clickable link");
  press();
  assert.deepEqual(guarded, [
    "orbyn://doc/11111111-1111-4111-8111-111111111111#target-block",
  ]);
  assert.deepEqual(direct, []);
});

test("web object pills use the editor's guarded app-link handler", () => {
  const path = "../../desktop/src/features/docs/DocLinks.tsx";
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declaration = source.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "LinkPillView",
  );
  assert.ok(declaration);
  const exports: Record<string, React.ComponentType<{ href: string; label: string; start: number }>> = {};
  const guarded = () => {};
  let click: ((event: { stopPropagation: () => void; metaKey: boolean; ctrlKey: boolean }) => void) | undefined;
  let forwarded: unknown;
  const capture = (type: React.ElementType, props: Record<string, unknown>, key?: React.Key) => {
    if (type === "span" && props.role === "link") click = props.onClick as typeof click;
    return jsxRuntime.jsx(type, props, key);
  };
  const js = ts.transpileModule(declaration.getText(source), {
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
      return { jsx: capture, jsxs: capture };
    },
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
    HOVER_MS: 450,
    Hash: () => null,
    s: {},
    PillContext: React.createContext({ pills: new Map() }),
    DocNavigationContext: React.createContext({ onAppLink: guarded }),
    openObject: (_ref: unknown, _block: unknown, handler: unknown) => {
      forwarded = handler;
    },
  });
  renderToStaticMarkup(
    React.createElement(exports.LinkPillView, {
      href: "orbyn://doc/11111111-1111-4111-8111-111111111111",
      label: "Return to launcher",
      start: 0,
    }),
  );
  assert.ok(click, "The web object pill must expose a clickable link");
  click({ stopPropagation: () => {}, metaKey: false, ctrlKey: false });
  assert.equal(forwarded, guarded);
});
