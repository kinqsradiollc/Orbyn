/** Compare the fixed layers used by Orbyn dialogs, then their paint order. */
function layer(node: HTMLElement) {
  let current: HTMLElement | null = node;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const z = Number.parseInt(style.zIndex, 10);
    if (style.position !== "static" && Number.isFinite(z))
      return { node: current, z };
    current = current.parentElement;
  }
  return { node, z: 0 };
}

/** Only a modal painted above this panel owns its keyboard interaction. */
export function hasHigherDialog(root: HTMLElement | null) {
  if (!root) return true;
  const own = layer(root);
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
    if (style.display === "none" || style.visibility === "hidden") return false;
    const other = layer(node);
    return (
      other.z > own.z ||
      (other.z === own.z &&
        !!(
          own.node.compareDocumentPosition(other.node) &
          own.node.DOCUMENT_POSITION_FOLLOWING
        ))
    );
  });
}
