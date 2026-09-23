import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { pageNeedsOcr, type PageText, type Span } from "@orbyn/core";

/**
 * Reading a PDF's own text, page by page, and cutting out single pages for
 * OCR. Most lecture slides and readings are exported rather than scanned,
 * so their text is right there in the file, with its fonts: reading it takes
 * well under a second a page, and maths set in maths fonts can be rebuilt as
 * LaTeX (see pageToMarkdown in @orbyn/core). Only pages without real text
 * (scans, photos) or with garbled text go to OCR.
 */

export class PdfLocked extends Error {}
export class PdfUnreadable extends Error {}

type TextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
};

// pdf.js is large; load it once, and only in the converter.
let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;
const loadPdfjs = async () =>
  (pdfjs ??= await import("pdfjs-dist/legacy/build/pdf.mjs"));

/** pdf.js's own copies of the 14 standard fonts, so their widths are right. */
const standardFonts = (() => {
  try {
    const require = createRequire(import.meta.url);
    return (
      join(
        dirname(require.resolve("pdfjs-dist/package.json")),
        "standard_fonts",
      ) + "/"
    );
  } catch {
    return undefined;
  }
})();

const BOLD =
  /bold|black|heavy|semibold|demibold|extrabold|-bd\b|\bbd\b|cmbx|cmb\d/i;
const ITALIC = /italic|oblique|-it\b|\bit\b|ital|cmti|cmmi|cmsl/i;

export type PdfPage = {
  page: number;
  /** Positioned text with fonts, for pageToMarkdown. */
  text: PageText;
  needsOcr: boolean;
};

/** Every page of a PDF: its text with positions and fonts, and whether it needs OCR. */
export async function readPdf(
  data: Buffer,
  maxPages: number,
): Promise<PdfPage[]> {
  const lib = await loadPdfjs();
  let doc;
  try {
    doc = await lib.getDocument({
      data: new Uint8Array(data),
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: false,
      standardFontDataUrl: standardFonts,
      verbosity: 0,
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
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      // The operator list loads the fonts (for their real names) and shows
      // which pictures the page paints.
      const ops = await page.getOperatorList();
      const pictures = new Set<string>();
      ops.fnArray.forEach((fn, i) => {
        if (fn === lib.OPS.paintImageXObject)
          pictures.add(String(ops.argsArray[i]?.[0] ?? i));
        else if (fn === lib.OPS.paintInlineImageXObject)
          pictures.add(`inline${i}`);
      });
      const fonts = new Map<
        string,
        { name: string; bold: boolean; italic: boolean }
      >();
      const fontOf = (id: string) => {
        if (!fonts.has(id)) {
          let name = "";
          let bold = false;
          let italic = false;
          try {
            const f = page.commonObjs.get(id) as {
              name?: string;
              bold?: boolean;
              italic?: boolean;
            } | null;
            name = f?.name ?? "";
            bold = !!f?.bold;
            italic = !!f?.italic;
          } catch {
            // Not loaded: fall back to what the name says.
          }
          fonts.set(id, {
            name,
            bold: bold || BOLD.test(name),
            italic: italic || ITALIC.test(name),
          });
        }
        return fonts.get(id)!;
      };
      const spans: Span[] = [];
      for (const raw of content.items as TextItem[]) {
        if (!("str" in raw) || !raw.str) continue;
        const [a, b, c, d, e, f] = lib.Util.transform(
          viewport.transform,
          raw.transform,
        );
        const size = Math.hypot(c, d) || Math.hypot(a, b) || raw.height || 10;
        const font = fontOf(raw.fontName);
        spans.push({
          text: raw.str,
          x: e,
          // Device space grows downwards; spans are kept PDF-style (upwards).
          y: viewport.height - f,
          w: raw.width,
          size,
          font: font.name,
          bold: font.bold,
          italic: font.italic,
        });
      }
      pages.push({
        page: n,
        text: {
          width: viewport.width,
          height: viewport.height,
          spans,
          images: pictures.size,
        },
        needsOcr: pageNeedsOcr(spans.map((s) => s.text).join(" ")),
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

/** One page of a PDF as a PDF of its own, to send to OCR. */
export async function singlePage(data: Buffer, page: number): Promise<Buffer> {
  const src = await PDFDocument.load(data, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const [copy] = await out.copyPages(src, [page - 1]);
  out.addPage(copy);
  return Buffer.from(await out.save());
}
