import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as React from "react";
import * as jsx from "react/jsx-runtime";

function fixture(platform: "desktop" | "mobile", doc: Record<string, unknown>) {
  const states: unknown[] = [];
  const effects: (() => (() => void) | void)[] = [];
  let index = 0;
  let token = "account-a";
  let resolve!: (value: unknown) => void;
  const opened = new Promise((done) => {
    resolve = done;
  });
  const modules: Record<string, unknown> = {
    react: {
      ...React,
      useState(initial: unknown) {
        const slot = index++;
        if (!(slot in states)) states[slot] = initial;
        return [
          states[slot],
          (next: unknown) => {
            states[slot] =
              typeof next === "function" ? next(states[slot]) : next;
          },
        ];
      },
      useEffect: (effect: () => (() => void) | void) => effects.push(effect),
    },
    "react/jsx-runtime": jsx,
    "@orbyn/core": { docContainerBlocks: () => [] },
    "../../../lib/api": { client: { getDocForEditor: () => opened } },
    "./LegacyDocEditor": { LegacyDocEditor: "legacy-editor" },
    "./StructuredDocEditor": { StructuredDocEditor: "structured-editor" },
    "react-native": { Text: "text", View: "view" },
    "../../../components/SmallAction": { SmallAction: "retry" },
    "../../../lib/session": {
      session: {
        get token() {
          return token;
        },
      },
    },
    "../../../theme": { colors: {}, themed: (make: () => unknown) => make() },
  };
  const result = { exports: {} as Record<string, (props: any) => any> };
  runInNewContext(
    transformSync(
      readFileSync(
        new URL(
          `../../${platform}/src/features/documents/editor/DocEditor.tsx`,
          import.meta.url,
        ),
        "utf8",
      ),
      {
        loader: "tsx",
        format: "cjs",
        jsx: "automatic",
      },
    ).code,
    {
      module: result,
      exports: result.exports,
      require: (name: string) => {
        assert.ok(name in modules, name);
        return modules[name];
      },
    },
  );
  return {
    render() {
      index = 0;
      const node = result.exports.DocEditor({ doc, report: assert.fail });
      return platform === "mobile" ? node.type(node.props) : node;
    },
    effects,
    resolve,
    switchAccount() {
      token = "account-b";
    },
  };
}

for (const platform of ["desktop", "mobile"] as const) {
  test(`${platform}: the content loader chooses the stored document format`, () => {
    for (const [format, expected] of [
      [1, "legacy-editor"],
      [2, "structured-editor"],
    ] as const) {
      const view = fixture(platform, {
        id: "page-fixture",
        document: { format, nodes: [] },
      });
      assert.equal(view.render().type, expected);
    }
  });

  test(`${platform}: a late document load cannot update an unmounted editor`, async () => {
    const view = fixture(platform, { id: "page-fixture" });
    const opening = view.render();
    const cleanup = view.effects[0]();
    cleanup?.();
    view.resolve({ id: "page-fixture", document: { format: 2, nodes: [] } });
    await Promise.resolve();
    assert.equal(view.render().type, opening.type);
  });
}

test("mobile: replacing the account rejects the previous account's document result", async () => {
  const view = fixture("mobile", { id: "page-fixture" });
  const opening = view.render();
  view.effects[0]();
  view.switchAccount();
  view.resolve({ id: "page-fixture", document: { format: 2, nodes: [] } });
  await Promise.resolve();
  assert.equal(view.render().type, opening.type);
});
