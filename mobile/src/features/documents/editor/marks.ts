/** A stretch of a line that carries a remark. */
export type Mark = { start: number; end: number };

/**
 * The stretches of each line that carry a remark, as the page should tint
 * them. A remark about a whole line has no range of its own, so it tints
 * nothing here — the line's own marker already says it has one.
 */
export function markRanges(
  comments: Map<
    string,
    { range_start: number | null; range_end: number | null }[]
  >,
): Record<string, Mark[]> {
  const out: Record<string, Mark[]> = {};
  for (const [blockId, list] of comments)
    out[blockId] = list.flatMap((c) =>
      c.range_start !== null && c.range_end !== null
        ? [{ start: c.range_start, end: c.range_end }]
        : [],
    );
  return out;
}
