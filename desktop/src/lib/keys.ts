/**
 * Whether a key press should skip single-key shortcuts: typing in a field,
 * or a modifier other than Shift held (Shift is needed for "?").
 */
export const isTyping = (e: KeyboardEvent) => {
  // The target can be the document or window (a key pressed with nothing
  // focused), which have no closest(); only elements can be typed in.
  const el = e.target instanceof Element ? (e.target as HTMLElement) : null;
  return (
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    !!el?.isContentEditable ||
    !!el?.closest("input, textarea, select, [contenteditable='true']")
  );
};
