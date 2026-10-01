import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDocInline,
  parseDoc,
  serializeDoc,
  docToHtml,
  isDocLinkSafe,
} from "@orbyn/core";

for (const [source, expected] of [
  [
    "``use `ticks` and **literal** $math$``",
    "use `ticks` and **literal** $math$",
  ],
  ["```one `` two ` three```", "one `` two ` three"],
  ["` spaced `", "spaced"],
  ["`   `", "   "],
  ["`a\nb`", "a b"],
  ["`\\*not emphasis*`", "\\*not emphasis*"],
] as const) {
  test(`code span stays literal: ${JSON.stringify(source)}`, () => {
    const runs = parseDocInline(source);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].text, expected);
    assert.equal(runs[0].code, true);
    assert.ok(
      !runs[0].math && !runs[0].bold && !runs[0].italic && !runs[0].link,
    );
  });
}

test("unmatched backtick runs do not borrow a shorter closing delimiter", () => {
  for (const source of ["``a`", "```a``", "`a``"]) {
    const runs = parseDocInline(source);
    assert.ok(!runs.some((run) => run.code));
    assert.equal(runs.map((run) => run.text).join(""), source);
  }
});

test("code, escaped punctuation, math and following styles preserve source offsets", () => {
  const source = "A \\*literal\\* ``x`y`` $\\frac{a}{b}$ **bold**";
  const runs = parseDocInline(source);
  assert.equal(
    runs.map((run) => run.text).join(""),
    "A *literal* x`y \\frac{a}{b} bold",
  );
  for (const run of runs)
    assert.equal(
      source.slice(run.start, run.start + run.text.length),
      run.text,
    );
  assert.equal(runs.find((run) => run.math)?.text, "\\frac{a}{b}");
  assert.equal(runs.find((run) => run.bold)?.text, "bold");
});

test("surrounding styles survive escaped punctuation and embedded code", () => {
  const runs = parseDocInline("**bold \\* and `code` end**");
  assert.equal(runs.map((run) => run.text).join(""), "bold * and code end");
  assert.ok(runs.every((run) => run.bold));
  assert.equal(runs.find((run) => run.code)?.text, "code");
});

test("LaTeX escapes are not Markdown escapes and code containing math is literal", () => {
  assert.equal(parseDocInline("$\\{a\\} + \\$5$")[0].text, "\\{a\\} + \\$5");
  const run = parseDocInline("`$a$`")[0];
  assert.equal(run.text, "$a$");
  assert.ok(run.code && !run.math);
});

for (const href of [
  "javascript:alert",
  "JaVaScRiPt:alert",
  "data:text/html,x",
  "file:///private",
  "vbscript:run",
  "//outside.test/path",
  "https:\\outside.test",
  "https://x.test/\u0001",
  "orbyn://doc/../../private",
  "orbyn://person/not-an-id",
  "orbyn://task/0b7f6d1e-3c1a-4f7e-9d59-2f0a4b6c8e11#action",
]) {
  test(`unsupported link remains inert source: ${JSON.stringify(href)}`, () => {
    assert.equal(isDocLinkSafe(href), false);
    const source = `[words](${href})`;
    assert.ok(!parseDocInline(source).some((run) => run.link));
    assert.equal(
      parseDocInline(source)
        .map((run) => run.text)
        .join(""),
      source,
    );
    assert.ok(!docToHtml("Fixture", parseDoc(source)).includes("<a "));
  });
}

test("supported external and Orbyn links remain actionable", () => {
  for (const href of [
    "https://example.test/a",
    "http://localhost:8080/a",
    "mailto:hello@example.test",
    "orbyn://doc/0b7f6d1e-3c1a-4f7e-9d59-2f0a4b6c8e11",
  ]) {
    assert.ok(isDocLinkSafe(href));
    assert.equal(parseDocInline(`[label](${href})`)[0].link, href);
  }
});

test("literal Markdown round-trips and HTML never activates code or raw HTML", () => {
  const source =
    "``[run](javascript:run) **literal**`` and \\*literal\\* <script>bad</script>";
  const blocks = parseDoc(source);
  assert.deepEqual(parseDoc(serializeDoc(blocks)), blocks);
  const html = docToHtml("Fixture", blocks);
  assert.ok(html.includes("<code>"));
  assert.ok(!html.includes("<a ") && !html.includes("<script>"));
});

test("many unmatched delimiter lengths preserve source", () => {
  const source = Array.from(
    { length: 160 },
    (_, n) => "`".repeat(n + 1) + "a",
  ).join(" ");
  assert.equal(
    parseDocInline(source)
      .map((run) => run.text)
      .join(""),
    source,
  );
});
