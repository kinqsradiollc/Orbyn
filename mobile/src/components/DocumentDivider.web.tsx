import { useEffect, useRef } from "react";
import { colors } from "../theme";
export type DocumentDividerProps = {
  value: number;
  width: number;
  onChange: (value: number) => void;
};
export function DocumentDivider({
  value,
  width,
  onChange,
}: DocumentDividerProps) {
  const endResize = useRef<(() => void) | null>(null);
  useEffect(() => () => endResize.current?.(), []);
  const change = (n: number) =>
    onChange(Math.max(30, Math.min(70, Math.round(n))));
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize source and preview"
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={30}
      aria-valuemax={70}
      style={{
        flex: "0 0 12px",
        alignSelf: "stretch",
        cursor: "col-resize",
        touchAction: "none",
        background: colors.surfaceMuted,
        borderInline: `1px solid ${colors.border}`,
      }}
      onKeyDown={(event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          change(
            event.key === "Home"
              ? 30
              : event.key === "End"
                ? 70
                : value + (event.key === "ArrowRight" ? 5 : -5),
          );
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        endResize.current?.();
        const divider = event.currentTarget;
        const parent = divider.parentElement!;
        const box = parent.getBoundingClientRect();
        const pointerId = event.pointerId;
        const frames = [...parent.querySelectorAll("iframe")];
        const styles = frames.map((frame) => frame.style.pointerEvents);
        frames.forEach((frame) => {
          frame.style.pointerEvents = "none";
        });
        const move = (next: PointerEvent) => {
          if (next.pointerId === pointerId)
            change(
              ((next.clientX - box.left) / Math.max(1, box.width || width)) *
                100,
            );
        };
        const stop = () => {
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", stop, true);
          window.removeEventListener("pointercancel", stop, true);
          window.removeEventListener("blur", stop);
          frames.forEach((frame, index) => {
            frame.style.pointerEvents = styles[index];
          });
          endResize.current = null;
        };
        endResize.current = stop;
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", stop, true);
        window.addEventListener("pointercancel", stop, true);
        window.addEventListener("blur", stop);
        try {
          divider.setPointerCapture(pointerId);
        } catch {
          /* Window listeners retain the drag when capture is unavailable. */
        }
      }}
    />
  );
}
