import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import "./document-workspace.css";
export const DocumentLibraryContext = createContext<{
  setSourceOpen: (open: boolean) => void;
} | null>(null);
export function useDocumentWorkspace(
  root: RefObject<HTMLElement | null>,
  open: boolean,
) {
  const library = useContext(DocumentLibraryContext);
  const endResize = useRef<(() => void) | null>(null);
  useEffect(() => () => endResize.current?.(), []);
  const controls = useRef(library);
  controls.current = library;
  const [compact, setCompact] = useState(false);
  const [view, setView] = useState<"source" | "preview">("source");
  const [ratio, setRatio] = useState(() => {
    try {
      const n = Number(localStorage.getItem("orbyn-document-split"));
      return n >= 30 && n <= 70 ? n : 50;
    } catch {
      return 50;
    }
  });
  useLayoutEffect(() => {
    controls.current?.setSourceOpen(open);
    if (open) setView("source");
    return () => controls.current?.setSourceOpen(false);
  }, [open]);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => {
      setCompact(node.getBoundingClientRect().width < 760);
      node.style.setProperty(
        "--document-height",
        `${Math.max(240, window.innerHeight - Math.max(0, node.getBoundingClientRect().top) - 8)}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node.parentElement ?? node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [root, open]);
  const changeRatio = (n: number) => {
    const value = Math.max(30, Math.min(70, Math.round(n)));
    setRatio(value);
    try {
      localStorage.setItem("orbyn-document-split", String(value));
    } catch {}
  };
  const divider = open ? (
    <div
      className="document-divider"
      role="separator"
      tabIndex={0}
      aria-label="Resize source and preview"
      aria-orientation="vertical"
      aria-valuemin={30}
      aria-valuemax={70}
      aria-valuenow={ratio}
      onKeyDown={(event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          changeRatio(
            event.key === "Home"
              ? 30
              : event.key === "End"
                ? 70
                : ratio + (event.key === "ArrowRight" ? 5 : -5),
          );
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        endResize.current?.();
        const divider = event.currentTarget;
        const box = divider.parentElement!.getBoundingClientRect();
        const pointerId = event.pointerId;
        const node = root.current;
        node?.setAttribute("data-resizing", "");
        const frames = [...(node?.querySelectorAll("iframe") ?? [])];
        const styles = frames.map((frame) => frame.style.pointerEvents);
        frames.forEach((frame) => {
          frame.style.pointerEvents = "none";
        });
        const move = (next: PointerEvent) => {
          if (next.pointerId === pointerId)
            changeRatio(
              ((next.clientX - box.left) / Math.max(1, box.width)) * 100,
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
          node?.removeAttribute("data-resizing");
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
  ) : null;
  return {
    compact,
    view,
    setView,
    divider,
    style: {
      "--document-source-size": `${ratio}fr`,
      "--document-preview-size": `${100 - ratio}fr`,
    } as CSSProperties,
  };
}
export function DocumentPaneSwitch({
  view,
  onChange,
}: {
  view: "source" | "preview";
  onChange: (view: "source" | "preview") => void;
}) {
  return (
    <div
      className="document-pane-switch"
      role="group"
      aria-label="Document pane"
    >
      {(["source", "preview"] as const).map((pane) => (
        <button
          key={pane}
          className="text-button"
          aria-pressed={view === pane}
          onClick={() => onChange(pane)}
        >
          {pane === "source" ? "Source" : "Preview"}
        </button>
      ))}
    </div>
  );
}
