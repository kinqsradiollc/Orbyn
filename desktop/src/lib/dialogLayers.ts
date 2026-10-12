/** A separate visible modal owns keyboard interaction above this panel. */
export function hasHigherDialog(root: HTMLElement | null) {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[aria-modal="true"]'),
  ).some((node) => {
    if (
      node === root ||
      node.contains(root) ||
      root?.contains(node) ||
      node.closest("[inert], [hidden]")
    )
      return false;
    const style = window.getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}
