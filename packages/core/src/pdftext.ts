import { rowsToBullets } from "./imports.js";

/**
 * Reading a page from positioned text: what a PDF's own text layer gives
 * (pdf.js) and what OCR gives (Tesseract's words and boxes) both arrive as
 * spans of text with a position, a size and, for PDFs, a font. From those,
 * this rebuilds the page as Markdown:
 *
 * - lines in reading order, with two-column pages read column by column;
 * - running headers, footers and page numbers dropped (across the file);
 * - bold and italic from the font, headings from size and weight;
 * - maths: text set in maths fonts (LaTeX's CMMI/CMSY/CMEX, Word's Cambria
 *   Math, STIX…) and maths symbols become LaTeX, raised and lowered small
 *   text becomes superscripts and subscripts, and a line that is mostly
 *   maths becomes a display equation. Where the layout can't be read with
 *   confidence (stacked fractions, matrices, limits above and below), the
 *   equation is flagged to check.
 *
 * Coordinates are PDF-style: x grows to the right, y grows upwards, and y is
 * a span's baseline.
 */

export type Span = {
  text: string;
  x: number;
  y: number;
  /** Width of the text. */
  w: number;
  /** Font size (or, for OCR, the line's height). */
  size: number;
  /** The font's real name, for PDFs ("ABCDEF+CMMI10", "Arial-BoldMT"). */
  font?: string;
  bold?: boolean;
  italic?: boolean;
  /** OCR confidence, 0–100, when the text came from OCR. */
  conf?: number;
};

export type PageText = {
  width: number;
  height: number;
  spans: Span[];
  /** Pictures on the page (each becomes a placeholder line). */
  images?: number;
};

/** What reading a page found, besides its Markdown. */
export type PageResult = {
  markdown: string;
  equations: number;
  /** Tables found (each written as bullet rows). */
  tables: number;
  /** Equations whose layout was a guess. */
  checks: number;
  figures: number;
  /** Regions OCR couldn't read that look like maths, for a formula model. */
  formulaBoxes: { x: number; y: number; w: number; h: number }[];
};

// ------------------------------------------------------------- maths ---

/** Fonts that set maths: TeX's, AMS's, Word's and the common OpenType ones. */
export const MATH_FONT =
  /(^|[+-])(CM(MI|SY|EX|BSY|MIB)\d*|MSAM|MSBM|EUFM|EUSM|RSFS|ESINT|Cambria.?Math|STIX(Math|Two.?Math|General-Italic|Size)|Latin.?Modern.?Math|LM(Math|MathItalic|MathSymbols|MathExtension)|XITS.?Math|TeX.?Gyre.?\w+.?Math|Asana.?Math|Symbol(MT)?$|MT.?Extra|Euclid|Math)/i;

export const isMathFont = (font?: string) => !!font && MATH_FONT.test(font);

/** Unicode maths symbols and their LaTeX commands. */
export const LATEX_FOR: Record<string, string> = {
  α: "\\alpha",
  β: "\\beta",
  γ: "\\gamma",
  δ: "\\delta",
  ε: "\\epsilon",
  ϵ: "\\epsilon",
  ζ: "\\zeta",
  η: "\\eta",
  θ: "\\theta",
  ϑ: "\\vartheta",
  ι: "\\iota",
  κ: "\\kappa",
  λ: "\\lambda",
  μ: "\\mu",
  ν: "\\nu",
  ξ: "\\xi",
  π: "\\pi",
  ϖ: "\\varpi",
  ρ: "\\rho",
  ϱ: "\\varrho",
  σ: "\\sigma",
  ς: "\\varsigma",
  τ: "\\tau",
  υ: "\\upsilon",
  φ: "\\phi",
  ϕ: "\\phi",
  χ: "\\chi",
  ψ: "\\psi",
  ω: "\\omega",
  Γ: "\\Gamma",
  Δ: "\\Delta",
  Θ: "\\Theta",
  Λ: "\\Lambda",
  Ξ: "\\Xi",
  Π: "\\Pi",
  Σ: "\\Sigma",
  Υ: "\\Upsilon",
  Φ: "\\Phi",
  Ψ: "\\Psi",
  Ω: "\\Omega",
  "≤": "\\leq",
  "≥": "\\geq",
  "≠": "\\neq",
  "≈": "\\approx",
  "≡": "\\equiv",
  "∼": "\\sim",
  "≃": "\\simeq",
  "≅": "\\cong",
  "∝": "\\propto",
  "≪": "\\ll",
  "≫": "\\gg",
  "×": "\\times",
  "÷": "\\div",
  "±": "\\pm",
  "∓": "\\mp",
  "·": "\\cdot",
  "⋅": "\\cdot",
  "∘": "\\circ",
  "∗": "\\ast",
  "⊕": "\\oplus",
  "⊗": "\\otimes",
  "∈": "\\in",
  "∉": "\\notin",
  "∋": "\\ni",
  "⊂": "\\subset",
  "⊆": "\\subseteq",
  "⊃": "\\supset",
  "⊇": "\\supseteq",
  "∪": "\\cup",
  "∩": "\\cap",
  "∅": "\\emptyset",
  "∀": "\\forall",
  "∃": "\\exists",
  "∄": "\\nexists",
  "¬": "\\neg",
  "∧": "\\wedge",
  "∨": "\\vee",
  "→": "\\to",
  "←": "\\leftarrow",
  "↔": "\\leftrightarrow",
  "⇒": "\\Rightarrow",
  "⇐": "\\Leftarrow",
  "⇔": "\\Leftrightarrow",
  "↦": "\\mapsto",
  "⟶": "\\longrightarrow",
  "∞": "\\infty",
  "∂": "\\partial",
  "∇": "\\nabla",
  "∑": "\\sum",
  "∏": "\\prod",
  "∐": "\\coprod",
  "∫": "\\int",
  "∬": "\\iint",
  "∭": "\\iiint",
  "∮": "\\oint",
  "√": "\\sqrt",
  "′": "'",
  "″": "''",
  "…": "\\ldots",
  "⋯": "\\cdots",
  "⋮": "\\vdots",
  "⋱": "\\ddots",
  ℝ: "\\mathbb{R}",
  ℕ: "\\mathbb{N}",
  ℤ: "\\mathbb{Z}",
  ℚ: "\\mathbb{Q}",
  ℂ: "\\mathbb{C}",
  ℓ: "\\ell",
  ℏ: "\\hbar",
  ℵ: "\\aleph",
  "⟨": "\\langle",
  "⟩": "\\rangle",
  "‖": "\\|",
  "⌊": "\\lfloor",
  "⌋": "\\rfloor",
  "⌈": "\\lceil",
  "⌉": "\\rceil",
  "−": "-",
  "∣": "\\mid",
  "∥": "\\parallel",
  "⊥": "\\perp",
  "∠": "\\angle",
  "°": "^{\\circ}",
  "∴": "\\therefore",
  "∵": "\\because",
  "⊢": "\\vdash",
  "⊨": "\\models",
  "□": "\\square",
  "∎": "\\blacksquare",
  "†": "\\dagger",
  ˆ: "\\hat{}",
  "˜": "\\tilde{}",
  // Mathematical italic letters, which some PDFs keep as their own code points.
};

// Mathematical alphanumerics (𝑥, 𝒙, 𝐀, 𝔽, 𝕄…) read as the plain letter.
function plainAlnum(ch: string): string {
  const cp = ch.codePointAt(0)!;
  if (cp < 0x1d400 || cp > 0x1d7ff) return ch;
  if (cp >= 0x1d7ce) return String((cp - 0x1d7ce) % 10);
  const i = (cp - 0x1d400) % 52;
  return String.fromCharCode(i < 26 ? 65 + i : 97 + i - 26);
}

const MATH_CHAR = /[Ͱ-Ͽ∀-⋿←-⇿⟀-⟯⦀-⧿⨀-⫿℀-⅏\u{1d400}-\u{1d7ff}√∞≤≥≠±×÷∑∏∫]/u;

/** Whether a piece of text is maths by its characters alone. */
export const hasMathChar = (text: string) => MATH_CHAR.test(text);

/** Text in a maths font, as LaTeX. */
export function toLatex(text: string): string {
  let out = "";
  for (const ch of text) {
    const plain = plainAlnum(ch);
    const cmd = LATEX_FOR[plain];
    if (cmd) {
      out += cmd.startsWith("\\") && /[a-zA-Z]$/.test(cmd) ? cmd + " " : cmd;
      continue;
    }
    if ("{}".includes(plain)) out += "\\" + plain;
    else if ("#%&".includes(plain)) out += "\\" + plain;
    else if (plain === "\\") out += "\\backslash ";
    else out += plain;
  }
  return out.replace(/ +/g, " ").replace(/ ([}^_,.)\]])/g, "$1");
}

// ------------------------------------------------------------- lines ---

type Line = {
  y: number;
  /** The size most of the line is set in. */
  size: number;
  x: number;
  right: number;
  spans: Span[];
  /** A table found on the page, already written as bullet rows. */
  table?: string;
};

const plainOf = (line: Line) =>
  line.spans
    .map((s) => s.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** Spans grouped into lines, top to bottom; small raised or lowered text joins its line. */
export function linesOf(spans: Span[]): Line[] {
  const lines: Line[] = [];
  const sorted = [...spans]
    .filter((s) => s.text.length)
    .sort((a, b) => b.size - a.size || b.y - a.y);
  for (const s of sorted) {
    const line = lines.find((l) => {
      const reach = s.size < l.size * 0.85 ? l.size * 0.7 : l.size * 0.45;
      return (
        Math.abs(l.y - s.y) <= Math.max(reach, s.size * 0.45) &&
        // Two columns at the same height are two lines.
        !(s.x > l.right + l.size * 3 || s.x + s.w < l.x - l.size * 3)
      );
    });
    if (line) {
      line.spans.push(s);
      line.x = Math.min(line.x, s.x);
      line.right = Math.max(line.right, s.x + s.w);
    } else
      lines.push({
        y: s.y,
        size: s.size,
        x: s.x,
        right: s.x + s.w,
        spans: [s],
      });
  }
  for (const l of lines) l.spans.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y || a.x - b.x);
}

/**
 * Reading order: on a two-column page, the left column then the right, with
 * lines that cross the gutter (titles, full-width figures' captions) kept in
 * place between them.
 */
export function readingOrder(lines: Line[], width: number): Line[] {
  if (lines.length < 10 || !width) return lines;
  let best: { g: number; crossing: number } | null = null;
  for (let g = width * 0.3; g <= width * 0.7; g += 2) {
    const crossing = lines.filter((l) => l.x < g - 2 && l.right > g + 2).length;
    if (!best || crossing < best.crossing) best = { g, crossing };
  }
  if (!best) return lines;
  const gutter = best.g;
  const left = lines.filter((l) => l.right <= gutter + 2);
  const right = lines.filter((l) => l.x >= gutter - 2);
  if (
    best.crossing > lines.length * 0.15 ||
    left.length < 4 ||
    right.length < 4
  )
    return lines;
  const out: Line[] = [];
  let colL: Line[] = [];
  let colR: Line[] = [];
  const flush = () => {
    out.push(...colL, ...colR);
    colL = [];
    colR = [];
  };
  for (const l of lines) {
    if (l.x < gutter - 2 && l.right > gutter + 2) {
      flush();
      out.push(l);
    } else if (l.right <= gutter + 2) colL.push(l);
    else colR.push(l);
  }
  flush();
  return out;
}

const PAGE_NUMBER =
  /^(page\s*)?\d{1,4}(\s*(\/|of)\s*\d{1,4})?$|^[ivxlc]{1,6}$|^-\s*\d{1,4}\s*-$/i;
const furnitureKey = (text: string) =>
  text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

/**
 * Lines that repeat at the top or bottom of most pages (a course code, a
 * lecture title, "Page 3 of 20"): the file's running headers and footers.
 */
export function runningLines(pages: PageText[]): Set<string> {
  const counts = new Map<string, number>();
  for (const p of pages) {
    const lines = linesOf(p.spans);
    const band = (p.height || 842) * 0.1;
    const top = lines
      .filter((l) => l.y >= (p.height || 842) - band)
      .slice(0, 2);
    const bottom = lines.filter((l) => l.y <= band).slice(-2);
    const edge = new Set(
      [...top, ...bottom]
        .map((l) => furnitureKey(plainOf(l)))
        .filter((k) => k.length > 0 && k.length <= 120),
    );
    for (const k of edge) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const min = Math.max(3, Math.ceil(pages.length * 0.5));
  return new Set(
    [...counts]
      .filter(([, n]) => pages.length >= 3 && n >= min)
      .map(([k]) => k),
  );
}

/**
 * Tables in a page's own text: three or more rows at the same heights, each
 * with the same number of cells starting at the same places. Cells are
 * short (wide text columns side by side are a two-column page, not a
 * table). Each table becomes one line holding bullet rows, since pages have
 * no table block yet.
 */
export function findTables(lines: Line[], width: number): Line[] {
  // A line's cells: its spans, split wherever there is a wide gap.
  type Cell = {
    line: Line;
    x: number;
    right: number;
    text: string;
    size: number;
    y: number;
  };
  const cellsOf = (l: Line): Cell[] => {
    const out: Cell[] = [];
    for (const sp of l.spans) {
      const last = out[out.length - 1];
      if (last && sp.x - last.right <= Math.max(l.size * 1.5, 8)) {
        last.text += (sp.x - last.right > l.size * 0.18 ? " " : "") + sp.text;
        last.right = Math.max(last.right, sp.x + sp.w);
      } else
        out.push({
          line: l,
          x: sp.x,
          right: sp.x + sp.w,
          text: sp.text,
          size: l.size,
          y: l.y,
        });
    }
    return out;
  };
  const rows: Cell[][] = [];
  for (const l of [...lines].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const cells = cellsOf(l);
    const row = rows.find(
      (r) => Math.abs(r[0].y - l.y) <= Math.min(r[0].size, l.size) * 0.35,
    );
    if (row) row.push(...cells);
    else rows.push(cells);
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);
  const isRow = (r: Cell[]) =>
    r.length >= 2 &&
    r.every(
      (c) =>
        c.right - c.x < Math.max(width * 0.4, 1) &&
        c.text.trim().length > 0 &&
        c.text.trim().length <= 80,
    );
  // Text columns side by side fill their width line after line; a table's
  // cells are ragged and short.
  const looksLikeText = (rows: Cell[][]) => {
    const cols = rows[0].length;
    for (let c = 0; c < cols; c++) {
      const widths = rows.map((r) => r[c].right - r[c].x);
      const max = Math.max(...widths);
      const full = widths.filter((w) => w >= max * 0.8).length;
      const long =
        rows.reduce((n, r) => n + r[c].text.trim().length, 0) / rows.length;
      if (full >= rows.length * 0.7 && long > 20) return true;
    }
    return false;
  };
  const aligned = (a: Cell[], b: Cell[]) =>
    a.length === b.length &&
    a.every((c, i) => Math.abs(c.x - b[i].x) <= Math.max(c.size, 6) * 1.2);
  const used = new Set<Line>();
  const tables: Line[] = [];
  let i = 0;
  while (i < rows.length) {
    if (!isRow(rows[i])) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < rows.length && isRow(rows[j]) && aligned(rows[i], rows[j])) j++;
    if (j - i >= 3 && !looksLikeText(rows.slice(i, j))) {
      const cells = rows
        .slice(i, j)
        .map((r) => r.map((c) => c.text.replace(/\s+/g, " ").trim()));
      const top = rows[i][0];
      tables.push({
        y: top.y,
        size: top.size,
        x: Math.min(...rows[i].map((c) => c.x)),
        right: Math.max(...rows[i].map((c) => c.right)),
        spans: [{ text: "table", x: top.x, y: top.y, w: 1, size: top.size }],
        table: rowsToBullets(cells).join("\n"),
      });
      for (const r of rows.slice(i, j)) for (const c of r) used.add(c.line);
      i = j;
    } else i++;
  }
  if (!tables.length) return lines;
  return [...lines.filter((l) => !used.has(l)), ...tables].sort(
    (a, b) => b.y - a.y || a.x - b.x,
  );
}

// ------------------------------------------------------ one line out ---

/** The baseline and size most of a line's text sits on. */
function baseOf(line: Line) {
  const weights = new Map<number, number>();
  for (const s of line.spans) {
    const k = Math.round(s.size * 2) / 2;
    weights.set(k, (weights.get(k) ?? 0) + s.text.length);
  }
  const size = [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] ?? line.size;
  const main = line.spans.filter((s) => Math.abs(s.size - size) < 0.6);
  const y = main.length
    ? main.reduce((n, s) => n + s.y, 0) / main.length
    : line.y;
  return { size, y };
}

type Piece = { text: string; math: boolean; bold: boolean; italic: boolean };

/** Whether a span belongs to maths. */
function spanIsMath(s: Span, base: { size: number; y: number }) {
  if (isMathFont(s.font)) return true;
  if (hasMathChar(s.text)) return true;
  const shifted =
    s.size < base.size * 0.85 && Math.abs(s.y - base.y) > base.size * 0.12;
  return shifted;
}

/**
 * A line as Markdown pieces: runs of maths become LaTeX (with superscripts
 * and subscripts from raised and lowered small text), the rest keeps its
 * bold and italic.
 */
function piecesOf(line: Line): {
  pieces: Piece[];
  mathChars: number;
  chars: number;
} {
  const base = baseOf(line);
  const pieces: Piece[] = [];
  let mathChars = 0;
  let chars = 0;
  let prevEnd: number | null = null;
  for (const s of line.spans) {
    const gap = prevEnd !== null && s.x - prevEnd > base.size * 0.18 ? " " : "";
    prevEnd = s.x + s.w;
    const math = spanIsMath(s, base);
    const count = s.text.replace(/\s/g, "").length;
    chars += count;
    let text: string;
    if (math) {
      mathChars += count;
      let latex = toLatex(s.text.trim());
      if (s.size < base.size * 0.85 && s.y - base.y > base.size * 0.12)
        latex = `^{${latex}}`;
      else if (s.size < base.size * 0.85 && base.y - s.y > base.size * 0.08)
        latex = `_{${latex}}`;
      text = latex;
    } else text = s.text;
    const last = pieces[pieces.length - 1];
    // Plain operators and digits between two maths runs stay in the maths.
    if (
      last &&
      last.math &&
      !math &&
      /^[\s\d=+\-*/().,<>|[\]]+$/.test(s.text)
    ) {
      last.text += gap + s.text.trim();
      continue;
    }
    if (
      last &&
      last.math === math &&
      last.bold === !!s.bold &&
      last.italic === !!s.italic
    )
      last.text += (math && /^[\^_]/.test(text) ? "" : gap) + text;
    else
      pieces.push({
        text: (gap && pieces.length ? " " : "") + text,
        math,
        bold: !!s.bold,
        italic: !!s.italic,
      });
  }
  // A single italic letter next to maths (an x set in the text font) is maths.
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (
      !p.math &&
      p.italic &&
      /^\s*[A-Za-z]\s*$/.test(p.text) &&
      (pieces[i - 1]?.math || pieces[i + 1]?.math)
    )
      p.math = true;
  }
  return { pieces, mathChars, chars };
}

function renderPieces(pieces: Piece[]): string {
  let out = "";
  let run: string[] = [];
  const flushMath = () => {
    if (!run.length) return;
    const tex = run.join("").trim();
    if (tex) out += `$${tex}$`;
    run = [];
  };
  for (const p of pieces) {
    if (p.math) {
      const lead = /^\s/.test(p.text) && !run.length ? " " : "";
      if (lead) out += lead;
      run.push(p.text);
      continue;
    }
    flushMath();
    const lead = /^\s+/.exec(p.text)?.[0] ?? "";
    const core = p.text.trim();
    if (!core) {
      out += p.text;
      continue;
    }
    const wrap =
      p.bold && p.italic ? "***" : p.bold ? "**" : p.italic ? "*" : "";
    out += lead + wrap + core + wrap + (/\s$/.test(p.text) ? " " : "");
  }
  flushMath();
  return out
    .replace(/\*\*\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------ the whole page ---

const BULLET = /^\s*[•▪◦●○■□‣⁃–—\-*]\s+/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+/;
const SENTENCE_END = /[.!?:;"”)]$/;
const EQUATION_NUMBER = /\s*\((\d{1,3}(\.\d{1,3}){0,2}[a-z]?)\)\s*$/;

/** The size most of a page's text is set in. */
function bodySize(lines: Line[]): number {
  const bySize = new Map<number, number>();
  for (const l of lines) {
    const key = Math.round(l.size * 2) / 2;
    bySize.set(key, (bySize.get(key) ?? 0) + plainOf(l).length);
  }
  return [...bySize].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

/**
 * One page as Markdown. `running` holds the file's running headers and
 * footers (from `runningLines`), which are dropped.
 */
export function pageToMarkdown(
  page: PageText,
  pageNumber: number,
  running: Set<string> = new Set(),
): PageResult {
  const found = findTables(linesOf(page.spans), page.width);
  const tables = found.filter((l) => l.table).length;
  let lines = readingOrder(found, page.width);
  const first = lines[0];
  const last = lines[lines.length - 1];
  lines = lines.filter((l) => {
    const text = plainOf(l);
    if (!text) return false;
    if (running.has(furnitureKey(text))) return false;
    if ((l === first || l === last) && PAGE_NUMBER.test(text)) return false;
    return true;
  });
  const result: PageResult = {
    markdown: "",
    equations: 0,
    checks: 0,
    tables,
    figures: page.images ?? 0,
    formulaBoxes: [],
  };
  if (!lines.length) {
    result.markdown = figures(page.images ?? 0, pageNumber);
    return result;
  }
  const body = bodySize(lines);
  const widest = Math.max(...lines.map((l) => l.right - l.x));
  const leftEdge = Math.min(...lines.map((l) => l.x));
  const out: string[] = [];
  let paragraph: { text: string; size: number; width: number } | null = null;
  const flush = () => {
    if (paragraph) out.push(paragraph.text.trim(), "");
    paragraph = null;
  };
  let display: {
    tex: string[];
    y: number;
    size: number;
    tag: string;
    stacked: number;
    mainX: number;
  } | null = null;
  const flushDisplay = () => {
    if (!display) return;
    const tex = display.tex.join(" ").replace(/\s+/g, " ").trim();
    const check = display.stacked > 0;
    result.equations++;
    if (check) result.checks++;
    out.push(
      "$$",
      tex +
        (display.tag ? ` \\tag{${display.tag}}` : "") +
        (check ? "\n%check" : ""),
      "$$",
      "",
    );
    display = null;
  };

  for (const line of lines) {
    if (line.table !== undefined) {
      flush();
      flushDisplay();
      out.push(line.table, "");
      continue;
    }
    const plain = plainOf(line);
    // An equation's number, set apart at the right margin of its line.
    if (
      display &&
      /^\(\d{1,3}(\.\d{1,3}){0,2}[a-z]?\)$/.test(plain) &&
      Math.abs(display.y - line.y) < line.size * 0.5
    ) {
      display.tag = plain.slice(1, -1);
      continue;
    }
    const { pieces, mathChars, chars } = piecesOf(line);
    const words = plain.split(/\s+/).filter((w) => /^[A-Za-z]{4,}$/.test(w));
    const mathLine =
      chars > 0 &&
      mathChars / chars >= 0.5 &&
      words.length <= 2 &&
      pieces.some((p) => p.math);
    const lowConfidence =
      line.spans.some((s) => s.conf !== undefined) &&
      line.spans.reduce((n, s) => n + (s.conf ?? 100), 0) / line.spans.length <
        55 &&
      /[=+^_{}()\\/<>|∑∫√]/.test(plain);

    if (lowConfidence) {
      // OCR couldn't read it and it looks like maths: a formula model can.
      flush();
      flushDisplay();
      result.formulaBoxes.push({
        x: line.x,
        y: line.y,
        w: line.right - line.x,
        h: line.size * 1.4,
      });
      out.push(`%%formula ${result.formulaBoxes.length - 1}%%`, "");
      continue;
    }

    if (mathLine) {
      flush();
      let tex = pieces
        .map((p) => (p.math ? p.text : toLatex(p.text)))
        .join("")
        .trim();
      let tag = "";
      const numbered = EQUATION_NUMBER.exec(plain);
      if (numbered) {
        tag = numbered[1];
        tex = tex.replace(/\s*\(\s*\d[\d.a-z]*\s*\)\s*$/, "");
      }
      const center = (line.x + line.right) / 2;
      // A line just above or below the equation, part of the same display:
      // limits of a sum, the halves of a fraction, rows of a matrix.
      if (
        display &&
        Math.abs(display.y - line.y) < Math.max(display.size, line.size) * 2.2
      ) {
        if (line.size < display.size * 0.85) {
          const above = line.y > display.y;
          const op = /\\(sum|prod|int|lim|bigcup|bigcap)\b/.exec(
            display.tex.join(" "),
          );
          if (op) {
            display.tex = display.tex.map((t) =>
              t.replace(op[0], `${op[0]}${above ? "^" : "_"}{${tex}}`),
            );
            display.stacked++;
            continue;
          }
        }
        display.tex.push(tex);
        display.stacked++;
        display.y = line.y;
        if (tag) display.tag = tag;
        continue;
      }
      flushDisplay();
      display = {
        tex: [tex],
        y: line.y,
        size: line.size,
        tag,
        stacked: 0,
        mainX: center,
      };
      continue;
    }
    flushDisplay();

    const text = renderPieces(pieces);
    result.equations += (text.match(/\$[^$]+\$/g) ?? []).length;
    const ratio = line.size / body;
    const allBold = line.spans.every((s) => s.bold || !s.text.trim());
    const short = plain.length <= 90;
    if (
      short &&
      (ratio >= 1.12 ||
        (allBold &&
          ratio >= 0.95 &&
          plain.length <= 70 &&
          !SENTENCE_END.test(plain)))
    ) {
      flush();
      const level = ratio >= 1.6 ? 1 : ratio >= 1.3 ? 2 : 3;
      out.push(`${"#".repeat(level)} ${text.replace(/\*+/g, "")}`, "");
      continue;
    }
    if (BULLET.test(plain)) {
      flush();
      paragraph = {
        text: "- " + text.replace(BULLET, ""),
        size: line.size,
        width: line.right - line.x,
      };
      continue;
    }
    if (NUMBERED.test(plain)) {
      flush();
      paragraph = {
        text: text.replace(/^(\s*\d{1,3})\)/, "$1."),
        size: line.size,
        width: line.right - line.x,
      };
      continue;
    }
    const prev = paragraph as {
      text: string;
      size: number;
      width: number;
    } | null;
    const width = line.right - line.x;
    const indented = line.x - leftEdge > body * 1.5 && !prev;
    if (
      prev &&
      Math.abs(prev.size - line.size) < 0.6 &&
      prev.width >= widest * 0.7 &&
      !indented
    ) {
      const joined = /[a-z]-$/.test(prev.text)
        ? prev.text.slice(0, -1) + text
        : `${prev.text} ${text}`;
      paragraph = { text: joined, size: line.size, width };
      if (SENTENCE_END.test(plain) && width < widest * 0.7) flush();
      continue;
    }
    flush();
    paragraph = { text, size: line.size, width };
  }
  flush();
  flushDisplay();
  const pictures = figures(page.images ?? 0, pageNumber);
  result.markdown = [out.join("\n").trim(), pictures]
    .filter(Boolean)
    .join("\n\n");
  return result;
}

const figures = (n: number, page: number) =>
  n
    ? `*${n === 1 ? "A figure" : `${n} figures`} on page ${page} (not imported)*`
    : "";
