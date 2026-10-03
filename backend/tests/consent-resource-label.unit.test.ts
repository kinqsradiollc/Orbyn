import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

type Node = {
  type: unknown;
  props: { className?: string; children?: unknown };
};
const path = new URL(
  "../../desktop/src/features/auth/OAuthConsent.tsx",
  import.meta.url,
);
const source = ts.createSourceFile(
  path.pathname,
  readFileSync(path, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declaration = source.statements.find(
  (statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "WhoAsks",
);
assert.ok(declaration, "Exercise the actual consent component function");
const jsx = (type: unknown, props: Node["props"]) => ({ type, props });
const exported: { WhoAsks?: (props: object) => Node } = {};
const context = {
  module: { exports: exported },
  exports: exported,
  require: (name: string) => {
    assert.equal(name, "react/jsx-runtime");
    return { jsx, jsxs: jsx };
  },
  Globe: "icon",
  ArrowRight: "icon",
  Laptop: "icon",
  AlertTriangle: "icon",
};
const compiled = ts.transpileModule(
  declaration.getText(source) + "\nmodule.exports.WhoAsks = WhoAsks;",
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
vm.runInNewContext(compiled, context);
const client = {
  name: "Fixture",
  host: "fixture.example.test",
  verified: true,
  redirect_host: "fixture.example.test",
  redirect_local: false,
};
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value)
    return text((value as Node).props.children);
  return typeof value === "string" ? value : "";
}

test("consent shows the server recipient and distinguishes plugin from portable MCP", () => {
  for (const [kind, label] of [
    ["mcp", "Portable MCP connection"],
    ["plugin", "Plugin integration"],
  ]) {
    const url = `https://${kind}.example.test/api`;
    const root = context.module.exports.WhoAsks!({
      check: { client, resource: { kind, url } },
    });
    const recipient = nodes(root).find(
      (node) => node.props.className === "oauth-resource",
    );
    assert.ok(recipient);
    assert.equal(recipient.type, "span");
    assert.equal(text(recipient), `${label} · ${url}`);
  }
});
test("older API responses without recipient metadata remain usable", () => {
  const root = context.module.exports.WhoAsks!({ check: { client } });
  assert.equal(
    nodes(root).some((node) => node.props.className === "oauth-resource"),
    false,
  );
  assert.ok(text(root).includes("Fixture"));
});
