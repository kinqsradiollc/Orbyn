import type { CSSProperties } from "react";

/**
 * Inline style that feeds a list index to the `.stagger` utility in
 * styles/motion.css (delay = min(index, maxStagger) * stagger).
 */
export const stagger = (index: number) => ({ "--i": index }) as CSSProperties;
