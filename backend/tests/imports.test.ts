import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  assembleImport,
  importRefusal,
  importTypeOf,
  ocrPageToMarkdown,
  pageNeedsOcr,
  pageToMarkdown,
  sniffImportType,
  tablesToMarkdown,
  textPageToMarkdown,
} from "@orbyn/core";

process.env.FILES_SECRET ??= "test-secret-for-imports-0123456789";
const { zip } = await import("../src/modules/docs/zip.js");
const { docxToMarkdown } = await import("../src/modules/imports/docx.js");
const { readPdf, singlePage } = await import("../src/modules/imports/pdf.js");
const { uploadToken, readUploadToken, isService, serviceKey } =
  await import("../src/modules/imports/tokens.js");

test("file types come from the name, and the bytes decide", () => {
  assert.equal(importTypeOf("Week 6.PDF"), "pdf");
  assert.equal(importTypeOf("notes.docx"), "docx");
  assert.equal(importTypeOf("board.jpg"), "jpeg");
  assert.equal(importTypeOf("scan", "image/png"), "png");
  assert.equal(importTypeOf("old.doc"), null);
  assert.match(importRefusal("old.doc")!, /Save this one as \.docx or PDF/);
  assert.equal(sniffImportType(Buffer.from("%PDF-1.7")), "pdf");
  assert.equal(sniffImportType(Buffer.from([0x50, 0x4b, 3, 4])), "docx");
  assert.equal(sniffImportType(Buffer.from("hello")), null);
});

test("OCR output: page furniture goes, figures leave a note, tables stay tables", () => {
  const raw = [
    "<|ref|>header<|/ref|><|det|>[[0,0,10,10]]<|/det|>COMP3100 · Week 6",
    "<|ref|>title<|/ref|><|det|>[[0,0,10,10]]<|/det|># Consensus and Raft",
    "<|ref|>text<|/ref|><|det|>[[0,0,10,10]]<|/det|>Raft elects a leader.",
    "<|ref|>image<|/ref|><|det|>[[0,0,10,10]]<|/det|>",
    "<|ref|>image_caption<|/ref|><|det|>[[0,0,10,10]]<|/det|>Raft states",
    "<|ref|>table<|/ref|><|det|>[[0,0,10,10]]<|/det|><table><tr><td>Protocol</td><td>Leader</td></tr><tr><td>Raft</td><td>yes</td></tr></table>",
    "<|ref|>equation<|/ref|><|det|>[[0,0,10,10]]<|/det|>\\[ q = \\lfloor n/2 \\rfloor + 1 \\]",
    "<|ref|>page_number<|/ref|><|det|>[[0,0,10,10]]<|/det|>14",
  ].join("\n");
  const page = ocrPageToMarkdown(raw, 4);
  assert.equal(page.tables, 1);
  assert.equal(page.figures, 1);
  assert.doesNotMatch(page.markdown, /COMP3100|<\||^14$/m);
  assert.match(page.markdown, /Figure on page 4: “Raft states”/);
  assert.match(
    page.markdown,
    /\| Protocol \| Leader \|\n\| --- \| --- \|\n\| Raft \| yes \|/,
  );
  assert.match(page.markdown, /\$\$\nq = \\lfloor n\/2 \\rfloor \+ 1\n\$\$/);
});

test("Markdown pipe tables stay tables (EDT-02)", () => {
  const { markdown, tables } = tablesToMarkdown(
    "Before\n| Term | Meaning |\n|---|---|\n| CAP | Consistency |\n| ACID | Atomicity |\nAfter",
  );
  assert.equal(tables, 1);
  assert.equal(
    markdown,
    "Before\n\n| Term | Meaning |\n| --- | --- |\n| CAP | Consistency |\n| ACID | Atomicity |\n\nAfter",
  );
});

test("a page's own text: big lines are headings, bullets stay, wrapped lines join", () => {
  const md = textPageToMarkdown([
    { text: "Consensus and Raft", size: 24, x: 50, width: 300 },
    {
      text: "Raft splits consensus into leader election, log",
      size: 11,
      x: 50,
      width: 480,
    },
    { text: "replication and safety.", size: 11, x: 50, width: 150 },
    { text: "• Leaders send heartbeats", size: 11, x: 60, width: 200 },
    { text: "• Terms only increase", size: 11, x: 60, width: 180 },
  ]);
  assert.equal(
    md,
    "# Consensus and Raft\n\nRaft splits consensus into leader election, log replication and safety.\n\n- Leaders send heartbeats\n\n- Terms only increase",
  );
});

test("which pages need OCR", () => {
  assert.equal(pageNeedsOcr(""), true);
  assert.equal(
    pageNeedsOcr(
      "Raft elects one leader per term, and the leader replicates its log to followers.",
    ),
    false,
  );
  assert.equal(
    pageNeedsOcr(
      "∑ ∫ √ ≤ ≥ ∞ α β γ ∂ ∇ x y z = 1 + 2 ≈ 3 ± 4 → 5 ∈ S ∀ ∃ λ μ π σ",
    ),
    true,
  );
});

test("pages are assembled with a title, stepped-down headings and a source line", () => {
  const { title, content, notes } = assembleImport(
    [
      { markdown: "# Consensus and Raft\n\nIntro", ocr: false },
      {
        markdown: "# Log replication\n\n- Append entries",
        ocr: true,
        tables: 1,
      },
    ],
    "lecture06.pdf",
    { importedAt: new Date("2026-09-23T10:00:00Z") },
  );
  assert.equal(title, "Consensus and Raft");
  assert.deepEqual(content[1], {
    type: "heading",
    level: 2,
    text: "Log replication",
  });
  assert.deepEqual(notes, [
    "1 table kept as tables",
    "1 page read from an image (OCR)",
  ]);
  const last = content[content.length - 1];
  assert.equal(last.type, "paragraph");
  assert.match(
    (last as { text: string }).text,
    /^\*Imported from lecture06\.pdf · 2 pages · 23 Sept 2026 · 1 table kept as tables/,
  );
  // No heading at the top: the file's name is the title.
  assert.equal(
    assembleImport([{ markdown: "Just text" }], "week_6-notes.docx").title,
    "week 6 notes",
  );
});

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
function wordFile(body: string) {
  return zip([
    {
      name: "word/document.xml",
      body: `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    },
    {
      name: "word/styles.xml",
      body: `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
    },
    {
      name: "word/numbering.xml",
      body: `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    },
  ]);
}

test("a Word document becomes Markdown: styles, lists, bold, tables, pictures", () => {
  const p = (text: string, pPr = "", rPr = "") =>
    `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const doc = wordFile(
    p("Essay plan", '<w:pStyle w:val="Title"/>') +
      p("Background", '<w:pStyle w:val="Heading2"/>') +
      `<w:p><w:r><w:t xml:space="preserve">CAP is </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>a trade-off</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>` +
      p(
        "Consistency",
        '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>',
      ) +
      p(
        "First step",
        '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>',
      ) +
      `<w:tbl><w:tr><w:tc>${p("Term")}</w:tc><w:tc>${p("Meaning")}</w:tc></w:tr><w:tr><w:tc>${p("CAP")}</w:tc><w:tc>${p("Consistency &amp; more")}</w:tc></w:tr></w:tbl>` +
      `<w:p><w:r><w:drawing/></w:r></w:p>`,
  );
  const { markdown, tables, figures } = docxToMarkdown(doc);
  assert.equal(tables, 1);
  assert.equal(figures, 1);
  assert.equal(
    markdown,
    [
      "# Essay plan",
      "",
      "## Background",
      "",
      "CAP is **a trade-off**.",
      "",
      "- Consistency",
      "1. First step",
      "",
      "| Term | Meaning |",
      "| --- | --- |",
      "| CAP | Consistency & more |",
      "",
      "*Figure (not imported)*",
    ].join("\n"),
  );
});

test("a PDF's own text is read; a blank page is left for OCR; one page can be cut out", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText("Consensus and Raft", { x: 50, y: 780, size: 24, font });
  page.drawText("Raft elects a single leader for each term of the cluster.", {
    x: 50,
    y: 740,
    size: 11,
    font,
  });
  pdf.addPage([595, 842]);
  const data = Buffer.from(await pdf.save());
  const pages = await readPdf(data, 200);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].needsOcr, false);
  const md = pageToMarkdown(pages[0].text, 1).markdown;
  assert.match(md, /^# Consensus and Raft/);
  assert.match(md, /Raft elects a single leader/);
  assert.equal(pages[1].needsOcr, true);
  const one = await PDFDocument.load(await singlePage(data, 2));
  assert.equal(one.getPageCount(), 1);
});

test("upload links are signed, expire, and can't be altered", () => {
  const claim = {
    i: "imp",
    u: "user",
    e: Math.floor(Date.now() / 1000) + 60,
    m: 10,
    t: "pdf",
  };
  const token = uploadToken(claim);
  assert.deepEqual(readUploadToken(token), claim);
  assert.equal(readUploadToken(token, Date.now() + 120_000), null);
  const [payload, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...claim, m: 1e9 })).toString(
    "base64url",
  );
  assert.equal(readUploadToken(`${forged}.${sig}`), null);
  // A changed first character (never the one it had, which made this flaky).
  const other = sig[0] === "x" ? "y" : "x";
  assert.equal(readUploadToken(`${payload}.${other}${sig.slice(1)}`), null);
  assert.equal(isService(serviceKey()), true);
  assert.equal(isService("nope"), false);
});
