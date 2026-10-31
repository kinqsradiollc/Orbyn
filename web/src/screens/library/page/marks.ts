import type { DocInline } from "@orbyn/core";

/** A stretch of a line carrying a remark or a proposed change. */
export type Mark = {
  start: number;
  end: number;
  active?: boolean;
  proposed?: boolean;
};

export type Piece = {
  text: string;
  start: number;
  depth: number;
  active: boolean;
  proposed: boolean;
};

/** Cut a run where marks begin and end; offsets are measured on the source. */
export function cut(run: DocInline, marks: Mark[]): Piece[] {
  const whole = [
    {
      text: run.text,
      start: run.start,
      depth: 0,
      active: false,
      proposed: false,
    },
  ];
  const length = run.text.length;
  if (!marks.length || !length) return whole;
  const edges = new Set([0, length]);
  let touched = false;
  for (const mark of marks) {
    const from = Math.max(0, mark.start - run.start);
    const to = Math.min(length, mark.end - run.start);
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
    const over = marks.filter(
      (mark) => mark.start - run.start <= from && mark.end - run.start >= to,
    );
    pieces.push({
      text: run.text.slice(from, to),
      start: run.start + from,
      depth: over.length,
      active: over.some((mark) => mark.active),
      proposed: over.some((mark) => mark.proposed),
    });
  }
  return pieces;
}
