import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as core from "@orbyn/core";
const require = createRequire(import.meta.url),
  React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function menus() {
  const module = { exports: {} as any };
  const dependencies: any = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "lucide-react": require("lucide-react"),
    "@orbyn/core": core,
    "../../components/Popover": {
      Popover: ({ children }: any) =>
        React.createElement("div", null, children),
    },
  };
  runInNewContext(
    transformSync(
      readFileSync(
        new URL(
          "../../desktop/src/features/docs/DocBlockMenu.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      { loader: "tsx", format: "cjs", jsx: "automatic" },
    ).code,
    {
      module,
      exports: module.exports,
      require: (name: string) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
      document: { activeElement: null },
    },
  );
  return module.exports;
}
for (const name of ["SlashMenu", "DocBlockMenu"])
  test(`${name} renders every supported block kind including headings four through six`, () => {
    const Component = menus()[name];
    const html = renderToStaticMarkup(
      React.createElement(Component, {
        anchor: { top: 0, bottom: 0, left: 0 },
        query: "",
        block: { type: "paragraph", text: "" },
        isFirst: true,
        isLast: true,
        onPick: () => {},
        onClose: () => {},
      }),
    );
    for (const block of core.BLOCK_KINDS)
      assert.ok(html.includes(block.label), `${block.label} must render`);
    assert.ok(
      html.includes("<svg"),
      "actual Lucide icons render, without stubbing the missing icon",
    );
  });
