import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createPortal } from "react-dom";

type Props = {
  /** Where it opened from; the popover sits below (or above) this box. */
  anchor: DOMRect;
  /** Accessible name. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * Whether focus moves into the popover on open and back on close. Off for
   * a menu that assists typing — a slash menu over a text field — where
   * taking focus would blur the field and end the edit it is helping with.
   */
  takeFocus?: boolean;
  /** Width, when the default 300px is too narrow for what it holds. */
  width?: number;
};

/**
 * A small floating menu next to what opened it. Escape or a click outside
 * closes it; focus moves in on open and back to the opener on close.
 */
export function Popover({
  anchor,
  label,
  onClose,
  children,
  takeFocus = true,
  width,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: anchor.bottom + 6, left: anchor.left });
  const latest = useRef(onClose);
  latest.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0;
      const y = viewport?.offsetTop ?? 0;
      const availableWidth = viewport?.width ?? window.innerWidth;
      const availableHeight = viewport?.height ?? window.innerHeight;
      el.style.maxHeight = `${Math.max(0, availableHeight - 16)}px`;
      el.style.maxWidth = `${Math.max(0, availableWidth - 16)}px`;
      const { width, height } = el.getBoundingClientRect();
      const left = Math.max(
        x + 8,
        Math.min(anchor.left, x + availableWidth - width - 8),
      );
      const below = anchor.bottom + 6;
      const wanted =
        below + height > y + availableHeight - 8
          ? anchor.top - height - 6
          : below;
      const top = Math.max(
        y + 8,
        Math.min(wanted, y + availableHeight - height - 8),
      );
      setPos({ top, left });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [anchor, width]);

  useEffect(() => {
    const opener = takeFocus
      ? (document.activeElement as HTMLElement | null)
      : null;
    if (takeFocus)
      ref.current
        ?.querySelector<HTMLElement>("button:not(:disabled), a[href], input")
        ?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        latest.current();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        latest.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
      opener?.focus?.({ preventScroll: true });
    };
  }, [takeFocus]);

  return createPortal(
    <div
      ref={ref}
      className="popover scale-in"
      role="dialog"
      aria-label={label}
      style={{
        top: pos.top,
        left: pos.left,
        ...(width ? { width: `min(${width}px, calc(100vw - 16px))` } : {}),
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
