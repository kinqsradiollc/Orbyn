import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, anchor.left),
      window.innerWidth - width - 8,
    );
    const below = anchor.bottom + 6;
    const top =
      below + height > window.innerHeight - 8
        ? Math.max(8, anchor.top - height - 6)
        : below;
    setPos({ top, left });
  }, [anchor]);

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
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        latest.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      opener?.focus?.();
    };
  }, [takeFocus]);

  return (
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
    </div>
  );
}
