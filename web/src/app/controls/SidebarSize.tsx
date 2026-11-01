import { useEffect, useRef, useState } from "react";

const KEY = "orbyn-navigation-width-v2";
const fit = (width: number) =>
  width < 180 ? 72 : Math.max(180, Math.min(400, Math.round(width)));
function initialWidth() {
  try {
    const value = Number(localStorage.getItem(KEY));
    return value === 72 || (value >= 180 && value <= 400) ? value : 224;
  } catch {
    return 224;
  }
}
/** Fitting a narrow viewport never writes over the explicitly chosen device width. */
export function useSidebarSize() {
  const [preferred, setPreferred] = useState(initialWidth),
    [available, setAvailable] = useState(innerWidth),
    [error, setError] = useState("");
  useEffect(() => {
    const resize = () => setAvailable(innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const choose = (width: number, remember = true) => {
    const next = fit(width);
    setPreferred(next);
    if (!remember) return;
    try {
      localStorage.setItem(KEY, String(next));
      setError("");
    } catch {
      setError(
        "Navigation size is kept for this visit. This browser couldn't save it.",
      );
    }
  };
  const width =
    available <= 800
      ? 224
      : fit(Math.min(preferred, Math.max(72, available - 880)));
  return {
    width,
    preferred,
    rail: available > 800 && width === 72,
    choose,
    error,
  };
}
export function SidebarSize({
  width,
  restoreWidth = width,
  onChange,
  onCommit = onChange,
}: {
  width: number;
  restoreWidth?: number;
  onChange(value: number): void;
  onCommit?(value: number): void;
}) {
  const drag = useRef<{
    id: number;
    x: number;
    width: number;
    value: number;
    restoreWidth: number;
  } | null>(null);
  const cancel = (element: HTMLElement) => {
    const opening = drag.current;
    if (!opening) return;
    drag.current = null;
    onChange(opening.restoreWidth);
    if (element.hasPointerCapture(opening.id))
      element.releasePointerCapture(opening.id);
  };
  return (
    <div
      className="shell-sidebar-resizer"
      role="separator"
      tabIndex={0}
      aria-label="Navigation width"
      aria-orientation="vertical"
      aria-valuemin={72}
      aria-valuemax={400}
      aria-valuenow={width}
      aria-valuetext={width === 72 ? "Icon rail" : `${width} pixels`}
      onDoubleClick={() => onCommit(224)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        drag.current = {
          id: e.pointerId,
          x: e.clientX,
          width,
          value: width,
          restoreWidth,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const opening = drag.current;
        if (opening?.id !== e.pointerId) return;
        opening.value = fit(opening.width + e.clientX - opening.x);
        onChange(opening.value);
      }}
      onPointerUp={(e) => {
        const opening = drag.current;
        if (opening?.id !== e.pointerId) return;
        drag.current = null;
        onCommit(opening.value);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={(e) => cancel(e.currentTarget)}
      onLostPointerCapture={(e) => cancel(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && drag.current) {
          e.preventDefault();
          cancel(e.currentTarget);
          return;
        }
        const step = e.shiftKey ? 32 : 8;
        const next =
          e.key === "Home"
            ? 72
            : e.key === "End"
              ? 400
              : e.key === "ArrowLeft"
                ? width - (width === 180 ? 108 : step)
                : e.key === "ArrowRight"
                  ? width + (width === 72 ? 108 : step)
                  : null;
        if (next !== null) {
          e.preventDefault();
          onCommit(next);
        }
      }}
    />
  );
}
