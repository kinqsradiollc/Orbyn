/**
 * Reading first (EDT-10): whether pages on this device open for reading,
 * with no editing handles, until Edit (or ⌘⇧R) is pressed. Kept per device,
 * so a phone and a computer can differ; a touch screen reads first unless
 * told otherwise.
 */
const KEY = "orbyn-pages-read-first";

export function readsFirst(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "1") return true;
    if (saved === "0") return false;
  } catch {
    // Storage refused: fall back to what the device is.
  }
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(pointer: coarse)").matches
  );
}

export function setReadsFirst(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Private windows can refuse storage; the choice lasts this visit.
  }
}
