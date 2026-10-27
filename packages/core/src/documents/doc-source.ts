import { docLines, parseDoc, serializeDoc, type DocBlock } from "./docs.js";

/** A rendered block's exact range in the editable, anchored Markdown source. */
export type DocSourceRange = {
  blockIndex: number;
  blockId?: string;
  start: number;
  end: number;
  /** One-based source lines, including a multiline block's closing fence/anchor. */
  startLine: number;
  endLine: number;
};
export type DocSourceMap = { source: string; ranges: DocSourceRange[] };

/** Source and preview share this map; serialization never changes the stored blocks. */
export function docSourceMap(
  blocks: DocBlock[],
  rawSource?: string,
): DocSourceMap {
  if (rawSource !== undefined) {
    const starts = [0];
    for (const match of rawSource.matchAll(/\r\n?|\n/g))
      starts.push(match.index! + match[0].length);
    const lines = rawSource.split(/\r\n?|\n/);
    const ranges: DocSourceRange[] = [];
    const parsed = parseDoc(rawSource, {
      anchors: true,
      onSourceRange: (blockIndex, startLine, endLine) => {
        const start = starts[startLine - 1] ?? rawSource.length;
        const end =
          (starts[endLine - 1] ?? rawSource.length) +
          (lines[endLine - 1]?.length ?? 0);
        ranges.push({
          blockIndex,
          ...(blocks[blockIndex]?.id ? { blockId: blocks[blockIndex].id } : {}),
          start,
          end,
          startLine,
          endLine,
        });
      },
    });
    // Invalid source can still be visible while the last accepted preview stays
    // intact. It cannot provide a map for that different block structure.
    if (parsed.length === blocks.length) return { source: rawSource, ranges };
  }
  const pieces = docLines(blocks, { anchors: true });
  const raw = pieces.join("\n\n");
  const leading = /^\n*/.exec(raw)![0].length;
  const source = serializeDoc(blocks, { anchors: true });
  const starts = [0];
  for (let at = 0; at < source.length; at++)
    if (source[at] === "\n") starts.push(at + 1);
  const lineAt = (offset: number) => {
    let low = 0,
      high = starts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return Math.max(1, low);
  };
  let cursor = 0;
  const ranges = pieces.map((piece, blockIndex) => {
    const start = Math.max(0, Math.min(source.length, cursor - leading));
    const end = Math.max(
      start,
      Math.min(source.length, cursor + piece.length - leading),
    );
    cursor += piece.length + 2;
    return {
      blockIndex,
      ...(blocks[blockIndex].id ? { blockId: blocks[blockIndex].id } : {}),
      start,
      end,
      startLine: lineAt(start),
      endLine: lineAt(Math.max(start, end - 1)),
    };
  });
  return { source, ranges };
}

/** Resolve a source caret to its block; separators belong to the preceding block. */
export function docSourceBlockAt(
  map: DocSourceMap,
  offset: number,
): DocSourceRange | null {
  if (!map.ranges.length) return null;
  const target = Number.isFinite(offset)
    ? Math.max(0, Math.min(map.source.length, offset))
    : 0;
  let low = 0,
    high = map.ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (map.ranges[middle].start <= target) low = middle + 1;
    else high = middle;
  }
  return map.ranges[Math.max(0, low - 1)];
}

/** Map a one-based fractional source line to a block and progress within it. */
export function docSourcePosition(
  map: DocSourceMap,
  line: number,
): { range: DocSourceRange; progress: number } | null {
  if (!map.ranges.length) return null;
  const target = Number.isFinite(line) ? Math.max(1, line) : 1;
  let low = 0,
    high = map.ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (map.ranges[middle].startLine <= target) low = middle + 1;
    else high = middle;
  }
  const range = map.ranges[Math.max(0, low - 1)];
  return {
    range,
    progress: Math.max(
      0,
      Math.min(
        1,
        (target - range.startLine) /
          Math.max(1, range.endLine - range.startLine),
      ),
    ),
  };
}

/** The corresponding source line at a fractional position in a rendered block. */
export function docSourceLineAt(
  range: DocSourceRange,
  progress: number,
): number {
  const amount = Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress))
    : 0;
  return (
    range.startLine + amount * Math.max(0, range.endLine - range.startLine)
  );
}

/**
 * Re-read the editor's anchored source without introducing another revision.
 * Retained anchors keep comment/task identity. Reject ambiguous duplicate
 * anchors before the owning editor schedules its ordinary save.
 */
export function editDocSource(
  previous: DocBlock[],
  source: string,
  expected: DocBlock[] = previous,
): DocBlock[] {
  if (
    previous !== expected &&
    JSON.stringify(previous) !== JSON.stringify(expected)
  )
    throw new Error(
      "The document changed before this source edit could be applied. Restore the current document before continuing.",
    );
  const canonical = serializeDoc(previous, { anchors: true });
  if (source === canonical) return previous;
  const next = source.trim() ? parseDoc(source, { anchors: true }) : [];
  const ids = new Set<string>();
  for (const block of next) {
    if (!block.id) continue;
    if (ids.has(block.id))
      throw new Error(
        `The source repeats the block anchor ^${block.id}. Each anchor must be unique.`,
      );
    ids.add(block.id);
  }
  // An emptied document remains editable and keeps its sole line's identity,
  // just like clearing the final line in the structured editor.
  if (!next.length)
    return [
      {
        type: "paragraph",
        text: "",
        ...(previous.length === 1 && previous[0].id
          ? { id: previous[0].id }
          : {}),
      },
    ];
  return next;
}
