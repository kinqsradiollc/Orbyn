import { PDFDocument } from "pdf-lib";
import { pageNeedsOcr, textPageToMarkdown, type TextLine } from "@orbyn/core";

/**
 * Reading a PDF's own text, page by page, and cutting out single pages for
 * OCR. Most lecture slides and readings are exported rather than scanned,
 * so their text is right there in the file: reading it takes well under a
 * second a page, against minutes for OCR on CPU. Only pages without real
 * text (scans, photos) or that are mostly maths go to OCR.
 */

export class PdfLocked extends Error {}
export class PdfUnreadable extends Error {}

type TextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
};

// pdf.js is large; load it once, and only in the converter.
let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;
const loadPdfjs = async () =>
  (pdfjs ??= await import("pdfjs-dist/legacy/build/pdf.mjs"));

/** A page's text items as lines, top to bottom, with their size. */
function linesOf(items: TextItem[]): TextLine[] {
  type Line = {
    y: number;
    size: number;
    parts: { x: number; str: string; w: number }[];
  };
  const lines: Line[] = [];
  for (const item of items) {
    if (!item.str) continue;
    const [, , c, d, x, y] = item.transform;
    const size = Math.hypot(c, d) || item.height || 10;
    const line = lines.find(
      (l) => Math.abs(l.y - y) <= Math.max(l.size, size) * 0.45,
    );
    if (line) {
      line.parts.push({ x, str: item.str, w: item.width });
      line.size = Math.max(line.size, size);
    } else
      lines.push({ y, size, parts: [{ x, str: item.str, w: item.width }] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      const parts = l.parts.sort((a, b) => a.x - b.x);
      let text = "";
      let end = parts[0].x;
      for (const p of parts) {
        // A visible gap between pieces is a space the PDF didn't write.
        if (
          text &&
          p.x - end > l.size * 0.2 &&
          !/\s$/.test(text) &&
          !/^\s/.test(p.str)
        )
          text += " ";
        text += p.str;
        end = p.x + p.w;
      }
      return {
        text,
        size: l.size,
        x: parts[0].x,
        width: end - parts[0].x,
      };
    });
}

export type PdfPage = {
  page: number;
  /** The page's own text as Markdown ("" when it has none). */
  markdown: string;
  needsOcr: boolean;
};

/** Every page of a PDF: its own text, and whether it needs OCR. */
export async function readPdf(
  data: Buffer,
  maxPages: number,
): Promise<PdfPage[]> {
  const { getDocument } = await loadPdfjs();
  let doc;
  try {
    doc = await getDocument({
      data: new Uint8Array(data),
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: false,
    }).promise;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "PasswordException") throw new PdfLocked("locked");
    throw new PdfUnreadable((error as Error).message);
  }
  try {
    if (doc.numPages > maxPages)
      throw new PdfUnreadable(`too many pages: ${doc.numPages}`);
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const lines = linesOf(content.items as TextItem[]);
      const plain = lines.map((l) => l.text).join("\n");
      pages.push({
        page: n,
        markdown: textPageToMarkdown(lines),
        needsOcr: pageNeedsOcr(plain),
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

/** How many pages a PDF has, without reading them. */
export async function pdfPageCount(data: Buffer): Promise<number> {
  const src = await PDFDocument.load(data, { ignoreEncryption: true });
  return src.getPageCount();
}

/** One page of a PDF as a PDF of its own, to send to OCR. */
export async function singlePage(data: Buffer, page: number): Promise<Buffer> {
  const src = await PDFDocument.load(data, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const [copy] = await out.copyPages(src, [page - 1]);
  out.addPage(copy);
  return Buffer.from(await out.save());
}
