import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { docToDocx } from "../src/modules/docs/docx.js";
import { readZip, docxToMarkdown } from "../src/modules/imports/docx.js";
import { parseDoc } from "@orbyn/core";
import {
  parseDocInline,
  tagRuns,
  mentionedPerson,
  parseObjectHref,
  docLinkDestination,
  mathToText,
} from "@orbyn/core";

/** Exercise the real web Inline and Pieces bodies without loading unrelated page widgets. */
function webInline() {
  const source = ts.createSourceFile(
    "DocBlocks.tsx",
    readFileSync(
      new URL("../../desktop/src/features/docs/DocBlocks.tsx", import.meta.url),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declarations = source.statements
    .filter(
      (node) =>
        ts.isFunctionDeclaration(node) &&
        ["Inline", "Pieces"].includes(node.name?.text ?? ""),
    )
    .map((node) => node.getText(source));
  assert.equal(declarations.length, 2);
  const exports: { Inline?: React.ComponentType<{ text: string }> } = {};
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
    Fragment: React.Fragment,
    useContext: React.useContext,
    DocNavigationContext: React.createContext(undefined),
    FootnoteContext: React.createContext({ references: undefined }),
    parseDocInline,
    tagRuns,
    mentionedPerson,
    parseObjectHref,
    docLinkDestination,
    webOrigin: () => "https://orbyn.test",
    touches: () => false,
    cut: (run: { text: string; start: number }) => [run],
  });
  assert.ok(exports.Inline);
  return exports.Inline;
}

test("actual web Inline preserves hard breaks and soft-break source coordinates", () => {
  const Inline = webInline();
  const html = renderToStaticMarkup(
    React.createElement(Inline, { text: "First\\\nSecond\nThird" }),
  );
  assert.match(html, /First<\/span><br data-src="5"\/>/);
  assert.match(html, /data-src="13"> <\/span>/);
  assert.ok(!html.includes("First\\"));
});

test("actual mobile Inline consumes the same hard/soft breaks as web", () => {
  const source = ts.createSourceFile(
    "Inline.tsx",
    readFileSync(
      new URL("../../mobile/src/screens/docs/Inline.tsx", import.meta.url),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declaration = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "Inline",
  );
  assert.ok(declaration);
  const exports: { Inline?: React.ComponentType<{ text: string }> } = {};
  const js = ts.transpileModule(declaration.getText(source), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const shown: string[] = [];
  runInNewContext(js, {
    exports,
    require: (id: string) => {
      assert.equal(id, "react/jsx-runtime");
      return jsxRuntime;
    },
    React,
    useContext: React.useContext,
    parseDocInline,
    tagRuns,
    parseObjectHref,
    mentionedPerson,
    docLinkDestination,
    mathToText,
    DocNavigationContext: React.createContext(undefined),
    FootnoteContext: React.createContext({
      references: undefined,
      numbers: new Map(),
      texts: new Map(),
    }),
    s: {},
    Text: ({ children }: { children: string }) => {
      shown.push(children);
      return React.createElement("span", {}, children);
    },
  });
  assert.ok(exports.Inline);
  renderToStaticMarkup(
    React.createElement(exports.Inline, { text: "First\\\nSecond\nThird" }),
  );
  assert.deepEqual(shown, ["First", "\n", "Second", " ", "Third"]);
});

test("web reader composes nested styles while retaining source spans and link behavior", () => {
  const Inline = webInline();
  const html = renderToStaticMarkup(
    React.createElement(Inline, {
      text: "=={green}**bold**== [**label**](https://example.test) **`code`**",
    }),
  );
  assert.match(
    html,
    /<strong><mark class="doc-highlight is-green"><span data-src="11">bold<\/span><\/mark><\/strong>/,
  );
  assert.match(
    html,
    /<strong><a href="https:\/\/example.test\/" data-src="23" target="_blank" rel="noreferrer">label<\/a><\/strong>/,
  );
  assert.match(html, /<strong><code data-src="57">code<\/code><\/strong>/);
});

test("Word retains combined run properties and imports bold italic text", () => {
  const bytes = docToDocx("Nested", parseDoc("***both*** =={green}**bold**=="));
  const xml = readZip(bytes).get("word/document.xml")!().toString("utf8");
  assert.match(
    xml,
    /<w:rPr><w:b\/><w:i\/><\/w:rPr><w:t xml:space="preserve">both<\/w:t>/,
  );
  assert.match(
    xml,
    /<w:b\/><w:shd w:val="clear" w:color="auto" w:fill="[A-Fa-f0-9]+"\/>/,
  );
  assert.ok(
    parseDocInline(docxToMarkdown(bytes).markdown).some(
      (run) => run.text === "both" && run.bold && run.italic,
    ),
  );
});

test("web link titles and balanced destinations stay escaped and preserve label offsets", () => {
  const Inline = webInline();
  const html = renderToStaticMarkup(
    React.createElement(Inline, {
      text: '[label](https://example.test/a(b) "Read <first> & second")',
    }),
  );
  assert.ok(html.includes('href="https://example.test/a(b)"'));
  assert.ok(html.includes('title="Read &lt;first&gt; &amp; second"'));
  assert.ok(html.includes('data-src="1"'));
  assert.ok(!html.includes("<first>"));
});
