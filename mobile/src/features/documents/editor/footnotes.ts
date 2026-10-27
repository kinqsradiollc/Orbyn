import { createContext } from "react";

/**
 * The page's footnotes (EDT-13): each marker's number and words, and how
 * to show a note's words when its marker is tapped. Kept apart from the
 * blocks that draw them, so a line of text can read it without importing
 * every kind of block.
 */
export const FootnoteContext = createContext<{
  numbers: Map<string, number>;
  texts: Map<string, string>;
  references?: ReadonlyMap<string, string>;
  onShow?: (n: string, words: string) => void;
}>({ numbers: new Map(), texts: new Map() });
