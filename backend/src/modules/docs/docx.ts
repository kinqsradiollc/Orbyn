import {
  blockText,
  CALLOUT_LABELS,
  footnoteNumbers,
  isEmbed,
  isLiveList,
  listLayout,
  mathToText,
  parseDocInline,
  parseTable,
  type DocBlock,
  type DocInline,
} from "@orbyn/core";
import { zip } from "./zip.js";

/**
 * A page as a Word document.
 *
 * A .docx is a zip holding a little XML. Three files are the minimum Word
 * will open — the content types, the relationship pointing at the document,
 * and the document itself — and a fourth carries the heading and quote
 * styles so an exported page looks like a document rather than a wall of
 * paragraphs.
 */

const esc = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The highlighter's colours as fills (the light theme's tints). */
const TINT_FILL = { amber: "FBF1DC", green: "E7F0EA", rose: "FBEFEA" };

/**
 * The page's footnotes while it is written out: the number each marker
 * shows, which is also its id in footnotes.xml (Word's own footnotes).
 */
let notes: Map<string, number> = new Map();

/** One styled run. Word wants the styling before the text, in that order. */
function run(piece: DocInline): string {
  if (piece.footnote) {
    const n = notes.get(piece.footnote);
    if (n)
      return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${n}"/></w:r>`;
  }
  const marks: string[] = [];
  if (piece.bold) marks.push("<w:b/>");
  if (piece.italic) marks.push("<w:i/>");
  if (piece.strike) marks.push("<w:strike/>");
  if (piece.code || piece.math)
    marks.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
  if (piece.link) marks.push('<w:color w:val="1155CC"/><w:u w:val="single"/>');
  if (piece.highlight)
    marks.push(
      `<w:shd w:val="clear" w:color="auto" w:fill="${TINT_FILL[piece.tint ?? "amber"]}"/>`,
    );
  const text = esc(piece.math ? mathToText(piece.text) : piece.text);
  // xml:space keeps the spaces between words from being collapsed away.
  return `<w:r>${
    marks.length ? `<w:rPr>${marks.join("")}</w:rPr>` : ""
  }<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

const para = (style: string | null, runs: string, extra = "") =>
  `<w:p>${
    style || extra
      ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>`
      : ""
  }${runs}</w:p>`;

const runsFor = (text: string) => parseDocInline(text).map(run).join("");

/** A list paragraph's place in a numbering: which list, and how deep. */
const listPr = (numId: number, depth: number) =>
  `<w:numPr><w:ilvl w:val="${depth}"/><w:numId w:val="${numId}"/></w:numPr>`;

function blockXml(block: DocBlock, depth = 0, numId = 2): string {
  switch (block.type) {
    case "heading":
      return para(`Heading${block.level}`, runsFor(block.text));
    case "bullet":
      return para("ListParagraph", runsFor(block.text), listPr(1, depth));
    case "numbered":
      return para("ListParagraph", runsFor(block.text), listPr(numId, depth));
    case "todo":
      return para(
        "ListParagraph",
        runsFor(`${block.done ? "☑" : "☐"} ${block.text}`),
        listPr(1, depth),
      );
    case "quote":
      return para("Quote", runsFor(block.text));
    case "callout":
      return para(
        "Callout",
        run({ text: `${CALLOUT_LABELS[block.kind]}  `, start: 0, bold: true }) +
          runsFor(block.text),
      );
    case "table":
      return tableXml(block.text);
    case "image":
      return para(
        "Quote",
        run({
          text: `Picture${block.text ? `: ${block.text}` : ""}`,
          start: 0,
          italic: true,
        }),
      );
    case "file":
      return para(
        null,
        run({ text: `File: ${block.text}`, start: 0, italic: true }),
      );
    case "footnote":
      // Written as Word's own footnotes (footnotes.xml).
      return "";
    case "code":
      // A live list or an embed is settings, not something to read.
      if (isLiveList(block) || isEmbed(block)) return "";
      // Each line of a code block is its own paragraph; Word has no <pre>.
      return block.text
        .split("\n")
        .map((line) => para("Code", run({ text: line, start: 0, code: true })))
        .join("");
    case "math":
      return para("Quote", run({ text: block.text, start: 0, math: true }));
    case "divider":
      return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>`;
    default:
      return para(null, runsFor(blockText(block)));
  }
}

/** A table, its first row as the header, with thin borders. */
function tableXml(text: string): string {
  const { rows, align } = parseTable(text);
  const border = (side: string) =>
    `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>`;
  const cell = (c: string, i: number, head: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(
      null,
      head
        ? parseDocInline(c)
            .map((p) => run({ ...p, bold: true }))
            .join("")
        : runsFor(c),
      align[i]
        ? `<w:jc w:val="${align[i] === "center" ? "center" : align[i] === "right" ? "right" : "left"}"/>`
        : "",
    )}</w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${[
    "top",
    "left",
    "bottom",
    "right",
    "insideH",
    "insideV",
  ]
    .map(border)
    .join("")}</w:tblBorders></w:tblPr>${rows
    .map(
      (r, n) => `<w:tr>${r.map((c, i) => cell(c, i, n === 0)).join("")}</w:tr>`,
    )
    .join("")}</w:tbl><w:p/>`;
}

/** Word's footnotes: the two separators it needs, then the page's notes. */
function footnotesXml(blocks: DocBlock[]): string {
  const list = blocks
    .filter(
      (b): b is Extract<DocBlock, { type: "footnote" }> =>
        b.type === "footnote" && notes.has(b.label),
    )
    .sort((a, b) => notes.get(a.label)! - notes.get(b.label)!);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
${list
  .map(
    (f) =>
      `<w:footnote w:id="${notes.get(f.label)}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${runsFor(f.text)}</w:p></w:footnote>`,
  )
  .join("\n")}
</w:footnotes>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
</Relationships>`;

const style = (id: string, name: string, body: string) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${body}</w:style>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
${style("Title", "Title", '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr>')}
${style("Heading1", "heading 1", '<w:pPr><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr>')}
${style("Heading2", "heading 2", '<w:pPr><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr>')}
${style("Heading3", "heading 3", '<w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr>')}
${[4, 5, 6].map((level) => style(`Heading${level}`, `heading ${level}`, `<w:pPr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr>`)).join("")}
${style("Quote", "Quote", '<w:pPr><w:ind w:left="480"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr>')}
${style("Code", "Code", '<w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr>')}
${style("ListParagraph", "List Paragraph", '<w:pPr><w:ind w:left="720"/><w:spacing w:after="80"/></w:pPr>')}
${style("Callout", "Callout", '<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="376C51"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F3F5F2"/><w:ind w:left="240"/><w:spacing w:before="120" w:after="120"/></w:pPr>')}
${style("FootnoteText", "footnote text", '<w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr>')}
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
</w:styles>`;

/** Four levels of a list, each tucked in a step further than the last. */
const levels = (lvl: (i: number) => string) =>
  [0, 1, 2, 3]
    .map(
      (i) =>
        `<w:lvl w:ilvl="${i}">${lvl(i)}<w:pPr><w:ind w:left="${720 + 360 * i}" w:hanging="360"/></w:pPr></w:lvl>`,
    )
    .join("");

/**
 * One bulleted list and one numbered list, each four levels deep. Every
 * numbered list on the page is its own instance of the numbered one, so a
 * list after a paragraph counts from its own start rather than carrying on
 * from the list before it.
 */
const numbering = (
  numbered: { numId: number; depth: number; start: number }[],
) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0">${levels((i) => `<w:numFmt w:val="bullet"/><w:lvlText w:val="${["•", "◦", "▪", "•"][i]}"/>`)}</w:abstractNum>
<w:abstractNum w:abstractNumId="1">${levels((i) => `<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${i + 1}."/>`)}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
${numbered
  .map(
    (n) =>
      `<w:num w:numId="${n.numId}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="${n.depth}"><w:startOverride w:val="${n.start}"/></w:lvlOverride></w:num>`,
  )
  .join("\n")}
</w:numbering>`;

export function docToDocx(
  title: string,
  blocks: DocBlock[],
  at = new Date(),
): Buffer {
  const layout = listLayout(blocks);
  notes = footnoteNumbers(blocks);
  // Each numbered list gets a numbering of its own (see `numbering`).
  const numbered: { numId: number; depth: number; start: number }[] = [];
  let lists: (number | null)[] = [];
  let first = true;
  const body = blocks.map((block, i) => {
    const { depth, number } = layout[i];
    if (
      block.type !== "bullet" &&
      block.type !== "numbered" &&
      block.type !== "todo"
    ) {
      lists = [];
      return blockXml(block);
    }
    lists = lists.slice(0, depth + 1);
    while (lists.length < depth + 1) lists.push(null);
    if (block.type !== "numbered") {
      lists[depth] = null;
      return blockXml(block, depth);
    }
    if (lists[depth] === null) {
      // The first list counting from 1 uses the numbering as it stands;
      // every other list is an instance of its own, restarted.
      const start = number ?? 1;
      if (first && start === 1 && depth === 0) lists[depth] = 2;
      else {
        const numId = numbered.length + 3;
        numbered.push({ numId, depth, start });
        lists[depth] = numId;
      }
      first = false;
    }
    return blockXml(block, depth, lists[depth]!);
  });
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${para("Title", run({ text: title, start: 0 }))}
${body.join("\n")}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body>
</w:document>`;
  return zip(
    [
      { name: "[Content_Types].xml", body: CONTENT_TYPES },
      { name: "_rels/.rels", body: RELS },
      { name: "word/_rels/document.xml.rels", body: DOC_RELS },
      { name: "word/document.xml", body: document },
      { name: "word/styles.xml", body: STYLES },
      { name: "word/numbering.xml", body: numbering(numbered) },
      { name: "word/footnotes.xml", body: footnotesXml(blocks) },
    ],
    at,
  );
}
