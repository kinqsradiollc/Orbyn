import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cssUrl = new URL(
  "../../desktop/src/features/settings/settings.css",
  import.meta.url,
);

test("phone Settings uses the available modal space without shrinking controls", async () => {
  const css = await readFile(
    new URL(
      "../../desktop/src/features/settings/settings-modal.css",
      import.meta.url,
    ),
    "utf8",
  );
  for (const width of [320, 390, 560, 600]) {
    assert.equal(
      gridColumns(css, width, false, "padding", "settings-backdrop"),
      "0",
    );
    assert.equal(
      gridColumns(css, width, false, "width", "settings-dialog"),
      "100%",
    );
    assert.equal(
      gridColumns(css, width, false, "height", "settings-dialog"),
      "100%",
    );
    assert.equal(
      gridColumns(css, width, false, "padding", "settings-dialog-header"),
      "8px 12px",
    );
    assert.equal(
      gridColumns(
        css,
        width,
        false,
        "min-height",
        "settings-dialog .settings-section-head",
      ),
      "var(--control-h)",
    );
  }
  assert.equal(
    gridColumns(css, 601, false, "padding", "settings-backdrop"),
    "12px",
  );
  assert.equal(
    gridColumns(css, 1280, false, "width", "settings-dialog"),
    "min(1000px, 100%)",
  );
  assert.equal(
    gridColumns(css, 1280, false, "padding", "settings-dialog-header"),
    "16px 20px",
  );
  assert.equal(
    gridColumns(css, 320, false, "font-size", "settings-dialog-header h2"),
    "18px",
  );
  assert.equal(
    gridColumns(css, 1280, false, "font-size", "settings-dialog-header h2"),
    "18px",
  );
  assert.doesNotMatch(
    css.slice(css.lastIndexOf("@media (max-width: 600px)")),
    /font-size|transform:\s*scale|zoom:/,
  );
});

/** Evaluate the relevant class rules in source order, including media nesting. */
function gridColumns(
  css: string,
  width: number,
  pairs = false,
  property = "grid-template-columns",
  className = "",
) {
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
      const value = new RegExp(property + ":\\s*([^;]+);")
        .exec(body)?.[1]
        .trim();
      if (!value) continue;
      for (const part of selector.split(",").map((item) => item.trim())) {
        const score = className
          ? part === "." + className
            ? 1
            : -1
          : part === ".settings-grid"
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

test("phone settings expose exactly one navigation control through the final CSS cascade", async () => {
  const css = await readFile(cssUrl, "utf8");
  const display = (width: number, name: string, source = css) =>
    gridColumns(source, width, false, "display", name);
  for (const width of [320, 390, 560, 600]) {
    assert.equal(display(width, "settings-navigation-wide"), "none");
    assert.equal(display(width, "settings-navigation-compact"), "block");
  }
  for (const width of [601, 900]) {
    assert.equal(display(width, "settings-navigation-wide"), "flex");
    assert.equal(display(width, "settings-navigation-compact"), "none");
  }
  assert.equal(display(1280, "settings-navigation-wide"), "grid");
  assert.equal(display(1280, "settings-navigation-compact"), "none");
  assert.equal(
    display(
      320,
      "settings-navigation-wide",
      css + "\n.settings-navigation-wide { display: grid; }",
    ),
    "grid",
    "the evaluator must detect later regressions rather than merely finding the media rule",
  );
});

test("phone theme controls use three shrinkable columns inside their card", async () => {
  const css = await readFile(cssUrl, "utf8");
  for (const width of [320, 390, 560, 600]) {
    const property = (name: string) =>
      gridColumns(css, width, false, name, "theme-preference > .segmented");
    assert.equal(property("display"), "grid");
    assert.equal(
      property("grid-template-columns"),
      "repeat(3, minmax(0, 1fr))",
    );
    assert.equal(property("width"), "100%");
    assert.equal(property("min-width"), "0");
  }
  assert.notEqual(
    gridColumns(css, 601, false, "display", "theme-preference > .segmented"),
    "grid",
    "wide settings retain the existing compact theme control",
  );
});

test("theme labels can wrap at enlarged text sizes without hiding their content", async () => {
  const css = await readFile(cssUrl, "utf8");
  const property = (name: string) =>
    gridColumns(css, 320, false, name, "theme-preference > .segmented button");
  assert.equal(property("min-width"), "0");
  assert.equal(property("flex-wrap"), "wrap");
  assert.equal(property("overflow-wrap"), "anywhere");
  assert.equal(property("padding-inline"), "6px");
  assert.notEqual(property("overflow"), "hidden");
  assert.equal(property("font-size"), "", "retain shared readable text size");
});
