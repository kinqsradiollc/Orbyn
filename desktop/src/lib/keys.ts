/**
 * Whether a key press should skip single-key shortcuts: typing in a field,
 * or a modifier other than Shift held (Shift is needed for "?").
 */
export const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return (
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    !!el?.isContentEditable ||
    !!el?.closest("input, textarea, select, [contenteditable='true']")
  );
};
