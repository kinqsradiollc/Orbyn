import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "dim";

const THEMES: readonly Theme[] = ["light", "dark", "dim"];
const isTheme = (value: unknown): value is Theme =>
  THEMES.includes(value as Theme);
/** Dark and Dim are both dark schemes. */
export const isDarkTheme = (value: Theme) => value !== "light";

/** The same key the old client uses, so the choice carries over. */
const KEY = "orbyn-theme";

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (isTheme(saved)) return saved;
  } catch {
    // Fall back to the system preference.
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let theme = initial();
const listeners = new Set<() => void>();
let transitionFrame = 0;

function apply(next: Theme, persist: boolean) {
  // Commit every surface's palette together, then restore hover transitions.
  document.documentElement.setAttribute("data-theme-changing", "");
  theme = next;
  document.documentElement.dataset.theme = next;
  if (persist) {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // The explicit choice still lasts for this page.
    }
  }
  cancelAnimationFrame(transitionFrame);
  transitionFrame = requestAnimationFrame(() => {
    transitionFrame = requestAnimationFrame(() => {
      document.documentElement.removeAttribute("data-theme-changing");
    });
  });
  listeners.forEach((listener) => listener());
}

apply(theme, true);
window.addEventListener("storage", (event) => {
  if (event.key === KEY && isTheme(event.newValue))
    apply(event.newValue, false);
});
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const setTheme = (next: Theme) => apply(next, true);
const toggle = () => setTheme(isDarkTheme(theme) ? "light" : "dark");

export function useTheme() {
  const value = useSyncExternalStore(subscribe, () => theme);
  return [value, toggle] as const;
}
