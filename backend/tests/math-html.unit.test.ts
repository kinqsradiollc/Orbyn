import { test } from "node:test";
import assert from "node:assert/strict";
import katex from "katex";
import { mathHtml, createMathHtml } from "../src/lib/math-html.js";
import { docToHtml } from "@orbyn/core";

test("inline and display math produce self-contained MathML", () => {
  const inline = mathHtml("\\frac{a}{b}", false)!;
  assert.match(inline, /<math[ >]/);
  assert.match(inline, /<mfrac>/);
  assert.ok(!inline.startsWith("<div"));
  const display = mathHtml("x^2", true)!;
  assert.match(display, /^<div class="math">/);
  assert.match(display, /display="block"/);
  assert.match(display, /<msup>/);
  for (const html of [inline, display])
    assert.doesNotMatch(html, /<(?:script|link|img|iframe)\b/i);
});

for (const tex of [
  "\\href{javascript:alert(1)}{click}",
  "\\includegraphics{https://outside.test/private}",
  "\\htmlStyle{position:fixed}{overlay}",
  "\\htmlData{onclick=run}{click}",
]) {
  test(`untrusted math cannot activate ${tex.split("{")[0]}`, () => {
    const html = mathHtml(tex, false)!;
    assert.ok(html);
    assert.doesNotMatch(
      html,
      /<(?:a|script|link|img|iframe)\b|<[a-z][^>]*\bonclick\s*=|style="[^"]*position\s*:\s*fixed/i,
    );
  });
}

test("malformed math retains escaped source rather than breaking export", () => {
  const source = "\\frac{<script>bad</script>";
  const html = mathHtml(source, false)!;
  assert.match(html, /katex-error/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("source/output and recursive macro expansion are bounded", () => {
  assert.equal(mathHtml("x".repeat(16_385), false), null);
  const recursive = mathHtml("\\def\\a{\\a}\\a", false)!;
  assert.match(recursive, /katex-error/);
});

test("oversized generated markup falls back without returning it", () => {
  const render = katex.renderToString;
  try {
    katex.renderToString = () => "x".repeat(524_289);
    assert.equal(mathHtml("x", false), null);
  } finally {
    katex.renderToString = render;
  }
});

test("combined MathML output is bounded independently for each document", () => {
  const original = katex.renderToString;
  let calls = 0;
  try {
    katex.renderToString = () => {
      calls++;
      return "x".repeat(524_288);
    };
    const first = createMathHtml();
    for (let i = 0; i < 4; i++) assert.ok(first("x", false));
    assert.equal(first("x", false), null);
    assert.equal(calls, 4, "exhausted documents stop rendering");
    assert.ok(
      createMathHtml()("x", false),
      "a new document has its own budget",
    );
  } finally {
    katex.renderToString = original;
  }
});

test("combined source work is bounded independently for each document", () => {
  const original = katex.renderToString;
  let calls = 0;
  try {
    katex.renderToString = () => {
      calls++;
      return "<math></math>";
    };
    const first = createMathHtml();
    for (let i = 0; i < 8; i++) assert.ok(first("x".repeat(16_384), false));
    assert.equal(first("x", false), null);
    assert.equal(calls, 8);
    assert.ok(createMathHtml()("x", false));
  } finally {
    katex.renderToString = original;
  }
});

test("unavailable typesetting keeps exact escaped LaTeX in HTML export", () => {
  const source = "\\frac{<script>}{b}";
  const html = docToHtml(
    "Fallback",
    [
      { type: "paragraph", text: `$${source}$` },
      { type: "math", text: source },
    ],
    { math: () => null },
  );
  assert.match(html, /class="math-source"/);
  assert.match(html, /Math source \(rendering unavailable\)/);
  assert.ok(html.includes("\\frac{&lt;script&gt;}{b}"));
  assert.doesNotMatch(html, /<script>/);
});

test("macro definitions never cross expressions", () => {
  const defined = mathHtml("\\gdef\\private{x}\\private", false)!;
  assert.match(defined, /<mi>x<\/mi>/);
  const another = mathHtml("\\private", false)!;
  assert.ok(!another.includes("<mi>x</mi>"));
});
