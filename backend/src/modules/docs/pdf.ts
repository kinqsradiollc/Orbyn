import {
  blockText,
  listLayout,
  mathToText,
  parseDocInline,
  type DocBlock,
} from "@orbyn/core";

/**
 * A page as a PDF.
 *
 * PDF is a plain-text format with an index at the end, and the fourteen
 * fonts every reader already has mean no font has to be embedded. So this
 * writes the file directly rather than pulling in a rendering library for
 * the sake of one export — which keeps the backend at the ten dependencies
 * it has.
 *
 * What it does: A4 pages, wrapped text, headings, lists, checklists,
 * quotes, code, rules, and bold and italic inside a line. What it does not:
 * images (a page has none), colour, or typeset maths — a formula is written
 * as the symbols it reads as, the same as everywhere else outside the
 * editor.
 */

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 64;
const WIDTH = PAGE.width - MARGIN * 2;

type Font = "F1" | "F2" | "F3" | "F4";

/**
 * Widths of the fonts used, per 1000 units, for the printable ASCII range.
 *
 * These are what place each run of text, so the wrong table does not merely
 * wrap badly — the next run starts in the wrong place. Bold letters are
 * wider than regular ones, so bold needs its own table; oblique is regular
 * Helvetica slanted, so it shares one; Courier is fixed at 600.
 */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
  556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584,
];

/** How wide a string is, in points, in the font it will be drawn in. */
function widthOf(text: string, size: number, font: Font): number {
  if (font === "F4") return text.length * 0.6 * size;
  const table = font === "F2" ? HELVETICA_BOLD : HELVETICA;
  let units = 0;
  for (const ch of text) {
    const code = winAnsi(ch);
    units += code >= 32 && code <= 126 ? table[code - 32] : 556;
  }
  return (units * size) / 1000;
}

/** A run of text in one font, ready to be placed. */
type Piece = { text: string; font: Font };

/** Break pieces into lines that fit, keeping each piece's font. */
function wrap(pieces: Piece[], size: number, width: number): Piece[][] {
  const lines: Piece[][] = [];
  let line: Piece[] = [];
  let used = 0;
  for (const piece of pieces) {
    // Split on spaces but keep them, so words rejoin with their spacing.
    for (const word of piece.text.split(/(\s+)/)) {
      if (!word) continue;
      const w = widthOf(word, size, piece.font);
      if (used + w > width && line.length && word.trim()) {
        lines.push(line);
        line = [];
        used = 0;
      }
      if (!line.length && !word.trim()) continue; // no leading space
      line.push({ text: word, font: piece.font });
      used += w;
    }
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [[]];
}

/**
 * The punctuation a document actually uses that is not Latin-1.
 *
 * WinAnsi has all of it, just at its own code points — a bullet is 0x95,
 * not U+2022. Without this a list came out as a column of question marks.
 */
const WIN_ANSI: Record<string, number> = {
  "\u20ac": 0x80, // euro
  "\u201a": 0x82,
  "\u0192": 0x83,
  "\u201e": 0x84,
  "\u2026": 0x85, // ellipsis
  "\u2020": 0x86,
  "\u2021": 0x87,
  "\u02c6": 0x88,
  "\u2030": 0x89,
  "\u0160": 0x8a,
  "\u2039": 0x8b,
  "\u0152": 0x8c,
  "\u017d": 0x8e,
  "\u2018": 0x91, // curly quotes
  "\u2019": 0x92,
  "\u201c": 0x93,
  "\u201d": 0x94,
  "\u2022": 0x95, // bullet
  "\u2013": 0x96, // en dash
  "\u2014": 0x97, // em dash
  "\u02dc": 0x98,
  "\u2122": 0x99, // trademark
  "\u0161": 0x9a,
  "\u203a": 0x9b,
  "\u0153": 0x9c,
  "\u017e": 0x9e,
  "\u0178": 0x9f,
};

/** Which byte a character is in WinAnsi, or -1 when it has none. */
function winAnsi(ch: string): number {
  const mapped = WIN_ANSI[ch];
  if (mapped !== undefined) return mapped;
  const code = ch.codePointAt(0)!;
  return code <= 255 ? code : -1;
}

/** Text as PDF wants it inside parentheses. */
const pdfText = (text: string) =>
  [...text]
    .map((ch) => {
      if (ch === "\\" || ch === "(" || ch === ")") return `\\${ch}`;
      const code = winAnsi(ch);
      // A character the base fonts simply do not have becomes a question
      // mark, which is honest, rather than a byte that renders as nonsense.
      if (code < 0) return "?";
      if (code < 32) return " ";
      return code > 126 ? `\\${code.toString(8).padStart(3, "0")}` : ch;
    })
    .join("");

/** One line's styled runs, as pieces in the right font. */
function piecesFor(text: string, base: Font): Piece[] {
  return parseDocInline(text).map((run) => {
    const body = run.math ? mathToText(run.text) : run.text;
    if (run.code || run.math) return { text: body, font: "F4" as Font };
    if (run.bold) return { text: body, font: "F2" as Font };
    if (run.italic) return { text: body, font: "F3" as Font };
    return { text: body, font: base };
  });
}

type Line = {
  pieces: Piece[];
  size: number;
  font: Font;
  indent: number;
  before: number;
  after: number;
  rule?: boolean;
};

/** Lay a page's blocks out as a list of lines to draw. */
function layout(title: string, blocks: DocBlock[]): Line[] {
  const out: Line[] = [];
  const add = (
    text: string,
    o: {
      size?: number;
      font?: Font;
      indent?: number;
      before?: number;
      after?: number;
      prefix?: string;
    } = {},
  ) => {
    const size = o.size ?? 11;
    const font = o.font ?? "F1";
    const indent = o.indent ?? 0;
    const pieces = piecesFor(text, font);
    if (o.prefix) pieces.unshift({ text: o.prefix, font });
    for (const [i, line] of wrap(pieces, size, WIDTH - indent).entries())
      out.push({
        pieces: line,
        size,
        font,
        indent,
        before: i === 0 ? (o.before ?? 0) : 0,
        after: o.after ?? 4,
      });
  };

  add(title, { size: 24, font: "F2", after: 14 });
  const lists = listLayout(blocks);
  for (const [index, block] of blocks.entries()) {
    // Nested list items step in a little further for each level.
    const inset = 18 + 18 * lists[index].depth;
    switch (block.type) {
      case "heading":
        add(block.text, {
          size: [18, 15, 13][block.level - 1],
          font: "F2",
          before: 12,
          after: 5,
        });
        break;
      case "bullet":
        add(block.text, { indent: inset, prefix: "•  " });
        break;
      case "numbered":
        add(block.text, {
          indent: inset,
          prefix: `${lists[index].number ?? 1}.  `,
        });
        break;
      case "todo":
        add(block.text, {
          indent: inset,
          prefix: block.done ? "[x]  " : "[ ]  ",
        });
        break;
      case "quote":
        add(block.text, { font: "F3", indent: 22, before: 4, after: 6 });
        break;
      case "code":
        for (const line of block.text.split("\n"))
          add(line, { font: "F4", size: 9.5, indent: 14, after: 1 });
        break;
      case "math":
        add(mathToText(block.text), { font: "F4", indent: 14, before: 4 });
        break;
      case "divider":
        out.push({
          pieces: [],
          size: 11,
          font: "F1",
          indent: 0,
          before: 8,
          after: 10,
          rule: true,
        });
        break;
      default:
        add(blockText(block), { after: 7 });
    }
  }
  return out;
}

/** Run neighbouring pieces in the same font together. */
function join(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const piece of pieces) {
    const last = out[out.length - 1];
    if (last && last.font === piece.font) last.text += piece.text;
    else out.push({ ...piece });
  }
  return out;
}

/** Draw the lines onto as many pages as they need. */
function paint(lines: Line[]): string[] {
  const pages: string[] = [];
  let body: string[] = [];
  let y = PAGE.height - MARGIN;
  const finish = () => {
    if (body.length) pages.push(body.join("\n"));
    body = [];
    y = PAGE.height - MARGIN;
  };
  for (const line of lines) {
    y -= line.before;
    const height = line.size * 1.35;
    if (y - height < MARGIN) finish();
    y -= height;
    if (line.rule) {
      body.push(
        `0.8 w 0.8 G ${MARGIN} ${y.toFixed(2)} m ${(PAGE.width - MARGIN).toFixed(2)} ${y.toFixed(2)} l S 0 G`,
      );
    } else if (line.pieces.length) {
      let x = MARGIN + line.indent;
      body.push("BT");
      // Neighbouring words in the same font are drawn as one run. Placing
      // every word separately works, but it triples the file and leaves a
      // reader with nothing sensible to copy: selecting a sentence would
      // give back its words with the spaces missing.
      for (const piece of join(line.pieces)) {
        body.push(
          `/${piece.font} ${line.size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfText(piece.text)}) Tj`,
        );
        x += widthOf(piece.text, line.size, piece.font);
      }
      body.push("ET");
    }
    y -= line.after;
  }
  finish();
  return pages.length ? pages : [""];
}

export function docToPdf(title: string, blocks: DocBlock[]): Buffer {
  const pages = paint(layout(title, blocks));
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;

  // 1 catalogue, 2 page tree, 3-6 fonts, then a page and a stream each.
  const catalogue = add("<< /Type /Catalog /Pages 2 0 R >>");
  const tree = add("");
  const fonts = [
    "Helvetica",
    "Helvetica-Bold",
    "Helvetica-Oblique",
    "Courier",
  ].map((name) =>
    add(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`,
    ),
  );
  const pageIds: number[] = [];
  for (const content of pages) {
    const stream = add(
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
          `/Resources << /Font << ${fonts
            .map((id, i) => `/F${i + 1} ${id} 0 R`)
            .join(" ")} >> >> /Contents ${stream} 0 R >>`,
      ),
    );
  }
  objects[tree - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] >>`;

  let file = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(file, "latin1"));
    file += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(file, "latin1");
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    file += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogue} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(file, "latin1");
}
