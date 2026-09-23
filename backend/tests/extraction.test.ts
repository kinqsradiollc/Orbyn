import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  assembleImport,
  ommlXmlToLatex,
  pageToMarkdown,
  runningLines,
  toLatex,
  type PageText,
  type Span,
} from "@orbyn/core";

const { tsvToPage, tesseractAvailable, renderPdfPage, ocrImage } =
  await import("../src/modules/imports/tesseract.js");
const { readPdf } = await import("../src/modules/imports/pdf.js");

const M = `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"`;
const r = (t: string) => `<m:r><m:t>${t}</m:t></m:r>`;

test("Word equations become exact LaTeX", () => {
  assert.equal(
    ommlXmlToLatex(
      `<m:oMath ${M}><m:f><m:num>${r("a")}</m:num><m:den>${r("b+1")}</m:den></m:f></m:oMath>`,
    ),
    "\\frac{a}{b+1}",
  );
  assert.equal(
    ommlXmlToLatex(
      `<m:oMath ${M}><m:sSup><m:e>${r("x")}</m:e><m:sup>${r("2")}</m:sup></m:sSup>${r("+")}<m:sSub><m:e>${r("y")}</m:e><m:sub>${r("i")}</m:sub></m:sSub></m:oMath>`,
    ),
    "x^{2}+y_{i}",
  );
  assert.equal(
    ommlXmlToLatex(
      `<m:oMath ${M}><m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${r("i=1")}</m:sub><m:sup>${r("n")}</m:sup><m:e>${r("i")}</m:e></m:nary></m:oMath>`,
    ),
    "\\sum_{i=1}^{n} i",
  );
  assert.equal(
    ommlXmlToLatex(
      `<m:oMath ${M}><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${r("α")}</m:e></m:rad></m:oMath>`,
    ),
    "\\sqrt{\\alpha}",
  );
  assert.equal(
    ommlXmlToLatex(
      `<m:oMath ${M}><m:d><m:e><m:m><m:mr><m:e>${r("1")}</m:e><m:e>${r("0")}</m:e></m:mr><m:mr><m:e>${r("0")}</m:e><m:e>${r("1")}</m:e></m:mr></m:m></m:e></m:d></m:oMath>`,
    ),
    "\\left( \\begin{matrix} 1 & 0 \\\\ 0 & 1 \\end{matrix} \\right)",
  );
  assert.equal(toLatex("α ≤ β"), "\\alpha \\leq \\beta ");
});

// A page from spans: y grows upwards; body text 11pt.
const span = (
  text: string,
  x: number,
  y: number,
  opts: Partial<Span> = {},
): Span => ({
  text,
  x,
  y,
  w: text.length * (opts.size ?? 11) * 0.5,
  size: 11,
  font: "Helvetica",
  ...opts,
});

test("a page's text: headings from size and bold, wrapped lines joined", () => {
  const page: PageText = {
    width: 595,
    height: 842,
    spans: [
      span("Consensus and Raft", 50, 780, {
        size: 22,
        font: "Helvetica-Bold",
        bold: true,
      }),
      span("Leader election", 50, 750, { font: "Helvetica-Bold", bold: true }),
      span("Raft splits consensus into leader election, log", 50, 730),
      span("replication and safety.", 50, 716),
    ],
  };
  assert.equal(
    pageToMarkdown(page, 1).markdown,
    "# Consensus and Raft\n\n### Leader election\n\nRaft splits consensus into leader election, log replication and safety.",
  );
});

test("maths in the text: maths fonts and superscripts become LaTeX", () => {
  const page: PageText = {
    width: 595,
    height: 842,
    spans: [
      span("The energy is ", 50, 700),
      span("E", 118, 700, { font: "CMMI10", italic: true }),
      span(" = ", 124, 700),
      span("mc", 138, 700, { font: "CMMI10", italic: true }),
      span("2", 149, 704, { font: "CMR7", size: 7 }),
      span(" in joules.", 153, 700),
    ],
  };
  const { markdown, equations } = pageToMarkdown(page, 1);
  assert.equal(equations, 1);
  assert.match(markdown, /^The energy is \$E ?= ?mc\^\{2\}\$ in joules\.$/);
});

test("a line of maths becomes a display equation, numbered with \\tag", () => {
  const page: PageText = {
    width: 595,
    height: 842,
    spans: [
      span("We have", 50, 720),
      span("∑", 250, 690, { font: "CMEX10", size: 16 }),
      span("x", 268, 690, { font: "CMMI10" }),
      span("=", 280, 690, { font: "CMR10" }),
      span("1", 292, 690, { font: "CMR10" }),
      span("(3.1)", 520, 690, { font: "CMR10" }),
      span("so the weights sum to one.", 50, 660),
    ],
  };
  const { markdown, equations, checks } = pageToMarkdown(page, 1);
  assert.equal(equations, 1);
  assert.equal(checks, 0);
  assert.match(markdown, /\$\$\n\\sum ?x ?= ?1 \\tag\{3\.1\}\n\$\$/);
});

test("two columns are read left then right; running headers are dropped", () => {
  const column = (x: number, first: number, word: string) =>
    Array.from({ length: 8 }, (_, i) =>
      span(`${word} line ${i + 1} of this column.`, x, first - i * 14, {
        w: 220,
      }),
    );
  const page = (n: number): PageText => ({
    width: 595,
    height: 842,
    spans: [
      span("COMP3100 Distributed Systems", 50, 810, { size: 9 }),
      ...column(50, 760, "Left"),
      ...column(320, 760, "Right"),
      span(String(n), 290, 30, { size: 9 }),
    ],
  });
  const pages = [page(1), page(2), page(3)];
  const running = runningLines(pages);
  const md = pageToMarkdown(pages[1], 2, running).markdown;
  assert.doesNotMatch(md, /COMP3100/);
  assert.ok(md.indexOf("Left line 8") < md.indexOf("Right line 1"));
});

test("aligned rows become a table of bullets", () => {
  const rows = [
    ["Protocol", "Leader", "Messages"],
    ["Raft", "yes", "2"],
    ["Paxos", "no", "3"],
  ];
  const page: PageText = {
    width: 595,
    height: 842,
    spans: rows.flatMap((row, i) =>
      row.map((cell, j) => span(cell, 60 + j * 150, 700 - i * 16)),
    ),
  };
  const res = pageToMarkdown(page, 1);
  assert.equal(res.tables, 1);
  assert.match(res.markdown, /- Protocol: Raft · Leader: yes · Messages: 2/);
});

test("equations whose layout was a guess are marked to check", () => {
  const { content, notes } = assembleImport(
    [{ markdown: "Intro\n\n$$\n\\frac{a}{b}\n%check\n$$", checks: 1 }],
    "maths.pdf",
  );
  const math = content.find((b) => b.type === "math");
  assert.deepEqual(math, { type: "math", text: "\\frac{a}{b}", check: true });
  assert.ok(notes.includes("1 equation may need checking"));
});

test("Tesseract's TSV becomes positioned text", () => {
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t1000\t1400\t-1\t",
    "5\t1\t1\t1\t1\t1\t100\t100\t300\t60\t96\tLecture",
    "5\t1\t1\t1\t1\t2\t420\t100\t80\t60\t95\t6",
    "5\t1\t2\t1\t1\t1\t100\t300\t200\t30\t91\tConsensus",
    "5\t1\t2\t1\t1\t2\t310\t300\t60\t30\t90\tis",
    "5\t1\t2\t1\t1\t3\t380\t300\t120\t30\t92\tagreement.",
  ].join("\n");
  const page = tsvToPage(tsv);
  assert.equal(page.width, 1000);
  assert.equal(page.spans.length, 5);
  assert.equal(
    pageToMarkdown(page, 1).markdown,
    "# Lecture 6\n\nConsensus is agreement.",
  );
});

test("a real PDF's own text: bold heading and body, read with fonts", async () => {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  page.drawText("Week 6: Consensus", { x: 50, y: 780, size: 22, font: bold });
  page.drawText("Summary", { x: 50, y: 740, size: 11, font: bold });
  page.drawText("A leader is elected for each term.", {
    x: 50,
    y: 720,
    size: 11,
    font: reg,
  });
  const [read] = await readPdf(Buffer.from(await pdf.save()), 10);
  assert.equal(read.needsOcr, false);
  assert.ok(read.text.spans.some((s) => s.bold && s.font === "Helvetica-Bold"));
  assert.equal(
    pageToMarkdown(read.text, 1).markdown,
    "# Week 6: Consensus\n\n### Summary\n\nA leader is elected for each term.",
  );
});

test(
  "a scanned page read with Tesseract (when installed)",
  { skip: !(await tesseractAvailable()) },
  async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([595, 842]);
    page.drawText("Distributed Systems", { x: 60, y: 760, size: 26, font });
    page.drawText("Consensus lets servers agree on one value.", {
      x: 60,
      y: 700,
      size: 13,
      font,
    });
    const image = await renderPdfPage(Buffer.from(await pdf.save()), 1);
    const text = await ocrImage(image);
    const md = pageToMarkdown(text, 1).markdown;
    assert.match(md, /^# Distributed Systems/);
    assert.match(md, /Consensus lets servers agree on one value\./);
  },
);
