import { hasHigherDialog } from "../../../lib/dialogLayers";

/** Retained editor selections never own another pane, field or modal's keys. */
export function ownsEditorKey(
  root: HTMLElement | null,
  event: KeyboardEvent,
  ownsPane: () => boolean,
  allowTextInput = false,
) {
  if (
    !ownsPane() ||
    event.defaultPrevented ||
    !root?.isConnected ||
    !root.getClientRects().length ||
    root.closest("[inert], [hidden]") ||
    hasHigherDialog(root)
  )
    return false;
  // Native top-layer dialogs may not carry aria-modal. Yield to child and
  // unrelated dialogs; a dialog containing the editor remains its parent.
  for (const modal of document.querySelectorAll<HTMLElement>(
    'dialog[open], [aria-modal="true"]',
  )) {
    if (
      !modal.contains(root) &&
      modal.getClientRects().length &&
      !modal.closest("[inert], [hidden]")
    )
      return false;
  }
  const target =
    event.target instanceof Element ? event.target : document.activeElement;
  if (!target) return false;
  if (
    !allowTextInput &&
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    )
  )
    return false;
  if (root.contains(target)) return true;
  // Selecting rendered text need not move keyboard focus off the page body.
  if (target !== document.body && target !== document.documentElement)
    return false;
  const selection = window.getSelection();
  return (
    !!selection &&
    !selection.isCollapsed &&
    !!selection.anchorNode &&
    !!selection.focusNode &&
    root.contains(selection.anchorNode) &&
    root.contains(selection.focusNode)
  );
}
