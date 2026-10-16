import { useEffect, useRef, useState } from "react";

export const DEFAULT_SIDEBAR_WIDTH = 224;
export const SIDEBAR_WIDTH_KEY = "orbyn-navigation-width-v2";
export const SIDEBAR_RAIL_WIDTH = 72;
export const SIDEBAR_LABEL_WIDTH = 180;

export function sidebarMaximum(available: number) {
  return Math.max(SIDEBAR_RAIL_WIDTH, Math.min(400, available - 880));
}
export function boundedSidebarWidth(value: number, maximum = 400) {
  const next = Math.round(Math.min(maximum, value));
  return next < SIDEBAR_LABEL_WIDTH ? SIDEBAR_RAIL_WIDTH : next;
}
/** Viewport fitting never overwrites the person's preferred width. */
export function sidebarLayout(preferred: number, available: number) {
  const width =
    available <= 800
      ? DEFAULT_SIDEBAR_WIDTH
      : boundedSidebarWidth(preferred, sidebarMaximum(available));
  return { width, railed: available > 800 && width === SIDEBAR_RAIL_WIDTH };
}
export function savedSidebarWidth() {
  try {
    const width = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(width) &&
      (width === SIDEBAR_RAIL_WIDTH || width >= SIDEBAR_LABEL_WIDTH) &&
      width <= 400
      ? width
      : SIDEBAR_RAIL_WIDTH;
  } catch {
    return SIDEBAR_RAIL_WIDTH;
  }
}

/** Pointer and keyboard resizing share the same bounded, remembered width. */
export function SidebarResizer({
  width,
  onChange,
}: {
  width: number;
  onChange: (width: number) => void;
}) {
  const edge = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(
    null,
  );
  const [maximum, setMaximum] = useState(400);
  useEffect(() => {
    const scope = edge.current?.closest<HTMLElement>(".app.workspace");
    if (!scope) return;
    const measure = () => {
      if (!window.matchMedia("(min-width: 801px)").matches) return;
      const max = boundedSidebarWidth(400, sidebarMaximum(scope.clientWidth));
      setMaximum(max);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scope);
    return () => observer.disconnect();
  }, []);
  const change = (value: number, remember = false) => {
    const next = boundedSidebarWidth(value, maximum);
    onChange(next);
    if (remember) {
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
      } catch {
        /* Session choice remains usable. */
      }
    }
  };
  return (
    <div
      ref={edge}
      className="sidebar-resizer"
      role="separator"
      aria-label="Navigation width"
      aria-orientation="vertical"
      tabIndex={0}
      aria-valuemin={SIDEBAR_RAIL_WIDTH}
      aria-valuemax={maximum}
      aria-valuenow={width}
      aria-valuetext={
        width === SIDEBAR_RAIL_WIDTH ? "Icon rail" : `${width} pixels`
      }
      aria-controls="workspace-navigation"
      onDoubleClick={() => change(DEFAULT_SIDEBAR_WIDTH, true)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointer === event.pointerId)
          change(start.width + event.clientX - start.x);
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (start?.pointer !== event.pointerId) return;
        change(start.width + event.clientX - start.x, true);
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (drag.current) change(drag.current.width);
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          change(drag.current.width);
          const pointer = drag.current.pointer;
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(pointer))
            event.currentTarget.releasePointerCapture(pointer);
        } else if (event.key === "ArrowLeft")
          change(width - (event.shiftKey ? 40 : 10), true);
        else if (event.key === "ArrowRight")
          change(
            width === SIDEBAR_RAIL_WIDTH
              ? SIDEBAR_LABEL_WIDTH
              : width + (event.shiftKey ? 40 : 10),
            true,
          );
        else if (event.key === "Home") change(SIDEBAR_RAIL_WIDTH, true);
        else if (event.key === "End") change(maximum, true);
        else return;
        event.preventDefault();
      }}
    />
  );
}
