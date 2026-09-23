import { env } from "../../config/env.js";

/**
 * The formula model (Compose profile `formula`, pix2tex): turns pictures of
 * equations into LaTeX. OCR marks the lines it couldn't read that look like
 * maths; this sends the page image with those boxes and gets LaTeX back.
 * Off unless FORMULA_URL is set, and then such lines keep a placeholder.
 */

export type Box = { left: number; top: number; width: number; height: number };

export const formulaAvailable = () => !!env.FORMULA_URL;

/** LaTeX for each box of a page image ("" where it couldn't read one). */
export async function readFormulas(
  image: Buffer,
  type: "image/png" | "image/jpeg",
  boxes: Box[],
): Promise<string[]> {
  if (!env.FORMULA_URL || !boxes.length) return boxes.map(() => "");
  const res = await fetch(`${env.FORMULA_URL}/formulas`, {
    method: "POST",
    headers: {
      "Content-Type": type,
      "X-Boxes": JSON.stringify(
        boxes.map((b) => [
          Math.round(b.left),
          Math.round(b.top),
          Math.round(b.width),
          Math.round(b.height),
        ]),
      ),
    },
    body: new Uint8Array(image),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Formula model answered ${res.status}`);
  const out = ((await res.json()) as { latex?: string[] }).latex ?? [];
  return boxes.map((_, i) => (out[i] ?? "").trim());
}
