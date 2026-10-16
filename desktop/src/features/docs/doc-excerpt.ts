import { type DocSelection } from "@orbyn/core";
/** Visible text is an unanchored excerpt; never invent a canonical block mapping. */
export function readDocExcerpt(
  root: HTMLElement,
  format: DocSelection["format"] = "note",
): DocSelection | null {
  if (!root?.isConnected) return null;
  const active = document.activeElement;
  if (
    active instanceof HTMLTextAreaElement &&
    (root === active || root.contains(active))
  ) {
    const start = active.selectionStart,
      end = active.selectionEnd;
    if (end <= start) return null;
    const source = active.value;
    return {
      isCurrent: () => active.isConnected && active.value === source,
      format,
      source,
      start,
      end,
      quote: active.value.slice(start, end),
    };
  }
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const source = root.textContent ?? "",
    start = prefix.toString().length,
    quote = range.toString();
  if (!quote.trim() || source.slice(start, start + quote.length) !== quote)
    return null;
  return {
    isCurrent: () =>
      root.isConnected &&
      root.contains(range.commonAncestorContainer) &&
      range.toString() === quote,
    format,
    source,
    start,
    end: start + quote.length,
    quote,
  };
}
