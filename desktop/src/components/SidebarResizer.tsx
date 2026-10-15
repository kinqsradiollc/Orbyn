import { useEffect, useRef, useState } from "react";

export const DEFAULT_SIDEBAR_WIDTH = 224;
export function savedSidebarWidth() {
  try {
    const width = Number(localStorage.getItem("orbyn-sidebar-width"));
    return Number.isFinite(width) && width >= 200 && width <= 400
      ? width
      : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
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
  const latest = useRef({ width, onChange });
  latest.current = { width, onChange };
  useEffect(() => {
    const scope = edge.current?.closest<HTMLElement>(".app.workspace");
    if (!scope) return;
    const measure = () => {
      if (!window.matchMedia("(min-width: 801px)").matches) return;
      const max = Math.max(200, Math.min(400, scope.clientWidth - 320));
      setMaximum(max);
      if (latest.current.width > max) latest.current.onChange(max);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scope);
    return () => observer.disconnect();
  }, []);
  const change = (value: number, remember = false) => {
    const next = Math.round(Math.max(200, Math.min(maximum, value)));
    onChange(next);
    if (remember) {
      try {
        localStorage.setItem("orbyn-sidebar-width", String(next));
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
      aria-valuemin={200}
      aria-valuemax={maximum}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
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
          change(width + (event.shiftKey ? 40 : 10), true);
        else if (event.key === "Home") change(200, true);
        else if (event.key === "End") change(maximum, true);
        else return;
        event.preventDefault();
      }}
    />
  );
}
