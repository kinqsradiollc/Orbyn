import {
  blockText,
  mathToText,
  parseDocInline,
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

/** One styled run. Word wants the styling before the text, in that order. */
function run(piece: DocInline): string {
  const marks: string[] = [];
  if (piece.bold) marks.push("<w:b/>");
  if (piece.italic) marks.push("<w:i/>");
  if (piece.code || piece.math)
    marks.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
  if (piece.link) marks.push('<w:color w:val="1155CC"/><w:u w:val="single"/>');
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

function blockXml(block: DocBlock): string {
  switch (block.type) {
    case "heading":
      return para(`Heading${block.level}`, runsFor(block.text));
    case "bullet":
      return para("ListParagraph", runsFor(block.text), BULLET);
    case "numbered":
      return para("ListParagraph", runsFor(block.text), NUMBER);
    case "todo":
      return para(
        "ListParagraph",
        runsFor(`${block.done ? "☑" : "☐"} ${block.text}`),
        BULLET,
      );
    case "quote":
      return para("Quote", runsFor(block.text));
    case "code":
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

const BULLET = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
const NUMBER = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
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
${style("Quote", "Quote", '<w:pPr><w:ind w:left="480"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr>')}
${style("Code", "Code", '<w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr>')}
${style("ListParagraph", "List Paragraph", '<w:pPr><w:ind w:left="720"/><w:spacing w:after="80"/></w:pPr>')}
</w:styles>`;

/** One bulleted list and one numbered list, which is all a page needs. */
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

export function docToDocx(
  title: string,
  blocks: DocBlock[],
  at = new Date(),
): Buffer {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${para("Title", run({ text: title, start: 0 }))}
${blocks.map(blockXml).join("\n")}
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
      { name: "word/numbering.xml", body: NUMBERING },
    ],
    at,
  );
}
