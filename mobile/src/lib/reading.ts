import { readLocal, saveLocal } from "./localPrefs";

/**
 * Reading on the phone (EDT-10, MOB-03), chosen per device in Settings:
 *
 * - pages open for reading — no handles, no keyboard — and a double tap on
 *   a line edits it there. On unless turned off;
 * - the header steps aside while a long page is read, and comes back on a
 *   scroll up or a tap at the top. On unless turned off.
 */
const READ_FIRST = "orbyn-pages-read-first";
const HIDE_CHROME = "orbyn-pages-hide-header";

export const readsFirst = () => readLocal(READ_FIRST) !== "0";
export const setReadsFirst = (on: boolean) =>
  saveLocal(READ_FIRST, on ? "1" : "0");

export const hidesHeaderWhileReading = () => readLocal(HIDE_CHROME) !== "0";
export const setHidesHeaderWhileReading = (on: boolean) =>
  saveLocal(HIDE_CHROME, on ? "1" : "0");

/**
 * Whether the header should be out of the way, from the page's scroll: down
 * past the top hides it, any way up (or back at the top) shows it. Only a
 * page at least two screens long is worth it.
 */
export function headerHiddenAfter(
  was: boolean,
  scroll: { y: number; lastY: number; content: number; frame: number },
): boolean {
  if (scroll.content < scroll.frame * 2) return false;
  if (scroll.y < 80) return false;
  const moved = scroll.y - scroll.lastY;
  if (moved > 6) return true;
  if (moved < -6) return false;
  return was;
}
