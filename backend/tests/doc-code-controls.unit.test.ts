import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import {
  FRONTMATTER_LANG,
  docCodeLabel,
  colourable,
  colourCode,
} from "@orbyn/core";

function mount(
  platform: "desktop" | "mobile",
  clipboard?: { writeText(text: string): Promise<void> },
) {
  const states: unknown[] = [];
  let index = 0;
  const copies: string[] = [];
  const hooks = {
    useState(initial: unknown) {
      const at = index++;
      if (!(at in states)) states[at] = initial;
      return [states[at], (next: unknown) => (states[at] = next)];
    },
    useMemo: (fn: () => unknown) => fn(),
  };
  const source = readFileSync(
    new URL(
      platform === "desktop"
        ? "../../desktop/src/features/docs/RichBlocks.tsx"
        : "../../mobile/src/screens/docs/RichBlocks.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const begin = source.indexOf("export function CodeView(");
  const end = source.indexOf(
    "// -------------------------------------------------------------- diagrams",
    begin,
  );
  const compiled = ts.transpileModule(source.slice(begin, end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports: {
    CodeView(props: { text: string; lang: string }): React.ReactElement;
  } = {} as never;
  const component = (props: unknown) => null;
  runInNewContext(compiled, {
    exports,
    React,
    ...hooks,
    FRONTMATTER_LANG,
    docCodeLabel,
    colourable,
    colourCode,
    navigator: { clipboard },
    View: component,
    Text: component,
    ScrollView: component,
    Pressable: component,
    s: {},
    copyText: async (text: string) => {
      copies.push(text);
    },
  });
  const render = (text: string, lang: string) => {
    index = 0;
    return exports.CodeView({ text, lang });
  };
  return { render, copies };
}
function nodes(tree: React.ReactNode): React.ReactElement[] {
  if (!React.isValidElement(tree)) return [];
  return [
    tree,
    ...React.Children.toArray(
      (tree.props as { children?: React.ReactNode }).children,
    ).flatMap(nodes),
  ];
}
function words(tree: React.ReactNode): string {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (!React.isValidElement(tree)) return "";
  return React.Children.toArray(
    (tree.props as { children?: React.ReactNode }).children,
  )
    .map(words)
    .join("");
}
function button(tree: React.ReactNode, label: string) {
  const found = nodes(tree).find(
    (node) =>
      words(node) === label &&
      (node.type === "button" ||
        (node.props as { accessibilityRole?: string }).accessibilityRole ===
          "button"),
  );
  assert.ok(found, `missing ${label}`);
  return found.props as { onClick?: () => void; onPress?: () => void };
}
for (const platform of ["desktop", "mobile"] as const) {
  test(`${platform} labels metadata, exposes literal source on request and copies exact bytes`, async () => {
    const source =
      "---\ntitle: <script>not executable</script>\nprivate: &anchor yes\n---";
    const view = mount(platform);
    let tree = view.render(source, FRONTMATTER_LANG);
    assert.ok(words(tree).includes("Page metadata"));
    assert.ok(!words(tree).includes(source));
    const control = button(tree, "View source");
    (control.onClick ?? control.onPress)!();
    tree = view.render(source, FRONTMATTER_LANG);
    assert.ok(words(tree).includes(source));
    assert.ok(!nodes(tree).some((n) => n.type === "script"));
    if (platform === "mobile") {
      button(tree, "Copy").onPress!();
      await Promise.resolve();
      assert.equal(view.copies[0], source);
    }
  });
  test(`${platform} retains unknown-language source and toggles known highlighting`, () => {
    const view = mount(platform);
    const source = "<b>raw</b> " + "x".repeat(1000);
    const unknown = view.render(source, "unknown-language");
    assert.ok(words(unknown).includes(source));
    assert.ok(!nodes(unknown).some((n) => n.type === "b"));
    const known = view.render("const answer = 42;", "typescript");
    const toggle = button(known, "Source");
    (toggle.onClick ?? toggle.onPress)!();
    const plain = view.render("const answer = 42;", "typescript");
    assert.ok(words(plain).includes("const answer = 42;"));
    button(plain, "Highlight");
  });
}
test("desktop copy preserves source and recovers when clipboard is missing or refuses", async () => {
  const copies: string[] = [];
  const cases = [
    {
      clipboard: undefined,
      expected: "Couldn't copy. Select the source to copy it.",
    },
    {
      clipboard: {
        writeText: async () => {
          throw Error("denied");
        },
      },
      expected: "Couldn't copy. Select the source to copy it.",
    },
    {
      clipboard: {
        writeText: async (text: string) => {
          copies.push(text);
        },
      },
      expected: "Copied",
    },
  ];
  for (const { clipboard, expected } of cases) {
    const view = mount("desktop", clipboard);
    const tree = view.render("exact\nsource", "");
    button(tree, "Copy").onClick!();
    await new Promise((resolve) => setImmediate(resolve));
    const after = view.render("exact\nsource", "");
    const status = nodes(after).find(
      (node) => (node.props as { role?: string }).role === "status",
    );
    assert.ok(status);
    assert.equal(words(status), expected);
    assert.equal(
      (button(after, "Copy") as { disabled?: boolean }).disabled,
      false,
    );
  }
  assert.deepEqual(copies, ["exact\nsource"]);
});

test("mobile web copy reports unavailable clipboard instead of false success", async () => {
  const source = readFileSync(
    new URL("../../mobile/src/lib/share.ts", import.meta.url),
    "utf8",
  );
  const begin = source.indexOf("export async function copyText(");
  const end = source.indexOf("/** A page as a Markdown", begin);
  const compiled = ts.transpileModule(source.slice(begin, end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  for (const scenario of ["missing", "denied", "success"]) {
    const messages: string[] = [];
    const copies: string[] = [];
    const exports: { copyText(text: string, done?: string): Promise<void> } =
      {} as never;
    runInNewContext(compiled, {
      exports,
      Platform: { OS: "web" },
      navigator:
        scenario === "missing"
          ? {}
          : {
              clipboard: {
                writeText: async (text: string) => {
                  if (scenario === "denied") throw Error("denied");
                  copies.push(text);
                },
              },
            },
      showToast: ({ text }: { text: string }) => messages.push(text),
    });
    await exports.copyText("exact\nsource", "Code copied");
    assert.deepEqual(messages, [
      scenario === "success" ? "Code copied" : "Couldn't copy it",
    ]);
    assert.deepEqual(copies, scenario === "success" ? ["exact\nsource"] : []);
  }
});
