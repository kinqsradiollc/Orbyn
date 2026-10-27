import type { DocInline } from "@orbyn/core";

/** A stretch of a line that carries a remark, or a proposed change. */
export type Mark = {
  start: number;
  end: number;
  active?: boolean;
  /** True when this marks words somebody has proposed changing. */
  proposed?: boolean;
};

/** One piece of a run, after the marks over it have been cut in. */
export type Piece = {
  text: string;
  /** Where this piece starts in the line's Markdown source. */
  start: number;
  /** How many remarks cover it; more than one shades darker. */
  depth: number;
  active: boolean;
  /** True when a proposed change covers this piece. */
  proposed: boolean;
};

/**
 * Cut a run of text where remarks begin and end.
 *
 * Marks are measured on the Markdown source and the run knows where its own
 * text sits in that source, so the two line up without a second parse. A run
 * no remark touches comes back whole, which is the usual case and costs
 * nothing.
 */
export function cut(run: DocInline, marks: Mark[]): Piece[] {
  const len = run.text.length;
  const whole = [
    {
      text: run.text,
      start: run.start,
      depth: 0,
      active: false,
      proposed: false,
    },
  ];
  if (!marks.length || !len) return whole;
  const edges = new Set<number>([0, len]);
  let touched = false;
  for (const m of marks) {
    const from = Math.max(0, m.start - run.start);
    const to = Math.min(len, m.end - run.start);
    if (to <= from) continue;
    touched = true;
    edges.add(from);
    edges.add(to);
  }
  if (!touched) return whole;
  const cuts = [...edges].sort((a, b) => a - b);
  const pieces: Piece[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    if (to <= from) continue;
    const over = marks.filter(
      (m) => m.start - run.start <= from && m.end - run.start >= to,
    );
    pieces.push({
      text: run.text.slice(from, to),
      start: run.start + from,
      depth: over.length,
      active: over.some((m) => m.active),
      proposed: over.some((m) => m.proposed),
    });
  }
  return pieces;
}

/** True when any remark touches this run at all. */
export const touches = (run: DocInline, marks: Mark[]) =>
  marks.some((m) => m.start < run.start + run.text.length && m.end > run.start);
