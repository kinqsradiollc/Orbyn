import React, { useEffect, useRef } from "react";
import { AppState, Platform, View } from "react-native";

export type ConversationViewport = React.RefObject<React.ComponentRef<
  typeof View
> | null>;
/** A fetch is not a read: measure the row against the actual unobscured chat viewport. */
export function ConversationSeen({
  children,
  sequence,
  viewport,
  revision,
  active,
  onSeen,
  focused = false,
  onFocus,
  onRow,
}: {
  children: React.ReactNode;
  sequence: string | null;
  viewport?: ConversationViewport;
  revision: number;
  active: boolean;
  onSeen: (sequence: string) => void;
  focused?: boolean;
  onFocus?: (view: React.ComponentRef<typeof View>) => void;
  onRow?: (
    sequence: string,
    view: React.ComponentRef<typeof View> | null,
  ) => void;
}) {
  const row = useRef<React.ComponentRef<typeof View>>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (!sequence) return;
    onRow?.(sequence, row.current);
    return () => onRow?.(sequence, null);
  }, [sequence, onRow]);
  const focusCallback = useRef(onFocus);
  focusCallback.current = onFocus;
  useEffect(() => {
    if (!focused || !active) return;
    const frame = requestAnimationFrame(() => {
      if (row.current) focusCallback.current?.(row.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [focused, active]);
  const measure = () => {
    const current = generation.current;
    const visible = () =>
      current === generation.current &&
      active &&
      AppState.currentState === "active" &&
      (Platform.OS !== "web" || (!document.hidden && document.hasFocus()));
    if (!sequence || !viewport?.current || !visible()) return;
    viewport.current.measureInWindow((vx, vy, vw, vh) => {
      if (!visible() || vw <= 0 || vh <= 0) return;
      row.current?.measureInWindow((x, y, w, h) => {
        if (!visible() || w <= 0 || h <= 0) return;
        const height = Math.max(0, Math.min(y + h, vy + vh) - Math.max(y, vy));
        const width = Math.max(0, Math.min(x + w, vx + vw) - Math.max(x, vx));
        if (height >= Math.min(h, vh) * 0.5 && width >= Math.min(w, vw) * 0.5)
          onSeen(sequence);
      });
    });
  };
  useEffect(() => {
    measure();
    const subscription = AppState.addEventListener("change", measure);
    if (Platform.OS === "web") window.addEventListener("focus", measure);
    return () => {
      generation.current++;
      subscription.remove();
      if (Platform.OS === "web") window.removeEventListener("focus", measure);
    };
  }, [sequence, viewport, revision, active, onSeen]);
  return (
    <View ref={row} collapsable={false} onLayout={measure}>
      {children}
    </View>
  );
}
