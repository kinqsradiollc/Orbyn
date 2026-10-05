import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cssUrl = new URL(
  "../../desktop/src/features/settings/settings.css",
  import.meta.url,
);

/** Evaluate the relevant class rules in source order, including media nesting. */
function gridColumns(css: string, width: number, pairs = false) {
  let result = "";
  let specificity = -1;
  function visit(source: string, enabled: boolean) {
    const blocks = /([^{}]+)\{/g;
    let match: RegExpExecArray | null;
    while ((match = blocks.exec(source))) {
      const start = blocks.lastIndex;
      let depth = 1;
      let end = start;
      for (; end < source.length && depth; end++) {
        if (source[end] === "{") depth++;
        if (source[end] === "}") depth--;
      }
      const selector = match[1].trim();
      const body = source.slice(start, end - 1);
      blocks.lastIndex = end;
      if (selector.startsWith("@")) {
        const max = /max-width:\s*(\d+)px/.exec(selector);
        visit(body, enabled && (!max || width <= Number(max[1])));
        continue;
      }
      if (!enabled) continue;
      const value = /grid-template-columns:\s*([^;]+);/.exec(body)?.[1].trim();
      if (!value) continue;
      for (const part of selector.split(",").map((item) => item.trim())) {
        const score =
          part === ".settings-grid"
            ? 1
            : pairs && part === ".settings-grid.settings-pairs"
              ? 2
              : -1;
        if (score >= 0 && score >= specificity) {
          specificity = score;
          result = value;
        }
      }
    }
  }
  visit(css.replace(/\/\*[\s\S]*?\*\//g, ""), true);
  return result;
}

test("settings grids retain responsive columns after all later CSS rules", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.equal(gridColumns(css, 1200), "repeat(3, minmax(0, 1fr))");
  assert.equal(gridColumns(css, 900), "minmax(0, 1fr) minmax(0, 1fr)");
  for (const width of [560, 390, 320]) {
    assert.equal(gridColumns(css, width), "minmax(0, 1fr)");
    assert.equal(gridColumns(css, width, true), "minmax(0, 1fr)");
  }
  assert.equal(gridColumns(css, 900, true), "repeat(2, minmax(0, 1fr))");
});

test("regression evaluator detects a late base rule overriding narrow layouts", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.equal(
    gridColumns(
      css +
        "\n.settings-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }",
      390,
    ),
    "repeat(3, minmax(0, 1fr))",
  );
});

test("settings field and secret surfaces use existing theme tokens", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  for (const token of ["surface", "surfaceMuted", "text", "border", "muted"]) {
    assert.ok(css.includes(`var(--color-${token})`));
  }
});
