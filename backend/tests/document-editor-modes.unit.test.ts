import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import * as React from "react";
const require = createRequire(import.meta.url);
for (const native of [false, true]) {
  test(`${native ? "mobile" : "web"} exposes Note, Markdown and LaTeX as primary format choices`, () => {
    const module = { exports: {} as any };
    const tokens = {
      colors: { accent: "accent", accentSoft: "soft", muted: "muted" },
      fonts: { medium: "medium" },
      radii: { input: 8 },
      themed: (create: () => unknown) => create(),
    };
    const deps: any = {
      react: React,
      "react/jsx-runtime": require("react/jsx-runtime"),
      "react-native": {
        View: "div",
        Text: "span",
        StyleSheet: { create: (styles: unknown) => styles },
      },
      "../../motion": { Pressable: "button" },
      "../../theme": tokens,
    };
    const path = native
      ? "../../mobile/src/screens/docs/DocEditorModes.tsx"
      : "../../desktop/src/features/docs/DocEditorModes.tsx";
    runInNewContext(
      transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
        loader: "tsx",
        format: "cjs",
        jsx: "automatic",
      }).code,
      {
        module,
        exports: module.exports,
        require: (name: string) => {
          assert.ok(name in deps, name);
          return deps[name];
        },
      },
    );
    const calls: string[] = [];
    const tree = module.exports.DocEditorModes({
      value: "note",
      onChange: (mode: string) => calls.push(mode),
    });
    const choices = React.Children.toArray(
      tree.props.children,
    ) as React.ReactElement<any>[];
    assert.equal(choices.length, 3);
    assert.deepEqual(
      choices.map((node) =>
        native
          ? React.Children.only(node.props.children).props.children
          : node.props.children,
      ),
      ["Note", "Markdown", "LaTeX"],
    );
    (native ? choices[2].props.onPress : choices[2].props.onClick)();
    assert.deepEqual(calls, ["latex"]);
    const locked = module.exports.DocEditorModes({
      value: "latex",
      disabled: true,
      onChange: assert.fail,
    });
    for (const node of React.Children.toArray(
      locked.props.children,
    ) as React.ReactElement<any>[])
      assert.equal(node.props.disabled, true);
  });
}
test("all document editor parents expose formats directly and the toast keeps its message and dismiss control together", () => {
  for (const platform of [
    "desktop/src/features/docs",
    "mobile/src/screens/docs",
  ])
    for (const file of ["DocEditor.tsx", "StructuredDocEditor.tsx"]) {
      const source = readFileSync(
        new URL(`../../${platform}/${file}`, import.meta.url),
        "utf8",
      );
      assert.match(source, /<DocEditorModes/);
      assert.match(source, /<DocSourcePreview[\s\S]*?\sinline\s/);
      assert.doesNotMatch(
        source,
        /label: "Source \/ preview"|>\s*Source \/ preview\s*</,
      );
    }
  const css = readFileSync(
    new URL("../../desktop/src/styles/global.css", import.meta.url),
    "utf8",
  );
  const final = css.slice(css.lastIndexOf(".toast {"));
  assert.match(final, /flex-wrap: nowrap/);
  assert.match(final, /\.toast-text\s*\{\s*flex: 1 1 auto/);
  assert.match(final, /\.toast-close\s*\{\s*width: 44px/);
  // Configuration evidence only. The final browser case checks actual toast geometry.
});
