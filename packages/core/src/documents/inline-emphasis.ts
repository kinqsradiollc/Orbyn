import type { DocInline, DocStyleRange } from "./docs.js";

type Delimiter = {
  start: number;
  count: number;
  remaining: number;
  consumed: number;
  marker: string;
  open: boolean;
  close: boolean;
};
type Range = { start: number; end: number; bold?: true; italic?: true };
const punctuation = /^[\p{P}\p{S}]$/u;
const whitespace = (value: string) =>
  !value || /^[\p{Zs}\t\n\f\r]$/u.test(value);
const before = (text: string, at: number) => {
  if (at <= 0) return "";
  const last = text.charCodeAt(at - 1);
  return text.slice(at - (last >= 0xdc00 && last <= 0xdfff ? 2 : 1), at);
};
const after = (text: string, at: number) =>
  at >= text.length ? "" : String.fromCodePoint(text.codePointAt(at)!);

/** Resolve CommonMark emphasis delimiters without interpreting literal or link destinations. */
export function inlineEmphasis(
  runs: DocInline[],
  masked: string,
  source: string,
  onStyleRange?: (range: DocStyleRange) => void,
): DocInline[] {
  const delimiters: Delimiter[] = [];
  for (const run of runs) {
    if (run.code || run.math || run.link || run.footnote || run.source)
      continue;
    const segment = masked.slice(run.start, run.start + run.text.length);
    for (const match of segment.matchAll(/\*+|_+/g)) {
      const start = run.start + match.index!;
      const count = match[0].length;
      const previous = before(source, start);
      const next = after(source, start + count);
      const previousPunctuation = punctuation.test(previous);
      const nextPunctuation = punctuation.test(next);
      const left =
        !whitespace(next) &&
        (!nextPunctuation || whitespace(previous) || previousPunctuation);
      const right =
        !whitespace(previous) &&
        (!previousPunctuation || whitespace(next) || nextPunctuation);
      const marker = match[0][0];
      delimiters.push({
        start,
        count,
        remaining: count,
        consumed: 0,
        marker,
        open: left && (marker !== "_" || !right || previousPunctuation),
        close: right && (marker !== "_" || !left || nextPunctuation),
      });
    }
  }
  if (!delimiters.length) return runs;
  const stack: Delimiter[] = [];
  const bottoms = new Map<string, number>();
  const removed: { start: number; end: number }[] = [];
  const formats: Range[] = [];
  for (const closer of delimiters) {
    while (closer.close && closer.remaining) {
      const key = `${closer.marker}:${closer.open}:${closer.remaining % 3}`;
      const bottom = bottoms.get(key) ?? -1;
      let found = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        const opener = stack[i];
        if (opener.start <= bottom) break;
        if (opener.marker !== closer.marker || !opener.remaining) continue;
        // A delimiter which can both open and close obeys the rule of three.
        if (
          (opener.close || closer.open) &&
          (opener.remaining + closer.remaining) % 3 === 0 &&
          (opener.remaining % 3 !== 0 || closer.remaining % 3 !== 0)
        )
          continue;
        found = i;
        break;
      }
      if (found < 0) {
        bottoms.set(key, stack.at(-1)?.start ?? -1);
        break;
      }
      const opener = stack[found];
      const used = opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1;
      const start = opener.start + opener.remaining;
      const end = closer.start + closer.consumed;
      removed.push(
        { start: start - used, end: start },
        { start: end, end: end + used },
      );
      onStyleRange?.({
        kind: used === 2 ? "bold" : "italic",
        openStart: start - used,
        openEnd: start,
        closeStart: end,
        closeEnd: end + used,
      });
      formats.push({
        start,
        end,
        ...(used === 2 ? { bold: true as const } : { italic: true as const }),
      });
      opener.remaining -= used;
      closer.remaining -= used;
      closer.consumed += used;
      // Unmatched interior openers cannot cross the pair just resolved.
      stack.splice(found + (opener.remaining ? 1 : 0));
    }
    if (closer.open && closer.remaining) stack.push(closer);
  }
  if (!formats.length) return runs;
  // Sweep interval changes once; repeated short emphasis runs must not
  // repeatedly scan all earlier pairs or make a large page quadratic.
  const changes = new Map<
    number,
    { bold: number; italic: number; removed: number }
  >();
  const change = (
    at: number,
    field: "bold" | "italic" | "removed",
    delta: number,
  ) => {
    const event = changes.get(at) ?? { bold: 0, italic: 0, removed: 0 };
    event[field] += delta;
    changes.set(at, event);
  };
  for (const range of formats) {
    const field = range.bold ? "bold" : "italic";
    change(range.start, field, 1);
    change(range.end, field, -1);
  }
  for (const range of removed) {
    change(range.start, "removed", 1);
    change(range.end, "removed", -1);
  }
  const events = [...changes].sort(([a], [b]) => a - b);
  const active = { bold: 0, italic: 0, removed: 0 };
  let index = 0;
  const advance = (at: number) => {
    while (index < events.length && events[index][0] <= at) {
      const event = events[index++][1];
      active.bold += event.bold;
      active.italic += event.italic;
      active.removed += event.removed;
    }
  };
  const out: DocInline[] = [];
  for (const run of runs) {
    const end = run.start + run.text.length;
    let start = run.start;
    advance(start);
    while (start < end) {
      const finish = Math.min(end, events[index]?.[0] ?? end);
      if (!active.removed)
        out.push({
          ...run,
          text: run.text.slice(start - run.start, finish - run.start),
          start,
          ...(active.bold ? { bold: true } : {}),
          ...(active.italic ? { italic: true } : {}),
        });
      start = finish;
      advance(start);
    }
    if (!run.text) out.push(run);
  }
  return out.length ? out : [{ text: "", start: 0 }];
}
