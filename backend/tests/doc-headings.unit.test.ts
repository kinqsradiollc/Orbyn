import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_KINDS,
  blocksHtml,
  blockToType,
  docContent,
  docOutline,
  htmlToBlocks,
  lineWordsStart,
  parseDoc,
  sectionRange,
  serializeDoc,
  type DocBlock,
  type DocHeadingLevel,
} from "@orbyn/core";
import { docToDocx } from "../src/modules/docs/docx.js";
import { docToPdf } from "../src/modules/docs/pdf.js";
import { docxToMarkdown, readZip } from "../src/modules/imports/docx.js";

const levels = [1, 2, 3, 4, 5, 6] as const;
const headings: DocBlock[] = levels.map((level) => ({
  type: "heading",
  level,
  text: `Depth ${level}`,
}));

test("all six heading levels survive schema, Markdown and clipboard round trips", () => {
  assert.deepEqual(docContent.parse(headings), headings);
  assert.deepEqual(parseDoc(serializeDoc(headings)), headings);
  const html = levels
    .map((level) => `<h${level}>Depth ${level}</h${level}>`)
    .join("");
  assert.deepEqual(htmlToBlocks(html), headings);
  assert.deepEqual(
    BLOCK_KINDS.filter((kind) => kind.type === "heading").map(
      (kind) => kind.level,
    ),
    levels,
  );
  for (const level of levels) {
    assert.equal(lineWordsStart(`${"#".repeat(level)} words`), level + 1);
    assert.deepEqual(
      blockToType({ type: "paragraph", text: "Words" }, "heading", level),
      { type: "heading", level, text: "Words" },
    );
  }
  for (const level of [0, 7, 1.5, "6"])
    assert.equal(
      docContent.safeParse([{ type: "heading", level, text: "bad" }]).success,
      false,
    );
});

test("ATX headings obey depth, whitespace, indentation and closing-hash rules", () => {
  assert.deepEqual(parseDoc("### Title ###\n\n######\n\n   #### Deep\t##"), [
    { type: "heading", level: 3, text: "Title" },
    { type: "heading", level: 6, text: "" },
    { type: "heading", level: 4, text: "Deep" },
  ]);
  assert.deepEqual(
    parseDoc("####### Too deep\n\n###No separator\n\n    #### Indented"),
    [
      { type: "paragraph", text: "####### Too deep" },
      { type: "paragraph", text: "###No separator" },
      { type: "paragraph", text: "#### Indented" },
    ],
  );
  assert.equal((parseDoc("## Title###")[0] as any).text, "Title###");
  assert.equal((parseDoc("## Title \\###")[0] as any).text, "Title \\###");
  assert.equal((parseDoc("## ###")[0] as any).text, "");
});

test("literal closing hashes round-trip as portable numeric entities without changing escaped Markdown", () => {
  for (const text of [
    "Title ###",
    "#",
    "###",
    "Title \\###",
    "Title \\\\###",
    "Title &#35;",
    "Title &#35;&#35;",
    "Title &#38;#35;",
    "Title \\&#35;",
    "Title & ###",
    "Title &#35; ###",
  ]) {
    const block: DocBlock = { type: "heading", level: 6, text };
    assert.deepEqual(parseDoc(serializeDoc([block])), [block]);
    const anchored = { ...block, id: "bclosing" };
    assert.deepEqual(
      parseDoc(serializeDoc([anchored], { anchors: true }), { anchors: true }),
      [anchored],
    );
  }
  assert.equal((parseDoc("## Title &#35;&#35;")[0] as any).text, "Title ##");
  assert.equal((parseDoc("## Title \\&#35;")[0] as any).text, "Title \\&#35;");
});

test("Setext headings normalize to ATX without swallowing lists, quotes, rules or fences", () => {
  const read = parseDoc(
    "Title\n===\n\nSection\n---\n\n- item\n---\n\n> quote\n---\n\n```md\nTitle\n---\n```",
  );
  assert.deepEqual(read.slice(0, 2), [
    { type: "heading", level: 1, text: "Title" },
    { type: "heading", level: 2, text: "Section" },
  ]);
  assert.deepEqual(
    read.slice(2).map((block) => block.type),
    ["bullet", "divider", "quote", "divider", "code"],
  );
  assert.deepEqual(parseDoc(serializeDoc(read)), read);
});

test("tilde and indented backtick fences contain heading syntax and preserve embedded fences", () => {
  const tilde = parseDoc(
    "  ~~~~md\n  ###### Not a heading\n  ~~~\n  ```\n  ~~~~~",
  );
  assert.deepEqual(tilde, [
    { type: "code", lang: "md", text: "###### Not a heading\n~~~\n```" },
  ]);
  assert.deepEqual(parseDoc(serializeDoc(tilde)), tilde);
  const ticks = parseDoc(
    "   ````ts\n   # not a heading\n   ```\n ```\n  `````",
  );
  assert.deepEqual(ticks, [
    { type: "code", lang: "ts", text: "# not a heading\n```\n```" },
  ]);
  assert.deepEqual(parseDoc(serializeDoc(ticks)), ticks);
  assert.deepEqual(parseDoc("~~~\n## unclosed\n---"), [
    { type: "code", lang: "", text: "## unclosed\n---" },
  ]);
  const embedded: DocBlock = {
    type: "code",
    lang: "md",
    text: "before\n   ````\nafter",
  };
  assert.deepEqual(parseDoc(serializeDoc([embedded])), [embedded]);
  assert.deepEqual(parseDoc("``` js\nconst n=1;\n```"), [
    { type: "code", lang: "js", text: "const n=1;" },
  ]);
});

test("deep outline entries and sections retain their exact depth", () => {
  const blocks: DocBlock[] = [
    { type: "heading", level: 4, text: "Parent" },
    { type: "heading", level: 5, text: "Child" },
    { type: "heading", level: 6, text: "Leaf" },
    { type: "paragraph", text: "Body" },
    { type: "heading", level: 5, text: "Sibling" },
    { type: "heading", level: 4, text: "Next" },
  ];
  assert.deepEqual(
    docOutline(blocks).map((entry) => entry.level),
    [4, 5, 6, 5, 4],
  );
  assert.deepEqual(sectionRange(blocks, 1), { start: 1, end: 4 });
  assert.deepEqual(sectionRange(blocks, 0), { start: 0, end: 5 });
});

test("HTML emits real h1 through h6 tags with stable anchors and no h7", () => {
  const html = blocksHtml(headings, { anchors: true });
  for (const level of levels)
    assert.ok(
      html.includes(
        `<h${level} id="h-${level - 1}">Depth ${level}</h${level}>`,
      ),
    );
  assert.doesNotMatch(html, /<h7\b/);
});

test("Word exports define all six outline styles and import them without clamping", () => {
  const bytes = docToDocx(
    "Fixture",
    headings,
    new Date("2026-10-01T00:00:00Z"),
  );
  const zip = readZip(bytes);
  const styles = zip.get("word/styles.xml")!().toString("utf8");
  const document = zip.get("word/document.xml")!().toString("utf8");
  for (const level of levels) {
    assert.ok(styles.includes(`w:styleId="Heading${level}"`));
    assert.ok(styles.includes(`<w:outlineLvl w:val="${level - 1}"/>`));
    assert.ok(document.includes(`<w:pStyle w:val="Heading${level}"/>`));
  }
  const imported = docxToMarkdown(bytes);
  assert.deepEqual(
    parseDoc(imported.markdown)
      .filter((block) => block.type === "heading")
      .slice(1),
    headings,
  );
});

test("PDF export renders every deep heading with a defined font size", () => {
  const pdf = docToPdf("Fixture", headings).toString("latin1");
  assert.match(pdf, /^%PDF-1\.4/);
  assert.doesNotMatch(pdf, /NaN|undefined/);
  for (const level of levels) assert.ok(pdf.includes(`Depth ${level}`));
});
