/** Rails respond to page space left after navigation, library and other app panels. */
export function docRailLayout(width: number): {
  narrow: boolean;
  outline: boolean;
} {
  const available = Number.isFinite(width) ? Math.max(0, width) : 0;
  return { narrow: available < 900, outline: available >= 1060 };
}

/** Track the editor container as navigation and panels change its available width. */
export function observeDocLayout(
  element: HTMLElement,
  onWidth: (width: number) => void,
): () => void {
  const measure = () => onWidth(element.getBoundingClientRect().width);
  measure();
  if (typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }
  const observer = new ResizeObserver((entries) => {
    const entry = entries.find((item) => item.target === element);
    if (entry) onWidth(entry.contentRect.width);
  });
  observer.observe(element);
  return () => observer.disconnect();
}
