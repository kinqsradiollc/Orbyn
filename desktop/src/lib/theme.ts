import { useState } from "react";

/** Light unless Dark, or System on a dark device, is chosen in Settings. */
export type ThemeChoice = "system" | "light" | "dark";

/** Also read by the inline script in index.html, before first paint. */
const THEME_KEY = "orbyn-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
/** Page backgrounds, for the browser's theme colour. */
const BACKGROUNDS = { light: "#f7f8fa", dark: "#121614" };

export function savedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "dark" || value === "system" ? value : "light";
  } catch {
    return "light";
  }
}

/** Sets `data-theme` on <html> to what the choice resolves to, and the theme colour. */
export function applyTheme(choice: ThemeChoice) {
  const dark =
    choice === "dark" ||
    (choice === "system" && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? BACKGROUNDS.dark : BACKGROUNDS.light);
}

/** Keeps a System choice in step when the device switches themes. */
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
      if (next === "light") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the choice lasts this visit.
    }
    applyTheme(next);
  };
  return [choice, change] as const;
}
