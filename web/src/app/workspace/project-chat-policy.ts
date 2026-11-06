/** Pure decisions for the workspace project chat dock. */
export type Box = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/**
 * True when focus moved onto a control hidden under the open panel.
 * Only focus that follows a user Tab counts: frame activation and focus
 * restoration move focus programmatically and must never collapse the dock.
 * Frame containers (focusable only by script) are never "obscured controls".
 */
export function shouldCollapseForFocus({
  panel,
  target,
  viaTab,
  container,
}: {
  panel: Box;
  target: Box;
  viaTab: boolean;
  container: boolean;
}): boolean {
  if (!viaTab || container) return false;
  return (
    panel.left < target.right &&
    panel.right > target.left &&
    panel.top < target.bottom &&
    panel.bottom > target.top
  );
}

/** Mounted project conversations kept at once. */
export const MAX_MOUNTED_SESSIONS = 3;

/**
 * Which mounted sessions to unmount. Only the selected, busy and dirty ones
 * are protected; the least recently selected go first. `recent` lists project
 * ids from least to most recently selected. When too few sessions are safe to
 * drop, fewer are dropped, so a draft is never lost.
 */
export function sessionsToUnmount({
  mounted,
  recent,
  selected,
  busy,
  dirty,
  cap = MAX_MOUNTED_SESSIONS,
}: {
  mounted: readonly string[];
  recent: readonly string[];
  selected: string;
  busy: ReadonlySet<string>;
  dirty: ReadonlySet<string>;
  cap?: number;
}): string[] {
  const excess = mounted.length - cap;
  if (excess <= 0) return [];
  return mounted
    .filter((id) => id !== selected && !busy.has(id) && !dirty.has(id))
    .sort((a, b) => recent.indexOf(a) - recent.indexOf(b))
    .slice(0, excess);
}
