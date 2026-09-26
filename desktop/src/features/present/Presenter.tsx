import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { listLayout, pageSlides, slideStep, type DocBlock } from "@orbyn/core";
import { BlockView } from "../docs/DocBlocks";
import "./present.css";

/**
 * Present a page as slides (CNV-03): the page splits at its dividers and
 * top headings and fills the screen in large type, one slide at a time.
 * Arrow keys, Space and the buttons move; Esc leaves. Nothing on the page
 * changes; ticking a checklist line here is left to the page itself.
 */
export function Presenter({
  title,
  blocks,
  onClose,
}: {
  title: string;
  blocks: DocBlock[];
  onClose: () => void;
}) {
  const slides = pageSlides(title, blocks);
  const [at, setAt] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = root.current;
    const opener = document.activeElement as HTMLElement | null;
    el?.focus();
    // Full screen where the browser allows it; the overlay works either way.
    el?.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen?.();
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      const next = slideStep(e.key, at, slides.length);
      if (next === null) return;
      e.preventDefault();
      setAt(next);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [at, slides.length]);

  const slide = slides[Math.min(at, slides.length - 1)];
  const layout = listLayout(slide.blocks);
  return createPortal(
    <div
      ref={root}
      className="presenter"
      role="dialog"
      aria-modal="true"
      aria-label={`Presenting ${title || "Untitled"}`}
      tabIndex={-1}
    >
      <button
        className="icon-button presenter-close"
        aria-label="Stop presenting"
        title="Stop presenting (Esc)"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <section
        className="presenter-slide"
        aria-live="polite"
        aria-label={`Slide ${at + 1} of ${slides.length}`}
        key={at}
      >
        {slide.title && (
          <h1 className="presenter-title" dir="auto">
            {slide.title}
          </h1>
        )}
        <div className="presenter-body doc-body">
          {slide.blocks.map((block, i) => (
            <div key={block.id ?? i} className="doc-block">
              <BlockView
                block={block}
                number={layout[i]?.number ?? null}
                depth={layout[i]?.depth ?? 0}
                pageBlocks={blocks}
              />
            </div>
          ))}
        </div>
      </section>
      <nav className="presenter-nav" aria-label="Slides">
        <button
          className="icon-button"
          aria-label="Previous slide"
          disabled={at === 0}
          onClick={() => setAt((n) => Math.max(n - 1, 0))}
        >
          <ChevronLeft size={20} />
        </button>
        <span className="presenter-count">
          {at + 1} / {slides.length}
        </span>
        <button
          className="icon-button"
          aria-label="Next slide"
          disabled={at >= slides.length - 1}
          onClick={() => setAt((n) => Math.min(n + 1, slides.length - 1))}
        >
          <ChevronRight size={20} />
        </button>
      </nav>
    </div>,
    document.body,
  );
}
