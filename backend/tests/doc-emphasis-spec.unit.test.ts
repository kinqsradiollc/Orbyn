import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDocInline, blocksHtml, parseDoc } from "@orbyn/core";

// CommonMark 0.31.2 examples, CC BY-SA 4.0, John MacFarlane.
// https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis
// Compare visible character formatting; wrapper ordering may differ without
// changing the reader's emphasis. Raw HTML remains inert by Orbyn's D1 contract.
const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/commonmark-emphasis.json", import.meta.url),
    "utf8",
  ),
) as { example: number; markdown: string; html: string; policy?: string }[];
function expected(html: string) {
  let bold = 0,
    italic = 0;
  const out: { text: string; bold: boolean; italic: boolean }[] = [];
  const content = html.replace(/^<p>/, "").replace(/<\/p>\n$/, "");
  for (const part of content.split(/(<[^>]+>)/)) {
    if (part === "<strong>") bold++;
    else if (part === "</strong>") bold--;
    else if (part === "<em>") italic++;
    else if (part === "</em>") italic--;
    else if (part.startsWith("<")) continue;
    else
      out.push(
        ...Array.from(
          part
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&"),
        ).map((text) => ({ text, bold: !!bold, italic: !!italic })),
      );
  }
  return out;
}
for (const fixture of fixtures) {
  test(`CommonMark emphasis example ${fixture.example}${fixture.policy ? " (inert HTML contract)" : ""}`, () => {
    const paragraphs = fixture.markdown.replace(/\n$/, "").split("\n\n");
    const html = fixture.html
      .split("</p>\n<p>")
      .map(
        (part, i, all) =>
          `${i ? "<p>" : ""}${part}${i < all.length - 1 ? "</p>\n" : ""}`,
      );
    assert.equal(paragraphs.length, html.length);
    paragraphs.forEach((source, index) => {
      const runs = parseDocInline(source);
      if (fixture.policy) {
        assert.equal(runs.map((run) => run.text).join(""), source);
        assert.ok(!runs.some((run) => run.bold || run.italic || run.link));
        assert.ok(!blocksHtml(parseDoc(source)).includes("<img "));
        assert.ok(!blocksHtml(parseDoc(source)).includes("<a "));
      } else {
        const actual = runs.flatMap((run) =>
          Array.from(run.text).map((text) => ({
            text,
            bold: !!run.bold,
            italic: !!run.italic,
          })),
        );
        assert.deepEqual(actual, expected(html[index]));
      }
    });
  });
}
