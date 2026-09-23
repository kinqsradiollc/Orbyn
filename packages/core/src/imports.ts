import { z } from "zod";
import { parseDoc, type DocBlock } from "./docs.js";

/**
 * Importing a file into Docs: a lecture PDF, a Word document or a photo of
 * notes becomes an ordinary Orbyn page in the Uploads section, and the file
 * itself is deleted once it has been read.
 *
 * Everything here is pure: how a file is recognised, how each page is turned
 * into Markdown (from the PDF's own text, or from OCR), and how the pages
 * are put together into blocks. Reading the bytes and calling the OCR model
 * happen in the backend's converter.
 */

export const IMPORT_FILE_TYPES = ["pdf", "docx", "png", "jpeg"] as const;
export type ImportFileType = (typeof IMPORT_FILE_TYPES)[number];

export const IMPORT_MIME: Record<ImportFileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpeg: "image/jpeg",
};

/** What the file picker accepts, for `<input accept>` and document pickers. */
export const IMPORT_ACCEPT = [
  ".pdf",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ...Object.values(IMPORT_MIME),
].join(",");

/**
 * Limits. Import is free; these keep one person's files from filling the
 * queue, since reading a scanned page on CPU takes minutes.
 */
export const IMPORT_LIMITS = {
  maxBytes: 50 * 1024 * 1024,
  maxPages: 200,
  /** Pages of one file that may need OCR. */
  maxOcrPagesPerFile: 40,
  /** OCR pages per person per day; pages read directly don't count. */
  ocrPagesPerDay: 60,
  /**
   * Pages read with the light OCR (Tesseract) per person per day. It takes
   * seconds a page, so the limit is generous.
   */
  scanPagesPerDay: 400,
  /** Files converting at once, per person. */
  activePerUser: 2,
  /** The file store deletes anything older than this, whatever happened. */
  keepFileHours: 24,
  /** How long an upload link works. */
  uploadLinkMinutes: 10,
} as const;

export const IMPORT_STATUSES = [
  /** Waiting for the file to arrive. */
  "waiting",
  /** The file is in; waiting for the converter. */
  "queued",
  /** Reading the file's own text. */
  "reading",
  /** Scanned pages are being read by OCR. */
  "ocr",
  "ready",
  "failed",
  "cancelled",
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const IMPORT_ACTIVE: ImportStatus[] = [
  "waiting",
  "queued",
  "reading",
  "ocr",
];

export type ImportJob = {
  id: string;
  file_name: string;
  file_type: ImportFileType;
  bytes: number;
  status: ImportStatus;
  /** Pages in the file, once known. */
  pages: number | null;
  /** Pages that need OCR, and how many of those are done. */
  ocr_pages: number;
  ocr_done: number;
  /** The page it became, once ready. */
  doc_id: string | null;
  /** Why it failed, in words for the person. */
  error: string | null;
  /** What changed on the way in: tables as lists, figures left out. */
  notes: string[];
  /** Scanned pages from other files ahead of this one's next page. */
  queue_ahead: number | null;
  /** A rough wait, from measured seconds per OCR page. */
  estimate_seconds: number | null;
  created_at: string;
  finished_at: string | null;
};

/** Start an import: the file's name and size; the type is read from both. */
export const importCreateInput = z
  .object({
    file_name: z.string().trim().min(1).max(200),
    bytes: z.number().int().min(1).max(IMPORT_LIMITS.maxBytes),
    mime: z.string().max(200).optional(),
  })
  .strict();
export type ImportCreateInput = z.infer<typeof importCreateInput>;

/** The type a file claims, from its name and (when given) its MIME type. */
export function importTypeOf(
  fileName: string,
  mime?: string,
): ImportFileType | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "png") return "png";
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  const byMime = (
    Object.entries(IMPORT_MIME) as [ImportFileType, string][]
  ).find(([, m]) => m === mime?.toLowerCase())?.[0];
  return byMime ?? null;
}

/** Why a file can't be imported, in words for the person, or null. */
export function importRefusal(fileName: string, mime?: string): string | null {
  if (importTypeOf(fileName, mime)) return null;
  if (/\.(doc|pages|odt|rtf)$/i.test(fileName))
    return "Orbyn can import .docx, PDF, PNG and JPEG files. Save this one as .docx or PDF and upload it again.";
  return "Orbyn can import PDF, Word (.docx), PNG and JPEG files.";
}

/**
 * What a file really is, from its first bytes, whatever its name says. A
 * .docx is a zip; that it holds a Word document is checked when it's read.
 */
export function sniffImportType(head: Uint8Array): ImportFileType | null {
  const at = (i: number, ...bytes: number[]) =>
    bytes.every((b, n) => head[i + n] === b);
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return "pdf"; // %PDF
  if (at(0, 0x50, 0x4b, 0x03, 0x04)) return "docx"; // PK..
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  return null;
}

// ------------------------------------------------------------- tables ---

const decodeEntities = (text: string) =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const cellText = (html: string) =>
  decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

/**
 * Orbyn pages have no table block yet, so a table becomes one bullet per
 * row: "Protocol: Raft · Leader: yes". The first row is taken as the header
 * when there is more than one row.
 */
export function rowsToBullets(rows: string[][]): string[] {
  const clean = rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some(Boolean));
  if (!clean.length) return [];
  if (clean.length === 1) return [`- ${clean[0].filter(Boolean).join(" · ")}`];
  const [head, ...body] = clean;
  return body.map(
    (row) =>
      "- " +
      row
        .map((cell, i) => (cell && head[i] ? `${head[i]}: ${cell}` : cell))
        .filter(Boolean)
        .join(" · "),
  );
}

/** HTML tables (what the OCR model writes) as rows of cell text. */
function htmlTableRows(html: string): string[][] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) =>
    [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) =>
      cellText(td[1]),
    ),
  );
}

/**
 * Tables in Markdown, as bullets, counting how many there were. Handles the
 * OCR model's HTML tables and Markdown pipe tables.
 */
export function tablesToBullets(markdown: string): {
  markdown: string;
  tables: number;
} {
  let tables = 0;
  let out = markdown.replace(/<table[\s\S]*?<\/table>/gi, (html) => {
    tables++;
    return "\n" + rowsToBullets(htmlTableRows(html)).join("\n") + "\n";
  });
  const lines = out.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i])) {
      kept.push(lines[i]);
      continue;
    }
    const rows: string[][] = [];
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
      const cells = lines[i].trim().slice(1, -1).split("|");
      if (!cells.every((c) => /^\s*:?-{2,}:?\s*$/.test(c)))
        rows.push(cells.map((c) => c.trim()));
      i++;
    }
    i--;
    tables++;
    kept.push(...rowsToBullets(rows));
  }
  out = kept.join("\n");
  return { markdown: out, tables };
}

// ----------------------------------------------------------------- OCR ---

/** Region labels the OCR model gives that are page furniture, not content. */
const FURNITURE =
  /^(header|footer|page[_ ]?header|page[_ ]?footer|page[_ ]?number|page[_ ]?num)$/i;
const FIGURE = /^(image|figure|picture|chart|photo|graphic)$/i;
const CAPTION = /caption$/i;

type Region = { label: string; body: string };

/**
 * Split OCR output into labelled regions. The model marks each region as
 * `<|ref|>label<|/ref|><|det|>[[x1,y1,x2,y2]]<|/det|>` or
 * `<|det|>label [x1,y1,x2,y2]<|/det|>`, followed by its text. Output with
 * no markers is a single text region.
 */
export function ocrRegions(raw: string): Region[] {
  const marker =
    /<\|ref\|>([\s\S]*?)<\|\/ref\|>\s*(?:<\|det\|>[\s\S]*?<\|\/det\|>)?|<\|det\|>\s*([A-Za-z_ ]*?)\s*\[[\s\S]*?<\|\/det\|>/g;
  const regions: Region[] = [];
  let label = "text";
  let last = 0;
  for (const m of raw.matchAll(marker)) {
    regions.push({ label, body: raw.slice(last, m.index) });
    label = (m[1] ?? m[2] ?? "text").trim() || "text";
    last = m.index! + m[0].length;
  }
  regions.push({ label, body: raw.slice(last) });
  return regions
    .map((r) => ({ label: r.label, body: r.body.replace(/<\|[^|]*\|>/g, "") }))
    .filter((r) => r.body.trim() || FIGURE.test(r.label));
}

/** One page of OCR output as clean Markdown for `parseDoc`. */
export function ocrPageToMarkdown(
  raw: string,
  page: number,
): { markdown: string; tables: number; figures: number } {
  let figures = 0;
  const parts: string[] = [];
  const regions = ocrRegions(raw);
  for (let n = 0; n < regions.length; n++) {
    const { label, body } = regions[n];
    if (FURNITURE.test(label)) continue;
    if (FIGURE.test(label)) {
      figures++;
      const next = regions[n + 1];
      const caption = next && CAPTION.test(next.label) ? next.body.trim() : "";
      if (caption) n++;
      parts.push(figureLine(page, caption));
      continue;
    }
    parts.push(body.trim());
  }
  let markdown = parts.join("\n\n");
  // Images the model wrote as Markdown.
  markdown = markdown.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => {
    figures++;
    return figureLine(page, alt.trim());
  });
  const tabled = tablesToBullets(markdown);
  return {
    markdown: normaliseMath(tabled.markdown),
    tables: tabled.tables,
    figures,
  };
}

const figureLine = (page: number, caption: string) =>
  `*Figure on page ${page}${caption ? `: “${caption.replace(/\s+/g, " ")}”` : ""} (not imported)*`;

/** `\[…\]` and `\(…\)` as the `$$…$$` and `$…$` our pages use. */
export function normaliseMath(markdown: string): string {
  return markdown
    .replace(
      /\\\[([\s\S]*?)\\\]/g,
      (_m, tex: string) => `\n$$\n${tex.trim()}\n$$\n`,
    )
    .replace(/\\\((.+?)\\\)/g, (_m, tex: string) => `$${tex.trim()}$`);
}

// ---------------------------------------------------------- text layer ---

/** A line of a PDF page's own text, with its size and where it sits. */
export type TextLine = {
  text: string;
  /** Font size in points. */
  size: number;
  x: number;
  width: number;
  bold?: boolean;
};

const BULLET = /^\s*[•▪◦●○■□‣⁃–—\-*]\s+/;
const NUMBERED = /^\s*(\d{1,3}|[a-z])[.)]\s+/i;
const SENTENCE_END = /[.!?:;"”)]$/;

/** The size most of a page's text is set in. */
function bodySize(lines: TextLine[]): number {
  const bySize = new Map<number, number>();
  for (const l of lines) {
    const key = Math.round(l.size * 2) / 2;
    bySize.set(key, (bySize.get(key) ?? 0) + l.text.length);
  }
  let best = 0;
  let most = -1;
  for (const [size, chars] of bySize)
    if (chars > most) {
      best = size;
      most = chars;
    }
  return best || 10;
}

/**
 * A page's own text as Markdown: bigger text becomes headings, bullet
 * characters become bullets, and wrapped lines are joined back into their
 * paragraph.
 */
export function textPageToMarkdown(lines: TextLine[]): string {
  const clean = lines.filter((l) => l.text.trim());
  if (!clean.length) return "";
  const body = bodySize(clean);
  const widest = Math.max(...clean.map((l) => l.width));
  const out: string[] = [];
  let paragraph: TextLine | null = null;
  const flush = () => {
    if (paragraph) out.push(paragraph.text.trim(), "");
    paragraph = null;
  };
  for (const line of clean) {
    const text = line.text.replace(/\s+/g, " ").trim();
    const ratio = line.size / body;
    const short = text.length <= 90;
    if (
      short &&
      (ratio >= 1.12 ||
        (line.bold &&
          ratio >= 1 &&
          text.length <= 60 &&
          !SENTENCE_END.test(text)))
    ) {
      flush();
      const level = ratio >= 1.6 ? 1 : ratio >= 1.3 ? 2 : 3;
      out.push(`${"#".repeat(level)} ${text}`, "");
      continue;
    }
    if (BULLET.test(text)) {
      flush();
      paragraph = { ...line, text: "- " + text.replace(BULLET, "") };
      continue;
    }
    if (NUMBERED.test(text) && /^\s*\d/.test(text)) {
      flush();
      paragraph = { ...line, text: text.replace(/^(\s*\d{1,3})\)/, "$1.") };
      continue;
    }
    // A wrapped line carries on the paragraph above it: same size, and the
    // line before ran most of the way across the page.
    const prev = paragraph as TextLine | null;
    if (
      prev &&
      Math.abs(prev.size - line.size) < 0.6 &&
      prev.width >= widest * 0.7 &&
      !SENTENCE_END.test(prev.text.trim())
    ) {
      const joined = prev.text.endsWith("-")
        ? prev.text.slice(0, -1) + text
        : `${prev.text} ${text}`;
      paragraph = { ...line, text: joined, width: line.width };
      continue;
    }
    if (
      prev &&
      Math.abs(prev.size - line.size) < 0.6 &&
      prev.width >= widest * 0.7
    ) {
      paragraph = { ...line, text: `${prev.text} ${text}` };
      continue;
    }
    flush();
    paragraph = { ...line, text };
  }
  flush();
  return out.join("\n").trim();
}

/**
 * Whether a PDF page has to be read from an image (OCR): it has no real text
 * (a scan or a photo), or its text is garbled (a font without a proper
 * mapping to characters). Pages of maths with real text are read from their
 * fonts instead (pdftext.ts), which is better than OCR at maths.
 */
export function pageNeedsOcr(text: string): boolean {
  const t = text.replace(/\s+/g, "");
  if (t.length < 30) return true;
  const broken = (t.match(/[\uFFFD\uE000-\uF8FF]/g) ?? []).length;
  if (broken / t.length > 0.05) return true;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  const maths = (
    t.match(/[\u2200-\u22ff\u0370-\u03ff\u{1d400}-\u{1d7ff}]/gu) ?? []
  ).length;
  return (letters - maths) / Math.max(1, t.length - maths) < 0.25;
}

// ------------------------------------------------------------ assemble ---

const MAX_BLOCKS = 1990;
const LIMIT: Partial<Record<DocBlock["type"], number>> = {
  heading: 2000,
  paragraph: 10000,
  bullet: 4000,
  numbered: 4000,
  todo: 4000,
  quote: 4000,
  code: 20000,
  math: 4000,
};

export type ImportedPage = {
  markdown: string;
  /** Read with OCR rather than from the file's own text. */
  ocr?: boolean;
  tables?: number;
  figures?: number;
  /** Equations found, and how many of them to check. */
  equations?: number;
  checks?: number;
};

/** The notes shown under an imported page's title, in plain words. */
export function importNotes(pages: ImportedPage[], extra: string[] = []) {
  const tables = pages.reduce((n, p) => n + (p.tables ?? 0), 0);
  const figures = pages.reduce((n, p) => n + (p.figures ?? 0), 0);
  const ocr = pages.filter((p) => p.ocr).length;
  const notes: string[] = [];
  if (tables)
    notes.push(`${tables} table${tables === 1 ? "" : "s"} kept as lists`);
  if (figures)
    notes.push(`${figures} figure${figures === 1 ? "" : "s"} left out`);
  if (ocr)
    notes.push(`${ocr} page${ocr === 1 ? "" : "s"} read from an image (OCR)`);
  const checks = pages.reduce((n, p) => n + (p.checks ?? 0), 0);
  if (checks)
    notes.push(
      `${checks} equation${checks === 1 ? "" : "s"} may need checking`,
    );
  return [...notes, ...extra];
}

/**
 * Put a file's pages together as one Orbyn page: the first top heading (or
 * the file's name) is the title, later top headings step down a level so a
 * slide deck reads as one section per slide, every block fits the editor's
 * limits, and a footnote records where it came from.
 */
export function assembleImport(
  pages: ImportedPage[],
  fileName: string,
  opts: { notes?: string[]; importedAt?: Date } = {},
): { title: string; content: DocBlock[]; notes: string[] } {
  const markdown = pages
    .map((p) => p.markdown.trim())
    .filter(Boolean)
    .join("\n\n");
  let blocks = markdown.trim() ? parseDoc(markdown) : [];
  let title = fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  const first = blocks.findIndex((b) => b.type === "heading");
  if (first === 0 && blocks[0].type === "heading") {
    title = blocks[0].text.replace(/[*_`]/g, "").trim() || title;
    blocks = blocks.slice(1);
  }
  blocks = blocks.map((b) =>
    b.type === "heading" && b.level === 1
      ? { ...b, level: 2 }
      : // An equation whose layout was a guess carries a mark to check it.
        b.type === "math" && /\n?%check\s*$/.test(b.text)
        ? { ...b, text: b.text.replace(/\s*%check\s*$/, ""), check: true }
        : b,
  );
  const notes = importNotes(pages, opts.notes);
  let cut = false;
  if (blocks.length > MAX_BLOCKS) {
    blocks = blocks.slice(0, MAX_BLOCKS);
    cut = true;
  }
  blocks = blocks.map((b) => {
    const max = LIMIT[b.type];
    return max && "text" in b && b.text.length > max
      ? { ...b, text: b.text.slice(0, max) }
      : b;
  });
  if (cut) notes.push("the rest was cut off at Orbyn's page length");
  const on = (opts.importedAt ?? new Date()).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const pageCount = pages.length;
  const source = `*Imported from ${fileName.replace(/[*_`]/g, "")}${
    pageCount > 1 ? ` · ${pageCount} pages` : ""
  } · ${on}${notes.length ? ` · ${notes.join(" · ")}` : ""}*`;
  const content: DocBlock[] = [
    ...(blocks.length ? blocks : [{ type: "paragraph", text: "" } as DocBlock]),
    { type: "divider" },
    { type: "paragraph", text: source },
  ];
  return { title: title.slice(0, 200) || "Imported file", content, notes };
}

/** What an import's status means, in words for its row in Uploads. */
export function importStatusLine(job: ImportJob): string {
  switch (job.status) {
    case "waiting":
      return "Uploading…";
    case "queued":
      return "Waiting to be read…";
    case "reading":
      return "Reading the file…";
    case "ocr": {
      const done = `Reading scanned page ${Math.min(job.ocr_done + 1, job.ocr_pages)} of ${job.ocr_pages}`;
      const wait =
        job.estimate_seconds && job.estimate_seconds > 90
          ? ` · about ${Math.round(job.estimate_seconds / 60)} min left`
          : "";
      return done + wait;
    }
    case "ready":
      return job.notes.length ? `Ready · ${job.notes.join(" · ")}` : "Ready";
    case "failed":
      return job.error ?? "Couldn't be imported.";
    case "cancelled":
      return "Cancelled";
  }
}

// ------------------------------------------------------- capabilities ---

/**
 * What this server can read, so the apps can say so before an upload
 * instead of failing after it. `scans` is how pages without their own text
 * are read: "tesseract" (built in: printed text, no maths), "full" (the
 * heavy OCR model), "none", or "unknown" while the converter hasn't
 * reported.
 */
export type ImportCapabilities = {
  enabled: boolean;
  scans: "full" | "tesseract" | "none" | "unknown";
  /** Pictures of equations on scans are read as LaTeX. */
  formulas: boolean;
  /** Photos of notes can be imported. */
  photos: boolean;
  limits: {
    maxBytes: number;
    maxPages: number;
    scanPagesPerFile: number;
    scanPagesPerDay: number;
  };
};

/** A sentence for the import button's hint, from what the server can read. */
export function importHint(c: ImportCapabilities | null): string {
  if (!c) return "PDF, Word (.docx), PNG or JPEG.";
  if (!c.enabled) return "Importing files isn't set up on this server yet.";
  const base = `PDF or Word (.docx), up to ${Math.round(c.limits.maxBytes / 1024 / 1024)} MB.`;
  if (c.scans === "none" || c.scans === "unknown")
    return `${base} Scanned pages and photos aren't read on this server.`;
  if (c.scans === "tesseract")
    return `${base} Scans and photos of printed notes are read too${c.formulas ? ", equations included" : "; handwriting and scanned equations aren't"}.`;
  return `${base} Scans, photos and equations are read too.`;
}

// ------------------------------------------------- admin → storage ---

export type AdminStoredFile = {
  import_id: string;
  object_id: string | null;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  file_name: string;
  file_type: ImportFileType;
  bytes: number;
  status: ImportStatus;
  uploaded_at: string;
  /** When the file store deletes it, whatever happens. */
  deletes_at: string;
};

export type AdminStorage = {
  database: { bytes: number };
  files: {
    /** Whether the file store answered. */
    reachable: boolean;
    count: number;
    bytes: number;
    oldest_at: string | null;
    disk_total: number | null;
    disk_free: number | null;
  };
  reading: {
    scans: ImportCapabilities["scans"];
    formulas: boolean;
    workers: number;
    /** When the converter last reported in. */
    converter_seen_at: string | null;
    converter_ok: boolean;
  };
  queue: {
    waiting: number;
    queued: number;
    reading: number;
    ocr: number;
    pages_waiting: number;
    seconds_per_page: number | null;
    failed_today: number;
    reasons: { error: string; count: number }[];
  };
  stored: AdminStoredFile[];
  history: {
    id: string;
    owner_name: string;
    file_name: string;
    file_type: ImportFileType;
    pages: number | null;
    engines: string[];
    status: ImportStatus;
    error: string | null;
    created_at: string;
    seconds: number | null;
  }[];
};
