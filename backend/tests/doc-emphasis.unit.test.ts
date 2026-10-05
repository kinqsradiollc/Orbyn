import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { parseDocInline, blocksHtml, parseDoc } from "@orbyn/core";

for (const [source, visible, bold, italic] of [
  ["_italic_", "italic", false, true],
  ["__bold__", "bold", true, false],
  ["___both___", "both", true, true],
  ["***both***", "both", true, true],
  ["**bold *italic* end**", "bold italic end", true, true],
  ["*italic **bold** end*", "italic bold end", true, true],
  ["__bold _italic_ end__", "bold italic end", true, true],
  ["_italic __bold__ end_", "italic bold end", true, true],
  ["**_both_**", "both", true, true],
  ["*__both__*", "both", true, true],
  ["a***both***b", "abothb", true, true],
  ["«_italic_»", "«italic»", false, true],
  ["😀*italic*😀", "😀italic😀", false, true],
] as const) {
  test(`emphasis delimiters: ${source}`, () => {
    const runs = parseDocInline(source);
    assert.equal(runs.map((run) => run.text).join(""), visible);
    assert.ok(
      runs.some((run) => !!run.bold === bold && !!run.italic === italic),
    );
    for (const run of runs)
      assert.equal(
        source.slice(run.start, run.start + run.text.length),
        run.text,
      );
  });
}
for (const source of [
  "snake_case_value",
  "word__bold__word",
  "foo_bar_baz",
  "_ spaced _",
  "* spaced *",
  "** spaced **",
  "___",
  "***",
  'a_"foo"_b',
]) {
  test(`nonflanking delimiters remain literal: ${source}`, () => {
    const runs = parseDocInline(source);
    assert.equal(runs.map((run) => run.text).join(""), source);
    assert.ok(!runs.some((run) => run.bold || run.italic));
  });
}

test("emphasis crosses safe links while URL and code delimiters remain literal", () => {
  const source =
    "**before [link](https://example.test/a_b*c) and `a_b*c` after**";
  const runs = parseDocInline(source);
  assert.equal(
    runs.map((run) => run.text).join(""),
    "before link and a_b*c after",
  );
  assert.ok(runs.every((run) => run.bold));
  assert.equal(
    runs.find((run) => run.link)?.link,
    "https://example.test/a_b*c",
  );
  assert.equal(runs.find((run) => run.code)?.text, "a_b*c");
});

test("crossing delimiters do not consume unrelated unmatched markers", () => {
  const html = blocksHtml(parseDoc("*foo _bar* baz_"));
  assert.equal(html, "<p><em>foo _bar</em> baz_</p>");
});

test("the rule of three prevents ambiguous intraword pairs", () => {
  const source = "**foo*bar**";
  const runs = parseDocInline(source);
  assert.equal(runs.map((run) => run.text).join(""), "foo*bar");
  assert.ok(runs.every((run) => run.bold));
  assert.ok(!runs.some((run) => run.italic));
});

test("large repeated and unmatched delimiter pages remain bounded", () => {
  for (const source of [
    "*x* ".repeat(10000),
    "a_b ".repeat(10000),
    "*x_ ".repeat(10000),
  ]) {
    const started = performance.now();
    const runs = parseDocInline(source);
    assert.ok(performance.now() - started < 2000);
    assert.ok(runs.length < 60000);
    assert.ok(
      runs.every((run) => Number.isInteger(run.start) && run.start >= 0),
    );
  }
});

test("autolinks exclude destination delimiters from surrounding emphasis", () => {
  for (const source of [
    "**a<https://foo.bar/?q=**>",
    "__a<https://foo.bar/?q=__>",
  ]) {
    const runs = parseDocInline(source);
    assert.equal(runs[0].text, source.slice(0, 3));
    assert.equal(runs[1].link, source.slice(4, -1));
    assert.ok(!runs.some((run) => run.bold || run.italic));
  }
  const mail = parseDocInline("<first_last@example.test>");
  assert.equal(mail[0].text, "first_last@example.test");
  assert.equal(mail[0].link, "mailto:first_last@example.test");
});

test("HTML and unsupported autolinks remain inert, exact source", () => {
  for (const source of [
    '*<img src="foo" title="*"/>',
    '**<a href="**">',
    '__<a href="__">',
    "<script>alert(1)</script>",
    "<!-- **literal** -->",
    "<javascript:alert(1)>",
  ]) {
    const runs = parseDocInline(source);
    assert.equal(runs.map((run) => run.text).join(""), source);
    assert.ok(!runs.some((run) => run.bold || run.italic || run.link));
    assert.ok(!blocksHtml(parseDoc(source)).includes("<script>"));
    assert.ok(!blocksHtml(parseDoc(source)).includes("<img "));
  }
});

// These are source edits, not reconstructions from rendered text: all unrelated
// delimiters, links and literal characters must survive the toggle unchanged.
test("nested style toggles remove their exact delimiters and preserve the other style", async () => {
  const { styleRange } = await import("@orbyn/core");
  for (const [source, style, expected] of [
    ["***both***", "bold", "*both*"],
    ["***both***", "italic", "**both**"],
    ["___both___", "bold", "_both_"],
    ["___both___", "italic", "__both__"],
    ["=={green}**bold**==", "bold", "=={green}bold=="],
    ["**before *inside* after**", "bold", "before *inside* after"],
    ["**before *inside* after**", "italic", "**before inside after**"],
    [
      "[**label**](https://example.test)",
      "bold",
      "[label](https://example.test)",
    ],
    ["**`code`**", "code", "**code**"],
  ] as const) {
    const word = source.includes("inside")
      ? "inside"
      : source.includes("both")
        ? "both"
        : source.includes("label")
          ? "label"
          : source.includes("code")
            ? "code"
            : "bold";
    const start = source.indexOf(word);
    const edited = styleRange(source, start, start + word.length, style);
    assert.ok(edited, source);
    assert.equal(edited.text, expected, source);
    assert.equal(edited.text.slice(edited.start, edited.end), word);
  }
});

test("adding and tinting nested styles preserves existing formatting and source", async () => {
  const { styleRange, tintRange } = await import("@orbyn/core");
  const bold = styleRange("_hello_", 1, 6, "bold");
  assert.equal(bold?.text, "_**hello**_");
  assert.ok(
    parseDocInline(bold!.text).some(
      (run) => run.bold && run.italic && run.text === "hello",
    ),
  );
  const tinted = tintRange("==**hello**==", 4, 9, "green");
  assert.equal(tinted?.text, "=={green}**hello**==");
  assert.equal(tinted!.text.slice(tinted!.start, tinted!.end), "**hello**");
  const both = parseDocInline(tinted!.text);
  assert.ok(
    both.some((run) => run.highlight && run.tint === "green" && run.bold),
  );
});
