/**
 * Read a selection made on the page back as a range in the Markdown source.
 *
 * The rendered page is not the source: `**bold**` shows as four characters
 * and is stored as eight. Every rendered piece carries the offset its text
 * starts at in the source, so a selection is converted by looking at the
 * pieces its ends fall in rather than by counting characters on screen.
 */

/** Words someone has selected, as the stored line sees them. */
export type Picked = {
  blockId: string;
  start: number;
  end: number;
  quote: string;
  /** Where the words sit on screen, for placing the button that acts on them. */
  at: DOMRect;
};

type Piece = { node: Text; start: number };

/** Every rendered piece inside a block, in reading order. */
function pieces(block: Element): Piece[] {
  const out: Piece[] = [];
  const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const holder = (n as Text).parentElement?.closest("[data-src]");
    if (!holder || !block.contains(holder)) continue;
    out.push({
      node: n as Text,
      start: Number(holder.getAttribute("data-src")),
    });
  }
  return out;
}

/** Where one end of a selection falls in the source, or null if nowhere. */
function edge(list: Piece[], node: Node, offset: number, toEnd: boolean) {
  if (node.nodeType === Node.TEXT_NODE) {
    const hit = list.find((p) => p.node === node);
    if (hit) return hit.start + offset;
  }
  // An end that landed on an element rather than in text — a whole line
  // selected by triple click, say — takes the nearest piece's edge.
  const inside = list.filter((p) => node.contains(p.node));
  if (!inside.length) return null;
  const piece = toEnd ? inside[inside.length - 1] : inside[0];
  return toEnd ? piece.start + piece.node.length : piece.start;
}

/**
 * What is selected inside `root`, or null when nothing useful is: an empty
 * selection, one outside the page, or one spanning two lines. Comments never
 * cross a line, because a line is what the document stores.
 */
export function readSelection(root: HTMLElement): Picked | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const block = (
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement
  )?.closest("[data-block-id]");
  if (!block) return null;
  const blockId = block.getAttribute("data-block-id");
  const source = block.getAttribute("data-block-source");
  if (!blockId || source === null) return null;
  const list = pieces(block);
  const from = edge(list, range.startContainer, range.startOffset, false);
  const to = edge(list, range.endContainer, range.endOffset, true);
  if (from === null || to === null) return null;
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(source.length, Math.max(from, to));
  if (end <= start) return null;
  const quote = source.slice(start, end).trim();
  if (!quote) return null;
  // Trimming may have moved the edges; keep the range and the quote agreeing.
  const lead = source.slice(start, end).indexOf(quote);
  return {
    blockId,
    start: start + lead,
    end: start + lead + quote.length,
    quote,
    at: range.getBoundingClientRect(),
  };
}
