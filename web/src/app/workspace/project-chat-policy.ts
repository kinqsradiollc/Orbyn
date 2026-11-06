import type { ChatView } from "@orbyn/core";
import type { WorkspaceSnapshot } from "./controller";

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

const VIEW_PATH = /^\/app(?:\/[A-Za-z0-9_-]{1,64}){0,3}$/;

/**
 * Where the person is working, for the next chat turn: the pane, pathname and
 * query of the working frame (a focused dock frame reports its captured
 * origin). Undefined when no frame is working or its path is not one the
 * server accepts. The server re-checks it; this only reports.
 */
export function workingView(
  state: Pick<
    WorkspaceSnapshot,
    "frames" | "focused" | "dockActive" | "primary" | "secondary"
  >,
): ChatView | undefined {
  const focused = state.frames.find(
    (frame) =>
      frame.lease.pane === state.focused &&
      frame.lease.tabKey ===
        (state.focused === "dock"
          ? state.dockActive
          : state[state.focused]?.active),
  );
  const working =
    focused?.lease.pane === "dock"
      ? state.frames.find(
          (frame) =>
            focused.origin &&
            frame.lease.pane === focused.origin.pane &&
            frame.lease.tabKey === focused.origin.tabKey &&
            frame.lease.mount === focused.origin.mount,
        )
      : focused;
  if (!working) return undefined;
  const { pathname, search } = working.destination;
  if (!VIEW_PATH.test(pathname)) return undefined;
  const query = search.replace(/^\?/, "").slice(0, 300);
  return {
    pane: working.lease.pane,
    path: pathname,
    ...(query ? { query } : {}),
  };
}
