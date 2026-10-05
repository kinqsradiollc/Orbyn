/** Observe a page's available width as navigation and sibling panels resize. */
export function observeElementWidth(
  element: HTMLElement,
  onWidth: (width: number) => void,
): () => void {
  const update = (width: number) =>
    onWidth(Number.isFinite(width) ? Math.max(0, width) : 0);
  const measure = () => update(element.getBoundingClientRect().width);
  measure();
  if (typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }
  const observer = new ResizeObserver((entries) => {
    const entry = entries.find((item) => item.target === element);
    if (entry) update(entry.contentRect.width);
  });
  observer.observe(element);
  return () => observer.disconnect();
}
