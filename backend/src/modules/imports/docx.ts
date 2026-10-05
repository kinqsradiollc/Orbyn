import { inflateRawSync } from "node:zlib";
import {
  isDocLinkSafe,
  serializeBlock,
  DOC_FOOTNOTE_MAX,
  ommlXmlToLatex,
  rowsToTable,
  type DocHeadingLevel,
} from "@orbyn/core";

/**
 * Reading a Word document (.docx) into Markdown for an Orbyn page.
 *
 * A .docx is a zip of XML files; the text is in word/document.xml, list
 * kinds in word/numbering.xml, and heading styles in word/styles.xml. Like
 * the export side (../docs/zip.ts), this reads the zip with Node's own zlib
 * rather than a library: only what a Word file uses is handled.
 *
 * Kept: headings (Title and Heading 1–6), paragraphs, bold and italic,
 * bulleted and numbered lists, quotes, and equations — Word stores their
 * structure (OMML), so they become exact LaTeX: inline as `$…$`, and an
 * equation on its own line as a math block.
 * Tables stay tables; pictures are counted and left out.
 */

export class NotAWordFile extends Error {}

/** Largest a file inside the zip may inflate to (a zip bomb guard). */
const MAX_ENTRY = 64 * 1024 * 1024;

/** The files in a zip, by name, inflated on demand. */
export function readZip(buf: Buffer): Map<string, () => Buffer> {
  const entries = new Map<string, () => Buffer>();
  // End of central directory: the last 0x06054b50 in the file.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new NotAWordFile("Not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50)
      throw new NotAWordFile("Damaged zip directory");
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    entries.set(name, () => {
      if (buf.readUInt32LE(local) !== 0x04034b50)
        throw new NotAWordFile("Damaged zip entry");
      const start =
        local +
        30 +
        buf.readUInt16LE(local + 26) +
        buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8)
        return inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
      throw new NotAWordFile("Unsupported compression");
    });
  }
  return entries;
}

const decode = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&");

const attr = (xml: string, tag: string) =>
  new RegExp(`<${tag}\\b[^>]*\\bw:val="([^"]*)"`).exec(xml)?.[1];

/** Whether a toggle like <w:b/> is on (it's off only with val 0/false). */
const on = (rPr: string, tag: string) => {
  const m = new RegExp(`<w:${tag}(\\s[^>]*)?/?>`).exec(rPr);
  if (!m) return false;
  return !/w:val="(0|false|none)"/.test(m[0]);
};

type Style = { heading?: DocHeadingLevel; quote?: boolean; code?: boolean };

/** Attribute values are decoded once; malformed or duplicate relationship IDs fail closed. */
const xmlAttr = (attributes: string, name: string): string | undefined => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"<>]*)"|'([^'<>]*)')`,
  ).exec(attributes);
  return match ? decode(match[1] ?? match[2]) : undefined;
};

/** Only local metadata is read: remote targets are never fetched during conversion. */
function readHyperlinks(xml: string): Map<string, string> {
  const links = new Map<string, string>();
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<Relationship\b([^<>]*?)\/?\s*>/g)) {
    const id = xmlAttr(match[1], "Id");
    if (!id) continue;
    if (seen.has(id)) {
      links.delete(id);
      continue;
    }
    seen.add(id);
    const target = xmlAttr(match[1], "Target");
    const type = xmlAttr(match[1], "Type");
    if (
      type ===
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" &&
      xmlAttr(match[1], "TargetMode") === "External" &&
      target &&
      isDocLinkSafe(target) &&
      /^(https?:\/\/|mailto:)/i.test(target)
    ) {
      links.set(id, target);
    }
  }
  return links;
}

/** Preserve the formatted label, a safe destination and the authored tooltip as Markdown. */
function hyperlinkMarkdown(
  label: string,
  href: string,
  title?: string,
): string {
  const destination = href.replace(/</g, "%3C").replace(/>/g, "%3E");
  const hint =
    title === undefined
      ? ""
      : ` "${title
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/[\r\n]+/g, " ")}"`;
  return `[${label}](<${destination}>${hint})`;
}

/** Paragraph styles by id: which are headings, quotes or code. */
function readStyles(xml: string): Map<string, Style> {
  const styles = new Map<string, Style>();
  for (const m of xml.matchAll(
    /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g,
  )) {
    const name = (attr(m[2], "w:name") ?? m[1]).toLowerCase();
    const level = /^heading\s*(\d)/.exec(name)?.[1];
    styles.set(m[1], {
      heading:
        name === "title"
          ? 1
          : level
            ? (Math.max(1, Math.min(Number(level), 6)) as DocHeadingLevel)
            : undefined,
      quote: /quote/.test(name),
      code: /code|preformatted|source/.test(name),
    });
  }
  return styles;
}

/** Which list ids are bullets (the rest are numbered). */
function readNumbering(xml: string): Map<string, boolean> {
  const abstractBullet = new Map<string, boolean>();
  for (const m of xml.matchAll(
    /<w:abstractNum\b[^>]*w:abstractNumId="([^"]+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g,
  ))
    abstractBullet.set(m[1], attr(m[2], "w:numFmt") === "bullet");
  const bullet = new Map<string, boolean>();
  for (const m of xml.matchAll(
    /<w:num\b[^>]*w:numId="([^"]+)"[^>]*>([\s\S]*?)<\/w:num>/g,
  ))
    bullet.set(
      m[1],
      abstractBullet.get(attr(m[2], "w:abstractNumId") ?? "") ?? true,
    );
  return bullet;
}

/** Word footnotes match references by their signed 32-bit ID; separators use type, not ID. */
function footnoteLabel(raw: string | undefined): string | undefined {
  if (!raw || raw.length > 24 || !/^[+-]?\d+$/.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isInteger(id) && id >= -2147483648 && id <= 2147483647
    ? `word-${id}`
    : undefined;
}

/** Resolve only the document's own archive part; never open a remote or filesystem target. */
function footnotePart(relationships: string): string | undefined {
  const targets: string[] = [];
  for (const match of relationships.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attrs = match[1];
    if (
      xmlAttr(attrs, "Type") !==
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"
    )
      continue;
    const target = xmlAttr(attrs, "Target");
    if (
      !target ||
      (xmlAttr(attrs, "TargetMode") ?? "Internal") !== "Internal" ||
      !/^[A-Za-z0-9_./ -]+$/.test(target)
    )
      throw new NotAWordFile("Invalid Word footnote part.");
    const url = new URL(target, "https://word.invalid/word/document.xml");
    if (url.origin !== "https://word.invalid")
      throw new NotAWordFile("Invalid Word footnote part.");
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith("/word/") || path.includes("//"))
      throw new NotAWordFile("Invalid Word footnote part.");
    targets.push(path.slice(1));
  }
  if (targets.length > 1)
    throw new NotAWordFile("Ambiguous Word footnote part.");
  return targets[0];
}

/** A paragraph's text as Markdown, with bold, italic and equations. */
function runsText(
  p: string,
  links: ReadonlyMap<string, string> = new Map(),
  insideLink = false,
): { text: string; figures: number } {
  let figures = 0;
  let out = "";
  const pieces = insideLink
    ? /<w:r\b[^>]*>([\s\S]*?)<\/w:r>|<m:oMath\b[^>]*>([\s\S]*?)<\/m:oMath>/g
    : /<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r\b[^>]*>([\s\S]*?)<\/w:r>|<m:oMath\b[^>]*>([\s\S]*?)<\/m:oMath>/g;
  for (const m of p.matchAll(pieces)) {
    if (!insideLink && m[1] !== undefined) {
      const content = runsText(m[2], links, true);
      figures += content.figures;
      const id = xmlAttr(m[1], "r:id");
      const href = id ? links.get(id) : undefined;
      out +=
        href && content.text
          ? hyperlinkMarkdown(content.text, href, xmlAttr(m[1], "w:tooltip"))
          : content.text;
      continue;
    }
    const math = insideLink ? m[2] : m[4];
    if (math !== undefined) {
      const tex = ommlXmlToLatex(m[0]);
      if (tex) out += ` $${tex}$ `;
      continue;
    }
    const run = insideLink ? m[1] : m[3];
    if (/<w:drawing\b|<w:pict\b|<w:object\b/.test(run)) figures++;
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? "";
    let text = "";
    for (const piece of run.matchAll(
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t\/>|<w:(tab|br|cr)\b[^>]*\/>|<w:footnoteReference\b([^>]*)\/>/g,
    )) {
      if (piece[3] !== undefined) {
        const label = footnoteLabel(xmlAttr(piece[3], "w:id"));
        if (!label) throw new NotAWordFile("Invalid Word footnote reference.");
        text += `[^${label}]`;
      } else {
        text +=
          piece[1] !== undefined
            ? insideLink
              ? decode(piece[1]).replace(/([\\`*_\[\]{}<>$~!|])/g, "\\$1")
              : decode(piece[1])
            : piece[2] === "tab"
              ? " "
              : piece[2]
                ? "\\\n"
                : "";
      }
    }
    if (!text) continue;
    const bold = on(rPr, "b");
    const italic = on(rPr, "i");
    const lead = /^\s*/.exec(text)![0];
    const trail = /\s*$/.exec(text)![0];
    const core = text.trim();
    if (!core) {
      out += text;
      continue;
    }
    const wrap = bold && italic ? "***" : bold ? "**" : italic ? "*" : "";
    out += lead + wrap + core + wrap + trail;
  }
  // Adjacent runs with the same styling: **a****b** → **ab**.
  out = out.replace(/\*{4}/g, "");
  return {
    text: out
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/(?:\\\n)+$/, "")
      .trim(),
    figures,
  };
}

const cellsOf = (row: string, links: ReadonlyMap<string, string>) =>
  [...row.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((tc) =>
    [...tc[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
      .map((p) => runsText(p[1], links).text)
      .filter(Boolean)
      .join(" "),
  );

/**
 * A Word document as Markdown, with how many tables it kept and how
 * many pictures were left out.
 */
export function docxToMarkdown(buf: Buffer): {
  markdown: string;
  tables: number;
  figures: number;
  equations: number;
} {
  const zip = readZip(buf);
  const document = zip.get("word/document.xml");
  if (!document) throw new NotAWordFile("No word/document.xml");
  const xml = document().toString("utf8");
  const relationships =
    zip.get("word/_rels/document.xml.rels")?.().toString("utf8") ?? "";
  const links = readHyperlinks(relationships);
  const notePath = footnotePart(relationships);
  const styles = readStyles(
    zip.get("word/styles.xml")?.().toString("utf8") ?? "",
  );
  const numbering = readNumbering(
    zip.get("word/numbering.xml")?.().toString("utf8") ?? "",
  );
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const lines: string[] = [];
  let tables = 0;
  let figures = 0;
  let equations = 0;
  let code: string[] = [];
  const flushCode = () => {
    if (code.length) lines.push("```", ...code, "```", "");
    code = [];
  };
  const blocks =
    /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  for (const [block] of body.matchAll(blocks)) {
    if (block.startsWith("<w:tbl")) {
      flushCode();
      tables++;
      const rows = [...block.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map(
        (tr) => cellsOf(tr[1], links),
      );
      lines.push("", ...rowsToTable(rows), "");
      continue;
    }
    // An equation on its own line (Word's "display" equation): a math block.
    if (/<m:oMathPara\b/.test(block)) {
      const outside = runsText(
        block.replace(/<m:oMathPara\b[\s\S]*?<\/m:oMathPara>/g, ""),
        links,
      ).text;
      if (!outside.trim()) {
        flushCode();
        for (const [math] of block.matchAll(
          /<m:oMath\b[^>]*>[\s\S]*?<\/m:oMath>/g,
        )) {
          const tex = ommlXmlToLatex(math);
          if (tex) {
            equations++;
            lines.push("$$", tex, "$$", "");
          }
        }
        continue;
      }
    }
    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(block)?.[1] ?? "";
    const style = styles.get(attr(pPr, "w:pStyle") ?? "") ?? {};
    const { text, figures: pictures } = runsText(block, links);
    equations += (text.match(/\$[^$]+\$/g) ?? []).length;
    if (pictures) {
      figures += pictures;
      if (!text) {
        flushCode();
        lines.push("*Figure (not imported)*", "");
        continue;
      }
    }
    if (style.code) {
      code.push(text.replace(/\*+/g, ""));
      continue;
    }
    flushCode();
    if (!text) continue;
    const numId = attr(pPr, "w:numId");
    if (style.heading)
      lines.push(
        `${"#".repeat(style.heading)} ${text.replace(/\*+/g, "")}`,
        "",
      );
    else if (style.quote)
      lines.push(serializeBlock({ type: "quote", text }), "");
    else if (numId && numId !== "0") {
      // Word's list level becomes the item's indentation, so nested lists
      // come in nested.
      const level = Math.min(3, Math.max(0, Number(attr(pPr, "w:ilvl")) || 0));
      lines.push(
        "    ".repeat(level) +
          (numbering.get(numId) === false ? `1. ${text}` : `- ${text}`),
      );
    } else lines.push(text, "");
  }
  flushCode();
  if (notePath) {
    const entry = zip.get(notePath);
    if (!entry) throw new NotAWordFile("Missing Word footnote part.");
    const directory = notePath.slice(0, notePath.lastIndexOf("/") + 1);
    const filename = notePath.slice(notePath.lastIndexOf("/") + 1);
    const noteLinks = readHyperlinks(
      zip.get(`${directory}_rels/${filename}.rels`)?.().toString("utf8") ?? "",
    );
    const labels = new Set<string>();
    for (const match of entry()
      .toString("utf8")
      .matchAll(/<w:footnote\b([^>]*?)(?:\/>|>([\s\S]*?)<\/w:footnote>)/g)) {
      const kind = xmlAttr(match[1], "w:type") ?? "normal";
      if (kind !== "normal") continue;
      const label = footnoteLabel(xmlAttr(match[1], "w:id"));
      if (!label || labels.has(label))
        throw new NotAWordFile(
          "Invalid or ambiguous Word footnote identifier.",
        );
      if (labels.size >= 2000)
        throw new NotAWordFile(
          "The Word document has too many footnotes to import.",
        );
      labels.add(label);
      const paragraphs = [
        ...(match[2] ?? "").matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g),
      ].map((p) => runsText(p[1], noteLinks));
      const text = paragraphs
        .map((p) => p.text || (p.figures ? "*Figure (not imported)*" : ""))
        .join("\n");
      if (text.length > DOC_FOOTNOTE_MAX)
        throw new NotAWordFile("The Word footnote is too large to import.");
      figures += paragraphs.reduce((count, p) => count + p.figures, 0);
      equations += (text.match(/\$[^$]+\$/g) ?? []).length;
      lines.push("", serializeBlock({ type: "footnote", label, text }), "");
    }
  }
  return {
    markdown: lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    tables,
    figures,
    equations,
  };
}
