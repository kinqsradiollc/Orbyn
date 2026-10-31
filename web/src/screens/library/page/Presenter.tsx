import { listLayout, pageSlides, slideStep, type DocBlock } from "@orbyn/core";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "../../../ui/kit";
import { BlockView } from "./Blocks";

/** The page as slides. Arrow keys, Space and the buttons move; Esc leaves. */
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
  const root = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = root.current;
    const opener = document.activeElement as HTMLElement | null;
    element?.showModal();
    element?.focus();
    element?.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement === element)
        void document.exitFullscreen?.().catch(() => {});
      element?.close();
      opener?.focus?.();
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === " " &&
        (event.target as HTMLElement)?.closest("button, a")
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      const next = slideStep(event.key, at, slides.length);
      if (next === null) return;
      event.preventDefault();
      setAt(next);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [at, slides.length]);
  const slide = slides[Math.min(at, slides.length - 1)];
  const layout = listLayout(slide.blocks);
  return createPortal(
    <dialog
      ref={root}
      className="doc-present"
      aria-label={`Presenting ${title || "Untitled"}`}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <IconButton
        className="doc-present-close"
        label="Stop presenting"
        onClick={onClose}
      >
        <X />
      </IconButton>
      <section
        className="doc-present-slide"
        aria-live="polite"
        aria-label={`Slide ${at + 1} of ${slides.length}`}
      >
        {slide.title && <h1 dir="auto">{slide.title}</h1>}
        <div>
          {slide.blocks.map((block, index) => (
            <BlockView
              key={block.id ?? index}
              block={block}
              number={layout[index]?.number}
              depth={layout[index]?.depth}
              pageBlocks={blocks}
            />
          ))}
        </div>
      </section>
      <nav className="doc-present-nav" aria-label="Slides">
        <IconButton
          label="Previous slide"
          disabled={at === 0}
          onClick={() => setAt((n) => Math.max(n - 1, 0))}
        >
          <ChevronLeft />
        </IconButton>
        <span className="small">
          {at + 1} / {slides.length}
        </span>
        <IconButton
          label="Next slide"
          disabled={at >= slides.length - 1}
          onClick={() => setAt((n) => Math.min(n + 1, slides.length - 1))}
        >
          <ChevronRight />
        </IconButton>
      </nav>
    </dialog>,
    document.body,
  );
}
