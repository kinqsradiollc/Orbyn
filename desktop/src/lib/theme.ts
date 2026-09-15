import { useState } from "react";

/** System follows the device; Light and Dark stick. */
export type ThemeChoice = "system" | "light" | "dark";

/** Also read by the inline script in index.html, before first paint. */
const THEME_KEY = "orbyn-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
/** Page backgrounds, for the browser's theme colour. */
const BACKGROUNDS = { light: "#f7f8fa", dark: "#121614" };

export function savedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** Sets `data-theme` on <html> (none for System) and the theme colour. */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  const dark =
    choice === "dark" ||
    (choice === "system" && window.matchMedia(DARK_QUERY).matches);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? BACKGROUNDS.dark : BACKGROUNDS.light);
}

/** Keeps the theme colour in step when the device switches themes. */
export function followSystemTheme() {
  window
    .matchMedia(DARK_QUERY)
    .addEventListener("change", () => applyTheme(savedTheme()));
}

/** The saved theme and a setter that applies and remembers it. */
export function useTheme() {
  const [choice, setChoice] = useState(savedTheme);
  const change = (next: ThemeChoice) => {
    setChoice(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the choice lasts this visit.
    }
    applyTheme(next);
  };
  return [choice, change] as const;
}
