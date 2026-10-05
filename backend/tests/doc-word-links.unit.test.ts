import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDoc, parseDocInline, docReferenceLinks } from "@orbyn/core";
import { docToDocx } from "../src/modules/docs/docx.js";
import { docxToMarkdown, readZip } from "../src/modules/imports/docx.js";
import { zip } from "../src/modules/docs/zip.js";

const archive = (source: string) =>
  readZip(docToDocx("Links", parseDoc(source)));
const xml = (files: ReturnType<typeof readZip>, path: string) =>
  files.get(path)?.().toString("utf8") ?? "";
const relationships = (target: string, extra = "") =>
  `<Relationships><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="${target}"/>${extra}</Relationships>`;
const word = (
  body: string,
  rels = relationships("https://example.test/guide"),
) =>
  zip(
    [
      {
        name: "word/document.xml",
        body: `<w:document><w:body><w:p>${body}</w:p></w:body></w:document>`,
      },
      { name: "word/_rels/document.xml.rels", body: rels },
    ],
    new Date("2026-10-06T00:00:00Z"),
  );
const textRun = (text: string, mark = "") =>
  `<w:r>${mark ? `<w:rPr>${mark}</w:rPr>` : ""}<w:t>${text}</w:t></w:r>`;
const linkRun = (
  attrs = 'r:id="rId4" w:tooltip="Guide title"',
  content = textRun("Guide"),
) => `<w:hyperlink ${attrs}>${content}</w:hyperlink>`;
const imported = (buffer: Buffer) => {
  const markdown = docxToMarkdown(buffer).markdown;
  const blocks = parseDoc(markdown);
  return {
    markdown,
    runs: blocks.flatMap((block) =>
      "text" in block
        ? parseDocInline(block.text, docReferenceLinks(blocks))
        : [],
    ),
  };
};

test("Word exports one hyperlink around nested styled label runs and escapes metadata", () => {
  const files = archive(
    '[**bold** and *italic*](https://example.test/a?x=1&y=2 "A & B")',
  );
  const document = xml(files, "word/document.xml");
  const rels = xml(files, "word/_rels/document.xml.rels");
  assert.equal((document.match(/<w:hyperlink\b/g) ?? []).length, 1);
  assert.match(document, /w:tooltip="A &amp; B"/);
  assert.match(document, /<w:b\/>/);
  assert.match(document, /<w:i\/>/);
  assert.match(
    rels,
    /Target="https:\/\/example.test\/a\?x=1&amp;y=2" TargetMode="External"/,
  );
  assert.match(
    document,
    /xmlns:r="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships"/,
  );
});

test("Word resolves reference titles, deduplicates destinations and retains table/footnote links", () => {
  const files = archive(
    '[Guide][g] and [again](https://example.test/guide "Other")[^note]\n\n[g]: https://example.test/guide "Guide title"\n\n| [Head][g] |\n| --- |\n| [Cell][g] |\n\n[^note]: [Note][g]',
  );
  const document = xml(files, "word/document.xml");
  assert.ok(!document.includes("[Guide][g]"));
  assert.match(document, /<w:hyperlink r:id="rId4" w:tooltip="Guide title">/);
  assert.match(document, /<w:hyperlink r:id="rId4" w:tooltip="Other">/);
  assert.equal(
    (
      xml(files, "word/_rels/document.xml.rels").match(
        /relationships\/hyperlink/g,
      ) ?? []
    ).length,
    1,
  );
  assert.match(
    xml(files, "word/footnotes.xml"),
    /<w:hyperlink r:id="rId4" w:tooltip="Guide title">/,
  );
  assert.match(
    xml(files, "word/_rels/footnotes.xml.rels"),
    /Target="https:\/\/example.test\/guide"/,
  );
  assert.match(document, /<w:hyperlink[^>]*><w:r><w:rPr><w:b\/>/);
});

test("Word export never creates actionable unsafe references and state cannot leak between documents", () => {
  const unsafe = archive(
    '[Bad][g]\n\n[g]: javascript:alert(1) "Secret hint"\n\n[g]: https://example.test/safe "Safe"',
  );
  assert.ok(!xml(unsafe, "word/document.xml").includes("<w:hyperlink"));
  assert.ok(
    !xml(unsafe, "word/_rels/document.xml.rels").includes(
      "relationships/hyperlink",
    ),
  );
  const first = archive("[First](https://example.test/first)");
  const second = archive("No links here.");
  assert.match(
    xml(first, "word/_rels/document.xml.rels"),
    /example.test\/first/,
  );
  assert.ok(
    !xml(second, "word/_rels/document.xml.rels").includes("example.test"),
  );
  assert.equal(second.has("word/_rels/footnotes.xml.rels"), false);
});

test("Word link archive round trip preserves destinations, titles and nested emphasis", () => {
  const source =
    '[**bold** and *italic*](https://example.test/a(b)?x=1&y=2 "A \\"quote\\" & B")';
  const result = imported(docToDocx("Links", parseDoc(source)));
  const links = result.runs.filter((run) => run.link);
  assert.ok(links.some((run) => run.bold && run.text === "bold"));
  assert.ok(links.some((run) => run.italic && run.text === "italic"));
  assert.ok(
    links.every((run) => run.link === "https://example.test/a(b)?x=1&y=2"),
  );
  assert.ok(links.every((run) => run.linkTitle === 'A "quote" & B'));
});

for (const target of [
  "javascript:alert(1)",
  "file:///private/key",
  "data:text/plain,test",
  "https://example.test/&#10;secret",
  "orbyn://doc/123",
  "/etc/passwd",
  "../template.xml",
]) {
  test(`Word import rejects unsafe target ${target}`, () => {
    const result = imported(word(linkRun(), relationships(target)));
    assert.equal(result.markdown, "Guide");
    assert.ok(result.runs.every((run) => !run.link && !run.linkTitle));
  });
}

test("Word import omits missing/wrong-type/internal-mode/duplicate relationships and their hints", () => {
  for (const rels of [
    "<Relationships/>",
    relationships("https://example.test").replace("/hyperlink", "/image"),
    relationships("https://example.test").replace('TargetMode="External"', ""),
    relationships(
      "https://example.test",
      '<Relationship Id="rId4" Type="other" Target="https://other.test"/>',
    ),
  ]) {
    const result = imported(word(linkRun(), rels));
    assert.equal(result.markdown, "Guide");
    assert.ok(result.runs.every((run) => !run.link && !run.linkTitle));
  }
});

test("Word import preserves XML-decoded titles, literal brackets and empty title distinction", () => {
  const content =
    textRun("A ] B [ C", "<w:b/>") + textRun(" and ") + textRun("D", "<w:i/>");
  const result = imported(
    word(
      linkRun('r:id="rId4" w:tooltip="A &quot;quote&quot; &amp; B"', content),
    ),
  );
  assert.equal(
    result.runs
      .filter((run) => run.bold)
      .map((run) => run.text)
      .join(""),
    "A ] B [ C",
  );
  assert.ok(result.runs.some((run) => run.italic && run.text === "D"));
  assert.ok(result.runs.every((run) => run.linkTitle === 'A "quote" & B'));
  const empty = imported(word(linkRun('r:id="rId4" w:tooltip=""')));
  assert.equal(empty.runs[0].linkTitle, "");
  const missing = imported(word(linkRun('r:id="rId4"')));
  assert.equal(missing.runs[0].linkTitle, undefined);
});

test("Word import parses single quoted relationship attributes and keeps label hard breaks", () => {
  const rels = relationships("mailto:hello@example.test").replace(/"/g, "'");
  const result = imported(
    word(
      linkRun(
        'r:id="rId4"',
        textRun("First") + "<w:r><w:br/></w:r>" + textRun("Second"),
      ),
      rels,
    ),
  );
  assert.ok(result.runs.some((run) => run.break === "hard"));
  assert.ok(
    result.runs
      .filter((run) => !run.break)
      .every((run) => run.link === "mailto:hello@example.test"),
  );
});

test("Word authorizer omission removes destinations, hints and actionable styling", () => {
  const files = readZip(
    docToDocx(
      "Private",
      parseDoc('[Hidden](https://example.test/private "Private hint")'),
      undefined,
      { linkUrl: () => undefined },
    ),
  );
  const document = xml(files, "word/document.xml");
  assert.ok(
    !document.includes("<w:hyperlink") && !document.includes("Private hint"),
  );
  assert.ok(!document.includes("<w:u "));
  assert.ok(
    !xml(files, "word/_rels/document.xml.rels").includes(
      "example.test/private",
    ),
  );
});

test("Word table import preserves formatting and asterisks in hyperlink metadata", () => {
  const source =
    '| [**Head**](https://example.test/search?q=* "A * hint") |\n| --- |\n| [Cell](https://example.test/cell "Cell hint") |';
  const result = imported(docToDocx("Links", parseDoc(source)));
  assert.ok(result.markdown.includes("https://example.test/search?q=*"));
  assert.ok(
    result.runs.some((run) => run.linkTitle === "A * hint" && run.bold),
  );
  assert.ok(
    result.runs.some((run) => run.link === "https://example.test/cell"),
  );
});

test("Word hyperlink labels keep typed Markdown punctuation literal", () => {
  const label = String.raw`A \ ] [ *not bold* $not math$`;
  const result = imported(word(linkRun('r:id="rId4"', textRun(label))));
  assert.equal(result.runs.map((run) => run.text).join(""), label);
  assert.ok(
    result.runs.every(
      (run) => !run.bold && !run.italic && !run.code && !run.math,
    ),
  );
  assert.ok(
    result.runs.every((run) => run.link === "https://example.test/guide"),
  );
});

test("Word hyperlink labels preserve generated inline OMML math rather than escaping its brackets", () => {
  const math = "<m:oMath><m:r><m:t>x[1]</m:t></m:r></m:oMath>";
  const result = imported(
    word(linkRun('r:id="rId4"', textRun("Value ") + math)),
  );
  assert.ok(result.runs.some((run) => run.math && run.text.includes("[1]")));
  assert.ok(
    result.runs
      .filter((run) => !run.break)
      .every((run) => run.link === "https://example.test/guide"),
  );
});

test("structured Word export retains ordered item ownership, quotes and continuation styles", async () => {
  const { parseDocContainers, docContainerBlocks } =
    await import("@orbyn/core");
  const nodes = parseDocContainers(
    "> 7. [x] First\n>\n>    Next paragraph\n>\n>    - Child\n>\n>      ```ts\n>      a();\n>      ```",
  );
  const blocks = docContainerBlocks(nodes);
  const files = readZip(
    docToDocx("Title", blocks, undefined, { containers: nodes }),
  );
  const body = xml(files, "word/document.xml");
  assert.match(body, /☑ First/);
  assert.match(body, /Next paragraph/);
  assert.match(body, /Child/);
  assert.match(body, /a\(\);/);
  assert.match(body, /w:pBdr/);
  assert.match(body, /w:pStyle w:val="Code"/);
  assert.match(xml(files, "word/numbering.xml"), /w:startOverride w:val="7"/);
  assert.ok(body.indexOf("First") < body.indexOf("Next paragraph"));
  assert.ok(body.indexOf("Next paragraph") < body.indexOf("Child"));
  assert.ok(body.indexOf("Child") < body.indexOf("a();"));
  assert.throws(
    () => docToDocx("Title", [], undefined, { containers: nodes }),
    /authorized leaf projection/,
  );
});
