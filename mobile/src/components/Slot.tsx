import React, { useLayoutEffect, useRef, useState } from "react";

/**
 * A place in one part of the tree that another part fills, like a small
 * portal: RootScreen puts a `SlotHost` in the page's sticky header and the
 * calendar fills it with its controls. Filling re-renders only the host, so
 * it can't loop back into the screen that fills it.
 */
export type SlotHandle = { set: ((node: React.ReactNode) => void) | null };

export function useSlot(): SlotHandle {
  return useRef<SlotHandle>({ set: null }).current;
}

/** Shows whatever the slot was last filled with. */
export function SlotHost({ slot }: { slot: SlotHandle }) {
  const [node, setNode] = useState<React.ReactNode>(null);
  useLayoutEffect(() => {
    slot.set = setNode;
    return () => {
      slot.set = null;
    };
  }, [slot]);
  return <>{node}</>;
}

/** Puts its children in the slot on every render; empties it on unmount. */
export function SlotFill({
  slot,
  children,
}: {
  slot: SlotHandle;
  children: React.ReactNode;
}) {
  useLayoutEffect(() => {
    slot.set?.(children);
  });
  useLayoutEffect(() => () => slot.set?.(null), [slot]);
  return null;
}
