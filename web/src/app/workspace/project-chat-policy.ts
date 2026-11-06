/** Pure decisions for the workspace project chat dock. */
export type Box = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/**
 * True when a focused control is actually hidden under the open panel.
 * A target that fully contains the panel is a container (such as a frame
 * body focused on activation), not a control the panel obscures.
 */
export function isObscuredByPanel(panel: Box, target: Box): boolean {
  const overlaps =
    panel.left < target.right &&
    panel.right > target.left &&
    panel.top < target.bottom &&
    panel.bottom > target.top;
  if (!overlaps) return false;
  const contains =
    target.left <= panel.left &&
    target.right >= panel.right &&
    target.top <= panel.top &&
    target.bottom >= panel.bottom;
  return !contains;
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
