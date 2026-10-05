import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { parseDocInline, blocksHtml, parseDoc, styleRange } from "@orbyn/core";

for (const [source, href, title] of [
  [
    "[label](https://example.test/a(b)c)",
    "https://example.test/a(b)c",
    undefined,
  ],
  [
    "[label](https://example.test/a(b(c)d)e)",
    "https://example.test/a(b(c)d)e",
    undefined,
  ],
  [
    "[label](<https://example.test/a(b)c>)",
    "https://example.test/a(b)c",
    undefined,
  ],
  [
    '[label](https://example.test "A title")',
    "https://example.test",
    "A title",
  ],
  [
    "[label](https://example.test 'A title')",
    "https://example.test",
    "A title",
  ],
  [
    "[label](https://example.test (A title))",
    "https://example.test",
    "A title",
  ],
  [
    '[label](\nhttps://example.test\n"A title"\n)',
    "https://example.test",
    "A title",
  ],
  [
    "[label](https://example.test/a\\(b\\)c)",
    "https://example.test/a(b)c",
    undefined,
  ],
  [
    '[label](https://example.test "A \\"title\\"")',
    "https://example.test",
    'A "title"',
  ],
] as const) {
  test(`balanced link destination/title: ${source}`, () => {
    const runs = parseDocInline(source);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].text, "label");
    assert.equal(runs[0].link, href);
    assert.equal(runs[0].linkTitle, title);
    assert.equal(runs[0].start, 1);
  });
}

test("nested label brackets, styles and code preserve their source coordinates", () => {
  const source =
    '[a [bracket] **bold** `code` end](https://example.test/a(b) "title")';
  const runs = parseDocInline(source);
  assert.equal(
    runs.map((run) => run.text).join(""),
    "a [bracket] bold code end",
  );
  assert.ok(
    runs.every(
      (run) =>
        run.link === "https://example.test/a(b)" && run.linkTitle === "title",
    ),
  );
  assert.ok(runs.some((run) => run.bold && run.text === "bold"));
  assert.ok(runs.some((run) => run.code && run.text === "code"));
  for (const run of runs)
    assert.equal(
      source.slice(run.start, run.start + run.text.length),
      run.text,
    );
  const start = source.indexOf("bold");
  assert.equal(
    styleRange(source, start, start + 4, "bold")?.text,
    '[a [bracket] bold `code` end](https://example.test/a(b) "title")',
  );
});

for (const source of [
  "[**label**](javascript:alert(1))",
  '[label](data:text/html,unsafe "title")',
  '![alt](https://example.test/image.png "title")',
  "[`code` \\*literal\\*](javascript:alert(1))",
]) {
  test(`unsupported or unsafe link remains exact inert source: ${source}`, () => {
    const runs = parseDocInline(source);
    assert.equal(runs.map((run) => run.text).join(""), source);
    assert.ok(
      !runs.some((run) => run.link || run.bold || run.italic || run.code),
    );
    assert.ok(!blocksHtml(parseDoc(source)).includes("<a "));
  });
}

test("malformed parentheses or title cannot authorize a partial destination", () => {
  for (const source of [
    "[label](https://example.test/a(b)",
    '[label](https://example.test "unclosed)',
    '[label](https://example.test "title" trailing)',
    "[label](<https://example.test/path)",
  ]) {
    assert.ok(!parseDocInline(source).some((run) => run.link), source);
    assert.equal(
      parseDocInline(source)
        .map((run) => run.text)
        .join(""),
      source,
    );
  }
});

test("HTML link titles are escaped rather than interpolated as markup", () => {
  const html = blocksHtml(
    parseDoc('[label](https://example.test "<script> & \\"title\\"")'),
  );
  assert.equal(
    html,
    '<p><a href="https://example.test" title="&lt;script&gt; &amp; &quot;title&quot;">label</a></p>',
  );
});

test("adversarial brackets and repeated rejected links remain bounded", () => {
  for (const source of [
    "[](".repeat(10000),
    "[x](javascript:alert(1)) ".repeat(5000),
    "[".repeat(30000) + "]".repeat(30000),
  ]) {
    const started = performance.now();
    const runs = parseDocInline(source);
    assert.ok(performance.now() - started < 2000);
    assert.equal(runs.map((run) => run.text).join(""), source);
  }
});

test("outer formatting cannot reinterpret rejected link or image source", () => {
  for (const source of [
    "==[**label**](javascript:alert(1))==",
    "~~![**alt**](https://example.test/image.png)~~",
  ]) {
    const runs = parseDocInline(source);
    assert.ok(!runs.some((run) => run.bold || run.link));
    assert.equal(runs.map((run) => run.text).join(""), source.slice(2, -2));
    assert.ok(runs.every((run) => run.highlight || run.strike));
  }
});

test("nested link syntax preserves only the validated inner action", () => {
  const html = blocksHtml(
    parseDoc("[outer [inner](https://example.test)](https://other.test)"),
  );
  assert.equal(
    html,
    '<p>[outer <a href="https://example.test">inner</a>](https://other.test)</p>',
  );
  assert.equal((html.match(/<a /g) ?? []).length, 1);
});
