import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  appUrl,
  docLinkDestination,
  mentionedPerson,
  parseDocInline,
  parseDoc,
  docReferenceLinks,
  parseObjectHref,
  tagRuns,
} from "@orbyn/core";

test("actual inline renderer gives fragment links the owning page URL and preserves modified clicks", () => {
  const source = readFileSync(
    new URL("../../desktop/src/features/docs/DocBlocks.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export function Inline(");
  const end = source.indexOf("\nexport function ", start + 1);
  assert.ok(start >= 0 && end > start);
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const jumps: string[] = [];
  const navigation = {
    docId: "0b7f6d1e-3c1a-4f7e-9d59-2f0a4b6c8e11",
    onFragment: (value: string) => jumps.push(value),
  };
  const context = {
    exports: {} as { Inline: any },
    require: createRequire(import.meta.url),
    useContext: () => navigation,
    DocNavigationContext: {},
    FootnoteContext: {},
    parseDocInline,
    tagRuns,
    mentionedPerson,
    parseObjectHref,
    docLinkDestination,
    touches: () => false,
    webOrigin: () => "https://notes.example.test",
    linkTo: (target: any) => appUrl("https://notes.example.test", target),
  };
  runInNewContext(compiled.outputText, context);
  const element = context.exports.Inline({
    text: "[Résumé](#r%C3%A9sum%C3%A9)",
  });
  const anchor = element.props.children[0];
  assert.equal(anchor.type, "a");
  assert.equal(
    anchor.props.href,
    `https://notes.example.test/app/doc/${navigation.docId}#r%C3%A9sum%C3%A9`,
  );
  let prevented = 0,
    stopped = 0;
  const event = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: () => prevented++,
    stopPropagation: () => stopped++,
  };
  anchor.props.onClick(event);
  assert.deepEqual(jumps, ["résumé"]);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"])
    anchor.props.onClick({ ...event, [modifier]: true });
  anchor.props.onClick({ ...event, button: 1 });
  assert.deepEqual(jumps, ["résumé"]);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});

for (const mobile of [false, true]) {
  test(`${mobile ? "native" : "web"} actual inline renderer resolves document references and follows their heading`, () => {
    const path = mobile
      ? "../../mobile/src/screens/docs/Inline.tsx"
      : "../../desktop/src/features/docs/DocBlocks.tsx";
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const start = source.indexOf("export function Inline(");
    const end = source.indexOf(
      mobile ? "\nconst s =" : "\nexport function ",
      start + 1,
    );
    assert.ok(start >= 0 && end > start);
    const compiled = ts.transpileModule(source.slice(start, end), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    const notes = {};
    const navigationContext = {};
    const jumps: string[] = [];
    const navigation = {
      docId: "0b7f6d1e-3c1a-4f7e-9d59-2f0a4b6c8e11",
      onFragment: (value: string) => jumps.push(value),
    };
    const context = {
      exports: {} as { Inline: any },
      require: createRequire(import.meta.url),
      useContext: (key: unknown) =>
        key === notes
          ? {
              references: docReferenceLinks(parseDoc("[intro]: #intro")),
              numbers: new Map(),
              texts: new Map(),
            }
          : navigation,
      FootnoteContext: notes,
      DocNavigationContext: navigationContext,
      parseDocInline,
      tagRuns,
      mentionedPerson,
      parseObjectHref,
      docLinkDestination,
      touches: () => false,
      webOrigin: mobile
        ? "https://notes.example.test"
        : () => "https://notes.example.test",
      linkTo: (target: any) => appUrl("https://notes.example.test", target),
      Text: "NativeText",
      s: {},
    };
    runInNewContext(compiled.outputText, context);
    const element = context.exports.Inline({ text: "[Introduction][intro]" });
    const link = element.props.children[0];
    if (mobile) link.props.onPress();
    else {
      assert.equal(link.type, "a");
      assert.ok(link.props.href.endsWith("#intro"));
      link.props.onClick({
        button: 0,
        preventDefault() {},
        stopPropagation() {},
      });
    }
    assert.deepEqual(jumps, ["intro"]);
  });
}
