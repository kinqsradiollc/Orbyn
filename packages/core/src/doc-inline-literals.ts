import type { DocInline } from "./docs.js";

type Literal = { start: number; end: number; run: DocInline };
const punctuation = /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/;

/** Opaque Markdown code and escaped punctuation, before inline formatting. */
export function docInlineLiterals(text: string): Literal[] {
  const ticks = new Map<number, number[]>();
  for (const match of text.matchAll(/`+/g)) {
    const positions = ticks.get(match[0].length) ?? [];
    positions.push(match.index!);
    ticks.set(match[0].length, positions);
  }
  const after = (positions: number[], start: number) => {
    let lo = 0,
      hi = positions.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (positions[mid] <= start) lo = mid + 1;
      else hi = mid;
    }
    return positions[lo];
  };
  const out: Literal[] = [];
  for (let at = 0; at < text.length;) {
    if (text[at] === "\\" && punctuation.test(text[at + 1] ?? "")) {
      out.push({
        start: at,
        end: at + 2,
        run: { text: text[at + 1], start: at + 1 },
      });
      at += 2;
      continue;
    }
    if (text[at] === "$") {
      let close = at + 1;
      while (
        close < text.length &&
        text[close] !== "\n" &&
        text[close] !== "\r"
      ) {
        if (text[close] === "\\") {
          close += 2;
          continue;
        }
        if (text[close] === "$") break;
        close++;
      }
      if (text[close] === "$" && close > at + 1) {
        out.push({
          start: at,
          end: close + 1,
          run: { text: text.slice(at + 1, close), start: at + 1, math: true },
        });
        at = close + 1;
        continue;
      }
    }
    if (text[at] !== "`") {
      at++;
      continue;
    }
    let length = 1;
    while (text[at + length] === "`") length++;
    const close = after(ticks.get(length)!, at);
    if (close === undefined) {
      at += length;
      continue;
    }
    let start = at + length;
    let code = text.slice(start, close).replace(/\r\n?|\n/g, " ");
    // CommonMark removes one surrounding space unless the entire span is spaces.
    if (code.startsWith(" ") && code.endsWith(" ") && /[^ ]/.test(code)) {
      code = code.slice(1, -1);
      start++;
    }
    out.push({
      start: at,
      end: close + length,
      run: { text: code, start, code: true },
    });
    at = close + length;
  }
  return out;
}
