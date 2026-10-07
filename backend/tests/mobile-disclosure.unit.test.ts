import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
test("mobile disclosure body leaves room beneath the heading focus outline", () => {
  const source = readFileSync(
    new URL("../../mobile/src/components/Disclosure.tsx", import.meta.url),
    "utf8",
  );
  let styles: any;
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  runInNewContext(output, {
    exports: {},
    require: (path: string) => {
      if (path === "react-native")
        return {
          StyleSheet: {
            create: (value: unknown) => {
              styles = value;
              return value;
            },
          },
        };
      if (path.endsWith("/theme"))
        return {
          colors: {},
          fonts: {},
          radii: {},
          themed: (fn: () => unknown) => fn(),
        };
      if (path.endsWith("/motion")) return { Pressable: () => null };
      if (path.endsWith("/Icon")) return { Icon: () => null };
      return require(path);
    },
  });
  assert.ok(
    styles.body.paddingTop >= 8,
    "the 2px outline plus offset must not touch body text",
  );
  assert.equal(styles.body.paddingHorizontal, 16);
  assert.equal(styles.body.paddingBottom, 16);
  assert.equal(
    styles.heading.minHeight,
    76,
    "retain the disclosure touch target",
  );
  assert.equal(
    styles.hidden.display,
    "none",
    "collapsed content remains hidden",
  );
});
