/**
 * Present a page as slides (CNV-03), and which way a line reads (DSN-04).
 *
 * A page splits into slides at its dividers (---) and at each top-level
 * heading, so a lecture or a stand-up agenda presents with nothing added.
 * Empty slides are dropped; a page with neither makes one slide. Comments,
 * footnote definitions and folded state don't travel onto slides.
 */
import type { DocBlock } from "./docs.js";

export type Slide = {
  /** The top-level heading it starts with, if it starts with one. */
  title: string | null;
  /** Its lines, the heading left out (it is the slide's title). */
  blocks: DocBlock[];
};

const isEmpty = (b: DocBlock) =>
  "text" in b &&
  b.type !== "image" &&
  b.type !== "file" &&
  !String(b.text ?? "").trim();

/** The slides a page makes: split at dividers and at level-one headings. */
export function pageSlides(title: string, content: DocBlock[]): Slide[] {
  const slides: Slide[] = [];
  let current: Slide = { title: null, blocks: [] };
  const flush = () => {
    const blocks = current.blocks.filter((b) => !isEmpty(b));
    if (current.title || blocks.length) slides.push({ ...current, blocks });
    current = { title: null, blocks: [] };
  };
  for (const block of content) {
    if (block.type === "divider") {
      flush();
      continue;
    }
    if (block.type === "footnote") continue;
    if (block.type === "heading" && block.level === 1) {
      flush();
      current.title = block.text.trim() || null;
      continue;
    }
    current.blocks.push(block);
  }
  flush();
  // The first slide takes the page's title when it has none of its own.
  if (!slides.length)
    return [{ title: title.trim() || "Untitled", blocks: [] }];
  if (!slides[0].title && title.trim())
    slides[0] = { ...slides[0], title: title.trim() };
  // A page that starts with its own top heading still opens on its title.
  else if (
    title.trim() &&
    slides[0].title !== title.trim() &&
    content.find((b) => !isEmpty(b))?.type === "heading"
  )
    slides.unshift({ title: title.trim(), blocks: [] });
  return slides;
}

/** The next slide number after a key press, or null for a key that isn't one. */
export function slideStep(
  key: string,
  at: number,
  count: number,
): number | null {
  const last = Math.max(count - 1, 0);
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
    case "Enter":
      return Math.min(at + 1, last);
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
      return Math.max(at - 1, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

// ------------------------------------------------------ right to left ---

// Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic and their
// presentation forms.
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
// Latin, Greek, Cyrillic and most other left-to-right scripts' letters.
const LTR = /[A-Za-zÀ-ʸͰ-֏ऀ-῿Ⰰ-﬜]/;

/**
 * Which way a line reads, from its first strong letter (as dir="auto" does):
 * Arabic or Hebrew first reads right to left. Markdown marks, links' targets,
 * maths and numbers don't count.
 */
export function lineDirection(text: string): "ltr" | "rtl" {
  const plain = text
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/\$[^$]*\$/g, " ")
    .replace(/`[^`]*`/g, " ");
  for (const ch of plain) {
    if (RTL.test(ch)) return "rtl";
    if (LTR.test(ch)) return "ltr";
  }
  return "ltr";
}
