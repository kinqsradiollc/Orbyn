import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentFileType,
  cardsInBlocks,
  docToHtml,
  parseDoc,
  parseDocInline,
  serializeDoc,
  sniffFileType,
  sourcesIn,
  withoutSources,
  type DocBlock,
} from "@orbyn/core";
import { zip } from "../src/modules/docs/zip.js";
import { splitPages } from "../src/capabilities/long-docs.js";
import { sourceUrl } from "../src/capabilities/citations.js";

/**
 * H2 without a database: the source-line convention (`[src: …]`) in the
 * dialect, reading a file's type from its bytes, splitting a long page
 * into pages the apps can save, and checking a source's address.
 */

const A = { anchors: true };

test("a source marker is a run of its own and round-trips exactly", () => {
  const line = "Mitochondria make ATP. [src: Lecture 5 slides, slide 12]";
  const runs = parseDocInline(line);
  const src = runs.find((r) => r.source)!;
  assert.equal(src.text, "Lecture 5 slides, slide 12");
  // Its start points at its words in the line's source.
  assert.equal(line.slice(src.start, src.start + src.text.length), src.text);
  assert.deepEqual(sourcesIn(line), ["Lecture 5 slides, slide 12"]);
  const blocks: DocBlock[] = [
    { id: "bs1", type: "paragraph", text: line },
    {
      id: "bs2",
      type: "bullet",
      text: "Two sources [src: A] and [src: B, p. 4]",
    },
    { id: "bs3", type: "todo", text: "Check [src: notes]", done: false },
    {
      id: "bs4",
      type: "callout",
      kind: "note",
      text: "Quoted [src: Smith 2020, p. 3]",
    },
    { id: "bs5", type: "heading", level: 2, text: "Results [src: Table 2]" },
  ];
  assert.deepEqual(parseDoc(serializeDoc(blocks, A), A), blocks);
  // Without anchors (exports), the words come back the same.
  assert.deepEqual(
    parseDoc(serializeDoc(blocks)).map((b) => ("text" in b ? b.text : "")),
    blocks.map((b) => ("text" in b ? b.text : "")),
  );
});

test("what isn't a source marker stays as written", () => {
  // A link whose words start with src: is a link.
  const link = parseDocInline("[src: the paper](https://example.org/p)");
  assert.equal(link.length, 1);
  assert.equal(link[0].link, "https://example.org/p");
  assert.ok(!link[0].source);
  // Empty, inside code, and without the colon: text.
  for (const text of ["[src: ]", "`[src: code]`", "[src]", "[source: x]"])
    assert.ok(!parseDocInline(text).some((r) => r.source), text);
});

test("cards leave source markers out; exports show them small", () => {
  const cards = cardsInBlocks([
    {
      id: "c1",
      type: "paragraph",
      text: "What makes ATP? :: Mitochondria [src: Lecture 5, slide 12]",
    },
    {
      id: "c2",
      type: "bullet",
      text: "The {{Krebs}} cycle [src: p. 40]",
      depth: 0,
    },
  ]);
  assert.equal(cards[0].answer, "Mitochondria");
  assert.equal(cards[1].question, "The […] cycle");
  assert.equal(withoutSources("A  [src: x]  b"), "A b");
  const html = docToHtml("T", [
    { id: "h1", type: "paragraph", text: "Fact [src: Lecture 5]" },
  ]);
  assert.match(html, /<small class="src">\[Lecture 5\]<\/small>/);
});

test("a file's type comes from its bytes, not its name", () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2,
  ]);
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n");
  const word = zip([{ name: "word/document.xml", body: "<w:document/>" }]);
  const slides = zip([
    { name: "ppt/presentation.xml", body: "<p:presentation/>" },
  ]);
  const sheet = zip([{ name: "xl/workbook.xml", body: "<workbook/>" }]);
  assert.equal(sniffFileType(png), "image/png");
  assert.equal(sniffFileType(pdf), "application/pdf");
  assert.match(sniffFileType(word)!, /wordprocessingml/);
  assert.match(sniffFileType(slides)!, /presentationml/);
  assert.match(sniffFileType(sheet)!, /spreadsheetml/);
  assert.equal(sniffFileType(Buffer.from("plain words\n")), "text/plain");
  assert.equal(
    sniffFileType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0])),
    null,
  );
  assert.equal(sniffFileType(Buffer.from([0xff, 0xfe, 0xfd, 0x00])), null);

  assert.deepEqual(agentFileType("scan.png", png), { mime: "image/png" });
  assert.deepEqual(agentFileType("no-name", pdf), { mime: "application/pdf" });
  assert.deepEqual(agentFileType("notes.md", Buffer.from("# Hi")), {
    mime: "text/markdown",
  });
  assert.match(sniffFileType(slides)!, /presentation/);
  // A PNG named .pdf, text named .docx, a spreadsheet and junk are refused.
  const wrong = agentFileType("slides.pdf", png);
  assert.ok(
    "error" in wrong && /PNG picture, but its name says PDF/.test(wrong.error),
  );
  assert.ok("error" in agentFileType("essay.docx", Buffer.from("words")));
  const xl = agentFileType("marks.xlsx", sheet);
  assert.ok("error" in xl && /Excel sheet/.test(xl.error));
  assert.ok("error" in agentFileType("x.bin", Buffer.from([0, 1, 2, 3])));
});

test("a long page splits into pages the apps can save, at headings", () => {
  const blocks: DocBlock[] = [];
  for (let s = 0; s < 12; s++) {
    blocks.push({
      id: `h${s}`,
      type: "heading",
      level: 2,
      text: `Section ${s}`,
    });
    for (let p = 0; p < 20; p++)
      blocks.push({
        id: `p${s}_${p}`,
        type: "paragraph",
        text: `${"Words from the lecture transcript. ".repeat(20)}${p === 0 ? `[^n${s}]` : ""}`,
      });
  }
  for (let s = 0; s < 12; s++)
    blocks.push({
      id: `f${s}`,
      type: "footnote",
      label: `n${s}`,
      text: `Note ${s}`,
    });
  const pages = splitPages(blocks);
  assert.ok(pages.length > 1, `${pages.length} pages`);
  for (const p of pages)
    assert.ok(Buffer.byteLength(JSON.stringify(p)) < 60_000);
  // Nothing lost or reordered (footnotes aside), and pages start at headings.
  const flow = pages.flat().filter((b) => b.type !== "footnote");
  assert.deepEqual(
    flow.map((b) => b.id),
    blocks.filter((b) => b.type !== "footnote").map((b) => b.id),
  );
  for (const p of pages.slice(1)) assert.equal(p[0].type, "heading");
  // Each footnote sits on the page that shows its marker.
  for (const p of pages)
    for (const note of p.filter((b) => b.type === "footnote"))
      assert.ok(
        p.some(
          (b) =>
            b.type === "paragraph" &&
            b.text.includes(`[^${(note as { label: string }).label}]`),
        ),
      );
  assert.deepEqual(splitPages([]), [[]]);
});

test("a source's address is checked as https, never opened", () => {
  assert.equal(
    sourceUrl(" https://Example.org/a?b=1#part "),
    "https://example.org/a?b=1",
  );
  for (const bad of [
    "http://example.org",
    "ftp://example.org/x",
    "https://user:pw@example.org",
    "javascript:alert(1)",
    "example.org",
  ])
    assert.throws(() => sourceUrl(bad), /https/, bad);
});
