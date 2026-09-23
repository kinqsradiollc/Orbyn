import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PageText, Span } from "@orbyn/core";

/**
 * Light OCR for scanned pages and photos of notes: Tesseract (Apache-2.0),
 * installed as a system package in the backend image with English. It runs
 * in the converter itself, needs about 100 MB and a few seconds a page, and
 * returns words with their boxes and confidence, which go through the same
 * page reading as a PDF's own text (headings, columns, lists). It doesn't
 * read maths: lines it can't read that look like maths are handed to the
 * formula model when there is one (see ./formula.ts).
 *
 * PDF pages are drawn as images with poppler's pdftoppm.
 */

const run = promisify(execFile);
const LANG = "eng";

let available: Promise<boolean> | null = null;

/** Whether tesseract and pdftoppm are installed here. */
export function tesseractAvailable(): Promise<boolean> {
  available ??= Promise.all([
    run("tesseract", ["--version"], { timeout: 10_000 }),
    run("pdftoppm", ["-v"], { timeout: 10_000 }),
  ]).then(
    () => true,
    () => false,
  );
  return available;
}

/** Orientation detection (for photos taken sideways) needs its own data. */
let hasOsd: Promise<boolean> | null = null;
const osd = () =>
  (hasOsd ??= run("tesseract", ["--list-langs"], { timeout: 10_000 }).then(
    ({ stdout }) => /\bosd\b/.test(stdout),
    () => false,
  ));

async function inTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "orbyn-ocr-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One page of a PDF drawn as a greyscale PNG at 300 dpi. */
export function renderPdfPage(pdf: Buffer, page: number): Promise<Buffer> {
  return inTemp(async (dir) => {
    const input = join(dir, "in.pdf");
    await writeFile(input, pdf);
    await run(
      "pdftoppm",
      [
        "-f",
        String(page),
        "-l",
        String(page),
        "-r",
        "300",
        "-gray",
        "-png",
        "-singlefile",
        input,
        join(dir, "page"),
      ],
      { timeout: 120_000, maxBuffer: 1024 * 1024 },
    );
    return readFile(join(dir, "page.png"));
  });
}

type Word = {
  block: number;
  par: number;
  line: number;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  text: string;
};

/**
 * Tesseract's TSV as positioned text. Every word of a line is given the
 * line's height as its size, so headings still read as bigger text.
 */
export function tsvToPage(tsv: string): PageText {
  let width = 0;
  let height = 0;
  const words: Word[] = [];
  for (const row of tsv.split("\n").slice(1)) {
    const c = row.split("\t");
    if (c.length < 12) continue;
    const level = Number(c[0]);
    if (level === 1) {
      width = Number(c[8]);
      height = Number(c[9]);
    }
    if (level !== 5 || !c[11]?.trim()) continue;
    words.push({
      block: Number(c[2]),
      par: Number(c[3]),
      line: Number(c[4]),
      left: Number(c[6]),
      top: Number(c[7]),
      width: Number(c[8]),
      height: Number(c[9]),
      conf: Number(c[10]),
      text: c[11],
    });
  }
  const lineHeight = new Map<string, number>();
  const lineBottom = new Map<string, number>();
  for (const w of words) {
    const key = `${w.block}.${w.par}.${w.line}`;
    lineHeight.set(key, Math.max(lineHeight.get(key) ?? 0, w.height));
    lineBottom.set(key, Math.max(lineBottom.get(key) ?? 0, w.top + w.height));
  }
  const spans: Span[] = words.map((w) => {
    const key = `${w.block}.${w.par}.${w.line}`;
    return {
      text: w.text + " ",
      x: w.left,
      // Every word of a line sits on the line's baseline, flipped to y-up.
      y: height - (lineBottom.get(key) ?? w.top + w.height),
      w: w.width,
      // Letter heights run about 1.3 times a font's size.
      size: (lineHeight.get(key) ?? w.height) / 1.3,
      conf: w.conf,
    };
  });
  return { width, height, spans };
}

/** Read an image (PNG or JPEG) with Tesseract, as positioned text. */
export function ocrImage(image: Buffer): Promise<PageText> {
  return inTemp(async (dir) => {
    const input = join(dir, "page.img");
    await writeFile(input, image);
    // psm 1: find the layout, and turn a sideways photo the right way up.
    const psm = (await osd()) ? "1" : "3";
    const { stdout } = await run(
      "tesseract",
      [input, "stdout", "-l", LANG, "--psm", psm, "--dpi", "300", "tsv"],
      { timeout: 180_000, maxBuffer: 64 * 1024 * 1024 },
    );
    return tsvToPage(stdout);
  });
}
